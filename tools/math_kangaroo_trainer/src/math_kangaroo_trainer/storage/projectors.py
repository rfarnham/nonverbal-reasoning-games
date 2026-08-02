"""Pure, sequence-driven projection of immutable learner evidence events."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

from pydantic import BaseModel, ConfigDict, model_validator

from math_kangaroo_trainer.domain.attempts import AssistanceLevel

from math_kangaroo_trainer.domain.events import (
    AnswerSubmittedEvent,
    ContentCorrectionRecordedEvent,
    EvidenceEvent,
    FeedbackShownEvent,
    HintRequestedEvent,
    ItemCorrectedEvent,
    ItemPresentedEvent,
    ItemSelectedEvent,
    SessionEndedEvent,
    SessionStartedEvent,
    StateSnapshotCreatedEvent,
)
from math_kangaroo_trainer.domain.learner import (
    AttemptObservation,
    ContentVersionHead,
    ContentCorrectionEvidence,
    FeedbackEvidence,
    HintEvidence,
    ItemCorrectionEvidence,
    LearnerEvidenceState,
    NamedCount,
    PresentationEvidence,
    SelectionEvidence,
    SessionEvidence,
    SnapshotEvidence,
    canonical_evidence_state_hash,
)
from math_kangaroo_trainer.versions import EVENT_PROJECTOR_VERSION


class ProjectionError(ValueError):
    pass


class ProjectionSequenceError(ProjectionError):
    pass


class ProjectionReferenceError(ProjectionError):
    pass


class PersistedSnapshot(BaseModel):
    """A serialized prefix state bound to its immutable snapshot event."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    state: LearnerEvidenceState
    snapshot_event: StateSnapshotCreatedEvent

    @model_validator(mode="after")
    def snapshot_matches_event(self) -> "PersistedSnapshot":
        event = self.snapshot_event
        state = self.state
        validated_state = LearnerEvidenceState.model_validate(
            state.model_dump(mode="python")
        )
        if validated_state != state:
            raise ValueError("snapshot state is not canonically validated")
        if event.learner_id != state.learner_id:
            raise ValueError("snapshot learner does not match its event")
        if event.sequence != state.through_sequence + 1:
            raise ValueError("snapshot event must immediately follow its state")
        if event.payload.through_sequence != state.through_sequence:
            raise ValueError("snapshot through-sequence does not match its state")
        if event.payload.projector_version != state.projector_version:
            raise ValueError("snapshot projector version does not match its state")
        if event.payload.state_hash != canonical_evidence_state_hash(state):
            raise ValueError("persisted snapshot hash does not match its state")
        if event.event_id in state.event_ids:
            raise ValueError("snapshot event cannot already be part of its prefix")
        if event.session_id not in {session.session_id for session in state.sessions}:
            raise ValueError("snapshot event references an unknown session")
        return self


@dataclass
class _Accumulator:
    learner_id: str
    through_sequence: int = 0
    event_ids: list[str] = field(default_factory=list)
    event_type_counts: Counter[str] = field(default_factory=Counter)
    sessions: dict[str, SessionEvidence] = field(default_factory=dict)
    selections: list[SelectionEvidence] = field(default_factory=list)
    presentations: list[PresentationEvidence] = field(default_factory=list)
    hints: list[HintEvidence] = field(default_factory=list)
    attempts: list[AttemptObservation] = field(default_factory=list)
    feedback: list[FeedbackEvidence] = field(default_factory=list)
    item_corrections: list[ItemCorrectionEvidence] = field(default_factory=list)
    snapshot_events: list[SnapshotEvidence] = field(default_factory=list)
    content_corrections: list[ContentCorrectionEvidence] = field(default_factory=list)
    content_version_heads: dict[str, str] = field(default_factory=dict)
    item_exposure_counts: Counter[str] = field(default_factory=Counter)
    family_exposure_counts: Counter[str] = field(default_factory=Counter)
    independent_first_attempt_count: int = 0
    assisted_or_retry_attempt_count: int = 0
    full_credit_observation_count: int = 0
    non_full_credit_observation_count: int = 0
    valid_timing_observation_count: int = 0
    interrupted_timing_observation_count: int = 0
    total_active_time_ms: int = 0
    total_idle_time_ms: int = 0
    total_wall_time_ms: int = 0

    @classmethod
    def from_state(cls, state: LearnerEvidenceState) -> "_Accumulator":
        return cls(
            learner_id=state.learner_id,
            through_sequence=state.through_sequence,
            event_ids=list(state.event_ids),
            event_type_counts=Counter(
                {entry.name: entry.count for entry in state.event_type_counts}
            ),
            sessions={session.session_id: session for session in state.sessions},
            selections=list(state.selections),
            presentations=list(state.presentations),
            hints=list(state.hints),
            attempts=list(state.attempts),
            feedback=list(state.feedback),
            item_corrections=list(state.item_corrections),
            snapshot_events=list(state.snapshot_events),
            content_corrections=list(state.content_corrections),
            content_version_heads={
                entry.item_id: entry.content_version
                for entry in state.content_version_heads
            },
            item_exposure_counts=Counter(
                {entry.name: entry.count for entry in state.item_exposure_counts}
            ),
            family_exposure_counts=Counter(
                {entry.name: entry.count for entry in state.family_exposure_counts}
            ),
            independent_first_attempt_count=state.independent_first_attempt_count,
            assisted_or_retry_attempt_count=state.assisted_or_retry_attempt_count,
            full_credit_observation_count=state.full_credit_observation_count,
            non_full_credit_observation_count=state.non_full_credit_observation_count,
            valid_timing_observation_count=state.valid_timing_observation_count,
            interrupted_timing_observation_count=(
                state.interrupted_timing_observation_count
            ),
            total_active_time_ms=state.total_active_time_ms,
            total_idle_time_ms=state.total_idle_time_ms,
            total_wall_time_ms=state.total_wall_time_ms,
        )

    def to_state(self) -> LearnerEvidenceState:
        return LearnerEvidenceState(
            learner_id=self.learner_id,
            through_sequence=self.through_sequence,
            event_ids=tuple(self.event_ids),
            event_type_counts=tuple(
                NamedCount(name=name, count=count)
                for name, count in sorted(self.event_type_counts.items())
            ),
            sessions=tuple(
                sorted(self.sessions.values(), key=lambda value: value.started_sequence)
            ),
            selections=tuple(self.selections),
            presentations=tuple(self.presentations),
            hints=tuple(self.hints),
            attempts=tuple(self.attempts),
            feedback=tuple(self.feedback),
            item_corrections=tuple(self.item_corrections),
            snapshot_events=tuple(self.snapshot_events),
            content_corrections=tuple(self.content_corrections),
            content_version_heads=tuple(
                ContentVersionHead(item_id=item_id, content_version=content_version)
                for item_id, content_version in sorted(
                    self.content_version_heads.items()
                )
            ),
            item_exposure_counts=tuple(
                NamedCount(name=name, count=count)
                for name, count in sorted(self.item_exposure_counts.items())
            ),
            family_exposure_counts=tuple(
                NamedCount(name=name, count=count)
                for name, count in sorted(self.family_exposure_counts.items())
            ),
            independent_first_attempt_count=self.independent_first_attempt_count,
            assisted_or_retry_attempt_count=self.assisted_or_retry_attempt_count,
            full_credit_observation_count=self.full_credit_observation_count,
            non_full_credit_observation_count=self.non_full_credit_observation_count,
            valid_timing_observation_count=self.valid_timing_observation_count,
            interrupted_timing_observation_count=(
                self.interrupted_timing_observation_count
            ),
            total_active_time_ms=self.total_active_time_ms,
            total_idle_time_ms=self.total_idle_time_ms,
            total_wall_time_ms=self.total_wall_time_ms,
        )


class EventProjector:
    """Rebuild observed evidence without estimating ability or mastery."""

    projector_version = EVENT_PROJECTOR_VERSION

    def rebuild(self, events: tuple[EvidenceEvent, ...]) -> LearnerEvidenceState:
        """Project a complete immutable stream from its first event."""

        return self._rebuild(events, snapshot=None)

    def resume_from_snapshot(
        self,
        tail_events: tuple[EvidenceEvent, ...],
        *,
        snapshot: PersistedSnapshot,
    ) -> LearnerEvidenceState:
        """Resume from a hash-verified persisted prefix plus events after it."""

        if not tail_events:
            raise ProjectionSequenceError(
                "snapshot replay requires at least one event after the snapshot"
            )
        return self._rebuild(
            (snapshot.snapshot_event, *tail_events),
            snapshot=snapshot.state,
        )

    def _rebuild(
        self,
        events: tuple[EvidenceEvent, ...],
        *,
        snapshot: LearnerEvidenceState | None,
    ) -> LearnerEvidenceState:
        if snapshot is None:
            if not events:
                raise ProjectionError(
                    "a learner ID cannot be inferred from an empty stream"
                )
            accumulator = _Accumulator(learner_id=events[0].learner_id)
        else:
            if snapshot.projector_version != self.projector_version:
                raise ProjectionError("snapshot projector version does not match")
            accumulator = _Accumulator.from_state(snapshot)

        known_event_ids = set(accumulator.event_ids)
        expected_sequence = accumulator.through_sequence + 1
        for event in events:
            if event.learner_id != accumulator.learner_id:
                raise ProjectionReferenceError(
                    "one projection cannot mix learner streams"
                )
            if event.sequence != expected_sequence:
                raise ProjectionSequenceError(
                    f"expected event sequence {expected_sequence}, got {event.sequence}"
                )
            if event.event_id in known_event_ids:
                raise ProjectionSequenceError("event IDs cannot repeat in a projection")

            self._apply(accumulator, event)
            accumulator.event_ids.append(event.event_id)
            known_event_ids.add(event.event_id)
            accumulator.event_type_counts[event.event_type.value] += 1
            accumulator.through_sequence = event.sequence
            expected_sequence += 1

        return accumulator.to_state()

    def _require_session(
        self, accumulator: _Accumulator, event: EvidenceEvent
    ) -> SessionEvidence:
        session = accumulator.sessions.get(event.session_id)
        if session is None:
            raise ProjectionReferenceError(
                "event references a session that has not started"
            )
        return session

    def _require_active_session(
        self, accumulator: _Accumulator, event: EvidenceEvent
    ) -> SessionEvidence:
        session = self._require_session(accumulator, event)
        if session.ended_sequence is not None:
            raise ProjectionReferenceError(
                "learning evidence cannot follow session end"
            )
        return session

    @staticmethod
    def _presentation(
        accumulator: _Accumulator, presentation_id: str
    ) -> PresentationEvidence:
        presentation = next(
            (
                value
                for value in accumulator.presentations
                if value.presentation_id == presentation_id
            ),
            None,
        )
        if presentation is None:
            raise ProjectionReferenceError("event references an unknown presentation")
        return presentation

    @staticmethod
    def _matching_presentation(
        accumulator: _Accumulator,
        event: EvidenceEvent,
        presentation_id: str,
        item_id: str,
    ) -> PresentationEvidence:
        presentation = EventProjector._presentation(accumulator, presentation_id)
        if (
            presentation.session_id != event.session_id
            or presentation.item_id != item_id
        ):
            raise ProjectionReferenceError("event does not match its presentation")
        return presentation

    def _apply(self, accumulator: _Accumulator, event: EvidenceEvent) -> None:
        if isinstance(event, SessionStartedEvent):
            if event.session_id in accumulator.sessions:
                raise ProjectionReferenceError("a session can start only once")
            payload = event.payload
            accumulator.sessions[event.session_id] = SessionEvidence(
                session_id=event.session_id,
                started_sequence=event.sequence,
                started_at=event.timestamp,
                config_version=payload.config_version,
                policy_version=payload.policy_version,
                random_seed=payload.random_seed,
                presentation_language=payload.presentation_language,
            )
            return

        if isinstance(event, SessionEndedEvent):
            session = self._require_active_session(accumulator, event)
            accumulator.sessions[event.session_id] = SessionEvidence(
                **session.model_dump(
                    exclude={"ended_sequence", "ended_at", "end_reason"}
                ),
                ended_sequence=event.sequence,
                ended_at=event.timestamp,
                end_reason=event.payload.reason,
            )
            return

        if isinstance(event, ItemSelectedEvent):
            self._require_active_session(accumulator, event)
            payload = event.payload
            known_head = accumulator.content_version_heads.get(payload.item_id)
            if known_head is None:
                accumulator.content_version_heads[payload.item_id] = (
                    payload.content_version
                )
            elif known_head != payload.content_version:
                raise ProjectionReferenceError(
                    "selection uses a content version other than the known head"
                )
            if any(
                selection.presentation_id == payload.presentation_id
                for selection in accumulator.selections
            ):
                raise ProjectionReferenceError(
                    "a presentation can be selected only once"
                )
            prediction = payload.predicted_success_distribution
            accumulator.selections.append(
                SelectionEvidence(
                    event_id=event.event_id,
                    sequence=event.sequence,
                    timestamp=event.timestamp,
                    session_id=event.session_id,
                    presentation_id=payload.presentation_id,
                    item_id=payload.item_id,
                    content_version=payload.content_version,
                    family_id=payload.family_id,
                    candidate_set_hash=payload.candidate_set_hash,
                    candidate_reasons=tuple(
                        (candidate.candidate_id, candidate.eligible, candidate.reasons)
                        for candidate in payload.eligibility_and_exclusion_reasons
                    ),
                    score_components=tuple(
                        (component.name, component.value)
                        for component in payload.score_components
                    ),
                    selected_purpose=payload.selected_purpose,
                    predicted_success_mean=prediction.mean,
                    predicted_success_low=prediction.low,
                    predicted_success_high=prediction.high,
                    random_seed=payload.random_seed,
                    approximate_selection_propensity=(
                        payload.approximate_selection_propensity
                    ),
                    policy_version=payload.policy_version,
                    model_version=payload.model_version,
                    config_version=payload.config_version,
                )
            )
            return

        if isinstance(event, ItemPresentedEvent):
            self._require_active_session(accumulator, event)
            payload = event.payload
            selection = next(
                (
                    value
                    for value in accumulator.selections
                    if value.presentation_id == payload.presentation_id
                ),
                None,
            )
            if selection is None:
                raise ProjectionReferenceError(
                    "presentation has no preceding selection"
                )
            if (
                selection.session_id != event.session_id
                or selection.item_id != payload.item_id
                or selection.content_version != payload.content_version
                or selection.family_id != payload.family_id
            ):
                raise ProjectionReferenceError(
                    "presentation differs from its selection"
                )
            if any(
                value.presentation_id == payload.presentation_id
                for value in accumulator.presentations
            ):
                raise ProjectionReferenceError("a presentation can be shown only once")
            accumulator.presentations.append(
                PresentationEvidence(
                    event_id=event.event_id,
                    sequence=event.sequence,
                    timestamp=event.timestamp,
                    session_id=event.session_id,
                    presentation_id=payload.presentation_id,
                    item_id=payload.item_id,
                    content_version=payload.content_version,
                    family_id=payload.family_id,
                    presentation_language=payload.presentation_language,
                    read_aloud=payload.read_aloud,
                    input_mode=payload.input_mode.value,
                )
            )
            accumulator.item_exposure_counts[payload.item_id] += 1
            if payload.family_id is not None:
                accumulator.family_exposure_counts[payload.family_id] += 1
            return

        if isinstance(event, HintRequestedEvent):
            self._require_active_session(accumulator, event)
            payload = event.payload
            self._matching_presentation(
                accumulator, event, payload.presentation_id, payload.item_id
            )
            accumulator.hints.append(
                HintEvidence(
                    event_id=event.event_id,
                    sequence=event.sequence,
                    timestamp=event.timestamp,
                    session_id=event.session_id,
                    presentation_id=payload.presentation_id,
                    item_id=payload.item_id,
                    hint_type=payload.hint_type,
                    assistance_level=payload.assistance_level,
                )
            )
            return

        if isinstance(event, AnswerSubmittedEvent):
            self._require_active_session(accumulator, event)
            payload = event.payload
            presentation = self._matching_presentation(
                accumulator, event, payload.presentation_id, payload.item_id
            )
            if (
                presentation.content_version != payload.content_version
                or presentation.family_id != payload.family_id
                or presentation.presentation_language != payload.presentation_language
                or presentation.read_aloud != payload.read_aloud
                or presentation.input_mode != payload.input_mode.value
            ):
                raise ProjectionReferenceError("attempt differs from presented content")
            prior = [
                attempt
                for attempt in accumulator.attempts
                if attempt.presentation_id == payload.presentation_id
            ]
            if payload.attempt_number != len(prior) + 1:
                raise ProjectionReferenceError("attempt numbers must be contiguous")
            if prior and payload.first_answer != prior[0].first_answer:
                raise ProjectionReferenceError("retry must preserve the first answer")
            prior_hints = [
                hint
                for hint in accumulator.hints
                if hint.presentation_id == payload.presentation_id
                and hint.sequence < event.sequence
            ]
            requested_hint_types = {hint.hint_type for hint in prior_hints}
            if set(payload.hint_types) != requested_hint_types:
                raise ProjectionReferenceError(
                    "attempt hint types must exactly match prior hint evidence"
                )
            assistance_rank = {
                AssistanceLevel.NONE: 0,
                AssistanceLevel.SMALL_HINT: 1,
                AssistanceLevel.REVEALED_STEP: 2,
                AssistanceLevel.WORKED_EXAMPLE: 3,
                AssistanceLevel.ANSWER_REVEALED: 4,
            }
            expected_assistance = max(
                (hint.assistance_level for hint in prior_hints),
                key=assistance_rank.__getitem__,
                default=AssistanceLevel.NONE,
            )
            if payload.assistance_level is not expected_assistance:
                raise ProjectionReferenceError(
                    "attempt assistance level must match prior hint evidence"
                )
            observation = AttemptObservation(
                event_id=event.event_id,
                sequence=event.sequence,
                timestamp=event.timestamp,
                session_id=event.session_id,
                presentation_id=payload.presentation_id,
                item_id=payload.item_id,
                content_version=payload.content_version,
                family_id=payload.family_id,
                attempt_number=payload.attempt_number,
                first_answer=payload.first_answer,
                final_answer=payload.final_answer,
                correctness_or_partial_score=payload.correctness_or_partial_score,
                hint_types=payload.hint_types,
                assistance_level=payload.assistance_level,
                confidence=payload.confidence,
                active_time_ms=payload.timing.active_time_ms,
                idle_time_ms=payload.timing.idle_time_ms,
                wall_time_ms=payload.timing.wall_time_ms,
                interruption_or_timeout_reason=(
                    payload.timing.interruption_or_timeout_reason
                ),
                valid_for_timing_analysis=payload.timing.valid_for_timing_analysis,
                independent_first_attempt=(
                    payload.attempt_number == 1 and not prior_hints
                ),
                presentation_language=payload.presentation_language,
                read_aloud=payload.read_aloud,
                input_mode=payload.input_mode.value,
                optional_strategy_or_error_classification=(
                    payload.optional_strategy_or_error_classification
                ),
                policy_version=payload.policy_version,
                model_version=payload.model_version,
                annotation_version=payload.annotation_version,
                calibration_version=payload.calibration_version,
                attempt_schema_version=payload.attempt_schema_version,
            )
            accumulator.attempts.append(observation)
            if observation.independent_first_attempt:
                accumulator.independent_first_attempt_count += 1
            else:
                accumulator.assisted_or_retry_attempt_count += 1
            if observation.correctness_or_partial_score == 1:
                accumulator.full_credit_observation_count += 1
            else:
                accumulator.non_full_credit_observation_count += 1
            if observation.valid_for_timing_analysis:
                accumulator.valid_timing_observation_count += 1
            if observation.interruption_or_timeout_reason is not None:
                accumulator.interrupted_timing_observation_count += 1
            accumulator.total_active_time_ms += observation.active_time_ms
            accumulator.total_idle_time_ms += observation.idle_time_ms
            accumulator.total_wall_time_ms += observation.wall_time_ms
            return

        if isinstance(event, FeedbackShownEvent):
            self._require_active_session(accumulator, event)
            payload = event.payload
            self._matching_presentation(
                accumulator, event, payload.presentation_id, payload.item_id
            )
            prior_attempts = [
                attempt
                for attempt in accumulator.attempts
                if attempt.presentation_id == payload.presentation_id
            ]
            if not prior_attempts:
                raise ProjectionReferenceError("feedback requires a submitted answer")
            if (
                prior_attempts[-1].correctness_or_partial_score
                != payload.correctness_or_partial_score
            ):
                raise ProjectionReferenceError(
                    "feedback score differs from the latest submitted answer"
                )
            accumulator.feedback.append(
                FeedbackEvidence(
                    event_id=event.event_id,
                    sequence=event.sequence,
                    timestamp=event.timestamp,
                    session_id=event.session_id,
                    presentation_id=payload.presentation_id,
                    item_id=payload.item_id,
                    correctness_or_partial_score=payload.correctness_or_partial_score,
                    feedback_kind=payload.feedback_kind,
                )
            )
            return

        if isinstance(event, ItemCorrectedEvent):
            self._require_active_session(accumulator, event)
            payload = event.payload
            self._matching_presentation(
                accumulator, event, payload.presentation_id, payload.item_id
            )
            prior_attempts = [
                attempt
                for attempt in accumulator.attempts
                if attempt.presentation_id == payload.presentation_id
            ]
            if not prior_attempts:
                raise ProjectionReferenceError(
                    "item correction requires a submitted answer"
                )
            latest = prior_attempts[-1]
            if (
                latest.final_answer != payload.final_answer
                or latest.correctness_or_partial_score
                != payload.correctness_or_partial_score
            ):
                raise ProjectionReferenceError(
                    "item correction differs from the latest submitted answer"
                )
            accumulator.item_corrections.append(
                ItemCorrectionEvidence(
                    event_id=event.event_id,
                    sequence=event.sequence,
                    timestamp=event.timestamp,
                    session_id=event.session_id,
                    presentation_id=payload.presentation_id,
                    item_id=payload.item_id,
                    final_answer=payload.final_answer,
                    correctness_or_partial_score=payload.correctness_or_partial_score,
                )
            )
            return

        if isinstance(event, StateSnapshotCreatedEvent):
            self._require_session(accumulator, event)
            payload = event.payload
            current_state = accumulator.to_state()
            actual_hash = canonical_evidence_state_hash(current_state)
            if payload.state_hash != actual_hash:
                raise ProjectionReferenceError(
                    "snapshot hash does not match the projected prefix state"
                )
            accumulator.snapshot_events.append(
                SnapshotEvidence(
                    event_id=event.event_id,
                    sequence=event.sequence,
                    timestamp=event.timestamp,
                    through_sequence=payload.through_sequence,
                    state_hash=payload.state_hash,
                    projector_version=payload.projector_version,
                )
            )
            return

        if isinstance(event, ContentCorrectionRecordedEvent):
            self._require_session(accumulator, event)
            payload = event.payload
            known_head = accumulator.content_version_heads.get(payload.item_id)
            if known_head is None:
                raise ProjectionReferenceError(
                    "content correction requires a previously observed item version"
                )
            if payload.previous_content_version != known_head:
                raise ProjectionReferenceError(
                    "content correction previous version is not the known head"
                )
            if any(
                correction.correction_version == payload.correction_version
                for correction in accumulator.content_corrections
            ):
                raise ProjectionReferenceError(
                    "content correction versions must be globally unique"
                )
            lineage_versions = {known_head}
            lineage_versions.update(
                correction.previous_content_version
                for correction in accumulator.content_corrections
                if correction.item_id == payload.item_id
            )
            lineage_versions.update(
                correction.corrected_content_version
                for correction in accumulator.content_corrections
                if correction.item_id == payload.item_id
            )
            if payload.corrected_content_version in lineage_versions:
                raise ProjectionReferenceError(
                    "content correction cannot create a cycle"
                )
            accumulator.content_corrections.append(
                ContentCorrectionEvidence(
                    event_id=event.event_id,
                    sequence=event.sequence,
                    timestamp=event.timestamp,
                    item_id=payload.item_id,
                    previous_content_version=payload.previous_content_version,
                    corrected_content_version=payload.corrected_content_version,
                    correction_version=payload.correction_version,
                    reason=payload.reason,
                )
            )
            accumulator.content_version_heads[payload.item_id] = (
                payload.corrected_content_version
            )
            return

        raise ProjectionError(f"unsupported event type {event.event_type!s}")
