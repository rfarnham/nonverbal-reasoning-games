"""Loopback-only teacher workbench for taxonomy, retrieval, and policy QA."""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import stat
import threading
from collections import Counter, defaultdict
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Literal, cast
from urllib.parse import parse_qs, quote, unquote, urlsplit

from pydantic import ValidationError

from math_kangaroo_trainer.config import default_ontology_path
from math_kangaroo_trainer.corpus.catalogue import (
    CATALOGUE_CLASSIFIER_VERSION,
    catalogue_controlled_vocabularies,
)
from math_kangaroo_trainer.corpus.catalogue_pipeline import (
    catalogue_vocabulary,
    file_sha256,
)
from math_kangaroo_trainer.corpus.source_adapter import CompleteBankAdapter
from math_kangaroo_trainer.curriculum import (
    CandidateEvidence,
    RecommendationContext,
    RecommendationMode,
    preview_recommendations,
)
from math_kangaroo_trainer.domain.catalogue_reviews import (
    CatalogueClassification,
    CatalogueDisposition,
    CatalogueFilters,
    CatalogueItemSummary,
    CatalogueNeighborJudgement,
    CatalogueReviewConflict,
    CatalogueSkillJudgement,
    CatalogueSourceChecks,
    CatalogueTeacherReview,
    GradeAppropriateness,
    NeighborJudgementValue,
    PrimaryDomain,
    QuestionType,
    TaxonomySkillDecision,
)
from math_kangaroo_trainer.domain.skills import load_ontology, ontology_checksum
from math_kangaroo_trainer.retrieval import (
    DEFAULT_ARTIFACT_BASENAME,
    SEMANTIC_MAP_PROJECTION_VERSION,
    RetrievalView,
    SemanticArtifactPaths,
    SemanticDocument,
    SemanticIndex,
    SemanticIndexError,
    SemanticQueryResult,
    SemanticTextQueryResult,
)
from math_kangaroo_trainer.storage.catalogue_repository import (
    CatalogueRepository,
    migrate_catalogue_database,
    secure_catalogue_directory,
)


CATALOGUE_DATABASE_NAME = "corpus-review.sqlite3"
MAX_REQUEST_BYTES = 128 * 1024
MAX_EXPLORE_QUERY_CHARACTERS = 8_000
MAX_EXPLORE_PROMPT_EXCERPT_CHARACTERS = 320
MAX_EXPLORE_SOURCE_LABEL_CHARACTERS = 180
IMAGE_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif"})
STATIC_SUFFIXES = frozenset(
    {".html", ".css", ".js", ".json", ".png", ".jpg", ".webp", ".ico", ".woff2"}
)


class CatalogueApiProblem(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class FilePayload:
    def __init__(self, data: bytes, content_type: str, etag: str) -> None:
        self.data = data
        self.content_type = content_type
        self.etag = etag


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _http_etag(value: str) -> str:
    return f'"{value}"'


def _if_match_value(value: str | None) -> str | None:
    if value is None or value == "*":
        return None
    return value.removeprefix('W/"').removesuffix('"').removeprefix('"')


def _enum_value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


class CatalogueWebApplication:
    """Private application logic independent of the HTTP adapter."""

    def __init__(
        self,
        *,
        catalogue_dir: Path,
        source_path: Path,
        reviewer_id: str,
        ontology_path: Path,
    ) -> None:
        self.catalogue_dir = secure_catalogue_directory(catalogue_dir)
        self.source_path = source_path.resolve()
        self.reviewer_id = reviewer_id.strip()
        if not self.reviewer_id:
            raise ValueError("reviewer_id cannot be blank")
        if not self.source_path.is_file():
            raise FileNotFoundError(f"source database not found: {self.source_path}")
        self.ontology_path = ontology_path.resolve()
        self.ontology = load_ontology(self.ontology_path)
        self.vocabulary = catalogue_vocabulary(self.ontology)
        self._skill_facet = {
            skill.skill_id: skill.facet for skill in self.ontology.skills
        }
        self._lock = threading.RLock()

        database_path = self.catalogue_dir / CATALOGUE_DATABASE_NAME
        migrate_catalogue_database(database_path)
        self.repository = CatalogueRepository(database_path, vocabulary=self.vocabulary)
        try:
            run_id = self.repository.latest_run_id()
            if run_id is None:
                raise ValueError("catalogue database contains no run")
            run = self.repository.run(run_id)
            if run is None:
                raise ValueError("catalogue run cannot be loaded")
            if file_sha256(self.source_path) != run.source_sha256:
                raise ValueError(
                    "canonical source does not match the catalogue snapshot"
                )
            if (
                run.ontology_version != self.ontology.ontology_version
                or run.ontology_sha256 != ontology_checksum(self.ontology_path)
            ):
                raise ValueError("ontology does not match the catalogue snapshot")
            self.run_id = run_id
            self.run = run
            self._load_inventory_cache()
            self._load_source_documents()
            self._verify_answer_key_evidence()
            self.semantic_index = self._load_semantic_index()
        except Exception:
            self.repository.close()
            raise

    def close(self) -> None:
        self.repository.close()

    def _load_inventory_cache(self) -> None:
        summaries: list[CatalogueItemSummary] = []
        offset = 0
        while True:
            page = self.repository.list_items(self.run_id, offset=offset, limit=100)
            summaries.extend(page.items)
            offset += len(page.items)
            if offset >= page.total:
                break
        if len(summaries) != self.run.source_item_count:
            raise ValueError("catalogue inventory is incomplete")
        self._summaries = tuple(summaries)
        self._summary_by_id = {summary.item_id: summary for summary in summaries}
        self._items = {}
        for summary in summaries:
            record = self.repository.item(self.run_id, summary.item_id)
            if record is None:
                raise ValueError(f"catalogue item disappeared: {summary.item_id}")
            self._items[summary.item_id] = record

    def _refresh_item(self, item_id: str) -> Any:
        record = self.repository.item(self.run_id, item_id)
        if record is None:
            raise CatalogueApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown item")
        self._items[item_id] = record
        return record

    def _load_source_documents(self) -> None:
        adapter = CompleteBankAdapter(self.source_path)
        _questions, documents = adapter.snapshot()
        self._source_documents = {
            document.source_path: document for document in documents
        }
        self._source_bank_root = self.source_path.parent.parent.resolve()
        self._source_scope_root = adapter.source_scope_root

    def _load_semantic_index(self) -> SemanticIndex:
        artifact = SemanticArtifactPaths(
            vectors_path=self.catalogue_dir / f"{DEFAULT_ARTIFACT_BASENAME}.npz",
            manifest_path=(
                self.catalogue_dir / f"{DEFAULT_ARTIFACT_BASENAME}.manifest.json"
            ),
        )
        index = SemanticIndex.load(
            artifact,
            expected_documents=tuple(
                SemanticDocument.from_catalogue_item(record.item)
                for record in sorted(
                    self._items.values(),
                    key=lambda value: value.item.inventory_order,
                )
            ),
            expected_ontology_version=self.run.ontology_version,
            expected_classifier_version=CATALOGUE_CLASSIFIER_VERSION,
        )
        expected = tuple(
            (summary.item_id, summary.content_version)
            for summary in sorted(
                self._summaries, key=lambda value: value.inventory_order
            )
        )
        if index.item_versions != expected:
            raise ValueError(
                "semantic index does not cover this exact catalogue inventory"
            )
        return index

    def _verify_answer_key_evidence(self) -> None:
        verified: dict[Path, tuple[str, int]] = {}
        for record in self._items.values():
            item = record.item
            relative = item.source_payload.get("answer_source_file")
            has_reference = isinstance(relative, str) and bool(relative.strip())
            snapshot = item.answer_key_ref
            if not has_reference:
                if snapshot is not None:
                    raise ValueError("unexpected answer-key evidence snapshot")
                continue
            if snapshot is None:
                raise ValueError(
                    "catalogue answer-key evidence is not integrity-bound; rebuild it"
                )
            expected_path = (self._source_bank_root / str(relative)).resolve()
            try:
                expected_path.relative_to(self._source_scope_root)
            except ValueError as error:
                raise ValueError(
                    "answer-key path escapes the private source scope"
                ) from error
            if Path(snapshot.local_ref).resolve() != expected_path:
                raise ValueError(
                    "catalogue answer-key evidence path does not match source"
                )
            if snapshot.status == "missing":
                if expected_path.exists():
                    raise ValueError(
                        "answer-key evidence changed after catalogue build; rebuild it"
                    )
                continue
            if snapshot.sha256 is None or snapshot.bytes is None:
                raise ValueError(
                    "catalogue answer-key integrity snapshot is incomplete"
                )
            actual = verified.get(expected_path)
            if actual is None:
                try:
                    payload = self._safe_file(
                        expected_path,
                        suffixes=frozenset({".pdf"}),
                        expected_sha256=snapshot.sha256,
                        expected_bytes=snapshot.bytes,
                    )
                except CatalogueApiProblem as error:
                    raise ValueError(
                        "answer-key evidence changed after catalogue build; rebuild it"
                    ) from error
                actual = (payload.etag.strip('"'), len(payload.data))
                verified[expected_path] = actual
            if actual != (snapshot.sha256, snapshot.bytes):
                raise ValueError(
                    "inconsistent answer-key integrity snapshots in catalogue"
                )

    @staticmethod
    def _proposal(record: Any) -> dict[str, Any]:
        return dict(record.item.proposal_payload)

    @staticmethod
    def _review_payload(record: Any) -> dict[str, Any] | None:
        current = record.current_review
        if current is None:
            return None
        review = current.review
        classification = review.classification
        review_state = (
            "stale"
            if review.content_version != record.item.content_version
            else review.disposition.value
        )
        return {
            "source_checks": {
                "prompt": review.source_checks.question_boundary_verified,
                "choices": review.source_checks.choices_verified,
                "answer": review.source_checks.answer_evidence_verified,
                "points": review.source_checks.source_metadata_verified,
                "visual": review.source_checks.diagram_verified,
            },
            "disposition": {
                "needs_review": "needs_correction",
                "rejected": "exclude",
            }.get(review.disposition.value, review.disposition.value),
            "primary_domain": classification.primary_domain.value,
            "question_type": classification.question_type.value,
            "skill_ids": [
                *classification.content_skill_ids,
                *classification.reasoning_move_ids,
                *classification.procedure_ids,
            ],
            "representation_ids": classification.representation_ids,
            "cognitive_demand": classification.cognitive_demand_id,
            "grade_appropriateness": classification.grade_appropriateness.value,
            "taxonomy_decision": (
                "validated" if review.curriculum_approved else "needs_changes"
            ),
            "review_state": review_state,
            "notes": review.notes,
            "reviewed_at": review.reviewed_at.isoformat(),
            "reviewer_id": review.reviewer_id,
            "revision": current.revision,
            "etag": _http_etag(current.etag),
        }

    def _promotion_payload(self, record: Any) -> dict[str, Any]:
        promotion = record.promotion
        if promotion.public_eligible:
            state = "release_candidate"
        elif promotion.curriculum_ready:
            state = "curriculum_ready"
        elif record.current_review is not None:
            state = "teacher_reviewed"
        else:
            state = "unreviewed"
        return {
            "state": state,
            "curriculum_ready": promotion.curriculum_ready,
            "public_eligible": promotion.public_eligible,
            "curriculum_blockers": promotion.curriculum_blockers,
            "public_blockers": promotion.public_blockers,
            "blockers": promotion.public_blockers,
        }

    def _source_label(self, record: Any) -> str:
        source = record.item.source_metadata
        return (
            f"{source.source_family} · {source.year} · Grades {source.grade_band} "
            f"· Q{source.question_number}"
        )

    @staticmethod
    def _compact_text(value: Any, *, max_characters: int) -> str:
        """Return one bounded display line without exposing adjacent item payload."""

        if not isinstance(value, str):
            return ""
        normalized = " ".join(value.split())
        if len(normalized) <= max_characters:
            return normalized
        return normalized[: max_characters - 1].rstrip() + "…"

    def _effective_classification(self, record: Any) -> dict[str, Any]:
        """Select a current teacher classification or an explicit proposal fallback."""

        item = record.item
        current = record.current_review
        if (
            current is not None
            and current.review.content_version == item.content_version
        ):
            review = current.review
            classification = review.classification
            return {
                "source": "teacher",
                "content_version": review.content_version,
                "review_state": review.disposition.value,
                "primary_domain": classification.primary_domain.value,
                "question_type": classification.question_type.value,
                "skill_ids": sorted(
                    {
                        *classification.content_skill_ids,
                        *classification.reasoning_move_ids,
                        *classification.procedure_ids,
                    }
                ),
                "representation_ids": list(classification.representation_ids),
                "cognitive_demand": classification.cognitive_demand_id,
            }

        proposal = self._proposal(record)
        return {
            "source": "proposal",
            "content_version": item.content_version,
            "review_state": "stale" if current is not None else "unreviewed",
            "primary_domain": str(proposal.get("primary_domain", "unknown")),
            "question_type": str(proposal.get("question_type", "unknown")),
            "skill_ids": sorted(str(value) for value in proposal.get("skill_ids", [])),
            "representation_ids": sorted(
                str(value) for value in proposal.get("representation_tags", [])
            ),
            "cognitive_demand": (
                str(proposal["cognitive_demand_tag"])
                if proposal.get("cognitive_demand_tag") is not None
                else None
            ),
        }

    def _comparable(
        self, item_id: str, *, include_prompt: bool = True
    ) -> dict[str, Any]:
        record = self._items[item_id]
        item = record.item
        proposal = self._proposal(record)
        classification = self._effective_classification(record)
        learner = item.learner_payload
        return {
            "item_id": item_id,
            "source": {
                **item.source_metadata.model_dump(mode="json"),
                "label": self._source_label(record),
            },
            "grade_band": item.source_metadata.grade_band,
            "prompt": str(learner.get("stem_markdown", "")) if include_prompt else "",
            "primary_domain": classification["primary_domain"],
            "question_type": classification["question_type"],
            "skill_ids": classification["skill_ids"],
            "representation_ids": classification["representation_ids"],
            "cognitive_demand": classification["cognitive_demand"],
            "classification_source": classification["source"],
            "classification_content_version": classification["content_version"],
            "review_state": classification["review_state"],
            "classification_tags": [
                *classification["skill_ids"],
                *classification["representation_ids"],
            ],
            "classification": classification,
            "proposed_tags": [
                *proposal.get("skill_ids", []),
                *proposal.get("representation_tags", []),
            ],
            "proposal": proposal,
        }

    def _curriculum_comparable(self, item_id: str) -> dict[str, Any]:
        """Return card metadata from the classification the policy actually used."""

        return self._comparable(item_id)

    def summary(self) -> dict[str, Any]:
        with self._lock:
            self._load_inventory_cache()
            base = self.repository.summary(self.run_id)
            blocker_counts: Counter[str] = Counter()
            source_reviewed = 0
            classified = 0
            attention = 0
            curriculum_ready = 0
            public_eligible = 0
            for record in self._items.values():
                blocker_counts.update(record.promotion.public_blockers)
                if record.current_review is not None:
                    review = record.current_review.review
                    if (
                        review.disposition is CatalogueDisposition.FAITHFUL
                        and review.source_checks.all_verified
                    ):
                        source_reviewed += 1
                    classification = review.classification
                    if (
                        classification.primary_domain is not PrimaryDomain.UNKNOWN
                        and classification.question_type is not QuestionType.UNKNOWN
                    ):
                        classified += 1
                else:
                    attention += 1
                curriculum_ready += int(record.promotion.curriculum_ready)
                public_eligible += int(record.promotion.public_eligible)
            return {
                "run_id": self.run_id,
                "total_items": base.inventory_items,
                "inventory_complete": base.inventory_complete,
                "source_reviewed": source_reviewed,
                "curriculum_classified": classified,
                "teacher_classified_items": base.teacher_classified_items,
                "proposal_available_items": base.proposal_available_items,
                "proposal_classified_items": base.proposal_classified_items,
                "needs_attention": attention,
                "answer_status_counts": base.facets.get("answer_status", {}),
                "modality_counts": base.facets.get("modality", {}),
                "promotion": {
                    "blocked": base.inventory_items - public_eligible,
                    "curriculum_ready": curriculum_ready,
                    "release_candidate": public_eligible,
                    "promoted": 0,
                    "blockers": dict(sorted(blocker_counts.items())),
                },
                "semantic_retrieval": {
                    "views": [
                        view.value for view in self.semantic_index.available_views
                    ],
                    "strategy_available": self.semantic_index.strategy_available,
                    "algorithm_version": self.semantic_index.config.algorithm_version,
                    "map_views": ["surface", "tag", "hybrid"],
                    "map_projection_algorithm_version": (
                        SEMANTIC_MAP_PROJECTION_VERSION
                    ),
                    "map_is_exploratory": True,
                    "represents_mastery_or_difficulty": False,
                },
            }

    @staticmethod
    def _filter_from_query(query: dict[str, list[str]]) -> CatalogueFilters:
        def first(name: str) -> str | None:
            value = query.get(name, [""])[0].strip()
            return value or None

        points = first("points")
        promotion = first("promotion_state")
        values: dict[str, Any] = {
            "grade_band": first("grade"),
            "published_point_tier": (
                "unknown" if points == "unknown" else int(points) if points else None
            ),
            "query": first("q"),
            "answer_status": first("answer_status"),
            "modality": first("modality"),
            "review_state": first("review_state"),
            "primary_domain": first("primary_domain"),
            "question_type": first("question_type"),
        }
        if promotion == "curriculum_ready":
            values["curriculum_ready"] = True
        elif promotion in {"release_candidate", "promoted"}:
            values["public_eligible"] = True
        elif promotion == "blocked":
            values["public_eligible"] = False
        return CatalogueFilters.model_validate(values)

    def items(self, query: dict[str, list[str]]) -> dict[str, Any]:
        try:
            offset = int(query.get("offset", ["0"])[0])
            limit = int(query.get("limit", ["25"])[0])
        except ValueError as error:
            raise CatalogueApiProblem(
                HTTPStatus.BAD_REQUEST, "invalid_pagination", "Invalid pagination"
            ) from error
        filters = self._filter_from_query(query)
        page = self.repository.list_items(
            self.run_id, offset=offset, limit=limit, filters=filters
        )
        rows = []
        for summary in page.items:
            record = self._items[summary.item_id]
            proposal = self._proposal(record)
            promotion = self._promotion_payload(record)
            source = summary.source_metadata
            rows.append(
                {
                    "item_id": summary.item_id,
                    "source": {
                        **source.model_dump(mode="json"),
                        "label": self._source_label(record),
                    },
                    "grade_band": source.grade_band,
                    "points": source.published_point_tier or "unknown",
                    "review_state": summary.review_state,
                    "promotion_state": promotion["state"],
                    "blocker_count": len(promotion["public_blockers"]),
                    "primary_domain": (
                        summary.primary_domain.value
                        if summary.primary_domain is not None
                        else proposal.get("primary_domain", "unknown")
                    ),
                    "question_type": (
                        summary.question_type.value
                        if summary.question_type is not None
                        else proposal.get("question_type", "unknown")
                    ),
                }
            )
        return {
            "run_id": self.run_id,
            "offset": page.offset,
            "limit": page.limit,
            "total": page.total,
            "items": rows,
        }

    def item_detail(self, item_id: str) -> dict[str, Any]:
        record = self._items.get(item_id)
        if record is None:
            raise CatalogueApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown item")
        item = record.item
        source_payload = item.source_payload
        learner = item.learner_payload
        protected = item.protected_payload
        english_helper: dict[str, Any] | None = None
        if source_payload.get("english_helper_needed") is True:
            source_choices = source_payload.get("choices", [])
            english_choices = source_payload.get(
                "english_choices", learner.get("choices", [])
            )
            english_helper = {
                "source_language": str(
                    source_payload.get("translation_source_language")
                    or item.source_metadata.language
                ),
                "source_prompt": str(source_payload.get("stem_markdown", "")),
                "source_choices": (
                    source_choices
                    if isinstance(source_choices, list)
                    and all(isinstance(choice, str) for choice in source_choices)
                    else []
                ),
                "english_prompt": str(
                    source_payload.get("english_stem")
                    or learner.get("stem_markdown", "")
                ),
                "english_choices": (
                    english_choices
                    if isinstance(english_choices, list)
                    and all(isinstance(choice, str) for choice in english_choices)
                    else []
                ),
                "prompt_status": str(
                    source_payload.get("english_prompt_status") or "unknown"
                ),
                "choices_status": str(
                    source_payload.get("english_options_status") or "unknown"
                ),
                "translation_method": str(
                    source_payload.get("translation_method") or "unknown"
                ),
                "review_status": str(
                    source_payload.get("translation_review_status") or "unknown"
                ),
            }
        return {
            "run_id": self.run_id,
            "item_id": item_id,
            "content_version": item.content_version,
            "source": {
                **item.source_metadata.model_dump(mode="json"),
                "label": self._source_label(record),
            },
            "prompt": learner.get("stem_markdown", ""),
            "choices": learner.get("choices", []),
            "english_helper": english_helper,
            "answer_metadata": {
                "answer_status": item.answer_status,
                "official_answer": protected.get("official_answer"),
                "answer_source_label": protected.get("answer_source_label"),
            },
            "warnings": item.warning_codes,
            "gaps": item.content_gap_codes,
            "proposal": self._proposal(record),
            "existing_review": self._review_payload(record),
            "promotion": self._promotion_payload(record),
            "blockers": record.promotion.public_blockers,
            "assets": [
                {
                    "ordinal": index + 1,
                    "url": (
                        self._asset_resource_url(item_id, index)
                        if asset.status == "available"
                        else None
                    ),
                    "status": asset.status,
                    "media_type": asset.media_type,
                    "width": asset.width,
                    "height": asset.height,
                }
                for index, asset in enumerate(item.asset_refs)
            ],
            "source_crop_url": self._resource_url(item_id, "asset"),
            "source_pdf_url": self._resource_url(
                item_id, "source-pdf", fragment=f"#page={source_payload.get('page', 1)}"
            ),
            "key_evidence_url": (
                self._resource_url(item_id, "answer-key")
                if source_payload.get("answer_source_file")
                else None
            ),
        }

    @staticmethod
    def _resource_url(item_id: str, resource: str, *, fragment: str = "") -> str:
        return f"/api/catalogue/items/{quote(item_id, safe='')}/{resource}{fragment}"

    @staticmethod
    def _asset_resource_url(item_id: str, index: int) -> str:
        return f"/api/catalogue/items/{quote(item_id, safe='')}/assets/{index}"

    def _parse_review(self, item_id: str, body: Any) -> CatalogueTeacherReview:
        if not isinstance(body, dict):
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_review",
                "Review must be an object",
            )
        record = self._items[item_id]
        source = body.get("source_checks", {})
        if not isinstance(source, dict):
            source = {}
        raw_disposition = body.get("disposition", "needs_correction")
        disposition_value = {
            "needs_correction": "needs_review",
            "exclude": "rejected",
        }.get(str(raw_disposition), str(raw_disposition))
        taxonomy_decision = str(body.get("taxonomy_decision", "needs_changes"))
        skill_ids = tuple(
            sorted(set(str(value) for value in body.get("skill_ids", [])))
        )
        by_facet: dict[str, list[str]] = defaultdict(list)
        for skill_id in skill_ids:
            facet = self._skill_facet.get(skill_id)
            if facet is None:
                raise CatalogueApiProblem(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "invalid_skill",
                    f"Unknown ontology skill: {skill_id}",
                )
            by_facet[facet].append(skill_id)
        proposal = self._proposal(record)
        legacy = proposal.get("legacy_spatial")
        return CatalogueTeacherReview(
            run_id=self.run_id,
            item_id=item_id,
            content_version=record.item.content_version,
            reviewer_id=self.reviewer_id,
            source_checks=CatalogueSourceChecks(
                question_boundary_verified=bool(source.get("prompt")),
                choices_verified=bool(source.get("choices")),
                answer_evidence_verified=bool(source.get("answer")),
                source_metadata_verified=bool(source.get("points")),
                diagram_verified=bool(source.get("visual")),
            ),
            disposition=CatalogueDisposition(disposition_value),
            classification=CatalogueClassification(
                primary_domain=PrimaryDomain(
                    str(body.get("primary_domain") or "unknown")
                ),
                question_type=QuestionType(str(body.get("question_type") or "unknown")),
                content_skill_ids=tuple(sorted(by_facet["mathematical_content"])),
                reasoning_move_ids=tuple(sorted(by_facet["reasoning_move"])),
                procedure_ids=tuple(sorted(by_facet["procedure"])),
                representation_ids=tuple(
                    sorted(
                        set(str(value) for value in body.get("representation_ids", []))
                    )
                ),
                cognitive_demand_id=(
                    str(body["cognitive_demand"])
                    if body.get("cognitive_demand")
                    else None
                ),
                spatial_mechanic=(
                    str(legacy["mechanic"])
                    if isinstance(legacy, dict) and legacy.get("mechanic")
                    else None
                ),
                grade_appropriateness=GradeAppropriateness(
                    str(body.get("grade_appropriateness") or "uncertain")
                ),
            ),
            curriculum_approved=(
                taxonomy_decision == "validated"
                and disposition_value == CatalogueDisposition.FAITHFUL.value
            ),
            notes=str(body.get("notes", "")),
            reviewed_at=datetime.now(timezone.utc),
        )

    def save_item_review(
        self, item_id: str, body: Any, *, if_match: str | None
    ) -> tuple[dict[str, Any], str]:
        if item_id not in self._items:
            raise CatalogueApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown item")
        review = self._parse_review(item_id, body)
        current = self._items[item_id].current_review
        expected_revision = current.revision if current is not None else 0
        supplied = _if_match_value(if_match)
        if if_match not in {None, "*"} and current is None:
            raise CatalogueApiProblem(
                HTTPStatus.PRECONDITION_FAILED, "stale_review", "Review changed; reload"
            )
        try:
            saved = self.repository.save_review(
                review,
                expected_revision,
                expected_etag=supplied,
            )
        except CatalogueReviewConflict as error:
            raise CatalogueApiProblem(
                HTTPStatus.PRECONDITION_FAILED, "stale_review", "Review changed; reload"
            ) from error
        record = self._refresh_item(item_id)
        return {"saved": True, "review": self._review_payload(record)}, _http_etag(
            saved.etag
        )

    def taxonomy(self) -> dict[str, Any]:
        controlled = catalogue_controlled_vocabularies(self.ontology).model_dump(
            mode="json"
        )
        counts: Counter[str] = Counter()
        examples: dict[str, list[str]] = defaultdict(list)
        for item_id, catalogue_record in self._items.items():
            for skill_id in self._proposal(catalogue_record).get("skill_ids", []):
                counts[str(skill_id)] += 1
                if len(examples[str(skill_id)]) < 4:
                    examples[str(skill_id)].append(item_id)
        current = {
            value.judgement.skill_id: value
            for value in self.repository.list_skill_judgements(self.run_id)
        }
        skills = []
        for skill in self.ontology.skills:
            judgement_record = current.get(skill.skill_id)
            skills.append(
                {
                    **skill.model_dump(mode="json"),
                    "coverage_count": counts[skill.skill_id],
                    "example_items": examples[skill.skill_id],
                    "current_judgement": (
                        None
                        if judgement_record is None
                        else {
                            **judgement_record.judgement.model_dump(mode="json"),
                            "revision": judgement_record.revision,
                            "etag": _http_etag(judgement_record.etag),
                        }
                    ),
                }
            )
        return {
            **controlled,
            "ontology_status": self.ontology.status,
            "ontology_review_ready": self.ontology.review_ready,
            "skills": skills,
            "relations": [
                relation.model_dump(mode="json") for relation in self.ontology.relations
            ],
            "skill_judgement_notice": (
                "One advisory judgement does not approve the ontology or a prerequisite edge."
            ),
        }

    def save_skill_judgement(
        self, skill_id: str, body: Any, *, if_match: str | None
    ) -> tuple[dict[str, Any], str]:
        if skill_id not in self._skill_facet:
            raise CatalogueApiProblem(
                HTTPStatus.NOT_FOUND, "not_found", "Unknown skill"
            )
        if not isinstance(body, dict):
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_judgement",
                "Taxonomy judgement must be an object",
            )
        current = self.repository.current_skill_judgement(self.run_id, skill_id)
        judgement = CatalogueSkillJudgement(
            run_id=self.run_id,
            skill_id=skill_id,
            ontology_version=self.run.ontology_version,
            ontology_sha256=self.run.ontology_sha256,
            reviewer_id=self.reviewer_id,
            decision=TaxonomySkillDecision(
                str(body.get("decision", body.get("judgement", "unsure")))
            ),
            proposed_name=body.get("proposed_name") or None,
            proposed_description=body.get("proposed_description") or None,
            merge_target_skill_id=body.get("merge_target_skill_id") or None,
            notes=str(body.get("notes", "")),
            reviewed_at=datetime.now(timezone.utc),
        )
        try:
            saved = self.repository.save_skill_judgement(
                judgement,
                0 if current is None else current.revision,
                expected_etag=_if_match_value(if_match),
            )
        except CatalogueReviewConflict as error:
            raise CatalogueApiProblem(
                HTTPStatus.PRECONDITION_FAILED,
                "stale_judgement",
                "Taxonomy judgement changed; reload",
            ) from error
        return {
            "saved": True,
            "judgement": saved.judgement.model_dump(mode="json"),
            "revision": saved.revision,
            "etag": _http_etag(saved.etag),
        }, _http_etag(saved.etag)

    @property
    def retrieval_version(self) -> str:
        return (
            f"{self.semantic_index.config.algorithm_version}:"
            f"{self.semantic_index.identity_sha256[:16]}"
        )

    def problem_map(self, query: dict[str, list[str]]) -> dict[str, Any]:
        view_value = query.get("view", ["hybrid"])[0]
        focus_item_id = query.get("item_id", [""])[0].strip() or None
        if focus_item_id is not None and focus_item_id not in self._items:
            raise CatalogueApiProblem(
                HTTPStatus.NOT_FOUND,
                "not_found",
                "Unknown map focus item",
            )
        try:
            view = RetrievalView(view_value)
            coordinates, cluster_ids, clusters = self.semantic_index.map_projection(
                view
            )
            projection_metadata = self.semantic_index.map_projection_metadata(view)
            quality = self.semantic_index.map_quality(view)
        except (ValueError, SemanticIndexError) as error:
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_map_view",
                str(error),
            ) from error

        cluster_by_id = {cluster.cluster_id: cluster for cluster in clusters}
        points = []
        for position, indexed in enumerate(self.semantic_index.items):
            record = self._items[indexed.item_id]
            source = record.item.source_metadata
            domain = next(
                (
                    tag.removeprefix("domain:")
                    for tag in indexed.tags
                    if tag.startswith("domain:")
                ),
                "unknown",
            )
            question_type = next(
                (
                    tag.removeprefix("type:")
                    for tag in indexed.tags
                    if tag.startswith("type:")
                ),
                "unknown",
            )
            skill_ids = sorted(
                tag.removeprefix("skill:")
                for tag in indexed.tags
                if tag.startswith("skill:")
            )
            cluster_id = int(cluster_ids[position])
            cluster = cluster_by_id.get(cluster_id)
            mapped = cluster is not None
            points.append(
                {
                    "item_id": indexed.item_id,
                    "x": round(float(coordinates[position, 0]), 6) if mapped else None,
                    "y": round(float(coordinates[position, 1]), 6) if mapped else None,
                    "mapped": mapped,
                    "cluster_id": cluster_id if mapped else None,
                    "cluster_label": (
                        cluster.label
                        if cluster is not None
                        else "No signal in this view"
                    ),
                    "primary_domain": domain,
                    "question_type": question_type,
                    "skill_ids": skill_ids,
                    "grade_band": source.grade_band,
                    "published_point_tier": source.published_point_tier,
                }
            )
        warnings = [
            "EXPLORATORY_PROJECTION_NOT_MASTERY_OR_DIFFICULTY",
            "CLUSTER_LABELS_ARE_PROPOSAL_DERIVED_AND_NON_AUTHORITATIVE",
            "CLUSTER_LABELS_REUSE_TAG_EVIDENCE_USED_BY_TAG_AND_HYBRID_VIEWS",
        ]
        if any(not point["mapped"] for point in points):
            warnings.append("ITEMS_WITHOUT_VIEW_SIGNAL_ARE_UNMAPPED")
        return {
            "run_id": self.run_id,
            "map_version": (f"{self.semantic_index.identity_sha256[:16]}:{view.value}"),
            "view": view.value,
            "focus_item_id": focus_item_id,
            "projection": {
                "algorithm_version": projection_metadata["algorithm_version"],
                "method": projection_metadata["method"],
                "dimensions": 2,
                "exploratory": True,
                "represents_mastery_or_difficulty": False,
                "classification_evidence": (
                    "unreviewed catalogue proposal tags at index build"
                ),
                "source_metric": quality["source_metric"],
                "input_distance_version": quality["input_distance_version"],
                "parameters": projection_metadata["parameters"],
                "configured_weights": {
                    "surface": self.semantic_index.config.surface_weight,
                    "tag": self.semantic_index.config.tag_weight,
                    "strategy": self.semantic_index.config.strategy_weight,
                },
                "configured_weight_scope": (
                    "semantic_index_configuration_not_pairwise_effective_weights"
                ),
                "missing_facet_policy": (
                    "anchor_available_facets_renormalized_per_direction_then_"
                    "mean_bidirectional"
                    if view is RetrievalView.HYBRID
                    else "single_facet_view_items_without_selected_signal_are_unmapped"
                ),
                "quality": quality,
            },
            "warnings": warnings,
            "clusters": [cluster.model_dump(mode="json") for cluster in clusters],
            "points": points,
        }

    def explore(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict):
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_explore_query",
                "Explore query must be an object",
            )
        raw_query = body.get("query")
        if not isinstance(raw_query, str):
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_explore_query",
                "Explore query must be text or an exact item ID",
            )
        if len(raw_query) > MAX_EXPLORE_QUERY_CHARACTERS:
            raise CatalogueApiProblem(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "explore_query_too_large",
                (
                    "Explore query cannot exceed "
                    f"{MAX_EXPLORE_QUERY_CHARACTERS:,} characters"
                ),
            )
        normalized_query = " ".join(raw_query.split())
        if not normalized_query:
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "empty_explore_query",
                "Explore query cannot be empty",
            )
        try:
            limit = min(50, max(1, int(body.get("limit", 12))))
            view = RetrievalView(str(body.get("view", "hybrid")))
            result: SemanticQueryResult | SemanticTextQueryResult
            if normalized_query in self._items:
                result = self.semantic_index.query(
                    normalized_query,
                    top_k=limit,
                    view=view,
                )
                query_kind = "item_id"
                query_item_id: str | None = normalized_query
            else:
                result = self.semantic_index.query_text(
                    normalized_query,
                    top_k=limit,
                    view=view,
                )
                query_kind = "pasted_text"
                query_item_id = None
        except (ValueError, KeyError, SemanticIndexError) as error:
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_explore_query",
                str(error),
            ) from error

        neighbors = []
        for neighbor in result.neighbors:
            record = self._items[neighbor.item_id]
            item = record.item
            source = record.item.source_metadata
            classification = self._effective_classification(record)
            neighbors.append(
                {
                    "item_id": neighbor.item_id,
                    "rank": neighbor.rank,
                    "score": neighbor.score,
                    "score_components": neighbor.components.model_dump(mode="json"),
                    "prompt_excerpt": self._compact_text(
                        item.learner_payload.get("stem_markdown", ""),
                        max_characters=MAX_EXPLORE_PROMPT_EXCERPT_CHARACTERS,
                    ),
                    "source_label": self._compact_text(
                        self._source_label(record),
                        max_characters=MAX_EXPLORE_SOURCE_LABEL_CHARACTERS,
                    ),
                    "primary_domain": classification["primary_domain"],
                    "question_type": classification["question_type"],
                    "skill_ids": classification["skill_ids"],
                    "representation_ids": classification["representation_ids"],
                    "cognitive_demand": classification["cognitive_demand"],
                    "classification_source": classification["source"],
                    "classification_content_version": classification["content_version"],
                    "review_state": classification["review_state"],
                    "grade_band": source.grade_band,
                    "published_point_tier": source.published_point_tier,
                }
            )
        return {
            "query_kind": query_kind,
            "query_item_id": query_item_id,
            "query_echoed": False,
            "view": result.view.value,
            "retrieval_version": self.retrieval_version,
            "effective_weights": result.effective_weights,
            "warnings": result.warnings,
            "neighbors": neighbors,
        }

    def neighbors(self, item_id: str, query: dict[str, list[str]]) -> dict[str, Any]:
        if item_id not in self._items:
            raise CatalogueApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown item")
        view = query.get("view", ["hybrid"])[0]
        try:
            limit = min(50, max(1, int(query.get("limit", ["12"])[0])))
            result = self.semantic_index.query(item_id, top_k=limit, view=view)
        except (ValueError, KeyError, SemanticIndexError) as error:
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_retrieval_query",
                str(error),
            ) from error
        values = []
        for neighbor in result.neighbors:
            existing = self.repository.current_neighbor_judgement(
                self.run_id,
                item_id,
                neighbor.item_id,
                self.retrieval_version,
                result.view.value,
            )
            comparable = self._comparable(neighbor.item_id)
            values.append(
                {
                    **comparable,
                    "rank": neighbor.rank,
                    "score": neighbor.score,
                    "score_components": neighbor.components.model_dump(mode="json"),
                    "shared_tags": neighbor.shared_tags,
                    "reasons": [
                        *result.warnings,
                        *(
                            ["SAME_EXACT_DUPLICATE_GROUP"]
                            if neighbor.same_exact_duplicate_group
                            else []
                        ),
                    ],
                    "same_family": neighbor.same_family,
                    "same_exact_duplicate_group": neighbor.same_exact_duplicate_group,
                    "existing_review": (
                        None
                        if existing is None
                        else {
                            "rating": existing.judgement.judgement.value,
                            "reviewer_id": existing.judgement.reviewer_id,
                            "etag": _http_etag(existing.etag),
                        }
                    ),
                }
            )
        return {
            "anchor": self._comparable(item_id),
            "view": result.view.value,
            "retrieval_version": self.retrieval_version,
            "effective_weights": result.effective_weights,
            "warnings": result.warnings,
            "neighbors": values,
        }

    def save_neighbor_judgement(
        self,
        anchor_id: str,
        neighbor_id: str,
        body: Any,
        *,
        if_match: str | None,
    ) -> tuple[dict[str, Any], str]:
        if anchor_id not in self._items or neighbor_id not in self._items:
            raise CatalogueApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown item")
        if not isinstance(body, dict):
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_judgement",
                "Invalid judgement",
            )
        view = RetrievalView(str(body.get("view", "hybrid")))
        visible = self.semantic_index.query(anchor_id, top_k=50, view=view)
        if neighbor_id not in {neighbor.item_id for neighbor in visible.neighbors}:
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "neighbor_not_in_retrieval",
                "Neighbor is not in the current retrieval result",
            )
        current = self.repository.current_neighbor_judgement(
            self.run_id,
            anchor_id,
            neighbor_id,
            self.retrieval_version,
            view.value,
        )
        judgement = CatalogueNeighborJudgement(
            run_id=self.run_id,
            anchor_id=anchor_id,
            anchor_content_version=self._items[anchor_id].item.content_version,
            neighbor_id=neighbor_id,
            neighbor_content_version=self._items[neighbor_id].item.content_version,
            retrieval_version=self.retrieval_version,
            retrieval_view=view.value,
            reviewer_id=self.reviewer_id,
            judgement=NeighborJudgementValue(str(body.get("rating", "unsure"))),
            reviewed_at=datetime.now(timezone.utc),
        )
        try:
            saved = self.repository.save_neighbor_judgement(
                judgement,
                0 if current is None else current.revision,
                expected_etag=_if_match_value(if_match),
            )
        except CatalogueReviewConflict as error:
            raise CatalogueApiProblem(
                HTTPStatus.PRECONDITION_FAILED,
                "stale_judgement",
                "Neighbor judgement changed; reload",
            ) from error
        return {
            "saved": True,
            "rating": saved.judgement.judgement.value,
            "etag": _http_etag(saved.etag),
        }, _http_etag(saved.etag)

    def recommendation_preview(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict):
            raise CatalogueApiProblem(
                HTTPStatus.UNPROCESSABLE_ENTITY,
                "invalid_preview",
                "Recommendation preview must be an object",
            )
        target_item_value = body.get("target_item_id")
        target_item_id = (
            str(target_item_value).strip() if target_item_value is not None else None
        )
        context = RecommendationContext(
            target_skill_id=str(body.get("target_skill_id", "")),
            target_item_id=target_item_id or None,
            grade_band=str(body.get("grade", body.get("grade_band", ""))),
            mastery=float(body.get("mastery", 0.5)),
            uncertainty=float(body.get("uncertainty", 0.5)),
            mode=RecommendationMode(str(body.get("mode", "practice"))),
            recent_item_ids=tuple(
                sorted(set(str(value) for value in body.get("recent_item_ids", [])))
            ),
            seed=int(body.get("seed", 0)),
            evidence_mode=cast(
                Literal["proposals", "reviewed_only"],
                str(body.get("evidence_mode", "proposals")),
            ),
        )
        recent_similarity: dict[str, float] = defaultdict(float)
        target_similarity: dict[str, float] = defaultdict(float)
        recent_families: set[str] = set()
        recent_duplicate_groups: set[str] = set()
        indexed = {item.item_id: item for item in self.semantic_index.items}
        if context.target_item_id is not None:
            if context.target_item_id not in indexed:
                raise CatalogueApiProblem(
                    HTTPStatus.UNPROCESSABLE_ENTITY,
                    "unknown_target_item",
                    "Target item is not in this catalogue run",
                )
            target_similarity[context.target_item_id] = 1.0
            target_result = self.semantic_index.query(
                context.target_item_id,
                top_k=max(1, len(self.semantic_index.items) - 1),
                view="surface",
            )
            for neighbor in target_result.neighbors:
                target_similarity[neighbor.item_id] = neighbor.score
        for recent_id in context.recent_item_ids:
            if recent_id not in indexed:
                continue
            recent_duplicate_groups.update(
                self._items[recent_id].item.duplicate_group_ids
            )
            family = indexed[recent_id].family_id
            if family:
                recent_families.add(family)
            result = self.semantic_index.query(
                recent_id,
                top_k=max(1, len(self.semantic_index.items) - 1),
                view="surface",
            )
            for neighbor in result.neighbors:
                recent_similarity[neighbor.item_id] = max(
                    recent_similarity[neighbor.item_id], neighbor.score
                )

        candidates = []
        for item_id, record in self._items.items():
            item = record.item
            proposal = self._proposal(record)
            current_review = record.current_review
            review_is_current = bool(
                current_review is not None
                and current_review.review.content_version == item.content_version
            )
            if review_is_current and current_review is not None:
                teacher_review = current_review.review
                reviewed = teacher_review.classification
                skill_ids = tuple(
                    sorted(
                        (
                            *reviewed.content_skill_ids,
                            *reviewed.reasoning_move_ids,
                            *reviewed.procedure_ids,
                        )
                    )
                )
                representations = reviewed.representation_ids
                question_type = reviewed.question_type.value
                classification_source: Literal["proposal", "teacher"] = "teacher"
                curriculum_approved = teacher_review.curriculum_approved
                teacher_disposition = cast(
                    Literal[
                        "unreviewed",
                        "faithful",
                        "needs_review",
                        "rejected",
                        "stale",
                    ],
                    teacher_review.disposition.value,
                )
            else:
                skill_ids = tuple(sorted(str(v) for v in proposal.get("skill_ids", [])))
                representations = tuple(
                    sorted(str(v) for v in proposal.get("representation_tags", []))
                )
                question_type = str(proposal.get("question_type", "unknown"))
                classification_source = "proposal"
                curriculum_approved = False
                teacher_disposition = (
                    "stale" if current_review is not None else "unreviewed"
                )
            family_id = indexed[item_id].family_id
            required_asset = item.modality in {
                "diagram_dependent",
                "diagram_review_required",
            }
            required_asset_ready = (
                not required_asset
                or bool(item.asset_refs)
                and all(
                    asset.status == "available" and asset.sha256 is not None
                    for asset in item.asset_refs
                )
                and not {
                    "ASSET_MISSING",
                    "ASSET_BYTE_COUNT_MISMATCH",
                }.intersection(item.warning_codes)
            )
            candidates.append(
                CandidateEvidence(
                    item_id=item_id,
                    content_version=item.content_version,
                    grade_band=item.source_metadata.grade_band,
                    published_point_tier=item.source_metadata.published_point_tier,
                    skill_ids=skill_ids,
                    representation_ids=representations,
                    family_id=family_id,
                    exact_duplicate_group_ids=tuple(sorted(item.duplicate_group_ids)),
                    question_type=question_type,
                    parser_ready=item.parser_status == "parsed",
                    answer_ready=item.answer_status == "official-verified",
                    playable_choices_ready=item.option_count in {4, 5},
                    required_asset_ready=required_asset_ready,
                    classification_source=classification_source,
                    curriculum_approved=curriculum_approved,
                    teacher_disposition=teacher_disposition,
                    source_warning_count=len(item.warning_codes),
                    recent_semantic_similarity=recent_similarity[item_id],
                    target_surface_similarity=(
                        target_similarity[item_id]
                        if context.target_item_id is not None
                        else None
                    ),
                    same_family_as_recent=bool(
                        family_id is not None and family_id in recent_families
                    ),
                    same_exact_duplicate_group_as_recent=bool(
                        set(item.duplicate_group_ids).intersection(
                            recent_duplicate_groups
                        )
                    ),
                )
            )
        preview = preview_recommendations(context, candidates)
        exclusion_reason_counts: Counter[str] = Counter(
            reason for excluded in preview.excluded for reason in excluded.reasons
        )
        slate = []
        for value in preview.slate:
            comparable = self._curriculum_comparable(value.item_id)
            if comparable["classification"]["source"] != value.classification_source:
                raise RuntimeError("recommendation classification provenance changed")
            slate.append(
                {
                    **comparable,
                    **value.model_dump(mode="json"),
                    "eligible": True,
                    "score_breakdown": {
                        key: component.value
                        for key, component in value.components.items()
                    },
                    "blockers": [],
                }
            )
        return {
            "context": context.model_dump(mode="json"),
            "policy_version": preview.policy_version,
            "summary": (
                preview.content_gap_reason
                if preview.content_gap
                else "Experimental slate; no learner state was read or changed."
            ),
            "warnings": preview.warnings
            + (
                ("SURFACE_SIMILARITY_PROXY_FROM_TARGET_ITEM",)
                if context.target_item_id is not None
                else ()
            ),
            "excluded_count": len(preview.excluded),
            "exclusion_reason_counts": dict(
                sorted(
                    exclusion_reason_counts.items(),
                    key=lambda value: (-value[1], value[0]),
                )
            ),
            "content_gap": preview.content_gap,
            "slate": slate,
        }

    def export_evidence(self) -> dict[str, Any]:
        return self.repository.export_evidence(self.run_id)

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
            raise CatalogueApiProblem(
                HTTPStatus.GONE,
                "audited_file_unavailable",
                "Audited file is unavailable",
            ) from error
        if resolved.suffix.lower() not in suffixes:
            raise CatalogueApiProblem(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media",
                "Unsupported audited media type",
            )
        try:
            with resolved.open("rb") as source:
                file_stat = os.fstat(source.fileno())
                if not stat.S_ISREG(file_stat.st_mode):
                    raise OSError("not a regular file")
                data = source.read()
        except OSError as error:
            raise CatalogueApiProblem(
                HTTPStatus.GONE,
                "audited_file_unavailable",
                "Audited file is unavailable",
            ) from error
        digest = hashlib.sha256(data).hexdigest()
        if expected_sha256 is not None and digest != expected_sha256:
            raise CatalogueApiProblem(
                HTTPStatus.CONFLICT, "audited_file_changed", "Audited file has changed"
            )
        if expected_bytes is not None and len(data) != expected_bytes:
            raise CatalogueApiProblem(
                HTTPStatus.CONFLICT, "audited_file_changed", "Audited file has changed"
            )
        return FilePayload(
            data,
            mimetypes.guess_type(resolved.name)[0] or "application/octet-stream",
            _http_etag(digest),
        )

    def file_for_item(self, item_id: str, resource: str) -> FilePayload:
        record = self._items.get(item_id)
        if record is None:
            raise CatalogueApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown item")
        item = record.item
        if resource == "asset":
            return self.file_for_item_asset(item_id, 0)
        source_path = str(item.source_payload.get("source_path", ""))
        if resource == "source-pdf":
            document = self._source_documents.get(source_path)
            if document is None:
                raise CatalogueApiProblem(
                    HTTPStatus.GONE, "source_unavailable", "Source PDF unavailable"
                )
            return self._safe_file(
                Path(document.local_pdf_path),
                suffixes=frozenset({".pdf"}),
                expected_sha256=document.actual_sha256,
                expected_bytes=document.actual_bytes,
            )
        if resource == "answer-key":
            snapshot = item.answer_key_ref
            if snapshot is None or snapshot.status != "available":
                raise CatalogueApiProblem(
                    HTTPStatus.GONE, "answer_key_unavailable", "Answer key unavailable"
                )
            return self._safe_file(
                Path(snapshot.local_ref),
                suffixes=frozenset({".pdf"}),
                expected_sha256=snapshot.sha256,
                expected_bytes=snapshot.bytes,
            )
        raise CatalogueApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown resource")

    def file_for_item_asset(self, item_id: str, index: int) -> FilePayload:
        """Return one audited question-scoped image by its stable source order."""

        record = self._items.get(item_id)
        if record is None:
            raise CatalogueApiProblem(HTTPStatus.NOT_FOUND, "not_found", "Unknown item")
        assets = record.item.asset_refs
        if index < 0 or index >= len(assets):
            raise CatalogueApiProblem(
                HTTPStatus.NOT_FOUND, "asset_not_found", "Question asset not found"
            )
        asset = assets[index]
        if asset.status != "available" or asset.sha256 is None:
            raise CatalogueApiProblem(
                HTTPStatus.GONE,
                "asset_unavailable",
                "Asset was not available in the audited catalogue snapshot",
            )
        return self._safe_file(
            Path(asset.local_ref),
            suffixes=IMAGE_SUFFIXES,
            expected_sha256=asset.sha256,
            expected_bytes=asset.bytes,
        )


class CatalogueHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        handler: type[BaseHTTPRequestHandler],
        application: CatalogueWebApplication,
    ) -> None:
        self.application = application
        super().__init__(server_address, handler)

    def server_close(self) -> None:
        try:
            super().server_close()
        finally:
            self.application.close()


def _handler_class(
    application: CatalogueWebApplication,
) -> type[BaseHTTPRequestHandler]:
    web_root = Path(__file__).resolve().parent

    class CatalogueRequestHandler(BaseHTTPRequestHandler):
        server_version = "MathKangarooCatalogueQA/1"

        def log_message(self, _format: str, *_args: Any) -> None:
            return

        def end_headers(self) -> None:
            """Apply the private-workbench response policy, including errors."""

            self.send_header("Cache-Control", "no-store")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            super().end_headers()

        def _security_headers(self, content_type: str) -> None:
            if content_type.startswith("text/html"):
                self.send_header(
                    "Content-Security-Policy",
                    "default-src 'self'; connect-src 'self'; img-src 'self' data:; "
                    "style-src 'self'; script-src 'self'; object-src 'none'; "
                    "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
                )

        def _send_json(
            self, status: int, value: Any, *, etag: str | None = None
        ) -> None:
            data = (_canonical_json(value) + "\n").encode("utf-8")
            self.send_response(int(status))
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            if etag is not None:
                self.send_header("ETag", etag)
            self._security_headers("application/json")
            self.end_headers()
            self.wfile.write(data)

        def _send_file(self, value: FilePayload) -> None:
            if self.headers.get("If-None-Match") == value.etag:
                self.send_response(HTTPStatus.NOT_MODIFIED)
                self.send_header("ETag", value.etag)
                self._security_headers(value.content_type)
                self.end_headers()
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", value.content_type)
            self.send_header("Content-Length", str(len(value.data)))
            self.send_header("ETag", value.etag)
            self._security_headers(value.content_type)
            self.end_headers()
            self.wfile.write(value.data)

        def _valid_host(self) -> bool:
            host = self.headers.get("Host", "").lower()
            address = cast(tuple[Any, ...], self.server.server_address)
            port = int(address[1])
            return host in {f"127.0.0.1:{port}", f"localhost:{port}"}

        def _validate_origin(self) -> None:
            if not self._valid_host():
                raise CatalogueApiProblem(
                    HTTPStatus.MISDIRECTED_REQUEST,
                    "invalid_host",
                    "The QA workbench is available only through localhost",
                )
            self._validate_fetch_metadata()
            origin = self.headers.get("Origin")
            if origin is None:
                return
            parsed = urlsplit(origin)
            address = cast(tuple[Any, ...], self.server.server_address)
            port = int(address[1])
            if not (
                parsed.scheme == "http"
                and parsed.hostname in {"127.0.0.1", "localhost"}
                and parsed.port == port
            ):
                raise CatalogueApiProblem(
                    HTTPStatus.FORBIDDEN,
                    "invalid_origin",
                    "Cross-origin writes are forbidden",
                )

        def _validate_fetch_metadata(self) -> None:
            """Reject browser subresource requests initiated outside this origin."""

            site = self.headers.get("Sec-Fetch-Site")
            if site is None or site.lower() in {"same-origin", "none"}:
                return
            mode = self.headers.get("Sec-Fetch-Mode", "").lower()
            destination = self.headers.get("Sec-Fetch-Dest", "").lower()
            if (
                self.command == "GET"
                and mode == "navigate"
                and destination == "document"
            ):
                return
            raise CatalogueApiProblem(
                HTTPStatus.FORBIDDEN,
                "cross_site_request",
                "Cross-site browser requests are forbidden",
            )

        @staticmethod
        def _segments(path: str) -> tuple[str, ...]:
            values = tuple(unquote(value) for value in path.split("/") if value)
            if any(
                not value
                or value in {".", ".."}
                or "/" in value
                or "\\" in value
                or "\x00" in value
                for value in values
            ):
                raise CatalogueApiProblem(
                    HTTPStatus.BAD_REQUEST, "invalid_target", "Invalid request target"
                )
            return values

        def _read_json(self) -> Any:
            if (
                self.headers.get("Content-Type", "").split(";", 1)[0].strip()
                != "application/json"
            ):
                raise CatalogueApiProblem(
                    HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                    "json_required",
                    "Writes require application/json",
                )
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError as error:
                raise CatalogueApiProblem(
                    HTTPStatus.LENGTH_REQUIRED,
                    "length_required",
                    "Content-Length required",
                ) from error
            if not 0 <= length <= MAX_REQUEST_BYTES:
                raise CatalogueApiProblem(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    "request_too_large",
                    "Request body is too large",
                )
            try:
                return json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                raise CatalogueApiProblem(
                    HTTPStatus.BAD_REQUEST, "invalid_json", "Invalid JSON"
                ) from error

        def _static_file(self, path: str) -> FilePayload:
            relative = "catalogue.html" if path == "/" else unquote(path.lstrip("/"))
            if (
                not relative
                or "\x00" in relative
                or "\\" in relative
                or any(
                    part in {"", ".", ".."} or part.startswith(".")
                    for part in Path(relative).parts
                )
            ):
                raise CatalogueApiProblem(
                    HTTPStatus.BAD_REQUEST, "invalid_target", "Invalid request target"
                )
            candidate = (web_root / relative).resolve()
            try:
                candidate.relative_to(web_root)
            except ValueError as error:
                raise CatalogueApiProblem(
                    HTTPStatus.NOT_FOUND, "not_found", "Browser asset not found"
                ) from error
            if (
                candidate.suffix.lower() not in STATIC_SUFFIXES
                or not candidate.is_file()
            ):
                raise CatalogueApiProblem(
                    HTTPStatus.NOT_FOUND, "not_found", "Browser asset not found"
                )
            data = candidate.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            return FilePayload(
                data,
                mimetypes.guess_type(candidate.name)[0] or "application/octet-stream",
                _http_etag(digest),
            )

        def _problem(self, problem: CatalogueApiProblem) -> None:
            self._send_json(
                problem.status,
                {
                    "message": problem.message,
                    "error": {"code": problem.code, "message": problem.message},
                },
            )

        def do_GET(self) -> None:  # noqa: N802
            try:
                if not self._valid_host():
                    raise CatalogueApiProblem(
                        HTTPStatus.MISDIRECTED_REQUEST,
                        "invalid_host",
                        "The QA workbench is available only through localhost",
                    )
                self._validate_fetch_metadata()
                split = urlsplit(self.path)
                segments = self._segments(split.path)
                query = parse_qs(split.query, keep_blank_values=False)
                if segments == ("api", "catalogue", "summary"):
                    self._send_json(HTTPStatus.OK, application.summary())
                    return
                if segments == ("api", "catalogue", "items"):
                    self._send_json(HTTPStatus.OK, application.items(query))
                    return
                if segments == ("api", "catalogue", "taxonomy"):
                    self._send_json(HTTPStatus.OK, application.taxonomy())
                    return
                if segments == ("api", "catalogue", "map"):
                    self._send_json(HTTPStatus.OK, application.problem_map(query))
                    return
                if segments == ("api", "catalogue", "export"):
                    self._send_json(HTTPStatus.OK, application.export_evidence())
                    return
                if len(segments) == 4 and segments[:3] == ("api", "catalogue", "items"):
                    detail = application.item_detail(segments[3])
                    etag = None
                    record = application._items[segments[3]].current_review
                    if record is not None:
                        etag = _http_etag(record.etag)
                    self._send_json(HTTPStatus.OK, detail, etag=etag)
                    return
                if (
                    len(segments) == 5
                    and segments[:3] == ("api", "catalogue", "items")
                    and segments[4] in {"asset", "source-pdf", "answer-key"}
                ):
                    self._send_file(application.file_for_item(segments[3], segments[4]))
                    return
                if (
                    len(segments) == 6
                    and segments[:3] == ("api", "catalogue", "items")
                    and segments[4] == "assets"
                ):
                    if not segments[5].isdigit():
                        raise CatalogueApiProblem(
                            HTTPStatus.BAD_REQUEST,
                            "invalid_asset_index",
                            "Question asset index must be a non-negative integer",
                        )
                    self._send_file(
                        application.file_for_item_asset(segments[3], int(segments[5]))
                    )
                    return
                if (
                    len(segments) == 5
                    and segments[:3] == ("api", "catalogue", "items")
                    and segments[4] == "neighbors"
                ):
                    self._send_json(
                        HTTPStatus.OK, application.neighbors(segments[3], query)
                    )
                    return
                if segments and segments[0] == "api":
                    raise CatalogueApiProblem(
                        HTTPStatus.NOT_FOUND, "not_found", "API endpoint not found"
                    )
                self._send_file(self._static_file(split.path))
            except CatalogueApiProblem as problem:
                self._problem(problem)
            except (ValidationError, ValueError) as error:
                self._problem(
                    CatalogueApiProblem(
                        HTTPStatus.UNPROCESSABLE_ENTITY, "invalid_request", str(error)
                    )
                )
            except Exception:
                self._problem(
                    CatalogueApiProblem(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        "internal_error",
                        "The local QA workbench could not complete the request",
                    )
                )

        def do_PUT(self) -> None:  # noqa: N802
            try:
                self._validate_origin()
                segments = self._segments(urlsplit(self.path).path)
                body = self._read_json()
                if_match = self.headers.get("If-Match")
                if (
                    len(segments) == 5
                    and segments[:3] == ("api", "catalogue", "items")
                    and segments[4] == "review"
                ):
                    payload, etag = application.save_item_review(
                        segments[3], body, if_match=if_match
                    )
                    self._send_json(HTTPStatus.OK, payload, etag=etag)
                    return
                if (
                    len(segments) == 7
                    and segments[:3] == ("api", "catalogue", "items")
                    and segments[4] == "neighbors"
                    and segments[6] == "review"
                ):
                    payload, etag = application.save_neighbor_judgement(
                        segments[3], segments[5], body, if_match=if_match
                    )
                    self._send_json(HTTPStatus.OK, payload, etag=etag)
                    return
                if (
                    len(segments) == 6
                    and segments[:4] == ("api", "catalogue", "taxonomy", "skills")
                    and segments[5] == "review"
                ):
                    payload, etag = application.save_skill_judgement(
                        segments[4], body, if_match=if_match
                    )
                    self._send_json(HTTPStatus.OK, payload, etag=etag)
                    return
                raise CatalogueApiProblem(
                    HTTPStatus.NOT_FOUND, "not_found", "API endpoint not found"
                )
            except CatalogueApiProblem as problem:
                self._problem(problem)
            except (ValidationError, ValueError) as error:
                self._problem(
                    CatalogueApiProblem(
                        HTTPStatus.UNPROCESSABLE_ENTITY, "invalid_request", str(error)
                    )
                )
            except Exception:
                self._problem(
                    CatalogueApiProblem(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        "internal_error",
                        "The local QA workbench could not save the request",
                    )
                )

        def do_POST(self) -> None:  # noqa: N802
            try:
                self._validate_origin()
                segments = self._segments(urlsplit(self.path).path)
                body = self._read_json()
                if segments == ("api", "catalogue", "explore"):
                    self._send_json(HTTPStatus.OK, application.explore(body))
                    return
                if segments == ("api", "catalogue", "recommendations", "preview"):
                    self._send_json(
                        HTTPStatus.OK, application.recommendation_preview(body)
                    )
                    return
                raise CatalogueApiProblem(
                    HTTPStatus.NOT_FOUND, "not_found", "API endpoint not found"
                )
            except CatalogueApiProblem as problem:
                self._problem(problem)
            except (ValidationError, ValueError) as error:
                self._problem(
                    CatalogueApiProblem(
                        HTTPStatus.UNPROCESSABLE_ENTITY, "invalid_request", str(error)
                    )
                )
            except Exception:
                self._problem(
                    CatalogueApiProblem(
                        HTTPStatus.INTERNAL_SERVER_ERROR,
                        "internal_error",
                        "The local QA workbench could not complete the preview",
                    )
                )

        def do_OPTIONS(self) -> None:  # noqa: N802
            try:
                if not self._valid_host():
                    raise CatalogueApiProblem(
                        HTTPStatus.MISDIRECTED_REQUEST,
                        "invalid_host",
                        "The QA workbench is available only through localhost",
                    )
                self._validate_fetch_metadata()
                self._send_json(
                    HTTPStatus.METHOD_NOT_ALLOWED,
                    {"message": "Method not allowed"},
                )
            except CatalogueApiProblem as problem:
                self._problem(problem)

    return CatalogueRequestHandler


def create_catalogue_server(
    application: CatalogueWebApplication, *, port: int = 8765
) -> CatalogueHTTPServer:
    if not 0 <= port <= 65535:
        raise ValueError("port must be between 0 and 65535")
    return CatalogueHTTPServer(
        ("127.0.0.1", port), _handler_class(application), application
    )


def serve_catalogue_web(
    *,
    catalogue_dir: Path,
    source_path: Path,
    reviewer_id: str,
    ontology_path: Path | None = None,
    port: int = 8765,
) -> int:
    application = CatalogueWebApplication(
        catalogue_dir=catalogue_dir,
        source_path=source_path,
        reviewer_id=reviewer_id,
        ontology_path=ontology_path or default_ontology_path(),
    )
    server = create_catalogue_server(application, port=port)
    actual_port = int(server.server_address[1])
    print(
        _canonical_json(
            {
                "catalogue_url": f"http://127.0.0.1:{actual_port}/",
                "reviewer_id": application.reviewer_id,
                "run_id": application.run_id,
                "source_items": application.run.source_item_count,
                "private_local_only": True,
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


__all__ = [
    "CatalogueWebApplication",
    "create_catalogue_server",
    "serve_catalogue_web",
]
