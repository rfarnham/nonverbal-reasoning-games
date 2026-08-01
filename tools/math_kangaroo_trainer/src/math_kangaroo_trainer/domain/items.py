"""Question schemas with an explicit learner-safe/protected boundary."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ItemStatus(StrEnum):
    RAW = "raw"
    PARSED = "parsed"
    ANNOTATED = "annotated"
    NEEDS_REVIEW = "needs_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class AnswerType(StrEnum):
    SINGLE_CHOICE = "single_choice"
    MULTIPLE_CHOICE = "multiple_choice"
    VOID = "void"
    UNKNOWN = "unknown"


class SourceQuestion(StrictModel):
    """Lossless subset of a canonical `questions` row used by Stage 0."""

    item_id: str = Field(min_length=1)
    source_collection: str = Field(min_length=1)
    source_path: str = Field(min_length=1)
    source_file_id: str = Field(min_length=1)
    source_label: str = Field(min_length=1)
    source_checksum: str = Field(min_length=32)
    source_family: str = Field(min_length=1)
    corpus_group: str = Field(min_length=1)
    year: int = Field(ge=1900, le=2200)
    grade_band: str = Field(min_length=1)
    paper_part: str = Field(min_length=1)
    section: str | None = None
    competition_level: str | None = None
    question_number: int = Field(ge=1)
    page: int = Field(ge=1)
    end_page: int = Field(ge=1)
    language: str = Field(min_length=1)
    stem_markdown: str
    raw_options_json: str
    choices: tuple[str, ...]
    english_stem: str
    raw_english_options_json: str
    english_choices: tuple[str, ...]
    english_helper_needed: bool
    english_prompt_status: str = Field(min_length=1)
    english_options_status: str = Field(min_length=1)
    translation_source_language: str | None = None
    translation_method: str | None = None
    translation_review_status: str | None = None
    translation_notes: str | None = None
    extraction_status: str = Field(min_length=1)
    adapter_warning_codes: tuple[str, ...] = ()
    adapter_field_errors: dict[str, str] = Field(default_factory=dict)
    visual_verified: bool
    official_answer: str | None = None
    answer_status: str = Field(min_length=1)
    answer_source_label: str | None = None
    answer_source_file: str | None = None
    answer_source_url: str | None = None
    answer_notes: str | None = None
    source_notes: str | None = None
    source_pdf_url: str | None = None
    source_archive_url: str | None = None
    asset_id: str = Field(min_length=1)
    image_width: int = Field(ge=1)
    image_height: int = Field(ge=1)
    image_bytes: int = Field(ge=1)
    crop_status: str = Field(min_length=1)
    crop_top_points: float = Field(ge=0)
    crop_bottom_points: float | None = Field(default=None, ge=0)
    source_page_link: str = Field(min_length=1)
    answer_source_link: str | None = None
    option_count: int = Field(ge=0)

    @field_validator("end_page")
    @classmethod
    def end_page_not_before_start(cls, value: int, info: Any) -> int:
        page = info.data.get("page")
        if page is not None and value < page:
            raise ValueError("end_page cannot precede page")
        return value


class SourceDocument(StrictModel):
    source_path: str = Field(min_length=1)
    source_family: str = Field(min_length=1)
    source_label: str = Field(min_length=1)
    years: tuple[int, ...]
    grade_bands: tuple[str, ...]
    question_count: int = Field(ge=1)
    page_count: int = Field(ge=1)
    declared_bytes: int = Field(ge=1)
    declared_sha256: str = Field(min_length=64, max_length=64)
    official_pdf_url: str | None = None
    official_archive_url: str | None = None
    manifest_notes: str | None = None
    pdf_link: str = Field(min_length=1)
    local_pdf_path: str
    actual_bytes: int | None = Field(default=None, ge=1)
    actual_sha256: str | None = Field(default=None, min_length=64, max_length=64)
    warning_codes: tuple[str, ...] = ()
    adapter_field_errors: dict[str, str] = Field(default_factory=dict)


class LearnerSafeItem(StrictModel):
    """Public shape; answer and solution fields do not exist in this type."""

    item_id: str
    content_version: str
    source_collection: str
    source_file_id: str
    source_checksum: str
    year: int
    contest_track_or_grade_band: str
    question_number: int
    published_point_value_or_tier: int | None
    language: str
    stem_markdown: str
    choices: tuple[str, ...]
    answer_type: AnswerType
    asset_ids: tuple[str, ...]
    family_id: str | None = None
    minimum_grade_prerequisites: tuple[str, ...] = ()
    status: ItemStatus
    license_or_use_status: str
    schema_version: str


class ProtectedAnswer(StrictModel):
    """Private answer entity, stored separately from learner-safe content."""

    item_id: str
    content_version: str
    official_answer: str | None
    answer_status: str
    answer_source_label: str | None = None
    answer_source_file: str | None = None
    answer_source_url: str | None = None


class ImportedItem(StrictModel):
    source: SourceQuestion
    learner: LearnerSafeItem
    protected: ProtectedAnswer
    warning_codes: tuple[str, ...]
    content_gap_codes: tuple[str, ...]
    modality: str
    year_band: str
    choice_count_bucket: str


def learner_safe_payload(item: ImportedItem) -> dict[str, Any]:
    """Serialize through the safe schema rather than filtering a private dict."""

    return item.learner.model_dump(mode="json")
