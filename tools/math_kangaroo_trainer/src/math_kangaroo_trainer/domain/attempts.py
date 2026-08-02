"""Immutable, factual attempt evidence with no mastery interpretation."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from math_kangaroo_trainer.versions import ATTEMPT_SCHEMA_VERSION


class StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Confidence(StrEnum):
    SURE = "sure"
    MAYBE = "maybe"
    GUESSED = "guessed"
    ABSENT = "absent"


class AssistanceLevel(StrEnum):
    NONE = "none"
    SMALL_HINT = "small_hint"
    REVEALED_STEP = "revealed_step"
    WORKED_EXAMPLE = "worked_example"
    ANSWER_REVEALED = "answer_revealed"


class InputMode(StrEnum):
    KEYBOARD = "keyboard"
    MOUSE = "mouse"
    TOUCH = "touch"
    VOICE = "voice"
    OTHER = "other"


class AttemptTiming(StrictFrozenModel):
    """Client-observed timing partitions, kept separate from competence."""

    active_time_ms: int = Field(ge=0)
    idle_time_ms: int = Field(ge=0)
    wall_time_ms: int = Field(ge=0)
    interruption_or_timeout_reason: str | None = None

    @field_validator("interruption_or_timeout_reason")
    @classmethod
    def normalize_reason(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("interruption reason cannot be blank")
        return normalized

    @model_validator(mode="after")
    def partitions_fit_wall_time(self) -> "AttemptTiming":
        if self.active_time_ms + self.idle_time_ms > self.wall_time_ms:
            raise ValueError("active and idle time cannot exceed wall time")
        return self

    @property
    def valid_for_timing_analysis(self) -> bool:
        """Whether this observation is usable by a later, separate timing model."""

        return self.wall_time_ms > 0 and self.interruption_or_timeout_reason is None


class AttemptEvidence(StrictFrozenModel):
    """Facts submitted for one attempt; this model never infers competence."""

    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    family_id: str | None = None
    first_answer: str | tuple[str, ...] | None
    final_answer: str | tuple[str, ...] | None
    correctness_or_partial_score: float = Field(ge=0, le=1)
    attempt_number: int = Field(ge=1)
    hint_types: tuple[str, ...] = ()
    assistance_level: AssistanceLevel = AssistanceLevel.NONE
    confidence: Confidence = Confidence.ABSENT
    timing: AttemptTiming
    presentation_language: str = Field(min_length=1)
    read_aloud: bool = False
    input_mode: InputMode
    optional_strategy_or_error_classification: str | None = None
    policy_version: str = Field(min_length=1)
    model_version: str = Field(min_length=1)
    annotation_version: str = Field(min_length=1)
    calibration_version: str = Field(min_length=1)
    attempt_schema_version: str = ATTEMPT_SCHEMA_VERSION

    @field_validator(
        "presentation_id",
        "item_id",
        "family_id",
        "presentation_language",
        "optional_strategy_or_error_classification",
        "policy_version",
        "model_version",
        "annotation_version",
        "calibration_version",
        mode="before",
    )
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        if not normalized:
            return None
        return normalized

    @field_validator("hint_types", mode="before")
    @classmethod
    def normalize_hint_types(cls, value: object) -> object:
        if not isinstance(value, (list, tuple)):
            return value
        normalized = tuple(str(hint).strip() for hint in value)
        if any(not hint for hint in normalized):
            raise ValueError("hint types cannot be blank")
        if len(set(normalized)) != len(normalized):
            raise ValueError("hint types must be unique")
        return normalized

    @field_validator("attempt_schema_version")
    @classmethod
    def current_attempt_schema_only(cls, value: str) -> str:
        if value != ATTEMPT_SCHEMA_VERSION:
            raise ValueError(
                f"unsupported attempt schema {value!r}; "
                f"expected {ATTEMPT_SCHEMA_VERSION!r}"
            )
        return value

    @model_validator(mode="after")
    def assistance_matches_hints(self) -> "AttemptEvidence":
        if self.assistance_level is AssistanceLevel.NONE and self.hint_types:
            raise ValueError("unassisted attempts cannot list hint types")
        if self.assistance_level is not AssistanceLevel.NONE and not self.hint_types:
            raise ValueError("assisted attempts must identify the assistance or hint")
        return self

    @property
    def is_independent_first_attempt(self) -> bool:
        """A factual evidence category, not a mastery or competence decision."""

        return (
            self.attempt_number == 1
            and self.assistance_level is AssistanceLevel.NONE
            and not self.hint_types
        )
