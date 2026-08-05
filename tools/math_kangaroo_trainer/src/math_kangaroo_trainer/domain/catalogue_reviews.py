"""Whole-corpus teacher review contracts.

This module is deliberately separate from the Stage 0 gold-sample review
schemas.  A catalogue review can classify every private corpus item without
weakening the independent Stage 0 evidence gate or implying that an item may
be published.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from enum import StrEnum
from typing import Any, Iterable, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    field_validator,
    model_validator,
)


CATALOGUE_RUN_SCHEMA_VERSION = "catalogue-run.v1"
CATALOGUE_ITEM_SCHEMA_VERSION = "catalogue-inventory-item.v2"
CATALOGUE_REVIEW_SCHEMA_VERSION = "catalogue-teacher-review.v1"
CATALOGUE_NEIGHBOR_SCHEMA_VERSION = "catalogue-neighbor-judgement.v1"
CATALOGUE_SKILL_JUDGEMENT_SCHEMA_VERSION = "catalogue-skill-judgement.v1"
CATALOGUE_EVIDENCE_EXPORT_VERSION = "catalogue-evidence-export.v1"

CONTENT_VERSION_PATTERN = r"^sha256:[0-9a-f]{64}$"
SHA256_PATTERN = r"^[0-9a-f]{64}$"
ETAG_PATTERN = r"^[0-9a-f]{64}$"


class StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


def _exact_nonblank(value: str, *, label: str) -> str:
    if not value or not value.strip():
        raise ValueError(f"{label} cannot be blank")
    if value != value.strip():
        raise ValueError(f"{label} must not contain surrounding whitespace")
    if "\n" in value or "\r" in value:
        raise ValueError(f"{label} must be one line")
    return value


def _canonical_ids(values: tuple[str, ...], *, label: str) -> tuple[str, ...]:
    for value in values:
        _exact_nonblank(value, label=label)
    if len(set(values)) != len(values):
        raise ValueError(f"{label} values must be unique")
    return tuple(sorted(values))


class PrimaryDomain(StrEnum):
    NUMBER_ARITHMETIC = "number_arithmetic"
    GEOMETRY_SPATIAL = "geometry_spatial"
    MEASUREMENT_TIME = "measurement_time"
    PATTERNS_ALGEBRA = "patterns_algebra"
    COUNTING_COMBINATORICS = "counting_combinatorics"
    LOGIC_CONSTRAINTS = "logic_constraints"
    PROBABILITY_DATA = "probability_data"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class QuestionType(StrEnum):
    COMPUTATION = "computation"
    NUMBER_RELATIONSHIPS = "number_relationships"
    WORD_PROBLEM = "word_problem"
    PATTERN_SEQUENCE = "pattern_sequence"
    GEOMETRY_MEASUREMENT = "geometry_measurement"
    SPATIAL_VISUAL = "spatial_visual"
    COMBINATORICS_COUNTING = "combinatorics_counting"
    LOGIC_CONSTRAINTS = "logic_constraints"
    PROBABILITY_DATA = "probability_data"
    MIXED = "mixed"
    UNKNOWN = "unknown"


class CatalogueRunStatus(StrEnum):
    ACTIVE = "active"
    SUPERSEDED = "superseded"


class CatalogueDisposition(StrEnum):
    FAITHFUL = "faithful"
    NEEDS_REVIEW = "needs_review"
    REJECTED = "rejected"


class GradeAppropriateness(StrEnum):
    APPROPRIATE = "appropriate"
    TOO_EASY = "too_easy"
    TOO_HARD = "too_hard"
    UNCERTAIN = "uncertain"


class TeacherDifficulty(StrEnum):
    STARTER = "starter"
    JUNIOR = "junior"
    EXPERT = "expert"
    WIZARD = "wizard"
    UNKNOWN = "unknown"


class NeighborJudgementValue(StrEnum):
    SAME_STRATEGY = "same_strategy"
    SAME_SKILL_DIFFERENT_SURFACE = "same_skill_different_surface"
    SURFACE_ONLY = "surface_only"
    DUPLICATE = "duplicate"
    UNRELATED = "unrelated"
    UNSURE = "unsure"


class TaxonomySkillDecision(StrEnum):
    APPROVE = "approve"
    REVISE = "revise"
    MERGE = "merge"
    SPLIT = "split"
    REMOVE = "remove"
    UNSURE = "unsure"


class CatalogueRun(StrictFrozenModel):
    run_id: str = Field(min_length=1)
    created_at: datetime
    source_sha256: str = Field(pattern=SHA256_PATTERN)
    corpus_snapshot_sha256: str = Field(pattern=SHA256_PATTERN)
    source_item_count: int = Field(ge=1)
    source_schema_version: str = Field(min_length=1)
    ontology_version: str = Field(min_length=1)
    ontology_sha256: str = Field(pattern=SHA256_PATTERN)
    proposal_version: str = Field(min_length=1)
    status: CatalogueRunStatus = CatalogueRunStatus.ACTIVE
    schema_version: str = CATALOGUE_RUN_SCHEMA_VERSION

    @field_validator(
        "run_id",
        "source_schema_version",
        "ontology_version",
        "proposal_version",
    )
    @classmethod
    def exact_identifiers(cls, value: str, info: Any) -> str:
        return _exact_nonblank(value, label=info.field_name)

    @field_validator("created_at")
    @classmethod
    def aware_created_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("created_at requires an explicit timezone")
        return value

    @field_validator("schema_version")
    @classmethod
    def current_schema(cls, value: str) -> str:
        if value != CATALOGUE_RUN_SCHEMA_VERSION:
            raise ValueError("unsupported catalogue run schema")
        return value


class CatalogueSourceMetadata(StrictFrozenModel):
    """Allowlisted source fields that contain no paths or question content."""

    source_collection: str = Field(min_length=1)
    source_family: str = Field(min_length=1)
    year: int = Field(ge=1900, le=2200)
    grade_band: str = Field(min_length=1)
    paper_part: str = Field(min_length=1)
    question_number: int = Field(ge=1)
    page: int = Field(ge=1)
    end_page: int = Field(ge=1)
    language: str = Field(min_length=1)
    published_point_tier: int | None = Field(default=None, ge=1)
    extraction_status: str = Field(min_length=1)
    crop_status: str = Field(min_length=1)

    @model_validator(mode="after")
    def valid_page_range(self) -> "CatalogueSourceMetadata":
        if self.end_page < self.page:
            raise ValueError("end_page cannot precede page")
        return self


class CatalogueAssetReference(StrictFrozenModel):
    """Private, build-time media snapshot excluded from evidence exports."""

    asset_id: str = Field(min_length=1)
    local_ref: str = Field(min_length=1)
    media_type: str | None = None
    sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)
    bytes: int | None = Field(default=None, ge=1)
    width: int | None = Field(default=None, ge=1)
    height: int | None = Field(default=None, ge=1)
    status: Literal["available", "missing"]

    @field_validator("asset_id", "local_ref", "status")
    @classmethod
    def nonblank_values(cls, value: str, info: Any) -> str:
        return _exact_nonblank(value, label=info.field_name)

    @model_validator(mode="after")
    def integrity_matches_status(self) -> "CatalogueAssetReference":
        if self.status == "available":
            if self.sha256 is None or self.bytes is None:
                raise ValueError("available asset references require sha256 and bytes")
        elif self.sha256 is not None or self.bytes is not None:
            raise ValueError("missing asset references cannot claim sha256 or bytes")
        return self


class CatalogueAnswerKeyReference(StrictFrozenModel):
    """Private, build-time integrity snapshot for one answer-key file.

    The absolute reference is intentionally confined to the private catalogue
    store and is never included in the allowlisted evidence export.  Missing
    files are recorded explicitly so a file appearing after the build also
    invalidates the snapshot instead of silently becoming trusted evidence.
    """

    local_ref: str = Field(min_length=1)
    media_type: str | None = None
    sha256: str | None = Field(default=None, pattern=SHA256_PATTERN)
    bytes: int | None = Field(default=None, ge=1)
    status: Literal["available", "missing"]

    @field_validator("local_ref")
    @classmethod
    def nonblank_local_ref(cls, value: str) -> str:
        return _exact_nonblank(value, label="local_ref")

    @model_validator(mode="after")
    def integrity_matches_status(self) -> "CatalogueAnswerKeyReference":
        if self.status == "available":
            if self.sha256 is None or self.bytes is None:
                raise ValueError(
                    "available answer-key references require sha256 and bytes"
                )
        elif self.sha256 is not None or self.bytes is not None:
            raise ValueError(
                "missing answer-key references cannot claim sha256 or bytes"
            )
        return self


class CatalogueInventoryItem(StrictFrozenModel):
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=CONTENT_VERSION_PATTERN)
    inventory_order: int = Field(ge=0)
    source_metadata: CatalogueSourceMetadata
    answer_status: str = Field(min_length=1)
    option_count: int = Field(ge=0)
    parser_status: str = Field(min_length=1)
    modality: str = Field(min_length=1)
    license_or_use_status: str = Field(min_length=1)
    warning_codes: tuple[str, ...] = ()
    content_gap_codes: tuple[str, ...] = ()
    duplicate_group_ids: tuple[str, ...] = ()
    source_payload: dict[str, JsonValue] = Field(default_factory=dict)
    learner_payload: dict[str, JsonValue] = Field(default_factory=dict)
    protected_payload: dict[str, JsonValue] = Field(default_factory=dict)
    proposal_payload: dict[str, JsonValue] = Field(default_factory=dict)
    asset_refs: tuple[CatalogueAssetReference, ...] = ()
    answer_key_ref: CatalogueAnswerKeyReference | None = None
    schema_version: str = CATALOGUE_ITEM_SCHEMA_VERSION

    @field_validator(
        "item_id",
        "answer_status",
        "parser_status",
        "modality",
        "license_or_use_status",
    )
    @classmethod
    def exact_values(cls, value: str, info: Any) -> str:
        return _exact_nonblank(value, label=info.field_name)

    @field_validator("warning_codes")
    @classmethod
    def canonical_warnings(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _canonical_ids(value, label="warning code")

    @field_validator("content_gap_codes")
    @classmethod
    def canonical_gaps(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _canonical_ids(value, label="content-gap code")

    @field_validator("duplicate_group_ids")
    @classmethod
    def canonical_duplicate_groups(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return _canonical_ids(value, label="duplicate group ID")

    @model_validator(mode="after")
    def unique_assets_and_current_schema(self) -> "CatalogueInventoryItem":
        asset_ids = [asset.asset_id for asset in self.asset_refs]
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError("asset IDs must be unique within an item")
        if self.schema_version != CATALOGUE_ITEM_SCHEMA_VERSION:
            raise ValueError("unsupported catalogue item schema")
        return self


def catalogue_inventory_snapshot_sha256(
    records: Iterable[CatalogueInventoryItem],
) -> str:
    """Bind a run to item versions and snapshotted private-file evidence.

    Teacher reviews remain version-bound to a catalogue run.  Including the
    asset and answer-key checksums, byte counts, and missing/available states
    here ensures changed evidence produces a different run rather than
    inheriting reviews made against different files.
    """

    rows = []
    for record in sorted(records, key=lambda value: value.item_id):
        answer_key = record.answer_key_ref
        row: list[Any] = [
            record.item_id,
            record.content_version,
            [
                {
                    "asset_id": asset.asset_id,
                    "status": asset.status,
                    "sha256": asset.sha256,
                    "bytes": asset.bytes,
                }
                for asset in record.asset_refs
            ],
            (
                None
                if answer_key is None
                else {
                    "status": answer_key.status,
                    "sha256": answer_key.sha256,
                    "bytes": answer_key.bytes,
                }
            ),
        ]
        rows.append(row)
    encoded = json.dumps(
        rows,
        allow_nan=False,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


class CatalogueClassification(StrictFrozenModel):
    primary_domain: PrimaryDomain = PrimaryDomain.UNKNOWN
    question_type: QuestionType = QuestionType.UNKNOWN
    content_skill_ids: tuple[str, ...] = ()
    reasoning_move_ids: tuple[str, ...] = ()
    procedure_ids: tuple[str, ...] = ()
    representation_ids: tuple[str, ...] = ()
    cognitive_demand_id: str | None = None
    nuisance_load_ids: tuple[str, ...] = ()
    spatial_mechanic: str | None = None
    grade_appropriateness: GradeAppropriateness = GradeAppropriateness.UNCERTAIN
    teacher_difficulty: TeacherDifficulty = TeacherDifficulty.UNKNOWN

    @field_validator(
        "content_skill_ids",
        "reasoning_move_ids",
        "procedure_ids",
        "representation_ids",
        "nuisance_load_ids",
    )
    @classmethod
    def canonical_taxonomy_ids(
        cls, value: tuple[str, ...], info: Any
    ) -> tuple[str, ...]:
        return _canonical_ids(value, label=info.field_name)

    @field_validator("spatial_mechanic")
    @classmethod
    def exact_spatial_mechanic(cls, value: str | None) -> str | None:
        if value is not None:
            _exact_nonblank(value, label="spatial_mechanic")
        return value

    @field_validator("cognitive_demand_id")
    @classmethod
    def exact_cognitive_demand(cls, value: str | None) -> str | None:
        if value is not None:
            _exact_nonblank(value, label="cognitive_demand_id")
        return value


class CatalogueVocabulary(StrictFrozenModel):
    content_skill_ids: frozenset[str] = frozenset()
    reasoning_move_ids: frozenset[str] = frozenset()
    procedure_ids: frozenset[str] = frozenset()
    representation_ids: frozenset[str] = frozenset()
    cognitive_demand_ids: frozenset[str] = frozenset()
    nuisance_load_ids: frozenset[str] = frozenset()
    spatial_mechanics: frozenset[str] = frozenset()

    @field_validator(
        "content_skill_ids",
        "reasoning_move_ids",
        "procedure_ids",
        "representation_ids",
        "cognitive_demand_ids",
        "nuisance_load_ids",
        "spatial_mechanics",
    )
    @classmethod
    def valid_vocab(cls, value: frozenset[str], info: Any) -> frozenset[str]:
        for identifier in value:
            _exact_nonblank(identifier, label=info.field_name)
        return value

    def validate_classification(self, classification: CatalogueClassification) -> None:
        comparisons = (
            (
                "content_skill_ids",
                classification.content_skill_ids,
                self.content_skill_ids,
            ),
            (
                "reasoning_move_ids",
                classification.reasoning_move_ids,
                self.reasoning_move_ids,
            ),
            ("procedure_ids", classification.procedure_ids, self.procedure_ids),
            (
                "representation_ids",
                classification.representation_ids,
                self.representation_ids,
            ),
            (
                "nuisance_load_ids",
                classification.nuisance_load_ids,
                self.nuisance_load_ids,
            ),
        )
        for label, assigned, allowed in comparisons:
            unknown = set(assigned) - set(allowed)
            if unknown:
                raise ValueError(f"unknown {label}: {', '.join(sorted(unknown))}")
        if (
            classification.cognitive_demand_id is not None
            and classification.cognitive_demand_id not in self.cognitive_demand_ids
        ):
            raise ValueError(
                "unknown cognitive_demand_id: " f"{classification.cognitive_demand_id}"
            )
        if (
            classification.spatial_mechanic is not None
            and classification.spatial_mechanic not in self.spatial_mechanics
        ):
            raise ValueError(
                f"unknown spatial_mechanic: {classification.spatial_mechanic}"
            )


class CatalogueSourceChecks(StrictFrozenModel):
    question_boundary_verified: bool
    choices_verified: bool
    answer_evidence_verified: bool
    diagram_verified: bool
    source_metadata_verified: bool

    @property
    def all_verified(self) -> bool:
        return all(
            (
                self.question_boundary_verified,
                self.choices_verified,
                self.answer_evidence_verified,
                self.diagram_verified,
                self.source_metadata_verified,
            )
        )


class CatalogueTeacherReview(StrictFrozenModel):
    run_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=CONTENT_VERSION_PATTERN)
    reviewer_id: str = Field(min_length=1)
    source_checks: CatalogueSourceChecks
    disposition: CatalogueDisposition
    classification: CatalogueClassification
    curriculum_approved: bool = False
    release_asset_approved: bool = False
    duplicate_resolved: bool = False
    notes: str = Field(default="", max_length=4000)
    reviewed_at: datetime
    schema_version: str = CATALOGUE_REVIEW_SCHEMA_VERSION

    @field_validator("run_id", "item_id", "reviewer_id")
    @classmethod
    def exact_identifiers(cls, value: str, info: Any) -> str:
        return _exact_nonblank(value, label=info.field_name)

    @field_validator("reviewed_at")
    @classmethod
    def aware_review_time(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("reviewed_at requires an explicit timezone")
        return value

    @model_validator(mode="after")
    def coherent_decision(self) -> "CatalogueTeacherReview":
        if self.schema_version != CATALOGUE_REVIEW_SCHEMA_VERSION:
            raise ValueError("unsupported catalogue review schema")
        if self.disposition is CatalogueDisposition.FAITHFUL:
            if not self.source_checks.all_verified:
                raise ValueError("faithful reviews require every source check")
        elif self.curriculum_approved or self.release_asset_approved:
            raise ValueError("only faithful reviews may approve curriculum or assets")
        if self.curriculum_approved and (
            self.classification.primary_domain is PrimaryDomain.UNKNOWN
            or self.classification.question_type is QuestionType.UNKNOWN
            or self.classification.cognitive_demand_id is None
        ):
            raise ValueError(
                "curriculum approval requires a known primary domain, question type, "
                "and cognitive demand"
            )
        if (
            self.curriculum_approved
            and self.classification.grade_appropriateness
            is not GradeAppropriateness.APPROPRIATE
        ):
            raise ValueError(
                "curriculum approval requires grade appropriateness to be appropriate"
            )
        if self.curriculum_approved and not (
            self.classification.content_skill_ids
            or self.classification.reasoning_move_ids
            or self.classification.procedure_ids
        ):
            raise ValueError("curriculum approval requires at least one ontology skill")
        return self


class CatalogueReviewRecord(StrictFrozenModel):
    revision: int = Field(ge=1)
    etag: str = Field(pattern=ETAG_PATTERN)
    event_id: str = Field(pattern=SHA256_PATTERN)
    review: CatalogueTeacherReview


class CatalogueReviewConflict(RuntimeError):
    """A caller attempted to replace a projection without its current revision."""


class CatalogueNeighborJudgement(StrictFrozenModel):
    run_id: str = Field(min_length=1)
    anchor_id: str = Field(min_length=1)
    anchor_content_version: str = Field(pattern=CONTENT_VERSION_PATTERN)
    neighbor_id: str = Field(min_length=1)
    neighbor_content_version: str = Field(pattern=CONTENT_VERSION_PATTERN)
    retrieval_version: str = Field(min_length=1)
    retrieval_view: str = Field(min_length=1)
    reviewer_id: str = Field(min_length=1)
    judgement: NeighborJudgementValue
    notes: str = Field(default="", max_length=4000)
    reviewed_at: datetime
    schema_version: str = CATALOGUE_NEIGHBOR_SCHEMA_VERSION

    @field_validator(
        "run_id",
        "anchor_id",
        "neighbor_id",
        "retrieval_version",
        "retrieval_view",
        "reviewer_id",
    )
    @classmethod
    def exact_values(cls, value: str, info: Any) -> str:
        return _exact_nonblank(value, label=info.field_name)

    @field_validator("reviewed_at")
    @classmethod
    def aware_review_time(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("reviewed_at requires an explicit timezone")
        return value

    @model_validator(mode="after")
    def distinct_items_and_current_schema(self) -> "CatalogueNeighborJudgement":
        if self.anchor_id == self.neighbor_id:
            raise ValueError("an item cannot be its own neighbor")
        if self.schema_version != CATALOGUE_NEIGHBOR_SCHEMA_VERSION:
            raise ValueError("unsupported neighbor-judgement schema")
        return self


class CatalogueNeighborRecord(StrictFrozenModel):
    revision: int = Field(ge=1)
    etag: str = Field(pattern=ETAG_PATTERN)
    event_id: str = Field(pattern=SHA256_PATTERN)
    judgement: CatalogueNeighborJudgement


class CatalogueSkillJudgement(StrictFrozenModel):
    """One teacher's advisory judgement about a proposed ontology skill.

    This record deliberately has no field that can approve an ontology or a
    prerequisite edge. Those remain separate two-person evidence gates.
    """

    run_id: str = Field(min_length=1)
    skill_id: str = Field(min_length=1)
    ontology_version: str = Field(min_length=1)
    ontology_sha256: str = Field(pattern=SHA256_PATTERN)
    reviewer_id: str = Field(min_length=1)
    decision: TaxonomySkillDecision
    proposed_name: str | None = Field(default=None, max_length=200)
    proposed_description: str | None = Field(default=None, max_length=2000)
    merge_target_skill_id: str | None = None
    notes: str = Field(default="", max_length=4000)
    reviewed_at: datetime
    schema_version: str = CATALOGUE_SKILL_JUDGEMENT_SCHEMA_VERSION

    @field_validator(
        "run_id",
        "skill_id",
        "ontology_version",
        "reviewer_id",
    )
    @classmethod
    def exact_identifiers(cls, value: str, info: Any) -> str:
        return _exact_nonblank(value, label=info.field_name)

    @field_validator("proposed_name", "merge_target_skill_id")
    @classmethod
    def exact_optional_identifier(cls, value: str | None, info: Any) -> str | None:
        if value is not None:
            _exact_nonblank(value, label=info.field_name)
        return value

    @field_validator("proposed_description")
    @classmethod
    def exact_optional_description(cls, value: str | None) -> str | None:
        if value is not None:
            if not value.strip():
                raise ValueError("proposed_description cannot be blank")
            if value != value.strip():
                raise ValueError(
                    "proposed_description must not contain surrounding whitespace"
                )
        return value

    @field_validator("reviewed_at")
    @classmethod
    def aware_review_time(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("reviewed_at requires an explicit timezone")
        return value

    @model_validator(mode="after")
    def coherent_taxonomy_edit(self) -> "CatalogueSkillJudgement":
        if self.schema_version != CATALOGUE_SKILL_JUDGEMENT_SCHEMA_VERSION:
            raise ValueError("unsupported skill-judgement schema")
        if self.decision is TaxonomySkillDecision.MERGE:
            if self.merge_target_skill_id is None:
                raise ValueError("merge decisions require a target skill")
            if self.merge_target_skill_id == self.skill_id:
                raise ValueError("a skill cannot merge into itself")
        elif self.merge_target_skill_id is not None:
            raise ValueError("only merge decisions may name a merge target")
        if self.decision is TaxonomySkillDecision.REVISE and not (
            self.proposed_name or self.proposed_description
        ):
            raise ValueError("revise decisions require a proposed name or description")
        return self


class CatalogueSkillJudgementRecord(StrictFrozenModel):
    revision: int = Field(ge=1)
    etag: str = Field(pattern=ETAG_PATTERN)
    event_id: str = Field(pattern=SHA256_PATTERN)
    judgement: CatalogueSkillJudgement


class CatalogueFilters(StrictFrozenModel):
    source_family: str | None = None
    grade_band: str | None = None
    year: int | None = Field(default=None, ge=1900, le=2200)
    published_point_tier: int | Literal["unknown"] | None = None
    query: str | None = Field(default=None, max_length=200)
    answer_status: str | None = None
    parser_status: str | None = None
    modality: str | None = None
    review_state: str | None = None
    primary_domain: PrimaryDomain | None = None
    question_type: QuestionType | None = None
    curriculum_ready: bool | None = None
    public_eligible: bool | None = None
    has_warnings: bool | None = None
    has_content_gaps: bool | None = None

    @field_validator(
        "source_family",
        "grade_band",
        "answer_status",
        "parser_status",
        "modality",
        "review_state",
        "query",
    )
    @classmethod
    def exact_optional_filters(cls, value: str | None, info: Any) -> str | None:
        if value is not None:
            _exact_nonblank(value, label=info.field_name)
        return value


class PromotionDecision(StrictFrozenModel):
    curriculum_ready: bool
    public_eligible: bool
    curriculum_blockers: tuple[str, ...]
    public_blockers: tuple[str, ...]


def compute_promotion(
    item: CatalogueInventoryItem,
    review_record: CatalogueReviewRecord | None,
) -> PromotionDecision:
    curriculum: set[str] = set()
    public: set[str] = set()

    if review_record is None:
        curriculum.add("TEACHER_REVIEW_MISSING")
    else:
        review = review_record.review
        if review.content_version != item.content_version:
            curriculum.add("TEACHER_REVIEW_STALE")
        if review.disposition is not CatalogueDisposition.FAITHFUL:
            curriculum.add("SOURCE_REVIEW_NOT_FAITHFUL")
        if not review.source_checks.all_verified:
            curriculum.add("SOURCE_CHECKS_INCOMPLETE")
        if (
            review.classification.primary_domain is PrimaryDomain.UNKNOWN
            or review.classification.question_type is QuestionType.UNKNOWN
        ):
            curriculum.add("CLASSIFICATION_INCOMPLETE")
        grade_appropriateness = review.classification.grade_appropriateness
        if grade_appropriateness is not GradeAppropriateness.APPROPRIATE:
            curriculum.add(
                "GRADE_APPROPRIATENESS_" + grade_appropriateness.value.upper()
            )
        if not review.curriculum_approved:
            curriculum.add("CURRICULUM_NOT_APPROVED")

    if "OFFICIAL_SOLUTION_NOT_AVAILABLE" in item.content_gap_codes:
        curriculum.add("SOLUTION_PATH_REVIEW_REQUIRED")

    public.update(curriculum)
    if item.answer_status != "official-verified":
        public.add("AUTHORITATIVE_SINGLE_ANSWER_REQUIRED")
    if item.option_count not in (4, 5):
        public.add("PLAYABLE_CHOICES_REQUIRED")
    if item.license_or_use_status == "private-research-only":
        public.add("PRIVATE_RESEARCH_ONLY")
    elif item.license_or_use_status != "public-release-approved":
        public.add("LICENSE_NOT_PUBLIC_RELEASE_APPROVED")
    if review_record is None or not review_record.review.release_asset_approved:
        public.add("RELEASE_ASSET_NOT_APPROVED")
    # A catalogue teacher's advisory checkbox cannot satisfy the independent,
    # two-reviewer duplicate-evidence gate.
    if item.duplicate_group_ids:
        public.add("DUPLICATE_REVIEW_UNRESOLVED")

    curriculum_blockers = tuple(sorted(curriculum))
    public_blockers = tuple(sorted(public))
    return PromotionDecision(
        curriculum_ready=not curriculum_blockers,
        public_eligible=not public_blockers,
        curriculum_blockers=curriculum_blockers,
        public_blockers=public_blockers,
    )


class CatalogueItemSummary(StrictFrozenModel):
    run_id: str
    item_id: str
    content_version: str
    inventory_order: int
    source_metadata: CatalogueSourceMetadata
    answer_status: str
    option_count: int
    parser_status: str
    modality: str
    license_or_use_status: str
    warning_count: int
    content_gap_count: int
    duplicate_group_count: int
    review_state: str
    current_revision: int | None
    current_etag: str | None
    reviewer_id: str | None
    # Teacher labels stay distinct from deterministic catalogue proposals.  The
    # effective values make the unreviewed corpus browsable without implying
    # that a proposal is authoritative.
    primary_domain: PrimaryDomain | None
    question_type: QuestionType | None
    proposed_primary_domain: PrimaryDomain | None
    proposed_question_type: QuestionType | None
    effective_primary_domain: PrimaryDomain | None
    effective_question_type: QuestionType | None
    classification_source: Literal["teacher_review", "proposal", "none"]
    promotion: PromotionDecision


class CatalogueItemRecord(StrictFrozenModel):
    run_id: str
    item: CatalogueInventoryItem
    current_review: CatalogueReviewRecord | None
    promotion: PromotionDecision


class CataloguePage(StrictFrozenModel):
    offset: int = Field(ge=0)
    limit: int = Field(ge=1, le=100)
    total: int = Field(ge=0)
    items: tuple[CatalogueItemSummary, ...]


class CatalogueSummary(StrictFrozenModel):
    run_id: str
    expected_items: int = Field(ge=1)
    matching_items: int = Field(ge=0)
    inventory_items: int = Field(ge=0)
    inventory_complete: bool
    reviewed_items: int = Field(ge=0)
    unreviewed_items: int = Field(ge=0)
    stale_review_items: int = Field(ge=0)
    proposal_available_items: int = Field(ge=0)
    proposal_classified_items: int = Field(ge=0)
    teacher_classified_items: int = Field(ge=0)
    curriculum_ready_items: int = Field(ge=0)
    public_eligible_items: int = Field(ge=0)
    facets: dict[str, dict[str, int]]


class CatalogueEvidenceItem(StrictFrozenModel):
    item_id: str
    content_version: str
    source_metadata: CatalogueSourceMetadata
    answer_status: str
    option_count: int
    parser_status: str
    modality: str
    license_or_use_status: str
    warning_codes: tuple[str, ...]
    content_gap_codes: tuple[str, ...]
    duplicate_group_ids: tuple[str, ...]


class CatalogueReviewEvidence(StrictFrozenModel):
    item_id: str
    content_version: str
    revision: int
    etag: str
    event_id: str
    reviewer_id: str
    source_checks: CatalogueSourceChecks
    disposition: CatalogueDisposition
    classification: CatalogueClassification
    curriculum_approved: bool
    release_asset_approved: bool
    duplicate_resolved: bool
    reviewed_at: datetime
    schema_version: str
    promotion: PromotionDecision


class CatalogueNeighborEvidence(StrictFrozenModel):
    anchor_id: str
    anchor_content_version: str
    neighbor_id: str
    neighbor_content_version: str
    retrieval_version: str
    retrieval_view: str
    revision: int
    etag: str
    event_id: str
    reviewer_id: str
    judgement: NeighborJudgementValue
    reviewed_at: datetime
    schema_version: str


class CatalogueSkillJudgementEvidence(StrictFrozenModel):
    skill_id: str
    ontology_version: str
    ontology_sha256: str
    revision: int
    etag: str
    event_id: str
    reviewer_id: str
    decision: TaxonomySkillDecision
    merge_target_skill_id: str | None
    reviewed_at: datetime
    schema_version: str


class CatalogueEvidenceExport(StrictFrozenModel):
    schema_version: str = CATALOGUE_EVIDENCE_EXPORT_VERSION
    generated_at: datetime
    run: CatalogueRun
    inventory: tuple[CatalogueEvidenceItem, ...]
    reviews: tuple[CatalogueReviewEvidence, ...]
    neighbor_judgements: tuple[CatalogueNeighborEvidence, ...]
    skill_judgements: tuple[CatalogueSkillJudgementEvidence, ...]

    @field_validator("generated_at")
    @classmethod
    def aware_generated_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("generated_at requires an explicit timezone")
        return value


def validate_inventory_ids(
    records: Iterable[CatalogueInventoryItem],
) -> tuple[CatalogueInventoryItem, ...]:
    result = tuple(records)
    item_ids = [record.item_id for record in result]
    orders = [record.inventory_order for record in result]
    if len(item_ids) != len(set(item_ids)):
        raise ValueError("catalogue inventory contains duplicate item IDs")
    if len(orders) != len(set(orders)):
        raise ValueError("catalogue inventory contains duplicate inventory positions")
    return result
