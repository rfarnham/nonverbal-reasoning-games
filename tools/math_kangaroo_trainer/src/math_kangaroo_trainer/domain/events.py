"""Versioned immutable evidence events for deterministic synthetic replay."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    field_validator,
    model_validator,
)

from math_kangaroo_trainer.domain.attempts import (
    AssistanceLevel,
    AttemptEvidence,
    InputMode,
)
from math_kangaroo_trainer.versions import EVENT_PROJECTOR_VERSION, EVENT_SCHEMA_VERSION


class StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class EventType(StrEnum):
    SESSION_STARTED = "session_started"
    ITEM_SELECTED = "item_selected"
    ITEM_PRESENTED = "item_presented"
    HINT_REQUESTED = "hint_requested"
    ANSWER_SUBMITTED = "answer_submitted"
    FEEDBACK_SHOWN = "feedback_shown"
    ITEM_CORRECTED = "item_corrected"
    SESSION_ENDED = "session_ended"
    STATE_SNAPSHOT_CREATED = "state_snapshot_created"
    CONTENT_CORRECTION_RECORDED = "content_correction_recorded"


class EventEnvelope(StrictFrozenModel):
    event_type: EventType
    event_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    learner_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestamp: AwareDatetime
    event_schema_version: str = EVENT_SCHEMA_VERSION

    @field_validator("event_id", "idempotency_key", "learner_id", "session_id")
    @classmethod
    def canonical_identifier(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("event identifiers cannot be blank")
        return normalized

    @field_validator("event_schema_version")
    @classmethod
    def current_event_schema_only(cls, value: str) -> str:
        if value != EVENT_SCHEMA_VERSION:
            raise ValueError(
                f"unsupported event schema {value!r}; expected {EVENT_SCHEMA_VERSION!r}"
            )
        return value


class SessionStartedPayload(StrictFrozenModel):
    config_version: str = Field(min_length=1)
    policy_version: str = Field(min_length=1)
    random_seed: int
    presentation_language: str = Field(min_length=1)


class SessionStartedEvent(EventEnvelope):
    event_type: Literal[EventType.SESSION_STARTED] = EventType.SESSION_STARTED
    payload: SessionStartedPayload


class ScoreComponent(StrictFrozenModel):
    name: str = Field(min_length=1)
    value: float = Field(allow_inf_nan=False)

    @field_validator("name")
    @classmethod
    def canonical_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("score-component names cannot be blank")
        return normalized


class CandidateEligibilityEvidence(StrictFrozenModel):
    candidate_id: str = Field(min_length=1)
    eligible: bool
    reasons: tuple[str, ...] = ()

    @field_validator("candidate_id")
    @classmethod
    def canonical_candidate_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("candidate IDs cannot be blank")
        return normalized

    @field_validator("reasons", mode="before")
    @classmethod
    def canonical_reasons(cls, value: object) -> object:
        if not isinstance(value, (list, tuple)):
            return value
        normalized = tuple(str(reason).strip() for reason in value)
        if any(not reason for reason in normalized):
            raise ValueError("candidate reasons cannot be blank")
        if len(set(normalized)) != len(normalized):
            raise ValueError("candidate reasons must be unique")
        return normalized


class PredictedSuccessDistribution(StrictFrozenModel):
    mean: float = Field(ge=0, le=1)
    low: float = Field(ge=0, le=1)
    high: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def ordered_interval(self) -> "PredictedSuccessDistribution":
        if not self.low <= self.mean <= self.high:
            raise ValueError("predicted-success interval must contain its mean")
        return self


class ItemSelectedPayload(StrictFrozenModel):
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    family_id: str | None = None
    candidate_set_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    eligibility_and_exclusion_reasons: tuple[CandidateEligibilityEvidence, ...] = Field(
        min_length=1
    )
    score_components: tuple[ScoreComponent, ...] = Field(min_length=1)
    selected_purpose: str = Field(min_length=1)
    predicted_success_distribution: PredictedSuccessDistribution
    random_seed: int
    approximate_selection_propensity: float = Field(gt=0, le=1)
    policy_version: str = Field(min_length=1)
    model_version: str = Field(min_length=1)
    config_version: str = Field(min_length=1)

    @field_validator(
        "presentation_id",
        "item_id",
        "family_id",
        "selected_purpose",
        "policy_version",
        "model_version",
        "config_version",
        mode="before",
    )
    @classmethod
    def normalize_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None

    @field_validator("eligibility_and_exclusion_reasons")
    @classmethod
    def canonical_candidates(
        cls, value: tuple[CandidateEligibilityEvidence, ...]
    ) -> tuple[CandidateEligibilityEvidence, ...]:
        ids = [candidate.candidate_id for candidate in value]
        if len(ids) != len(set(ids)):
            raise ValueError("candidate eligibility entries must have unique IDs")
        return tuple(sorted(value, key=lambda candidate: candidate.candidate_id))

    @field_validator("score_components")
    @classmethod
    def canonical_components(
        cls, value: tuple[ScoreComponent, ...]
    ) -> tuple[ScoreComponent, ...]:
        names = [component.name for component in value]
        if len(names) != len(set(names)):
            raise ValueError("score-component names must be unique")
        return tuple(sorted(value, key=lambda component: component.name))

    @model_validator(mode="after")
    def selected_item_was_eligible(self) -> "ItemSelectedPayload":
        selected = next(
            (
                candidate
                for candidate in self.eligibility_and_exclusion_reasons
                if candidate.candidate_id == self.item_id
            ),
            None,
        )
        if selected is None or not selected.eligible:
            raise ValueError(
                "selected item must be present and eligible in candidate evidence"
            )
        return self


class ItemSelectedEvent(EventEnvelope):
    event_type: Literal[EventType.ITEM_SELECTED] = EventType.ITEM_SELECTED
    payload: ItemSelectedPayload


class ItemPresentedPayload(StrictFrozenModel):
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    family_id: str | None = None
    presentation_language: str = Field(min_length=1)
    read_aloud: bool = False
    input_mode: InputMode


class ItemPresentedEvent(EventEnvelope):
    event_type: Literal[EventType.ITEM_PRESENTED] = EventType.ITEM_PRESENTED
    payload: ItemPresentedPayload


class HintRequestedPayload(StrictFrozenModel):
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    hint_type: str = Field(min_length=1)
    assistance_level: AssistanceLevel

    @field_validator("presentation_id", "item_id", "hint_type")
    @classmethod
    def canonical_hint_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("hint evidence fields cannot be blank")
        return normalized

    @model_validator(mode="after")
    def hint_is_assisted(self) -> "HintRequestedPayload":
        if self.assistance_level is AssistanceLevel.NONE:
            raise ValueError("a hint request must record a non-none assistance level")
        return self


class HintRequestedEvent(EventEnvelope):
    event_type: Literal[EventType.HINT_REQUESTED] = EventType.HINT_REQUESTED
    payload: HintRequestedPayload


class AnswerSubmittedEvent(EventEnvelope):
    event_type: Literal[EventType.ANSWER_SUBMITTED] = EventType.ANSWER_SUBMITTED
    payload: AttemptEvidence


class FeedbackShownPayload(StrictFrozenModel):
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    correctness_or_partial_score: float = Field(ge=0, le=1)
    feedback_kind: str = Field(min_length=1)


class FeedbackShownEvent(EventEnvelope):
    event_type: Literal[EventType.FEEDBACK_SHOWN] = EventType.FEEDBACK_SHOWN
    payload: FeedbackShownPayload


class ItemCorrectedPayload(StrictFrozenModel):
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    final_answer: str | tuple[str, ...] | None
    correctness_or_partial_score: float = Field(ge=0, le=1)


class ItemCorrectedEvent(EventEnvelope):
    event_type: Literal[EventType.ITEM_CORRECTED] = EventType.ITEM_CORRECTED
    payload: ItemCorrectedPayload


class SessionEndedPayload(StrictFrozenModel):
    reason: str = Field(min_length=1)


class SessionEndedEvent(EventEnvelope):
    event_type: Literal[EventType.SESSION_ENDED] = EventType.SESSION_ENDED
    payload: SessionEndedPayload


class StateSnapshotCreatedPayload(StrictFrozenModel):
    through_sequence: int = Field(ge=0)
    state_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    projector_version: str = Field(min_length=1)

    @field_validator("projector_version")
    @classmethod
    def current_projector_only(cls, value: str) -> str:
        if value != EVENT_PROJECTOR_VERSION:
            raise ValueError("snapshot projector version does not match")
        return value


class StateSnapshotCreatedEvent(EventEnvelope):
    event_type: Literal[EventType.STATE_SNAPSHOT_CREATED] = (
        EventType.STATE_SNAPSHOT_CREATED
    )
    payload: StateSnapshotCreatedPayload

    @model_validator(mode="after")
    def snapshot_precedes_its_event(self) -> "StateSnapshotCreatedEvent":
        if self.payload.through_sequence != self.sequence - 1:
            raise ValueError(
                "snapshot must describe state immediately before its event"
            )
        return self


class ContentCorrectionRecordedPayload(StrictFrozenModel):
    item_id: str = Field(min_length=1)
    previous_content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    corrected_content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    correction_version: str = Field(min_length=1)
    reason: str = Field(min_length=1)

    @model_validator(mode="after")
    def correction_changes_content(self) -> "ContentCorrectionRecordedPayload":
        if self.previous_content_version == self.corrected_content_version:
            raise ValueError("a content correction must change the content version")
        return self


class ContentCorrectionRecordedEvent(EventEnvelope):
    event_type: Literal[EventType.CONTENT_CORRECTION_RECORDED] = (
        EventType.CONTENT_CORRECTION_RECORDED
    )
    payload: ContentCorrectionRecordedPayload


EvidenceEvent = Annotated[
    SessionStartedEvent
    | ItemSelectedEvent
    | ItemPresentedEvent
    | HintRequestedEvent
    | AnswerSubmittedEvent
    | FeedbackShownEvent
    | ItemCorrectedEvent
    | SessionEndedEvent
    | StateSnapshotCreatedEvent
    | ContentCorrectionRecordedEvent,
    Field(discriminator="event_type"),
]

_EVENT_ADAPTER = TypeAdapter(EvidenceEvent)


def parse_event(value: object) -> EvidenceEvent:
    """Validate untrusted serialized input through the discriminated union."""

    return _EVENT_ADAPTER.validate_python(value)


def event_timestamp(event: EvidenceEvent) -> datetime:
    """Expose a plain datetime for callers that do not depend on Pydantic types."""

    return event.timestamp
