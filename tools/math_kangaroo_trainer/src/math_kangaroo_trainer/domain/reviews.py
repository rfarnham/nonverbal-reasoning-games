"""Human gold-set review schemas."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from math_kangaroo_trainer.versions import (
    DUPLICATE_REVIEW_SCHEMA_VERSION,
    REVIEW_SCHEMA_VERSION,
)


class ReviewDisposition(StrEnum):
    FAITHFUL = "faithful"
    NEEDS_REVIEW = "needs_review"
    REJECTED = "rejected"


class GoldReview(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    reviewer_slot: int = Field(ge=1, le=2)
    reviewer_id: str = Field(min_length=1)
    question_boundary_verified: bool
    choices_verified: bool
    answer_key_verified: bool
    diagram_verified: bool
    source_metadata_verified: bool
    disposition: ReviewDisposition
    notes: str = ""
    reviewed_at: datetime
    schema_version: str = REVIEW_SCHEMA_VERSION

    @field_validator("reviewer_id", mode="before")
    @classmethod
    def canonical_reviewer_id(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("reviewer_id cannot be blank")
        return value

    @field_validator("schema_version")
    @classmethod
    def current_schema_only(cls, value: str) -> str:
        if value != REVIEW_SCHEMA_VERSION:
            raise ValueError(
                f"unsupported review schema {value!r}; expected {REVIEW_SCHEMA_VERSION!r}"
            )
        return value

    @model_validator(mode="after")
    def faithful_requires_every_check(self) -> "GoldReview":
        if self.reviewed_at.tzinfo is None or self.reviewed_at.utcoffset() is None:
            raise ValueError("reviewed_at must include an explicit timezone")
        checks = (
            self.question_boundary_verified,
            self.choices_verified,
            self.answer_key_verified,
            self.diagram_verified,
            self.source_metadata_verified,
        )
        if self.disposition is ReviewDisposition.FAITHFUL and not all(checks):
            raise ValueError("faithful reviews require every verification check")
        return self


class DuplicateDecision(StrEnum):
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    NEEDS_REVIEW = "needs_review"


class DuplicateGoldReview(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: str = Field(min_length=1)
    group_id: str = Field(min_length=1)
    signature: str = Field(pattern=r"^[0-9a-f]{64}$")
    reviewer_slot: int = Field(ge=1, le=2)
    reviewer_id: str = Field(min_length=1)
    decision: DuplicateDecision
    notes: str = ""
    reviewed_at: datetime
    schema_version: str = DUPLICATE_REVIEW_SCHEMA_VERSION

    @field_validator("reviewer_id", mode="before")
    @classmethod
    def canonical_reviewer_id(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("reviewer_id cannot be blank")
        return value

    @field_validator("schema_version")
    @classmethod
    def current_schema_only(cls, value: str) -> str:
        if value != DUPLICATE_REVIEW_SCHEMA_VERSION:
            raise ValueError(
                "unsupported duplicate-review schema "
                f"{value!r}; expected {DUPLICATE_REVIEW_SCHEMA_VERSION!r}"
            )
        return value

    @model_validator(mode="after")
    def timezone_required(self) -> "DuplicateGoldReview":
        if self.reviewed_at.tzinfo is None or self.reviewed_at.utcoffset() is None:
            raise ValueError("reviewed_at must include an explicit timezone")
        return self
