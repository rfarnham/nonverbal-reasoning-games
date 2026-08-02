"""Localhost-only HTTP transport for the private Stage 0 review workflow.

The browser is a view over an existing derived audit store.  It never chooses
source paths, reviewer identity, content versions, signatures, or timestamps.
Those invariants remain server-owned and are validated by the existing domain
schemas before the append-only repository imports them.
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import stat
import threading
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote, urlsplit

from pydantic import BaseModel, ConfigDict, ValidationError

from math_kangaroo_trainer.domain.reviews import (
    DuplicateDecision,
    DuplicateGoldReview,
    GoldReview,
    ReviewDisposition,
)
from math_kangaroo_trainer.domain.skills import load_ontology, ontology_checksum
from math_kangaroo_trainer.quality.reporting import (
    build_quality_report,
    write_quality_reports,
)
from math_kangaroo_trainer.storage import AuditRepository, migrate_audit_database


AUDIT_DATABASE_NAME = "stage0-audit.sqlite3"
ITEM_QUEUE_NAME = "review-queue.jsonl"
DUPLICATE_QUEUE_NAME = "duplicate-review-queue.jsonl"
MAX_REQUEST_BYTES = 64 * 1024
IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif"})
STATIC_SUFFIXES = frozenset(
    {".html", ".css", ".js", ".json", ".svg", ".png", ".jpg", ".webp", ".ico", ".woff2"}
)


class ItemReviewSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    question_boundary_verified: bool
    choices_verified: bool
    answer_key_verified: bool
    diagram_verified: bool
    source_metadata_verified: bool
    disposition: ReviewDisposition
    notes: str = ""


class DuplicateReviewSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    decision: DuplicateDecision
    notes: str = ""


class ApiProblem(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


@dataclass(frozen=True)
class FilePayload:
    data: bytes
    content_type: str
    etag: str


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _etag(value: Any) -> str:
    digest = hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()
    return f'"sha256-{digest}"'


def _read_jsonl(path: Path, *, allow_empty: bool = False) -> tuple[dict[str, Any], ...]:
    if not path.is_file():
        raise FileNotFoundError(f"required Stage 0 queue is missing: {path.name}")
    values: list[dict[str, Any]] = []
    for line_number, line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), 1
    ):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"{path.name}:{line_number}: invalid JSON") from error
        if not isinstance(value, dict):
            raise ValueError(
                f"{path.name}:{line_number}: queue record must be an object"
            )
        values.append(value)
    if not values and not allow_empty:
        raise ValueError(f"{path.name}: queue contains no records")
    return tuple(values)


def _safe_fragment_page(value: object) -> str:
    if not isinstance(value, str):
        return ""
    fragment = urlsplit(value).fragment
    if fragment.startswith("page=") and fragment.removeprefix("page=").isdigit():
        return f"#{fragment}"
    return ""


class ReviewWebApplication:
    """Private review application independent of its HTTP transport."""

    def __init__(
        self,
        *,
        audit_dir: Path,
        reviewer_id: str,
        reviewer_slot: int,
        ontology_path: Path,
    ) -> None:
        self.audit_dir = audit_dir.resolve()
        self.audit_database = self.audit_dir / AUDIT_DATABASE_NAME
        self.reviewer_id = reviewer_id.strip()
        if not self.reviewer_id:
            raise ValueError("reviewer_id cannot be blank")
        if reviewer_slot not in {1, 2}:
            raise ValueError("reviewer_slot must be 1 or 2")
        self.reviewer_slot = reviewer_slot
        self.ontology_path = ontology_path.resolve()
        self.ontology = load_ontology(self.ontology_path)
        self.ontology_sha256 = ontology_checksum(self.ontology_path)
        self._lock = threading.RLock()

        migrate_audit_database(self.audit_database)
        self.repository = AuditRepository(self.audit_database)
        try:
            self.run_id = self.repository.latest_run_id()
            self.run = self.repository.run(self.run_id)
            self._source_database = Path(self.run["source_path"]).resolve()
            self._source_bank_root = self._source_database.parent.parent.resolve()
            self._source_scope_root = self._source_bank_root.parent.resolve()
            self._load_queues()
            self._report = self._regenerate_report()
        except Exception:
            self.repository.close()
            raise

    def close(self) -> None:
        self.repository.close()

    def _load_queues(self) -> None:
        item_records = _read_jsonl(self.audit_dir / ITEM_QUEUE_NAME)
        duplicate_records = _read_jsonl(
            self.audit_dir / DUPLICATE_QUEUE_NAME, allow_empty=True
        )
        stored_items = self.repository.items(self.run_id)
        stored_by_id = {str(item["item_id"]): item for item in stored_items}

        by_id: dict[str, dict[str, Any]] = {}
        for record in item_records:
            item_id = record.get("item_id")
            if not isinstance(item_id, str) or not item_id:
                raise ValueError("item review queue contains an invalid item_id")
            if item_id in by_id:
                raise ValueError(f"item review queue repeats {item_id}")
            stored = stored_by_id.get(item_id)
            if stored is None:
                raise ValueError(f"item review queue references unknown item {item_id}")
            expected = (
                record.get("run_id") == self.run_id
                and record.get("content_version") == stored["content_version"]
                and record.get("sample_order") == stored["sample_order"]
                and Path(str(record.get("asset_path", ""))).resolve()
                == Path(stored["asset_path"]).resolve()
            )
            if not expected:
                raise ValueError(
                    f"item review queue does not match audit item {item_id}"
                )
            by_id[item_id] = dict(record)
        if set(by_id) != set(stored_by_id):
            raise ValueError(
                "item review queue does not contain the complete gold sample"
            )

        groups = self.repository.duplicate_groups(self.run_id)
        stored_groups = {str(group["group_id"]): group for group in groups}
        duplicate_by_id: dict[str, dict[str, Any]] = {}
        for record in duplicate_records:
            group_id = record.get("group_id")
            if not isinstance(group_id, str) or not group_id:
                raise ValueError("duplicate review queue contains an invalid group_id")
            if group_id in duplicate_by_id:
                raise ValueError(f"duplicate review queue repeats {group_id}")
            stored = stored_groups.get(group_id)
            members = record.get("members")
            if stored is None or not isinstance(members, list):
                raise ValueError(
                    f"duplicate review queue references unknown group {group_id}"
                )
            member_ids = [
                member.get("item_id") for member in members if isinstance(member, dict)
            ]
            expected = (
                record.get("run_id") == self.run_id
                and record.get("signature") == stored["signature"]
                and record.get("signature_type") == stored["signature_type"]
                and sorted(member_ids) == sorted(stored["item_ids"])
                and len(member_ids) == len(members)
            )
            if not expected:
                raise ValueError(
                    f"duplicate review queue does not match audit group {group_id}"
                )
            for member in members:
                item_id = str(member["item_id"])
                item = by_id.get(item_id)
                if item is None or (
                    member.get("content_version") != item["content_version"]
                    or Path(str(member.get("asset_path", ""))).resolve()
                    != Path(str(item["asset_path"])).resolve()
                ):
                    raise ValueError(
                        f"duplicate group {group_id} has inconsistent member {item_id}"
                    )
            duplicate_by_id[group_id] = dict(record)
        if set(duplicate_by_id) != set(stored_groups):
            raise ValueError("duplicate review queue does not match stored groups")

        self._items = tuple(
            sorted(by_id.values(), key=lambda record: int(record["sample_order"]))
        )
        self._item_by_id = by_id
        self._stored_item_by_id = stored_by_id
        self._duplicates = tuple(
            duplicate_by_id[str(group["group_id"])] for group in groups
        )
        self._duplicate_by_id = duplicate_by_id
        self._source_documents = {
            str(document["source_path"]): document
            for document in self.repository.source_documents(self.run_id)
        }

    def _regenerate_report(self) -> dict[str, Any]:
        report = build_quality_report(
            self.repository,
            run_id=self.run_id,
            ontology=self.ontology,
            ontology_sha256=self.ontology_sha256,
        )
        write_quality_reports(report, self.audit_dir)
        return report

    def _item_reviews(self) -> dict[str, dict[int, dict[str, Any]]]:
        result: dict[str, dict[int, dict[str, Any]]] = {}
        for review in self.repository.current_item_reviews(self.run_id):
            result.setdefault(str(review["item_id"]), {})[
                int(review["reviewer_slot"])
            ] = review
        return result

    def _duplicate_reviews(self) -> dict[str, dict[int, dict[str, Any]]]:
        result: dict[str, dict[int, dict[str, Any]]] = {}
        for review in self.repository.current_duplicate_reviews(self.run_id):
            result.setdefault(str(review["group_id"]), {})[
                int(review["reviewer_slot"])
            ] = review
        return result

    def _slot_state(
        self, slots: dict[int, dict[str, Any]], *, decision_field: str
    ) -> tuple[str, dict[str, Any] | None]:
        selected = slots.get(self.reviewer_slot)
        opposite = slots.get(3 - self.reviewer_slot)
        if selected is not None and selected["reviewer_id"] != self.reviewer_id:
            return "locked", None
        if opposite is not None and opposite["reviewer_id"] == self.reviewer_id:
            return "locked", self._own_review(selected, decision_field=decision_field)
        if selected is None:
            return "not_started", None
        own = self._own_review(selected, decision_field=decision_field)
        attention_values = (
            {"needs_review", "rejected"}
            if decision_field == "disposition"
            else {"needs_review"}
        )
        if selected[decision_field] in attention_values:
            return "needs_attention", own
        return "saved", own

    @staticmethod
    def _own_review(
        review: dict[str, Any] | None, *, decision_field: str
    ) -> dict[str, Any] | None:
        if review is None:
            return None
        if decision_field == "disposition":
            value = {
                "question_boundary_verified": bool(
                    review["question_boundary_verified"]
                ),
                "choices_verified": bool(review["choices_verified"]),
                "answer_key_verified": bool(review["answer_key_verified"]),
                "diagram_verified": bool(review["diagram_verified"]),
                "source_metadata_verified": bool(review["source_metadata_verified"]),
                "disposition": review["disposition"],
                "notes": review["notes"],
                "reviewed_at": review["reviewed_at"],
            }
        else:
            value = {
                "decision": review["decision"],
                "notes": review["notes"],
                "reviewed_at": review["reviewed_at"],
            }
        return {**value, "etag": _etag(value)}

    def progress(self) -> dict[str, Any]:
        item_reviews = self._item_reviews()
        duplicate_reviews = self._duplicate_reviews()
        item_states = [
            self._slot_state(
                item_reviews.get(str(record["item_id"]), {}),
                decision_field="disposition",
            )[0]
            for record in self._items
        ]
        duplicate_states = [
            self._slot_state(
                duplicate_reviews.get(str(record["group_id"]), {}),
                decision_field="decision",
            )[0]
            for record in self._duplicates
        ]
        item_counts = Counter(item_states)
        duplicate_counts = Counter(duplicate_states)
        next_item = next(
            (
                str(record["item_id"])
                for record, state in zip(self._items, item_states, strict=True)
                if state == "not_started"
            ),
            None,
        )
        next_duplicate = next(
            (
                str(record["group_id"])
                for record, state in zip(
                    self._duplicates, duplicate_states, strict=True
                )
                if state == "not_started"
            ),
            None,
        )
        return {
            "run_id": self.run_id,
            "reviewer": {
                "reviewer_id": self.reviewer_id,
                "reviewer_slot": self.reviewer_slot,
            },
            "items": {
                "total": len(self._items),
                "saved": item_counts["saved"] + item_counts["needs_attention"],
                "remaining": item_counts["not_started"],
                "needs_attention": item_counts["needs_attention"],
                "locked": item_counts["locked"],
                "next_item_id": next_item,
            },
            "duplicate_groups": {
                "total": len(self._duplicates),
                "saved": duplicate_counts["saved"]
                + duplicate_counts["needs_attention"],
                "remaining": duplicate_counts["not_started"],
                "needs_attention": duplicate_counts["needs_attention"],
                "locked": duplicate_counts["locked"],
                "next_group_id": next_duplicate,
            },
            "quality": {
                "status": self._report["exit_criterion"]["status"],
                "reason": self._report["exit_criterion"]["reason"],
                "double_reviewed_items": self._report["gold_review"][
                    "double_reviewed_items"
                ],
                "sample_size": self._report["sample"]["size"],
                "duplicate_review_complete": self._report["exact_duplicates"][
                    "review_complete"
                ],
                "faithful_parsing_rate": self._report["gold_review"][
                    "faithful_parsing_rate"
                ],
            },
        }

    def item_list(self) -> dict[str, Any]:
        reviews = self._item_reviews()
        items = []
        for record in self._items:
            item_id = str(record["item_id"])
            state, own = self._slot_state(
                reviews.get(item_id, {}), decision_field="disposition"
            )
            items.append(
                {
                    "item_id": item_id,
                    "sample_order": record["sample_order"],
                    "parser_status": record["learner_safe_item"]["status"],
                    "warning_count": len(record["warning_codes"]),
                    "content_gap_count": len(record["content_gap_codes"]),
                    "review_state": state,
                    "current_disposition": own.get("disposition") if own else None,
                }
            )
        return {
            "run_id": self.run_id,
            "items": items,
            "progress": self.progress()["items"],
        }

    def duplicate_list(self) -> dict[str, Any]:
        reviews = self._duplicate_reviews()
        groups = []
        for record in self._duplicates:
            group_id = str(record["group_id"])
            state, own = self._slot_state(
                reviews.get(group_id, {}), decision_field="decision"
            )
            groups.append(
                {
                    "group_id": group_id,
                    "signature_type": record["signature_type"],
                    "member_count": len(record["members"]),
                    "review_state": state,
                    "current_decision": own.get("decision") if own else None,
                }
            )
        return {
            "run_id": self.run_id,
            "duplicate_groups": groups,
            "progress": self.progress()["duplicate_groups"],
        }

    def _same_origin_url(
        self, item_id: str, resource: str, *, fragment: str = ""
    ) -> str:
        return f"/api/items/{quote(item_id, safe='')}/{resource}{fragment}"

    def _source_metadata(self, source: dict[str, Any]) -> dict[str, Any]:
        keys = (
            "source_collection",
            "source_path",
            "source_file_id",
            "source_label",
            "source_checksum",
            "source_family",
            "corpus_group",
            "year",
            "grade_band",
            "paper_part",
            "section",
            "competition_level",
            "question_number",
            "page",
            "end_page",
            "language",
            "english_helper_needed",
            "english_prompt_status",
            "english_options_status",
            "translation_source_language",
            "translation_method",
            "translation_review_status",
            "translation_notes",
            "extraction_status",
            "visual_verified",
            "answer_status",
            "answer_source_label",
            "answer_notes",
            "source_notes",
            "image_width",
            "image_height",
            "image_bytes",
            "crop_status",
            "crop_top_points",
            "crop_bottom_points",
            "option_count",
            "adapter_warning_codes",
            "adapter_field_errors",
        )
        return {key: source.get(key) for key in keys}

    def _item_media_urls(self, record: dict[str, Any]) -> dict[str, str | None]:
        item_id = str(record["item_id"])
        source = record["source"]
        asset_url = None
        try:
            self._asset_file(item_id)
            asset_url = self._same_origin_url(item_id, "asset")
        except ApiProblem:
            pass
        source_url = None
        try:
            self._source_pdf_file(item_id)
            source_url = self._same_origin_url(
                item_id,
                "source-pdf",
                fragment=f"#page={int(source['page'])}",
            )
        except (ApiProblem, TypeError, ValueError):
            pass
        answer_url = None
        try:
            self._answer_key_file(item_id)
            answer_url = self._same_origin_url(
                item_id,
                "answer-key",
                fragment=_safe_fragment_page(source.get("answer_source_link")),
            )
        except ApiProblem:
            pass
        return {
            "asset_url": asset_url,
            "crop_url": asset_url,
            "source_page_url": source_url,
            "answer_key_url": answer_url,
        }

    def _normalized_item(
        self,
        record: dict[str, Any],
        *,
        current_review: dict[str, Any] | None,
        review_state: str,
        navigation: dict[str, Any] | None,
    ) -> dict[str, Any]:
        learner = record["learner_safe_item"]
        source = record["source"]
        protected = record["protected_answer"]
        payload = {
            "run_id": self.run_id,
            "item_id": record["item_id"],
            "sample_order": record["sample_order"],
            "content_version": record["content_version"],
            "stem": learner["stem_markdown"],
            "choices": learner["choices"],
            "answer_type": learner["answer_type"],
            "official_answer": protected.get("official_answer"),
            "protected_answer": {
                "official_answer": protected.get("official_answer"),
                "answer_status": protected.get("answer_status"),
                "answer_source_label": protected.get("answer_source_label"),
            },
            "original_stem": source.get("stem_markdown"),
            "original_choices": source.get("choices", []),
            "english_stem": source.get("english_stem"),
            "english_choices": source.get("english_choices", []),
            "source_metadata": self._source_metadata(source),
            "warnings": record["warning_codes"],
            "content_gaps": record["content_gap_codes"],
            "review_state": review_state,
            "current_review": current_review,
            **self._item_media_urls(record),
        }
        if navigation is not None:
            payload["navigation"] = navigation
        return payload

    def item_detail(self, item_id: str) -> dict[str, Any]:
        record = self._item_by_id.get(item_id)
        if record is None:
            raise ApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown review item")
        index = next(
            index
            for index, value in enumerate(self._items)
            if value["item_id"] == item_id
        )
        state, own = self._slot_state(
            self._item_reviews().get(item_id, {}), decision_field="disposition"
        )
        navigation = {
            "index": index,
            "total": len(self._items),
            "previous_item_id": (
                self._items[index - 1]["item_id"] if index > 0 else None
            ),
            "next_item_id": (
                self._items[index + 1]["item_id"]
                if index + 1 < len(self._items)
                else None
            ),
        }
        return self._normalized_item(
            record,
            current_review=own,
            review_state=state,
            navigation=navigation,
        )

    def duplicate_detail(self, group_id: str) -> dict[str, Any]:
        record = self._duplicate_by_id.get(group_id)
        if record is None:
            raise ApiProblem(
                HTTPStatus.NOT_FOUND, "not_found", "Unknown duplicate group"
            )
        index = next(
            index
            for index, value in enumerate(self._duplicates)
            if value["group_id"] == group_id
        )
        state, own = self._slot_state(
            self._duplicate_reviews().get(group_id, {}), decision_field="decision"
        )
        members = []
        for member in record["members"]:
            item = self._item_by_id[str(member["item_id"])]
            members.append(
                self._normalized_item(
                    item,
                    current_review=None,
                    review_state="duplicate_evidence",
                    navigation=None,
                )
            )
        return {
            "run_id": self.run_id,
            "group_id": group_id,
            "signature_type": record["signature_type"],
            "signature": record["signature"],
            "algorithm_version": record["algorithm_version"],
            "members": members,
            "review_state": state,
            "current_review": own,
            "navigation": {
                "index": index,
                "total": len(self._duplicates),
                "previous_group_id": (
                    self._duplicates[index - 1]["group_id"] if index > 0 else None
                ),
                "next_group_id": (
                    self._duplicates[index + 1]["group_id"]
                    if index + 1 < len(self._duplicates)
                    else None
                ),
            },
        }

    def _safe_file(
        self,
        path: Path,
        *,
        suffixes: frozenset[str],
        expected_sha256: str | None = None,
        expected_bytes: int | None = None,
    ) -> FilePayload:
        resolved = path.resolve()
        try:
            resolved.relative_to(self._source_scope_root)
        except ValueError as error:
            raise ApiProblem(
                HTTPStatus.GONE,
                "audited_file_unavailable",
                "Audited file is unavailable",
            ) from error
        if resolved.suffix.lower() not in suffixes:
            raise ApiProblem(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media",
                "Audited file has an unsupported media type",
            )
        try:
            with resolved.open("rb") as source:
                file_stat = os.fstat(source.fileno())
                if not stat.S_ISREG(file_stat.st_mode):
                    raise OSError("not a regular file")
                data = source.read()
        except OSError as error:
            raise ApiProblem(
                HTTPStatus.GONE,
                "audited_file_unavailable",
                "Audited file is unavailable",
            ) from error
        digest = hashlib.sha256(data).hexdigest()
        if expected_bytes is not None and len(data) != expected_bytes:
            raise ApiProblem(
                HTTPStatus.CONFLICT, "audited_file_changed", "Audited file has changed"
            )
        if expected_sha256 is not None and digest != expected_sha256:
            raise ApiProblem(
                HTTPStatus.CONFLICT, "audited_file_changed", "Audited file has changed"
            )
        content_type = (
            mimetypes.guess_type(resolved.name)[0] or "application/octet-stream"
        )
        return FilePayload(
            data=data, content_type=content_type, etag=f'"sha256-{digest}"'
        )

    def _asset_file(self, item_id: str) -> FilePayload:
        item = self._stored_item_by_id.get(item_id)
        if item is None:
            raise ApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown review item")
        return self._safe_file(
            Path(item["asset_path"]),
            suffixes=IMAGE_SUFFIXES,
            expected_sha256=item["exact_asset_sha256"],
        )

    def _source_pdf_file(self, item_id: str) -> FilePayload:
        record = self._item_by_id.get(item_id)
        if record is None:
            raise ApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown review item")
        document = self._source_documents.get(str(record["source"]["source_path"]))
        if document is None:
            raise ApiProblem(
                HTTPStatus.GONE, "source_pdf_unavailable", "Source PDF is unavailable"
            )
        return self._safe_file(
            Path(document["local_pdf_path"]),
            suffixes=frozenset({".pdf"}),
            expected_sha256=document["actual_sha256"],
            expected_bytes=document["actual_bytes"],
        )

    def _answer_key_file(self, item_id: str) -> FilePayload:
        record = self._item_by_id.get(item_id)
        if record is None:
            raise ApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown review item")
        relative = record["source"].get("answer_source_file")
        if not isinstance(relative, str) or not relative.strip():
            raise ApiProblem(
                HTTPStatus.GONE, "answer_key_unavailable", "Answer key is unavailable"
            )
        return self._safe_file(
            self._source_bank_root / relative,
            suffixes=frozenset({".pdf"}),
        )

    def file_for_item(self, item_id: str, resource: str) -> FilePayload:
        if resource == "asset":
            return self._asset_file(item_id)
        if resource == "source-pdf":
            return self._source_pdf_file(item_id)
        if resource == "answer-key":
            return self._answer_key_file(item_id)
        raise ApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown item resource")

    def _check_slot_owner(
        self, slots: dict[int, dict[str, Any]], *, decision_field: str
    ) -> dict[str, Any] | None:
        selected = slots.get(self.reviewer_slot)
        opposite = slots.get(3 - self.reviewer_slot)
        if selected is not None and selected["reviewer_id"] != self.reviewer_id:
            raise ApiProblem(
                HTTPStatus.CONFLICT,
                "review_slot_locked",
                "This review slot belongs to another reviewer",
            )
        if opposite is not None and opposite["reviewer_id"] == self.reviewer_id:
            raise ApiProblem(
                HTTPStatus.CONFLICT,
                "independent_review_required",
                "The same reviewer cannot fill both review slots",
            )
        return selected

    @staticmethod
    def _check_etag(current: dict[str, Any] | None, supplied: str | None) -> None:
        if supplied is None:
            return
        if current is None:
            if supplied != "*":
                raise ApiProblem(
                    HTTPStatus.PRECONDITION_FAILED,
                    "stale_review",
                    "The review changed; reload before saving",
                )
            return
        current_etag = _etag(current)
        if supplied != current_etag:
            raise ApiProblem(
                HTTPStatus.PRECONDITION_FAILED,
                "stale_review",
                "The review changed; reload before saving",
            )

    def save_item_review(
        self, item_id: str, body: Any, *, if_match: str | None = None
    ) -> tuple[int, dict[str, Any]]:
        record = self._item_by_id.get(item_id)
        if record is None:
            raise ApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown review item")
        try:
            submission = ItemReviewSubmission.model_validate(body)
        except ValidationError as error:
            raise ApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_review",
                "Review decision is incomplete or invalid",
            ) from error
        with self._lock:
            slots = self._item_reviews().get(item_id, {})
            existing = self._check_slot_owner(slots, decision_field="disposition")
            existing_payload = (
                self._own_review(existing, decision_field="disposition")
                if existing
                else None
            )
            self._check_etag(
                (
                    {
                        key: value
                        for key, value in (existing_payload or {}).items()
                        if key != "etag"
                    }
                    if existing_payload
                    else None
                ),
                if_match,
            )
            values = submission.model_dump(mode="json")
            comparable = (
                {key: existing_payload.get(key) for key in values}
                if existing_payload
                else None
            )
            if comparable == values:
                return HTTPStatus.OK, {
                    "saved": False,
                    "review": existing_payload,
                    "progress": self.progress(),
                }
            review = GoldReview(
                run_id=self.run_id,
                item_id=item_id,
                content_version=str(record["content_version"]),
                reviewer_slot=self.reviewer_slot,
                reviewer_id=self.reviewer_id,
                reviewed_at=datetime.now(timezone.utc),
                **submission.model_dump(),
            )
            self.repository.import_reviews((review,))
            self._report = self._regenerate_report()
            saved = self._item_reviews()[item_id][self.reviewer_slot]
            return (HTTPStatus.CREATED if existing is None else HTTPStatus.OK), {
                "saved": True,
                "review": self._own_review(saved, decision_field="disposition"),
                "progress": self.progress(),
            }

    def save_duplicate_review(
        self, group_id: str, body: Any, *, if_match: str | None = None
    ) -> tuple[int, dict[str, Any]]:
        record = self._duplicate_by_id.get(group_id)
        if record is None:
            raise ApiProblem(
                HTTPStatus.NOT_FOUND, "not_found", "Unknown duplicate group"
            )
        try:
            submission = DuplicateReviewSubmission.model_validate(body)
        except ValidationError as error:
            raise ApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_review",
                "Duplicate decision is incomplete or invalid",
            ) from error
        with self._lock:
            slots = self._duplicate_reviews().get(group_id, {})
            existing = self._check_slot_owner(slots, decision_field="decision")
            existing_payload = (
                self._own_review(existing, decision_field="decision")
                if existing
                else None
            )
            self._check_etag(
                (
                    {
                        key: value
                        for key, value in (existing_payload or {}).items()
                        if key != "etag"
                    }
                    if existing_payload
                    else None
                ),
                if_match,
            )
            values = submission.model_dump(mode="json")
            comparable = (
                {key: existing_payload.get(key) for key in values}
                if existing_payload
                else None
            )
            if comparable == values:
                return HTTPStatus.OK, {
                    "saved": False,
                    "review": existing_payload,
                    "progress": self.progress(),
                }
            review = DuplicateGoldReview(
                run_id=self.run_id,
                group_id=group_id,
                signature=str(record["signature"]),
                reviewer_slot=self.reviewer_slot,
                reviewer_id=self.reviewer_id,
                reviewed_at=datetime.now(timezone.utc),
                **submission.model_dump(),
            )
            self.repository.import_duplicate_reviews((review,))
            self._report = self._regenerate_report()
            saved = self._duplicate_reviews()[group_id][self.reviewer_slot]
            return (HTTPStatus.CREATED if existing is None else HTTPStatus.OK), {
                "saved": True,
                "review": self._own_review(saved, decision_field="decision"),
                "progress": self.progress(),
            }


class ReviewHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
        application: ReviewWebApplication,
    ) -> None:
        self.application = application
        super().__init__(server_address, handler)

    def server_close(self) -> None:
        try:
            super().server_close()
        finally:
            self.application.close()


def _handler_class(application: ReviewWebApplication) -> type[BaseHTTPRequestHandler]:
    web_root = Path(__file__).resolve().parent

    class ReviewRequestHandler(BaseHTTPRequestHandler):
        server_version = "MathKangarooStage0Review/1"

        def log_message(self, _format: str, *_args: Any) -> None:
            # Request paths contain private corpus identifiers. Do not log them.
            return

        def _security_headers(self, *, content_type: str) -> None:
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            if content_type.startswith("text/html"):
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'self'; connect-src 'self'; img-src 'self' data:; "
                    "style-src 'self'; script-src 'self'; object-src 'self'; "
                    "base-uri 'none'; frame-ancestors 'self'",
                )

        def _send_json(self, status: int, value: Any) -> None:
            data = (_canonical_json(value) + "\n").encode("utf-8")
            self.send_response(int(status))
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self._security_headers(content_type="application/json")
            self.end_headers()
            self.wfile.write(data)

        def _send_file(self, status: int, value: FilePayload) -> None:
            if self.headers.get("If-None-Match") == value.etag:
                self.send_response(HTTPStatus.NOT_MODIFIED)
                self.send_header("ETag", value.etag)
                self._security_headers(content_type=value.content_type)
                self.end_headers()
                return
            self.send_response(int(status))
            self.send_header("Content-Type", value.content_type)
            self.send_header("Content-Length", str(len(value.data)))
            self.send_header("ETag", value.etag)
            self._security_headers(content_type=value.content_type)
            self.end_headers()
            self.wfile.write(value.data)

        def _problem(self, problem: ApiProblem) -> None:
            self._send_json(
                problem.status,
                {"error": {"code": problem.code, "message": problem.message}},
            )

        def _valid_host(self) -> bool:
            host = self.headers.get("Host", "").lower()
            port = int(self.server.server_address[1])  # type: ignore[attr-defined]
            return host in {f"127.0.0.1:{port}", f"localhost:{port}"}

        def _validate_request_origin(self) -> None:
            if not self._valid_host():
                raise ApiProblem(
                    HTTPStatus.MISDIRECTED_REQUEST,
                    "invalid_host",
                    "The reviewer is available only through localhost",
                )
            origin = self.headers.get("Origin")
            if origin is None:
                return
            parsed = urlsplit(origin)
            port = int(self.server.server_address[1])  # type: ignore[attr-defined]
            if not (
                parsed.scheme == "http"
                and parsed.hostname in {"127.0.0.1", "localhost"}
                and parsed.port == port
            ):
                raise ApiProblem(
                    HTTPStatus.FORBIDDEN,
                    "invalid_origin",
                    "Cross-origin review writes are forbidden",
                )

        def _read_json_body(self) -> Any:
            content_type = self.headers.get("Content-Type", "").split(";", 1)[0]
            if content_type.strip().lower() != "application/json":
                raise ApiProblem(
                    HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                    "json_required",
                    "Review writes require application/json",
                )
            raw_length = self.headers.get("Content-Length")
            if raw_length is None:
                raise ApiProblem(
                    HTTPStatus.LENGTH_REQUIRED,
                    "length_required",
                    "Content-Length is required",
                )
            try:
                length = int(raw_length)
            except ValueError as error:
                raise ApiProblem(
                    HTTPStatus.BAD_REQUEST, "invalid_length", "Invalid Content-Length"
                ) from error
            if length < 0:
                raise ApiProblem(
                    HTTPStatus.BAD_REQUEST, "invalid_length", "Invalid Content-Length"
                )
            if length > MAX_REQUEST_BYTES:
                raise ApiProblem(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    "request_too_large",
                    "Review request is too large",
                )
            try:
                return json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                raise ApiProblem(
                    HTTPStatus.BAD_REQUEST,
                    "invalid_json",
                    "Request body is not valid JSON",
                ) from error

        @staticmethod
        def _segments(path: str) -> tuple[str, ...]:
            raw_segments = tuple(segment for segment in path.split("/") if segment)
            values = tuple(unquote(segment) for segment in raw_segments)
            if any(
                not value
                or value in {".", ".."}
                or "/" in value
                or "\\" in value
                or "\x00" in value
                for value in values
            ):
                raise ApiProblem(
                    HTTPStatus.BAD_REQUEST,
                    "invalid_target",
                    "Request target is invalid",
                )
            return values

        def _static_file(self, path: str) -> FilePayload:
            relative = "index.html" if path == "/" else unquote(path.lstrip("/"))
            if (
                not relative
                or "\x00" in relative
                or "\\" in relative
                or any(
                    part in {"", ".", ".."} or part.startswith(".")
                    for part in Path(relative).parts
                )
            ):
                raise ApiProblem(
                    HTTPStatus.BAD_REQUEST,
                    "invalid_target",
                    "Request target is invalid",
                )
            candidate = (web_root / relative).resolve()
            try:
                candidate.relative_to(web_root)
            except ValueError as error:
                raise ApiProblem(
                    HTTPStatus.NOT_FOUND, "not_found", "Browser asset not found"
                ) from error
            if (
                candidate.suffix.lower() not in STATIC_SUFFIXES
                or not candidate.is_file()
            ):
                raise ApiProblem(
                    HTTPStatus.NOT_FOUND, "not_found", "Browser asset not found"
                )
            data = candidate.read_bytes()
            content_type = (
                mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
            )
            digest = hashlib.sha256(data).hexdigest()
            return FilePayload(data, content_type, f'"sha256-{digest}"')

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
            try:
                if not self._valid_host():
                    raise ApiProblem(
                        HTTPStatus.MISDIRECTED_REQUEST,
                        "invalid_host",
                        "The reviewer is available only through localhost",
                    )
                path = urlsplit(self.path).path
                segments = self._segments(path)
                if segments == ("api", "progress"):
                    self._send_json(HTTPStatus.OK, application.progress())
                    return
                if segments == ("api", "items"):
                    self._send_json(HTTPStatus.OK, application.item_list())
                    return
                if len(segments) == 3 and segments[:2] == ("api", "items"):
                    self._send_json(HTTPStatus.OK, application.item_detail(segments[2]))
                    return
                if len(segments) == 4 and segments[:2] == ("api", "items"):
                    self._send_file(
                        HTTPStatus.OK,
                        application.file_for_item(segments[2], segments[3]),
                    )
                    return
                if segments == ("api", "duplicates"):
                    self._send_json(HTTPStatus.OK, application.duplicate_list())
                    return
                if len(segments) == 3 and segments[:2] == ("api", "duplicates"):
                    self._send_json(
                        HTTPStatus.OK, application.duplicate_detail(segments[2])
                    )
                    return
                if segments and segments[0] == "api":
                    raise ApiProblem(
                        HTTPStatus.NOT_FOUND, "not_found", "API endpoint not found"
                    )
                self._send_file(HTTPStatus.OK, self._static_file(path))
            except ApiProblem as problem:
                self._problem(problem)
            except Exception:
                self._problem(
                    ApiProblem(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        "internal_error",
                        "The local reviewer could not complete the request",
                    )
                )

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
            try:
                self._validate_request_origin()
                path = urlsplit(self.path).path
                segments = self._segments(path)
                body = self._read_json_body()
                if_match = self.headers.get("If-Match")
                if len(segments) in {3, 4} and segments[:2] == ("api", "items"):
                    if len(segments) == 4 and segments[3] != "review":
                        raise ApiProblem(
                            HTTPStatus.NOT_FOUND, "not_found", "API endpoint not found"
                        )
                    status, response = application.save_item_review(
                        segments[2], body, if_match=if_match
                    )
                    self._send_json(status, response)
                    return
                if len(segments) in {3, 4} and segments[:2] == (
                    "api",
                    "duplicates",
                ):
                    if len(segments) == 4 and segments[3] != "review":
                        raise ApiProblem(
                            HTTPStatus.NOT_FOUND, "not_found", "API endpoint not found"
                        )
                    status, response = application.save_duplicate_review(
                        segments[2], body, if_match=if_match
                    )
                    self._send_json(status, response)
                    return
                raise ApiProblem(
                    HTTPStatus.NOT_FOUND, "not_found", "API endpoint not found"
                )
            except ApiProblem as problem:
                self._problem(problem)
            except Exception:
                self._problem(
                    ApiProblem(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        "internal_error",
                        "The local reviewer could not complete the request",
                    )
                )

        def do_OPTIONS(self) -> None:  # noqa: N802 - deliberately no CORS
            self._send_json(
                HTTPStatus.METHOD_NOT_ALLOWED,
                {
                    "error": {
                        "code": "method_not_allowed",
                        "message": "Method not allowed",
                    }
                },
            )

    return ReviewRequestHandler


def create_review_server(
    application: ReviewWebApplication, *, port: int = 8765
) -> ReviewHTTPServer:
    if not 0 <= port <= 65535:
        raise ValueError("port must be between 0 and 65535")
    handler = _handler_class(application)
    return ReviewHTTPServer(("127.0.0.1", port), handler, application)


def serve_review_web(
    *,
    audit_dir: Path,
    reviewer_id: str,
    reviewer_slot: int,
    ontology_path: Path,
    port: int = 8765,
) -> int:
    application = ReviewWebApplication(
        audit_dir=audit_dir,
        reviewer_id=reviewer_id,
        reviewer_slot=reviewer_slot,
        ontology_path=ontology_path,
    )
    server = create_review_server(application, port=port)
    actual_port = int(server.server_address[1])
    print(
        _canonical_json(
            {
                "reviewer_url": f"http://127.0.0.1:{actual_port}/",
                "reviewer_id": application.reviewer_id,
                "reviewer_slot": application.reviewer_slot,
                "run_id": application.run_id,
            }
        )
    )
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
