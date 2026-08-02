"""Repository for deterministic Stage 0 state and independent reviews."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import (
    Engine,
    create_engine,
    event,
    func,
    inspect,
    select,
    update,
)
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import Connection

from math_kangaroo_trainer.corpus.duplicates import (
    DuplicateGroup,
    asset_signature,
    text_signature,
)
from math_kangaroo_trainer.domain.items import ImportedItem, SourceDocument
from math_kangaroo_trainer.domain.reviews import (
    DuplicateDecision,
    DuplicateGoldReview,
    GoldReview,
    ReviewDisposition,
)
from math_kangaroo_trainer.versions import (
    DUPLICATE_ALGORITHM_VERSION,
    REVIEW_CARRY_FORWARD_SCHEMA_VERSION,
)

from .models import (
    audit_items,
    audit_runs,
    duplicate_group_members,
    duplicate_groups,
    duplicate_review_history,
    duplicate_reviews,
    gold_review_history,
    gold_reviews,
    review_carry_forward_events,
    source_documents,
)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class _BorrowedConnectionContext:
    def __init__(self, connection: Connection) -> None:
        self.connection = connection

    def __enter__(self) -> Connection:
        return self.connection

    def __exit__(self, *_: object) -> None:
        return None


class _BorrowedConnectionEngine:
    """Let report code read an uncommitted carry-forward transaction."""

    def __init__(self, connection: Connection) -> None:
        self.connection = connection

    def connect(self) -> _BorrowedConnectionContext:
        return _BorrowedConnectionContext(self.connection)

    def begin(self) -> _BorrowedConnectionContext:
        return _BorrowedConnectionContext(self.connection)


def _review_event_id(values: Mapping[str, Any]) -> str:
    return hashlib.sha256(_json(values).encode("utf-8")).hexdigest()


def _gold_review_values(review: GoldReview) -> dict[str, Any]:
    return {
        "run_id": review.run_id,
        "item_id": review.item_id,
        "content_version": review.content_version,
        "reviewer_slot": review.reviewer_slot,
        "reviewer_id": review.reviewer_id,
        "question_boundary_verified": int(review.question_boundary_verified),
        "choices_verified": int(review.choices_verified),
        "answer_key_verified": int(review.answer_key_verified),
        "diagram_verified": int(review.diagram_verified),
        "source_metadata_verified": int(review.source_metadata_verified),
        "disposition": review.disposition.value,
        "notes": review.notes,
        "reviewed_at": review.reviewed_at.astimezone(timezone.utc).isoformat(),
        "schema_version": review.schema_version,
    }


def _duplicate_review_values(review: DuplicateGoldReview) -> dict[str, Any]:
    return {
        "run_id": review.run_id,
        "group_id": review.group_id,
        "reviewer_slot": review.reviewer_slot,
        "signature": review.signature,
        "reviewer_id": review.reviewer_id,
        "decision": review.decision.value,
        "notes": review.notes,
        "reviewed_at": review.reviewed_at.astimezone(timezone.utc).isoformat(),
        "schema_version": review.schema_version,
    }


def _append_gold_review(connection: Connection, review: GoldReview) -> int:
    item_row = connection.execute(
        select(audit_items.c.item_id, audit_items.c.content_version)
        .where(audit_items.c.run_id == review.run_id)
        .where(audit_items.c.item_id == review.item_id)
    ).mappings().one_or_none()
    if item_row is None:
        raise ValueError(
            f"review references unknown audit item {review.run_id}/{review.item_id}"
        )
    if item_row["content_version"] != review.content_version:
        raise ValueError(f"review content version does not match {review.item_id}")

    values = _gold_review_values(review)
    existing = connection.execute(
        select(gold_reviews)
        .where(gold_reviews.c.run_id == review.run_id)
        .where(gold_reviews.c.item_id == review.item_id)
        .where(gold_reviews.c.reviewer_slot == review.reviewer_slot)
    ).mappings().one_or_none()
    if existing is not None and existing["reviewed_at"] == values["reviewed_at"]:
        comparable = {key: existing[key] for key in values}
        if comparable != values:
            raise ValueError("conflicting review revisions cannot share reviewed_at")
    historical_payloads = connection.execute(
        select(gold_review_history.c.payload_json)
        .where(gold_review_history.c.run_id == review.run_id)
        .where(gold_review_history.c.item_id == review.item_id)
        .where(gold_review_history.c.reviewer_slot == review.reviewer_slot)
        .where(gold_review_history.c.reviewed_at == values["reviewed_at"])
    ).scalars().all()
    if historical_payloads and _json(values) not in historical_payloads:
        raise ValueError("conflicting review revisions cannot share reviewed_at")

    event_id = _review_event_id(values)
    history_result = connection.execute(
        sqlite_insert(gold_review_history)
        .values(
            review_event_id=event_id,
            run_id=review.run_id,
            item_id=review.item_id,
            content_version=review.content_version,
            reviewer_slot=review.reviewer_slot,
            reviewer_id=review.reviewer_id,
            disposition=review.disposition.value,
            reviewed_at=values["reviewed_at"],
            schema_version=review.schema_version,
            payload_json=_json(values),
        )
        .on_conflict_do_nothing(index_elements=[gold_review_history.c.review_event_id])
    )
    statement = sqlite_insert(gold_reviews).values(**values)
    statement = statement.on_conflict_do_update(
        index_elements=[
            gold_reviews.c.run_id,
            gold_reviews.c.item_id,
            gold_reviews.c.reviewer_slot,
        ],
        set_={
            key: getattr(statement.excluded, key)
            for key in values
            if key not in {"run_id", "item_id", "reviewer_slot"}
        },
        where=statement.excluded.reviewed_at > gold_reviews.c.reviewed_at,
    )
    connection.execute(statement)
    return max(history_result.rowcount or 0, 0)


def _refresh_item_review_states(
    connection: Connection, touched: set[tuple[str, str]]
) -> None:
    for run_id, item_id in touched:
        rows = connection.execute(
            select(gold_reviews.c.disposition, gold_reviews.c.reviewer_id)
            .where(gold_reviews.c.run_id == run_id)
            .where(gold_reviews.c.item_id == item_id)
            .order_by(gold_reviews.c.reviewer_slot)
        ).all()
        if any(row.disposition == ReviewDisposition.REJECTED.value for row in rows):
            state = "rejected"
        elif any(
            row.disposition == ReviewDisposition.NEEDS_REVIEW.value for row in rows
        ):
            state = "needs_review"
        elif len(rows) == 2 and rows[0].reviewer_id == rows[1].reviewer_id:
            state = "reviewer_conflict"
        elif len(rows) == 2 and all(
            row.disposition == ReviewDisposition.FAITHFUL.value for row in rows
        ):
            state = "double_reviewed_faithful"
        else:
            state = "singly_reviewed"
        connection.execute(
            update(audit_items)
            .where(audit_items.c.run_id == run_id)
            .where(audit_items.c.item_id == item_id)
            .values(review_state=state)
        )


def _append_duplicate_review(
    connection: Connection, review: DuplicateGoldReview
) -> int:
    group = connection.execute(
        select(duplicate_groups.c.run_id, duplicate_groups.c.signature).where(
            duplicate_groups.c.group_id == review.group_id
        )
    ).mappings().one_or_none()
    if group is None or group["run_id"] != review.run_id:
        raise ValueError(
            "duplicate review references unknown audit group "
            f"{review.run_id}/{review.group_id}"
        )
    if group["signature"] != review.signature:
        raise ValueError(
            f"duplicate review signature does not match {review.group_id}"
        )

    values = _duplicate_review_values(review)
    existing = connection.execute(
        select(duplicate_reviews)
        .where(duplicate_reviews.c.run_id == review.run_id)
        .where(duplicate_reviews.c.group_id == review.group_id)
        .where(duplicate_reviews.c.reviewer_slot == review.reviewer_slot)
    ).mappings().one_or_none()
    if existing is not None and existing["reviewed_at"] == values["reviewed_at"]:
        comparable = {key: existing[key] for key in values}
        if comparable != values:
            raise ValueError(
                "conflicting duplicate-review revisions cannot share reviewed_at"
            )
    historical_payloads = connection.execute(
        select(duplicate_review_history.c.payload_json)
        .where(duplicate_review_history.c.run_id == review.run_id)
        .where(duplicate_review_history.c.group_id == review.group_id)
        .where(duplicate_review_history.c.reviewer_slot == review.reviewer_slot)
        .where(duplicate_review_history.c.reviewed_at == values["reviewed_at"])
    ).scalars().all()
    if historical_payloads and _json(values) not in historical_payloads:
        raise ValueError(
            "conflicting duplicate-review revisions cannot share reviewed_at"
        )

    event_id = _review_event_id(values)
    history_result = connection.execute(
        sqlite_insert(duplicate_review_history)
        .values(
            review_event_id=event_id,
            run_id=review.run_id,
            group_id=review.group_id,
            reviewer_slot=review.reviewer_slot,
            reviewer_id=review.reviewer_id,
            decision=review.decision.value,
            reviewed_at=values["reviewed_at"],
            schema_version=review.schema_version,
            payload_json=_json(values),
        )
        .on_conflict_do_nothing(
            index_elements=[duplicate_review_history.c.review_event_id]
        )
    )
    statement = sqlite_insert(duplicate_reviews).values(**values)
    statement = statement.on_conflict_do_update(
        index_elements=[
            duplicate_reviews.c.run_id,
            duplicate_reviews.c.group_id,
            duplicate_reviews.c.reviewer_slot,
        ],
        set_={
            key: getattr(statement.excluded, key)
            for key in values
            if key not in {"run_id", "group_id", "reviewer_slot"}
        },
        where=statement.excluded.reviewed_at > duplicate_reviews.c.reviewed_at,
    )
    connection.execute(statement)
    return max(history_result.rowcount or 0, 0)


def _refresh_duplicate_review_states(
    connection: Connection, touched: set[tuple[str, str]]
) -> None:
    for run_id, group_id in touched:
        rows = connection.execute(
            select(duplicate_reviews.c.reviewer_id, duplicate_reviews.c.decision)
            .where(duplicate_reviews.c.run_id == run_id)
            .where(duplicate_reviews.c.group_id == group_id)
            .order_by(duplicate_reviews.c.reviewer_slot)
        ).all()
        if len(rows) == 2 and rows[0].reviewer_id == rows[1].reviewer_id:
            status = "reviewer_conflict"
        elif len(rows) == 2 and rows[0].decision == rows[1].decision:
            if rows[0].decision == DuplicateDecision.CONFIRMED.value:
                status = "double_reviewed_confirmed"
            elif rows[0].decision == DuplicateDecision.REJECTED.value:
                status = "double_reviewed_rejected"
            else:
                status = "needs_review"
        elif len(rows) == 2:
            status = "needs_review"
        elif rows and rows[0].decision == DuplicateDecision.NEEDS_REVIEW.value:
            status = "needs_review"
        else:
            status = "singly_reviewed"
        connection.execute(
            update(duplicate_groups)
            .where(duplicate_groups.c.run_id == run_id)
            .where(duplicate_groups.c.group_id == group_id)
            .values(review_status=status)
        )


class AuditRepository:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path.resolve()
        self.engine: Engine = create_engine(f"sqlite:///{self.database_path.as_posix()}")
        event.listen(self.engine, "connect", self._enable_sqlite_integrity)

    @staticmethod
    def _enable_sqlite_integrity(dbapi_connection: Any, _: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.close()

    def close(self) -> None:
        self.engine.dispose()

    def upsert_run(self, run: Mapping[str, Any]) -> None:
        statement = sqlite_insert(audit_runs).values(**run)
        statement = statement.on_conflict_do_update(
            index_elements=[audit_runs.c.run_id],
            set_={
                "source_path": statement.excluded.source_path,
                "source_sha256": statement.excluded.source_sha256,
                "source_item_count": statement.excluded.source_item_count,
                "sample_size": statement.excluded.sample_size,
                "seed": statement.excluded.seed,
                "versions_json": statement.excluded.versions_json,
                "coverage_json": statement.excluded.coverage_json,
                "population_findings_json": statement.excluded.population_findings_json,
            },
        )
        with self.engine.begin() as connection:
            connection.execute(statement)

    def upsert_items(
        self,
        run_id: str,
        items: Iterable[ImportedItem],
        *,
        asset_paths: Mapping[str, Path],
    ) -> None:
        with self.engine.begin() as connection:
            for sample_order, item in enumerate(items, start=1):
                item_id = item.source.item_id
                asset_hash = asset_signature(asset_paths[item_id])
                values = {
                    "run_id": run_id,
                    "item_id": item_id,
                    "sample_order": sample_order,
                    "content_version": item.learner.content_version,
                    "source_json": _json(item.source.model_dump(mode="json")),
                    "learner_json": _json(item.learner.model_dump(mode="json")),
                    "protected_json": _json(item.protected.model_dump(mode="json")),
                    "warning_codes_json": _json(item.warning_codes),
                    "content_gap_codes_json": _json(item.content_gap_codes),
                    "parser_status": item.learner.status.value,
                    "review_state": "pending",
                    "modality": item.modality,
                    "year_band": item.year_band,
                    "choice_count_bucket": item.choice_count_bucket,
                    "asset_path": str(asset_paths[item_id]),
                    "exact_text_sha256": text_signature(item),
                    "exact_asset_sha256": asset_hash,
                }
                statement = sqlite_insert(audit_items).values(**values)
                statement = statement.on_conflict_do_update(
                    index_elements=[audit_items.c.run_id, audit_items.c.item_id],
                    set_={
                        key: getattr(statement.excluded, key)
                        for key in values
                        if key not in {"run_id", "item_id", "review_state"}
                    },
                )
                connection.execute(statement)

    def upsert_source_documents(
        self, run_id: str, documents: Iterable[SourceDocument]
    ) -> None:
        with self.engine.begin() as connection:
            for document in documents:
                values = {
                    "run_id": run_id,
                    "source_path": document.source_path,
                    "metadata_json": _json(document.model_dump(mode="json")),
                    "warning_codes_json": _json(document.warning_codes),
                    "local_pdf_path": document.local_pdf_path,
                    "actual_sha256": document.actual_sha256,
                    "actual_bytes": document.actual_bytes,
                }
                statement = sqlite_insert(source_documents).values(**values)
                statement = statement.on_conflict_do_update(
                    index_elements=[
                        source_documents.c.run_id,
                        source_documents.c.source_path,
                    ],
                    set_={
                        key: getattr(statement.excluded, key)
                        for key in values
                        if key not in {"run_id", "source_path"}
                    },
                )
                connection.execute(statement)

    def replace_duplicate_groups(
        self, run_id: str, groups: Iterable[DuplicateGroup]
    ) -> None:
        with self.engine.begin() as connection:
            for group in groups:
                group_id = "dup-" + hashlib.sha256(
                    f"{run_id}:{group.signature_type}:{group.signature}".encode()
                ).hexdigest()[:24]
                connection.execute(
                    sqlite_insert(duplicate_groups)
                    .values(
                        group_id=group_id,
                        run_id=run_id,
                        signature_type=group.signature_type,
                        signature=group.signature,
                        algorithm_version=DUPLICATE_ALGORITHM_VERSION,
                        review_status="needs_review",
                    )
                    .on_conflict_do_update(
                        index_elements=[duplicate_groups.c.group_id],
                        set_={
                            "algorithm_version": DUPLICATE_ALGORITHM_VERSION,
                            "signature": group.signature,
                        },
                    )
                )
                connection.execute(
                    sqlite_insert(duplicate_group_members)
                    .values(
                        [
                            {"group_id": group_id, "item_id": item_id}
                            for item_id in group.item_ids
                        ]
                    )
                    .on_conflict_do_nothing(),
                )

    def import_reviews(self, reviews: Iterable[GoldReview]) -> int:
        imported = 0
        touched: set[tuple[str, str]] = set()
        with self.engine.begin() as connection:
            for review in reviews:
                imported += _append_gold_review(connection, review)
                touched.add((review.run_id, review.item_id))
            _refresh_item_review_states(connection, touched)
        return imported

    def import_duplicate_reviews(
        self, reviews: Iterable[DuplicateGoldReview]
    ) -> int:
        """Append duplicate adjudications and refresh their latest projections."""

        imported = 0
        touched: set[tuple[str, str]] = set()
        with self.engine.begin() as connection:
            for review in reviews:
                imported += _append_duplicate_review(connection, review)
                touched.add((review.run_id, review.group_id))
            _refresh_duplicate_review_states(connection, touched)
        return imported

    @staticmethod
    def _group_member_versions(
        connection: Connection, *, run_id: str, group_id: str
    ) -> tuple[dict[str, str], tuple[str, ...]]:
        member_ids = tuple(
            connection.execute(
                select(duplicate_group_members.c.item_id)
                .where(duplicate_group_members.c.group_id == group_id)
                .order_by(duplicate_group_members.c.item_id)
            ).scalars()
        )
        if not member_ids:
            return {}, ()
        rows = connection.execute(
            select(audit_items.c.item_id, audit_items.c.content_version)
            .where(audit_items.c.run_id == run_id)
            .where(audit_items.c.item_id.in_(member_ids))
        ).all()
        versions = {str(item_id): str(version) for item_id, version in rows}
        missing = tuple(item_id for item_id in member_ids if item_id not in versions)
        return versions, missing

    @staticmethod
    def _carry_forward_provenance(
        *,
        evidence_kind: str,
        source_run_id: str,
        target_run_id: str,
        source_entity_id: str,
        target_entity_id: str,
        reviewer_slot: int,
        source_review_event_id: str,
        target_review_event_id: str,
        match: Mapping[str, Any],
    ) -> dict[str, Any]:
        identity = {
            "evidence_kind": evidence_kind,
            "source_run_id": source_run_id,
            "target_run_id": target_run_id,
            "source_entity_id": source_entity_id,
            "target_entity_id": target_entity_id,
            "reviewer_slot": reviewer_slot,
            "source_review_event_id": source_review_event_id,
            "target_review_event_id": target_review_event_id,
            "match_json": _json(match),
            "schema_version": REVIEW_CARRY_FORWARD_SCHEMA_VERSION,
        }
        return {
            "carry_forward_event_id": hashlib.sha256(
                _json(identity).encode("utf-8")
            ).hexdigest(),
            **identity,
        }

    @staticmethod
    def _source_history_is_current(
        connection: Connection,
        *,
        history_table: Any,
        event_id: str,
        expected_payload: Mapping[str, Any],
    ) -> bool:
        payload = connection.execute(
            select(history_table.c.payload_json).where(
                history_table.c.review_event_id == event_id
            )
        ).scalar_one_or_none()
        return payload == _json(expected_payload)

    @staticmethod
    def _existing_provenance(
        connection: Connection, expected: Mapping[str, Any]
    ) -> tuple[dict[str, Any] | None, bool]:
        if not inspect(connection).has_table(review_carry_forward_events.name):
            return None, False
        by_target = connection.execute(
            select(review_carry_forward_events)
            .where(
                review_carry_forward_events.c.target_run_id
                == expected["target_run_id"]
            )
            .where(
                review_carry_forward_events.c.evidence_kind
                == expected["evidence_kind"]
            )
            .where(
                review_carry_forward_events.c.target_review_event_id
                == expected["target_review_event_id"]
            )
        ).mappings().one_or_none()
        by_source = connection.execute(
            select(review_carry_forward_events)
            .where(
                review_carry_forward_events.c.source_run_id
                == expected["source_run_id"]
            )
            .where(
                review_carry_forward_events.c.target_run_id
                == expected["target_run_id"]
            )
            .where(
                review_carry_forward_events.c.evidence_kind
                == expected["evidence_kind"]
            )
            .where(
                review_carry_forward_events.c.source_review_event_id
                == expected["source_review_event_id"]
            )
        ).mappings().one_or_none()
        if by_target is not None and by_source is not None:
            if (
                by_target["carry_forward_event_id"]
                != by_source["carry_forward_event_id"]
            ):
                return dict(by_target), False
        row = by_target or by_source
        if row is None:
            return None, False
        comparable = {
            key: row[key]
            for key in expected
            if key != "carry_forward_event_id"
        }
        return dict(row), comparable == {
            key: value
            for key, value in expected.items()
            if key != "carry_forward_event_id"
        }

    @staticmethod
    def _provenance_for_target_event(
        connection: Connection,
        *,
        evidence_kind: str,
        source_run_id: str,
        target_run_id: str,
        target_entity_id: str,
        reviewer_slot: int,
        target_review_event_id: str,
    ) -> dict[str, Any] | None:
        if not inspect(connection).has_table(review_carry_forward_events.name):
            return None
        row = connection.execute(
            select(review_carry_forward_events)
            .where(
                review_carry_forward_events.c.evidence_kind == evidence_kind
            )
            .where(
                review_carry_forward_events.c.source_run_id == source_run_id
            )
            .where(
                review_carry_forward_events.c.target_run_id == target_run_id
            )
            .where(
                review_carry_forward_events.c.target_entity_id == target_entity_id
            )
            .where(
                review_carry_forward_events.c.reviewer_slot == reviewer_slot
            )
            .where(
                review_carry_forward_events.c.target_review_event_id
                == target_review_event_id
            )
        ).mappings().one_or_none()
        return dict(row) if row is not None else None

    def _plan_review_carry_forward(
        self,
        connection: Connection,
        *,
        source_run_id: str,
        target_run_id: str,
    ) -> dict[str, Any]:
        if source_run_id == target_run_id:
            raise ValueError("source and target audit runs must be different")
        known_runs = set(
            connection.execute(
                select(audit_runs.c.run_id).where(
                    audit_runs.c.run_id.in_((source_run_id, target_run_id))
                )
            ).scalars()
        )
        missing_runs = sorted({source_run_id, target_run_id} - known_runs)
        if missing_runs:
            raise ValueError(
                "review carry-forward references unknown audit run(s): "
                + ", ".join(missing_runs)
            )

        plan: dict[str, Any] = {
            "schema_version": REVIEW_CARRY_FORWARD_SCHEMA_VERSION,
            "source_run_id": source_run_id,
            "target_run_id": target_run_id,
            "item_reviews": {
                "eligible": [],
                "already_carried": [],
                "skipped": [],
            },
            "duplicate_reviews": {
                "eligible": [],
                "already_carried": [],
                "skipped": [],
            },
            "blockers": [],
        }
        source_items = {
            str(row["item_id"]): str(row["content_version"])
            for row in connection.execute(
                select(audit_items.c.item_id, audit_items.c.content_version).where(
                    audit_items.c.run_id == source_run_id
                )
            ).mappings()
        }
        target_items = {
            str(row["item_id"]): str(row["content_version"])
            for row in connection.execute(
                select(audit_items.c.item_id, audit_items.c.content_version).where(
                    audit_items.c.run_id == target_run_id
                )
            ).mappings()
        }

        source_item_reviews = connection.execute(
            select(gold_reviews)
            .where(gold_reviews.c.run_id == source_run_id)
            .order_by(gold_reviews.c.item_id, gold_reviews.c.reviewer_slot)
        ).mappings()
        for row in source_item_reviews:
            source_values = dict(row)
            item_id = str(row["item_id"])
            reviewer_slot = int(row["reviewer_slot"])
            reference = {
                "evidence_kind": "item_review",
                "source_entity_id": item_id,
                "target_entity_id": item_id,
                "reviewer_slot": reviewer_slot,
            }
            if source_items.get(item_id) != row["content_version"]:
                plan["blockers"].append(
                    {**reference, "reason": "stale_source_item_review"}
                )
                continue
            source_event_id = _review_event_id(source_values)
            if not self._source_history_is_current(
                connection,
                history_table=gold_review_history,
                event_id=source_event_id,
                expected_payload=source_values,
            ):
                plan["blockers"].append(
                    {**reference, "reason": "missing_or_stale_source_item_history"}
                )
                continue
            target_content_version = target_items.get(item_id)
            if target_content_version is None:
                plan["item_reviews"]["skipped"].append(
                    {**reference, "reason": "target_item_missing"}
                )
                continue
            if target_content_version != row["content_version"]:
                plan["item_reviews"]["skipped"].append(
                    {
                        **reference,
                        "reason": "target_content_version_mismatch",
                        "source_content_version": row["content_version"],
                        "target_content_version": target_content_version,
                    }
                )
                continue

            target_review = GoldReview.model_validate(
                {**source_values, "run_id": target_run_id}
            )
            target_values = _gold_review_values(target_review)
            target_event_id = _review_event_id(target_values)
            match = {"item_id": item_id, "content_version": target_content_version}
            provenance = self._carry_forward_provenance(
                **reference,
                source_run_id=source_run_id,
                target_run_id=target_run_id,
                source_review_event_id=source_event_id,
                target_review_event_id=target_event_id,
                match=match,
            )
            entry = {
                **reference,
                "content_version": target_content_version,
                "source_review_event_id": source_event_id,
                "target_review_event_id": target_event_id,
                "carry_forward_event_id": provenance["carry_forward_event_id"],
                "_review": target_review,
                "_target_values": target_values,
                "_provenance": provenance,
            }
            existing = connection.execute(
                select(gold_reviews)
                .where(gold_reviews.c.run_id == target_run_id)
                .where(gold_reviews.c.item_id == item_id)
                .where(gold_reviews.c.reviewer_slot == reviewer_slot)
            ).mappings().one_or_none()
            prior_provenance, provenance_matches = self._existing_provenance(
                connection, provenance
            )
            carried_history_matches = self._source_history_is_current(
                connection,
                history_table=gold_review_history,
                event_id=target_event_id,
                expected_payload=target_values,
            )
            if provenance_matches:
                if not carried_history_matches:
                    plan["blockers"].append(
                        {
                            **reference,
                            "reason": "missing_or_stale_target_item_carry_history",
                        }
                    )
                elif existing is None:
                    plan["blockers"].append(
                        {**reference, "reason": "missing_target_item_projection"}
                    )
                else:
                    existing_values = {key: existing[key] for key in target_values}
                    existing_event_id = _review_event_id(existing_values)
                    existing_history_matches = self._source_history_is_current(
                        connection,
                        history_table=gold_review_history,
                        event_id=existing_event_id,
                        expected_payload=existing_values,
                    )
                    if not existing_history_matches:
                        plan["blockers"].append(
                            {
                                **reference,
                                "reason": "missing_or_stale_target_item_latest_history",
                            }
                        )
                    else:
                        plan["item_reviews"]["already_carried"].append(entry)
                continue
            if prior_provenance is not None:
                plan["blockers"].append(
                    {
                        **reference,
                        "reason": "conflicting_carry_forward_provenance",
                    }
                )
                continue
            if existing is not None:
                existing_values = {key: existing[key] for key in target_values}
                existing_event_id = _review_event_id(existing_values)
                chain_provenance = self._provenance_for_target_event(
                    connection,
                    evidence_kind="item_review",
                    source_run_id=source_run_id,
                    target_run_id=target_run_id,
                    target_entity_id=item_id,
                    reviewer_slot=reviewer_slot,
                    target_review_event_id=existing_event_id,
                )
                existing_history_matches = self._source_history_is_current(
                    connection,
                    history_table=gold_review_history,
                    event_id=existing_event_id,
                    expected_payload=existing_values,
                )
                if chain_provenance is None:
                    plan["blockers"].append(
                        {**reference, "reason": "occupied_target_item_review"}
                    )
                elif not existing_history_matches:
                    plan["blockers"].append(
                        {
                            **reference,
                            "reason": "missing_or_stale_target_item_chain_history",
                        }
                    )
                elif target_values["reviewed_at"] <= existing_values["reviewed_at"]:
                    plan["blockers"].append(
                        {**reference, "reason": "non_monotonic_item_review_revision"}
                    )
                else:
                    plan["item_reviews"]["eligible"].append(entry)
                continue
            target_history_exists = connection.execute(
                select(func.count())
                .select_from(gold_review_history)
                .where(gold_review_history.c.run_id == target_run_id)
                .where(gold_review_history.c.item_id == item_id)
                .where(gold_review_history.c.reviewer_slot == reviewer_slot)
            ).scalar_one()
            if prior_provenance is not None or target_history_exists:
                plan["blockers"].append(
                    {
                        **reference,
                        "reason": "orphaned_or_occupied_target_item_history",
                    }
                )
                continue
            plan["item_reviews"]["eligible"].append(entry)

        source_groups = {
            str(row["group_id"]): dict(row)
            for row in connection.execute(
                select(duplicate_groups).where(
                    duplicate_groups.c.run_id == source_run_id
                )
            ).mappings()
        }
        source_duplicate_reviews = connection.execute(
            select(duplicate_reviews)
            .where(duplicate_reviews.c.run_id == source_run_id)
            .order_by(duplicate_reviews.c.group_id, duplicate_reviews.c.reviewer_slot)
        ).mappings()
        for row in source_duplicate_reviews:
            source_values = dict(row)
            source_group_id = str(row["group_id"])
            reviewer_slot = int(row["reviewer_slot"])
            reference = {
                "evidence_kind": "duplicate_review",
                "source_entity_id": source_group_id,
                "reviewer_slot": reviewer_slot,
            }
            source_group = source_groups.get(source_group_id)
            if source_group is None or source_group["signature"] != row["signature"]:
                plan["blockers"].append(
                    {**reference, "reason": "stale_source_duplicate_review"}
                )
                continue
            source_versions, source_missing = self._group_member_versions(
                connection, run_id=source_run_id, group_id=source_group_id
            )
            if source_missing or not source_versions:
                plan["blockers"].append(
                    {**reference, "reason": "stale_source_duplicate_members"}
                )
                continue
            source_event_id = _review_event_id(source_values)
            if not self._source_history_is_current(
                connection,
                history_table=duplicate_review_history,
                event_id=source_event_id,
                expected_payload=source_values,
            ):
                plan["blockers"].append(
                    {
                        **reference,
                        "reason": "missing_or_stale_source_duplicate_history",
                    }
                )
                continue

            target_groups = list(
                connection.execute(
                    select(duplicate_groups)
                    .where(duplicate_groups.c.run_id == target_run_id)
                    .where(
                        duplicate_groups.c.signature_type
                        == source_group["signature_type"]
                    )
                    .where(duplicate_groups.c.signature == source_group["signature"])
                ).mappings()
            )
            if not target_groups:
                plan["duplicate_reviews"]["skipped"].append(
                    {**reference, "reason": "target_duplicate_missing"}
                )
                continue
            if len(target_groups) != 1:
                plan["blockers"].append(
                    {**reference, "reason": "ambiguous_target_duplicate_match"}
                )
                continue
            target_group = dict(target_groups[0])
            target_group_id = str(target_group["group_id"])
            target_reference = {**reference, "target_entity_id": target_group_id}
            target_versions, target_missing = self._group_member_versions(
                connection, run_id=target_run_id, group_id=target_group_id
            )
            if target_missing or set(source_versions) != set(target_versions):
                plan["duplicate_reviews"]["skipped"].append(
                    {
                        **target_reference,
                        "reason": "target_duplicate_member_set_mismatch",
                    }
                )
                continue
            if source_versions != target_versions:
                plan["duplicate_reviews"]["skipped"].append(
                    {
                        **target_reference,
                        "reason": "target_duplicate_member_content_mismatch",
                    }
                )
                continue

            target_review = DuplicateGoldReview.model_validate(
                {
                    **source_values,
                    "run_id": target_run_id,
                    "group_id": target_group_id,
                }
            )
            target_values = _duplicate_review_values(target_review)
            target_event_id = _review_event_id(target_values)
            match = {
                "signature_type": source_group["signature_type"],
                "signature": source_group["signature"],
                "members": [
                    {"item_id": item_id, "content_version": source_versions[item_id]}
                    for item_id in sorted(source_versions)
                ],
            }
            provenance = self._carry_forward_provenance(
                **target_reference,
                source_run_id=source_run_id,
                target_run_id=target_run_id,
                source_review_event_id=source_event_id,
                target_review_event_id=target_event_id,
                match=match,
            )
            entry = {
                **target_reference,
                "signature_type": source_group["signature_type"],
                "signature": source_group["signature"],
                "member_content_versions": source_versions,
                "source_review_event_id": source_event_id,
                "target_review_event_id": target_event_id,
                "carry_forward_event_id": provenance["carry_forward_event_id"],
                "_review": target_review,
                "_target_values": target_values,
                "_provenance": provenance,
            }
            existing = connection.execute(
                select(duplicate_reviews)
                .where(duplicate_reviews.c.run_id == target_run_id)
                .where(duplicate_reviews.c.group_id == target_group_id)
                .where(duplicate_reviews.c.reviewer_slot == reviewer_slot)
            ).mappings().one_or_none()
            prior_provenance, provenance_matches = self._existing_provenance(
                connection, provenance
            )
            carried_history_matches = self._source_history_is_current(
                connection,
                history_table=duplicate_review_history,
                event_id=target_event_id,
                expected_payload=target_values,
            )
            if provenance_matches:
                if not carried_history_matches:
                    plan["blockers"].append(
                        {
                            **target_reference,
                            "reason": (
                                "missing_or_stale_target_duplicate_carry_history"
                            ),
                        }
                    )
                elif existing is None:
                    plan["blockers"].append(
                        {
                            **target_reference,
                            "reason": "missing_target_duplicate_projection",
                        }
                    )
                else:
                    existing_values = {key: existing[key] for key in target_values}
                    existing_event_id = _review_event_id(existing_values)
                    existing_history_matches = self._source_history_is_current(
                        connection,
                        history_table=duplicate_review_history,
                        event_id=existing_event_id,
                        expected_payload=existing_values,
                    )
                    if not existing_history_matches:
                        plan["blockers"].append(
                            {
                                **target_reference,
                                "reason": (
                                    "missing_or_stale_target_duplicate_latest_history"
                                ),
                            }
                        )
                    else:
                        plan["duplicate_reviews"]["already_carried"].append(entry)
                continue
            if prior_provenance is not None:
                plan["blockers"].append(
                    {
                        **target_reference,
                        "reason": "conflicting_carry_forward_provenance",
                    }
                )
                continue
            if existing is not None:
                existing_values = {key: existing[key] for key in target_values}
                existing_event_id = _review_event_id(existing_values)
                chain_provenance = self._provenance_for_target_event(
                    connection,
                    evidence_kind="duplicate_review",
                    source_run_id=source_run_id,
                    target_run_id=target_run_id,
                    target_entity_id=target_group_id,
                    reviewer_slot=reviewer_slot,
                    target_review_event_id=existing_event_id,
                )
                existing_history_matches = self._source_history_is_current(
                    connection,
                    history_table=duplicate_review_history,
                    event_id=existing_event_id,
                    expected_payload=existing_values,
                )
                if chain_provenance is None:
                    plan["blockers"].append(
                        {
                            **target_reference,
                            "reason": "occupied_target_duplicate_review",
                        }
                    )
                elif not existing_history_matches:
                    plan["blockers"].append(
                        {
                            **target_reference,
                            "reason": (
                                "missing_or_stale_target_duplicate_chain_history"
                            ),
                        }
                    )
                elif target_values["reviewed_at"] <= existing_values["reviewed_at"]:
                    plan["blockers"].append(
                        {
                            **target_reference,
                            "reason": "non_monotonic_duplicate_review_revision",
                        }
                    )
                else:
                    plan["duplicate_reviews"]["eligible"].append(entry)
                continue
            target_history_exists = connection.execute(
                select(func.count())
                .select_from(duplicate_review_history)
                .where(duplicate_review_history.c.run_id == target_run_id)
                .where(duplicate_review_history.c.group_id == target_group_id)
                .where(duplicate_review_history.c.reviewer_slot == reviewer_slot)
            ).scalar_one()
            if prior_provenance is not None or target_history_exists:
                plan["blockers"].append(
                    {
                        **target_reference,
                        "reason": "orphaned_or_occupied_target_duplicate_history",
                    }
                )
                continue
            plan["duplicate_reviews"]["eligible"].append(entry)
        return plan

    @staticmethod
    def _public_carry_forward_result(
        plan: Mapping[str, Any], *, mode: str, applied_at: str | None = None
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            "schema_version": plan["schema_version"],
            "mode": mode,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_run_id": plan["source_run_id"],
            "target_run_id": plan["target_run_id"],
            "can_apply": not plan["blockers"],
            "blockers": list(plan["blockers"]),
        }
        for category in ("item_reviews", "duplicate_reviews"):
            result[category] = {}
            for state in ("eligible", "already_carried", "skipped"):
                result[category][state] = [
                    {
                        key: value
                        for key, value in entry.items()
                        if not key.startswith("_")
                    }
                    for entry in plan[category][state]
                ]
        result["counts"] = {
            "item_reviews_eligible": len(plan["item_reviews"]["eligible"]),
            "item_reviews_already_carried": len(
                plan["item_reviews"]["already_carried"]
            ),
            "item_reviews_skipped": len(plan["item_reviews"]["skipped"]),
            "duplicate_reviews_eligible": len(
                plan["duplicate_reviews"]["eligible"]
            ),
            "duplicate_reviews_already_carried": len(
                plan["duplicate_reviews"]["already_carried"]
            ),
            "duplicate_reviews_skipped": len(
                plan["duplicate_reviews"]["skipped"]
            ),
            "blockers": len(plan["blockers"]),
        }
        result["counts"]["item_reviews_applied"] = (
            len(plan["item_reviews"]["eligible"]) if mode == "applied" else 0
        )
        result["counts"]["duplicate_reviews_applied"] = (
            len(plan["duplicate_reviews"]["eligible"])
            if mode == "applied"
            else 0
        )
        if applied_at is not None:
            result["applied_at"] = applied_at
        return result

    def carry_forward_reviews(
        self,
        *,
        source_run_id: str,
        target_run_id: str,
        apply: bool = False,
        before_commit: Callable[["AuditRepository"], None] | None = None,
    ) -> dict[str, Any]:
        """Plan or atomically carry current Stage 0 reviews to an unchanged run."""

        if not apply:
            with self.engine.connect() as connection:
                plan = self._plan_review_carry_forward(
                    connection,
                    source_run_id=source_run_id,
                    target_run_id=target_run_id,
                )
            return self._public_carry_forward_result(plan, mode="dry_run")

        applied_at = datetime.now(timezone.utc).isoformat()
        with self.engine.begin() as connection:
            plan = self._plan_review_carry_forward(
                connection,
                source_run_id=source_run_id,
                target_run_id=target_run_id,
            )
            if plan["blockers"]:
                return self._public_carry_forward_result(plan, mode="blocked")
            touched_items: set[tuple[str, str]] = set()
            for entry in plan["item_reviews"]["eligible"]:
                imported = _append_gold_review(connection, entry["_review"])
                if imported != 1:
                    raise RuntimeError("item carry-forward did not append one event")
                provenance = {**entry["_provenance"], "carried_at": applied_at}
                connection.execute(
                    sqlite_insert(review_carry_forward_events).values(**provenance)
                )
                touched_items.add((target_run_id, entry["target_entity_id"]))
            _refresh_item_review_states(connection, touched_items)

            touched_groups: set[tuple[str, str]] = set()
            for entry in plan["duplicate_reviews"]["eligible"]:
                imported = _append_duplicate_review(connection, entry["_review"])
                if imported != 1:
                    raise RuntimeError(
                        "duplicate-review carry-forward did not append one event"
                    )
                provenance = {**entry["_provenance"], "carried_at": applied_at}
                connection.execute(
                    sqlite_insert(review_carry_forward_events).values(**provenance)
                )
                touched_groups.add((target_run_id, entry["target_entity_id"]))
            _refresh_duplicate_review_states(connection, touched_groups)
            if before_commit is not None:
                transaction_repository = object.__new__(AuditRepository)
                transaction_repository.database_path = self.database_path
                transaction_repository.engine = _BorrowedConnectionEngine(  # type: ignore[assignment]
                    connection
                )
                before_commit(transaction_repository)
        return self._public_carry_forward_result(
            plan, mode="applied", applied_at=applied_at
        )

    def review_carry_forward_provenance(
        self, *, source_run_id: str, target_run_id: str
    ) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(review_carry_forward_events)
                .where(
                    review_carry_forward_events.c.source_run_id == source_run_id
                )
                .where(
                    review_carry_forward_events.c.target_run_id == target_run_id
                )
                .order_by(
                    review_carry_forward_events.c.evidence_kind,
                    review_carry_forward_events.c.source_entity_id,
                    review_carry_forward_events.c.reviewer_slot,
                )
            ).mappings()
            result = [dict(row) for row in rows]
        for row in result:
            row["match"] = json.loads(row.pop("match_json"))
        return result

    def review_history_count(self, run_id: str) -> int:
        with self.engine.connect() as connection:
            return int(
                connection.execute(
                    select(func.count())
                    .select_from(gold_review_history)
                    .where(gold_review_history.c.run_id == run_id)
                ).scalar_one()
            )

    def duplicate_review_history_count(self, run_id: str) -> int:
        with self.engine.connect() as connection:
            return int(
                connection.execute(
                    select(func.count())
                    .select_from(duplicate_review_history)
                    .where(duplicate_review_history.c.run_id == run_id)
                ).scalar_one()
            )

    def latest_run_id(self) -> str:
        with self.engine.connect() as connection:
            value = connection.execute(
                select(audit_runs.c.run_id).order_by(
                    audit_runs.c.created_at.desc(), audit_runs.c.run_id.desc()
                ).limit(1)
            ).scalar_one_or_none()
        if value is None:
            raise ValueError("audit database contains no runs")
        return str(value)

    def run(self, run_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = connection.execute(
                select(audit_runs).where(audit_runs.c.run_id == run_id)
            ).mappings().one_or_none()
        if row is None:
            raise ValueError(f"unknown audit run: {run_id}")
        result = dict(row)
        result["versions"] = json.loads(result.pop("versions_json"))
        result["coverage"] = json.loads(result.pop("coverage_json"))
        result["population_findings"] = json.loads(
            result.pop("population_findings_json")
        )
        return result

    def items(self, run_id: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(audit_items)
                .where(audit_items.c.run_id == run_id)
                .order_by(audit_items.c.sample_order)
            ).mappings()
            result = [dict(row) for row in rows]
        for item in result:
            for key in (
                "source_json",
                "learner_json",
                "protected_json",
                "warning_codes_json",
                "content_gap_codes_json",
            ):
                item[key.removesuffix("_json")] = json.loads(item.pop(key))
        return result

    def source_documents(self, run_id: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(source_documents)
                .where(source_documents.c.run_id == run_id)
                .order_by(source_documents.c.source_path)
            ).mappings()
            result = [dict(row) for row in rows]
        for document in result:
            document["metadata"] = json.loads(document.pop("metadata_json"))
            document["warning_codes"] = json.loads(
                document.pop("warning_codes_json")
            )
        return result

    def review_counts(self, run_id: str) -> dict[str, int]:
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(audit_items.c.review_state, func.count())
                .where(audit_items.c.run_id == run_id)
                .group_by(audit_items.c.review_state)
            ).all()
        return {str(state): int(count) for state, count in rows}

    def current_item_reviews(self, run_id: str) -> list[dict[str, Any]]:
        """Return complete latest item-review projections in stable slot order.

        Quality reporting intentionally consumes a smaller evidence shape.  The
        local reviewer tool needs the configured reviewer's own saved checks and
        notes, so expose that projection separately rather than widening the
        public report payload.
        """

        with self.engine.connect() as connection:
            rows = connection.execute(
                select(gold_reviews)
                .where(gold_reviews.c.run_id == run_id)
                .order_by(
                    gold_reviews.c.item_id,
                    gold_reviews.c.reviewer_slot,
                )
            ).mappings()
            return [dict(row) for row in rows]

    def current_duplicate_reviews(self, run_id: str) -> list[dict[str, Any]]:
        """Return complete latest duplicate-review projections deterministically."""

        with self.engine.connect() as connection:
            rows = connection.execute(
                select(duplicate_reviews)
                .where(duplicate_reviews.c.run_id == run_id)
                .order_by(
                    duplicate_reviews.c.group_id,
                    duplicate_reviews.c.reviewer_slot,
                )
            ).mappings()
            return [dict(row) for row in rows]

    def review_evidence(self, run_id: str) -> list[dict[str, Any]]:
        """Return one aggregate per sample item, including empty review slots."""

        with self.engine.connect() as connection:
            review_rows = connection.execute(
                select(
                    gold_reviews.c.item_id,
                    gold_reviews.c.content_version,
                    gold_reviews.c.reviewer_id,
                    gold_reviews.c.disposition,
                    gold_reviews.c.reviewed_at,
                ).where(gold_reviews.c.run_id == run_id)
            ).mappings()
            by_item: dict[str, list[dict[str, Any]]] = {}
            for row in review_rows:
                by_item.setdefault(str(row["item_id"]), []).append(dict(row))
            item_rows = connection.execute(
                select(audit_items.c.item_id, audit_items.c.content_version)
                .where(audit_items.c.run_id == run_id)
                .order_by(audit_items.c.sample_order)
            ).mappings()
            evidence: list[dict[str, Any]] = []
            for item in item_rows:
                item_id = str(item["item_id"])
                current_version = str(item["content_version"])
                all_reviews = by_item.get(item_id, [])
                evidence.append(
                    {
                        "item_id": item_id,
                        "content_version": current_version,
                        "reviews": [
                            review
                            for review in all_reviews
                            if review["content_version"] == current_version
                        ],
                        "stale_review_count": sum(
                            review["content_version"] != current_version
                            for review in all_reviews
                        ),
                    }
                )
            return evidence

    def update_run_status(self, run_id: str, status: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                update(audit_runs)
                .where(audit_runs.c.run_id == run_id)
                .values(status=status)
            )

    def duplicate_groups(self, run_id: str) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            groups = connection.execute(
                select(duplicate_groups)
                .where(duplicate_groups.c.run_id == run_id)
                .order_by(
                    duplicate_groups.c.signature_type,
                    duplicate_groups.c.signature,
                )
            ).mappings()
            result: list[dict[str, Any]] = []
            for group in groups:
                value = dict(group)
                members = connection.execute(
                    select(duplicate_group_members.c.item_id)
                    .where(duplicate_group_members.c.group_id == group["group_id"])
                    .order_by(duplicate_group_members.c.item_id)
                ).scalars()
                value["item_ids"] = list(members)
                result.append(value)
        return result

    def duplicate_review_evidence(self, run_id: str) -> list[dict[str, Any]]:
        """Return every duplicate group together with its current review slots."""

        groups = self.duplicate_groups(run_id)
        with self.engine.connect() as connection:
            rows = connection.execute(
                select(
                    duplicate_reviews.c.group_id,
                    duplicate_reviews.c.reviewer_id,
                    duplicate_reviews.c.decision,
                    duplicate_reviews.c.reviewed_at,
                    duplicate_reviews.c.signature,
                ).where(duplicate_reviews.c.run_id == run_id)
            ).mappings()
            by_group: dict[str, list[dict[str, Any]]] = {}
            for row in rows:
                by_group.setdefault(str(row["group_id"]), []).append(dict(row))
        return [
            {**group, "reviews": by_group.get(str(group["group_id"]), [])}
            for group in groups
        ]
