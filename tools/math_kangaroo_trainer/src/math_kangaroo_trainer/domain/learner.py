"""Immutable projections of observed evidence, without competence claims."""

from __future__ import annotations

import hashlib
import json

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from math_kangaroo_trainer.domain.attempts import AssistanceLevel, Confidence
from math_kangaroo_trainer.versions import (
    EVIDENCE_STATE_SCHEMA_VERSION,
    EVENT_PROJECTOR_VERSION,
)


class StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class NamedCount(StrictFrozenModel):
    name: str = Field(min_length=1)
    count: int = Field(ge=0)


class SessionEvidence(StrictFrozenModel):
    session_id: str = Field(min_length=1)
    started_sequence: int = Field(ge=1)
    started_at: AwareDatetime
    ended_sequence: int | None = Field(default=None, ge=1)
    ended_at: AwareDatetime | None = None
    end_reason: str | None = None
    config_version: str = Field(min_length=1)
    policy_version: str = Field(min_length=1)
    random_seed: int
    presentation_language: str = Field(min_length=1)


class SelectionEvidence(StrictFrozenModel):
    event_id: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestamp: AwareDatetime
    session_id: str = Field(min_length=1)
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    family_id: str | None = None
    candidate_set_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    candidate_reasons: tuple[tuple[str, bool, tuple[str, ...]], ...]
    score_components: tuple[tuple[str, float], ...]
    selected_purpose: str = Field(min_length=1)
    predicted_success_mean: float = Field(ge=0, le=1)
    predicted_success_low: float = Field(ge=0, le=1)
    predicted_success_high: float = Field(ge=0, le=1)
    random_seed: int
    approximate_selection_propensity: float = Field(gt=0, le=1)
    policy_version: str = Field(min_length=1)
    model_version: str = Field(min_length=1)
    config_version: str = Field(min_length=1)


class PresentationEvidence(StrictFrozenModel):
    event_id: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestamp: AwareDatetime
    session_id: str = Field(min_length=1)
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    family_id: str | None = None
    presentation_language: str = Field(min_length=1)
    read_aloud: bool
    input_mode: str = Field(min_length=1)


class HintEvidence(StrictFrozenModel):
    event_id: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestamp: AwareDatetime
    session_id: str = Field(min_length=1)
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    hint_type: str = Field(min_length=1)
    assistance_level: AssistanceLevel


class AttemptObservation(StrictFrozenModel):
    event_id: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestamp: AwareDatetime
    session_id: str = Field(min_length=1)
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    family_id: str | None = None
    attempt_number: int = Field(ge=1)
    first_answer: str | tuple[str, ...] | None
    final_answer: str | tuple[str, ...] | None
    correctness_or_partial_score: float = Field(ge=0, le=1)
    hint_types: tuple[str, ...]
    assistance_level: AssistanceLevel
    confidence: Confidence
    active_time_ms: int = Field(ge=0)
    idle_time_ms: int = Field(ge=0)
    wall_time_ms: int = Field(ge=0)
    interruption_or_timeout_reason: str | None = None
    valid_for_timing_analysis: bool
    independent_first_attempt: bool
    presentation_language: str = Field(min_length=1)
    read_aloud: bool
    input_mode: str = Field(min_length=1)
    optional_strategy_or_error_classification: str | None = None
    policy_version: str = Field(min_length=1)
    model_version: str = Field(min_length=1)
    annotation_version: str = Field(min_length=1)
    calibration_version: str = Field(min_length=1)
    attempt_schema_version: str = Field(min_length=1)


class FeedbackEvidence(StrictFrozenModel):
    event_id: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestamp: AwareDatetime
    session_id: str = Field(min_length=1)
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    correctness_or_partial_score: float = Field(ge=0, le=1)
    feedback_kind: str = Field(min_length=1)


class ItemCorrectionEvidence(StrictFrozenModel):
    event_id: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestamp: AwareDatetime
    session_id: str = Field(min_length=1)
    presentation_id: str = Field(min_length=1)
    item_id: str = Field(min_length=1)
    final_answer: str | tuple[str, ...] | None
    correctness_or_partial_score: float = Field(ge=0, le=1)


class SnapshotEvidence(StrictFrozenModel):
    event_id: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestamp: AwareDatetime
    through_sequence: int = Field(ge=0)
    state_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    projector_version: str = Field(min_length=1)


class ContentCorrectionEvidence(StrictFrozenModel):
    event_id: str = Field(min_length=1)
    sequence: int = Field(ge=1)
    timestamp: AwareDatetime
    item_id: str = Field(min_length=1)
    previous_content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    corrected_content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    correction_version: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class ContentVersionHead(StrictFrozenModel):
    item_id: str = Field(min_length=1)
    content_version: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class LearnerEvidenceState(StrictFrozenModel):
    """Replayable facts only; no field represents ability, mastery, or fluency."""

    learner_id: str = Field(min_length=1)
    through_sequence: int = Field(ge=0)
    event_ids: tuple[str, ...] = ()
    event_type_counts: tuple[NamedCount, ...] = ()
    sessions: tuple[SessionEvidence, ...] = ()
    selections: tuple[SelectionEvidence, ...] = ()
    presentations: tuple[PresentationEvidence, ...] = ()
    hints: tuple[HintEvidence, ...] = ()
    attempts: tuple[AttemptObservation, ...] = ()
    feedback: tuple[FeedbackEvidence, ...] = ()
    item_corrections: tuple[ItemCorrectionEvidence, ...] = ()
    snapshot_events: tuple[SnapshotEvidence, ...] = ()
    content_corrections: tuple[ContentCorrectionEvidence, ...] = ()
    content_version_heads: tuple[ContentVersionHead, ...] = ()
    item_exposure_counts: tuple[NamedCount, ...] = ()
    family_exposure_counts: tuple[NamedCount, ...] = ()
    independent_first_attempt_count: int = Field(default=0, ge=0)
    assisted_or_retry_attempt_count: int = Field(default=0, ge=0)
    full_credit_observation_count: int = Field(default=0, ge=0)
    non_full_credit_observation_count: int = Field(default=0, ge=0)
    valid_timing_observation_count: int = Field(default=0, ge=0)
    interrupted_timing_observation_count: int = Field(default=0, ge=0)
    total_active_time_ms: int = Field(default=0, ge=0)
    total_idle_time_ms: int = Field(default=0, ge=0)
    total_wall_time_ms: int = Field(default=0, ge=0)
    state_schema_version: str = EVIDENCE_STATE_SCHEMA_VERSION
    projector_version: str = EVENT_PROJECTOR_VERSION

    @field_validator("state_schema_version")
    @classmethod
    def current_state_schema_only(cls, value: str) -> str:
        if value != EVIDENCE_STATE_SCHEMA_VERSION:
            raise ValueError("unsupported learner evidence-state schema")
        return value

    @field_validator("projector_version")
    @classmethod
    def current_projector_only(cls, value: str) -> str:
        if value != EVENT_PROJECTOR_VERSION:
            raise ValueError("unsupported learner evidence projector")
        return value

    @model_validator(mode="after")
    def factual_counts_are_internally_consistent(self) -> "LearnerEvidenceState":
        if len(self.event_ids) != self.through_sequence:
            raise ValueError("event ID count must equal through_sequence")
        if len(set(self.event_ids)) != len(self.event_ids):
            raise ValueError("event IDs must be unique")
        if (
            sum(entry.count for entry in self.event_type_counts)
            != self.through_sequence
        ):
            raise ValueError("event-type counts must cover the projected stream")
        if len({entry.name for entry in self.event_type_counts}) != len(
            self.event_type_counts
        ):
            raise ValueError("event-type count names must be unique")
        attempt_count = len(self.attempts)
        if (
            self.independent_first_attempt_count + self.assisted_or_retry_attempt_count
            != attempt_count
        ):
            raise ValueError("attempt classification counts must cover every attempt")
        if (
            self.full_credit_observation_count + self.non_full_credit_observation_count
            != attempt_count
        ):
            raise ValueError("score counts must cover every attempt")
        if self.valid_timing_observation_count > attempt_count:
            raise ValueError("valid timing count cannot exceed attempt count")
        if self.interrupted_timing_observation_count > attempt_count:
            raise ValueError("interrupted timing count cannot exceed attempt count")
        if sum(entry.count for entry in self.item_exposure_counts) != len(
            self.presentations
        ):
            raise ValueError("item exposure counts must match presentations")
        family_presentations = sum(
            presentation.family_id is not None for presentation in self.presentations
        )
        if (
            sum(entry.count for entry in self.family_exposure_counts)
            != family_presentations
        ):
            raise ValueError("family exposure counts must match presentations")
        if len({entry.name for entry in self.item_exposure_counts}) != len(
            self.item_exposure_counts
        ):
            raise ValueError("item exposure count names must be unique")
        if len({entry.name for entry in self.family_exposure_counts}) != len(
            self.family_exposure_counts
        ):
            raise ValueError("family exposure count names must be unique")
        if len({entry.item_id for entry in self.content_version_heads}) != len(
            self.content_version_heads
        ):
            raise ValueError("content-version heads must be unique by item")

        counts_by_type = {entry.name: entry.count for entry in self.event_type_counts}
        expected_type_counts = {
            "session_started": len(self.sessions),
            "session_ended": sum(
                session.ended_sequence is not None for session in self.sessions
            ),
            "item_selected": len(self.selections),
            "item_presented": len(self.presentations),
            "hint_requested": len(self.hints),
            "answer_submitted": len(self.attempts),
            "feedback_shown": len(self.feedback),
            "item_corrected": len(self.item_corrections),
            "state_snapshot_created": len(self.snapshot_events),
            "content_correction_recorded": len(self.content_corrections),
        }
        if any(
            counts_by_type.get(event_type, 0) != count
            for event_type, count in expected_type_counts.items()
        ):
            raise ValueError("event-type counts disagree with projected evidence")

        recorded_events = (
            *self.selections,
            *self.presentations,
            *self.hints,
            *self.attempts,
            *self.feedback,
            *self.item_corrections,
            *self.snapshot_events,
            *self.content_corrections,
        )
        recorded_sequences = [record.sequence for record in recorded_events]
        if len(recorded_sequences) != len(set(recorded_sequences)):
            raise ValueError("projected evidence sequences must be unique")
        if any(record.event_id not in self.event_ids for record in recorded_events):
            raise ValueError("projected evidence references an unknown event ID")

        presentations = {
            presentation.presentation_id: presentation
            for presentation in self.presentations
        }
        if len(presentations) != len(self.presentations):
            raise ValueError("presentation IDs must be unique")
        for record in (
            *self.hints,
            *self.attempts,
            *self.feedback,
            *self.item_corrections,
        ):
            presentation = presentations.get(record.presentation_id)
            if presentation is None:
                raise ValueError("attempt evidence references an unknown presentation")
            if (
                presentation.item_id != record.item_id
                or presentation.session_id != record.session_id
            ):
                raise ValueError("attempt evidence disagrees with its presentation")

        derived_heads: dict[str, str] = {}
        lineage: dict[str, set[str]] = {}
        version_events = sorted(
            (*self.selections, *self.content_corrections),
            key=lambda record: record.sequence,
        )
        correction_versions: set[str] = set()
        for record in version_events:
            if isinstance(record, SelectionEvidence):
                head = derived_heads.get(record.item_id)
                if head is None:
                    derived_heads[record.item_id] = record.content_version
                    lineage[record.item_id] = {record.content_version}
                elif head != record.content_version:
                    raise ValueError("selection disagrees with the known content head")
                continue
            head = derived_heads.get(record.item_id)
            if head is None or head != record.previous_content_version:
                raise ValueError("content correction does not extend the known head")
            if record.correction_version in correction_versions:
                raise ValueError("content correction versions must be unique")
            correction_versions.add(record.correction_version)
            if record.corrected_content_version in lineage[record.item_id]:
                raise ValueError("content correction lineage cannot cycle")
            lineage[record.item_id].add(record.corrected_content_version)
            derived_heads[record.item_id] = record.corrected_content_version
        stored_heads = {
            entry.item_id: entry.content_version for entry in self.content_version_heads
        }
        if stored_heads != derived_heads:
            raise ValueError("stored content heads disagree with projected evidence")
        return self

    @classmethod
    def empty(cls, learner_id: str) -> "LearnerEvidenceState":
        return cls(learner_id=learner_id, through_sequence=0)


def canonical_evidence_state_json(state: LearnerEvidenceState) -> str:
    return json.dumps(
        state.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def canonical_evidence_state_hash(state: LearnerEvidenceState) -> str:
    digest = hashlib.sha256(
        canonical_evidence_state_json(state).encode("utf-8")
    ).hexdigest()
    return f"sha256:{digest}"
