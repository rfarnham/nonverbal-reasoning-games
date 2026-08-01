"""Repository for deterministic Stage 0 state and independent reviews."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from datetime import timezone
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, delete, event, func, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

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
from math_kangaroo_trainer.versions import DUPLICATE_ALGORITHM_VERSION

from .models import (
    audit_items,
    audit_runs,
    duplicate_group_members,
    duplicate_groups,
    duplicate_review_history,
    duplicate_reviews,
    gold_review_history,
    gold_reviews,
    source_documents,
)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


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
                item_row = connection.execute(
                    select(audit_items.c.item_id, audit_items.c.content_version)
                    .where(audit_items.c.run_id == review.run_id)
                    .where(audit_items.c.item_id == review.item_id)
                ).mappings().one_or_none()
                if item_row is None:
                    raise ValueError(
                        f"review references unknown audit item "
                        f"{review.run_id}/{review.item_id}"
                    )
                if item_row["content_version"] != review.content_version:
                    raise ValueError(
                        f"review content version does not match {review.item_id}"
                    )
                reviewed_at = review.reviewed_at.astimezone(timezone.utc).isoformat()
                values = {
                    "run_id": review.run_id,
                    "item_id": review.item_id,
                    "content_version": review.content_version,
                    "reviewer_slot": review.reviewer_slot,
                    "reviewer_id": review.reviewer_id,
                    "question_boundary_verified": int(
                        review.question_boundary_verified
                    ),
                    "choices_verified": int(review.choices_verified),
                    "answer_key_verified": int(review.answer_key_verified),
                    "diagram_verified": int(review.diagram_verified),
                    "source_metadata_verified": int(
                        review.source_metadata_verified
                    ),
                    "disposition": review.disposition.value,
                    "notes": review.notes,
                    "reviewed_at": reviewed_at,
                    "schema_version": review.schema_version,
                }
                existing = connection.execute(
                    select(gold_reviews)
                    .where(gold_reviews.c.run_id == review.run_id)
                    .where(gold_reviews.c.item_id == review.item_id)
                    .where(gold_reviews.c.reviewer_slot == review.reviewer_slot)
                ).mappings().one_or_none()
                if existing is not None and existing["reviewed_at"] == reviewed_at:
                    comparable = {key: existing[key] for key in values}
                    if comparable != values:
                        raise ValueError(
                            "conflicting review revisions cannot share reviewed_at"
                        )
                historical_payloads = connection.execute(
                    select(gold_review_history.c.payload_json)
                    .where(gold_review_history.c.run_id == review.run_id)
                    .where(gold_review_history.c.item_id == review.item_id)
                    .where(
                        gold_review_history.c.reviewer_slot
                        == review.reviewer_slot
                    )
                    .where(gold_review_history.c.reviewed_at == reviewed_at)
                ).scalars().all()
                if historical_payloads and _json(values) not in historical_payloads:
                    raise ValueError(
                        "conflicting review revisions cannot share reviewed_at"
                    )

                review_event_id = hashlib.sha256(_json(values).encode("utf-8")).hexdigest()
                history_result = connection.execute(
                    sqlite_insert(gold_review_history)
                    .values(
                        review_event_id=review_event_id,
                        run_id=review.run_id,
                        item_id=review.item_id,
                        content_version=review.content_version,
                        reviewer_slot=review.reviewer_slot,
                        reviewer_id=review.reviewer_id,
                        disposition=review.disposition.value,
                        reviewed_at=reviewed_at,
                        schema_version=review.schema_version,
                        payload_json=_json(values),
                    )
                    .on_conflict_do_nothing(
                        index_elements=[gold_review_history.c.review_event_id]
                    )
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
                imported += max(history_result.rowcount or 0, 0)
                touched.add((review.run_id, review.item_id))

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
                    row.disposition == ReviewDisposition.NEEDS_REVIEW.value
                    for row in rows
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
        return imported

    def import_duplicate_reviews(
        self, reviews: Iterable[DuplicateGoldReview]
    ) -> int:
        """Append duplicate adjudications and refresh their latest projections."""

        imported = 0
        touched: set[tuple[str, str]] = set()
        with self.engine.begin() as connection:
            for review in reviews:
                group = connection.execute(
                    select(
                        duplicate_groups.c.run_id,
                        duplicate_groups.c.signature,
                    ).where(duplicate_groups.c.group_id == review.group_id)
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

                reviewed_at = review.reviewed_at.astimezone(timezone.utc).isoformat()
                values = {
                    "run_id": review.run_id,
                    "group_id": review.group_id,
                    "reviewer_slot": review.reviewer_slot,
                    "signature": review.signature,
                    "reviewer_id": review.reviewer_id,
                    "decision": review.decision.value,
                    "notes": review.notes,
                    "reviewed_at": reviewed_at,
                    "schema_version": review.schema_version,
                }
                existing = connection.execute(
                    select(duplicate_reviews)
                    .where(duplicate_reviews.c.run_id == review.run_id)
                    .where(duplicate_reviews.c.group_id == review.group_id)
                    .where(
                        duplicate_reviews.c.reviewer_slot == review.reviewer_slot
                    )
                ).mappings().one_or_none()
                if existing is not None and existing["reviewed_at"] == reviewed_at:
                    comparable = {key: existing[key] for key in values}
                    if comparable != values:
                        raise ValueError(
                            "conflicting duplicate-review revisions cannot share "
                            "reviewed_at"
                        )
                historical_payloads = connection.execute(
                    select(duplicate_review_history.c.payload_json)
                    .where(duplicate_review_history.c.run_id == review.run_id)
                    .where(
                        duplicate_review_history.c.group_id == review.group_id
                    )
                    .where(
                        duplicate_review_history.c.reviewer_slot
                        == review.reviewer_slot
                    )
                    .where(duplicate_review_history.c.reviewed_at == reviewed_at)
                ).scalars().all()
                if historical_payloads and _json(values) not in historical_payloads:
                    raise ValueError(
                        "conflicting duplicate-review revisions cannot share "
                        "reviewed_at"
                    )

                event_id = hashlib.sha256(_json(values).encode("utf-8")).hexdigest()
                history_result = connection.execute(
                    sqlite_insert(duplicate_review_history)
                    .values(
                        review_event_id=event_id,
                        run_id=review.run_id,
                        group_id=review.group_id,
                        reviewer_slot=review.reviewer_slot,
                        reviewer_id=review.reviewer_id,
                        decision=review.decision.value,
                        reviewed_at=reviewed_at,
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
                    where=(
                        statement.excluded.reviewed_at
                        > duplicate_reviews.c.reviewed_at
                    ),
                )
                connection.execute(statement)
                imported += max(history_result.rowcount or 0, 0)
                touched.add((review.run_id, review.group_id))

            for run_id, group_id in touched:
                rows = connection.execute(
                    select(
                        duplicate_reviews.c.reviewer_id,
                        duplicate_reviews.c.decision,
                    )
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
        return imported

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
                )
            ).scalar_one_or_none()
        if value is None:
            raise ValueError("audit database contains no runs")
        return str(value)

    def run(self, run_id: str) -> dict[str, Any]:
        with self.engine.connect() as connection:
            row = connection.execute(
                select(audit_runs).where(audit_runs.c.run_id == run_id)
            ).mappings().one()
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
