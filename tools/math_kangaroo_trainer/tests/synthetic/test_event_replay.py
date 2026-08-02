from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from math_kangaroo_trainer.domain.attempts import (
    AssistanceLevel,
    AttemptEvidence,
    AttemptTiming,
    Confidence,
    InputMode,
)
from math_kangaroo_trainer.domain.events import (
    AnswerSubmittedEvent,
    CandidateEligibilityEvidence,
    ContentCorrectionRecordedEvent,
    ContentCorrectionRecordedPayload,
    FeedbackShownEvent,
    FeedbackShownPayload,
    HintRequestedEvent,
    HintRequestedPayload,
    ItemCorrectedEvent,
    ItemCorrectedPayload,
    ItemPresentedEvent,
    ItemPresentedPayload,
    ItemSelectedEvent,
    ItemSelectedPayload,
    PredictedSuccessDistribution,
    ScoreComponent,
    SessionEndedEvent,
    SessionEndedPayload,
    SessionStartedEvent,
    SessionStartedPayload,
    StateSnapshotCreatedEvent,
    StateSnapshotCreatedPayload,
    parse_event,
)
from math_kangaroo_trainer.evaluation.replay import (
    canonical_state_hash,
    compare_full_replay_with_snapshot_tail,
    evaluate_synthetic_replay_cases,
    write_replay_quality_reports,
)
from math_kangaroo_trainer.storage.event_store import (
    EventIdentityConflictError,
    EventSequenceError,
    IdempotencyConflictError,
    InMemoryEventStore,
)
from math_kangaroo_trainer.storage.projectors import (
    EventProjector,
    PersistedSnapshot,
    ProjectionReferenceError,
    ProjectionSequenceError,
)
from math_kangaroo_trainer.versions import (
    ATTEMPT_SCHEMA_VERSION,
    EVIDENCE_STATE_SCHEMA_VERSION,
    EVENT_PROJECTOR_VERSION,
    EVENT_SCHEMA_VERSION,
    REPLAY_EVALUATION_VERSION,
)


LEARNER_ID = "invented-event-learner"
SESSION_ID = "invented-session-1"
PRESENTATION_ID = "invented-presentation-1"
ITEM_ID = "synthetic-parity-a"
FAMILY_ID = "family-parity-a"
CONTENT_V1 = "sha256:" + "1" * 64
CONTENT_V2 = "sha256:" + "2" * 64
CANDIDATE_HASH = "sha256:" + "a" * 64
BASE_TIME = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)


def envelope(sequence: int) -> dict[str, object]:
    return {
        "event_id": f"synthetic-event-{sequence}",
        "idempotency_key": f"synthetic-idempotency-{sequence}",
        "learner_id": LEARNER_ID,
        "session_id": SESSION_ID,
        "sequence": sequence,
        "timestamp": BASE_TIME + timedelta(seconds=sequence),
    }


def attempt(
    *,
    attempt_number: int,
    score: float,
    final_answer: str,
    assistance: AssistanceLevel = AssistanceLevel.NONE,
    hints: tuple[str, ...] = (),
    interruption: str | None = None,
) -> AttemptEvidence:
    return AttemptEvidence(
        presentation_id=PRESENTATION_ID,
        item_id=ITEM_ID,
        content_version=CONTENT_V1,
        family_id=FAMILY_ID,
        first_answer="B",
        final_answer=final_answer,
        correctness_or_partial_score=score,
        attempt_number=attempt_number,
        hint_types=hints,
        assistance_level=assistance,
        confidence=Confidence.MAYBE,
        timing=AttemptTiming(
            active_time_ms=4_000,
            idle_time_ms=1_000,
            wall_time_ms=7_000,
            interruption_or_timeout_reason=interruption,
        ),
        presentation_language="en",
        read_aloud=False,
        input_mode=InputMode.KEYBOARD,
        optional_strategy_or_error_classification="synthetic-observation",
        policy_version="diagnostic.synthetic.v1",
        model_version="no-competence-model.synthetic.v1",
        annotation_version="annotation.synthetic.v1",
        calibration_version="calibration.synthetic.v1",
    )


def reference_event_stream() -> tuple:
    prefix = (
        SessionStartedEvent(
            **envelope(1),
            payload=SessionStartedPayload(
                config_version="synthetic-config.v1",
                policy_version="diagnostic.synthetic.v1",
                random_seed=9182,
                presentation_language="en",
            ),
        ),
        ItemSelectedEvent(
            **envelope(2),
            payload=ItemSelectedPayload(
                presentation_id=PRESENTATION_ID,
                item_id=ITEM_ID,
                content_version=CONTENT_V1,
                family_id=FAMILY_ID,
                candidate_set_hash=CANDIDATE_HASH,
                eligibility_and_exclusion_reasons=(
                    CandidateEligibilityEvidence(
                        candidate_id=ITEM_ID,
                        eligible=True,
                        reasons=("synthetic_blueprint_fit", "unseen_family"),
                    ),
                    CandidateEligibilityEvidence(
                        candidate_id="synthetic-parity-repeat",
                        eligible=False,
                        reasons=("recent_family",),
                    ),
                ),
                score_components=(
                    ScoreComponent(name="coverage", value=0.7),
                    ScoreComponent(name="information", value=0.8),
                ),
                selected_purpose="broad_diagnostic",
                predicted_success_distribution=PredictedSuccessDistribution(
                    mean=0.64,
                    low=0.48,
                    high=0.78,
                ),
                random_seed=9182,
                approximate_selection_propensity=0.35,
                policy_version="diagnostic.synthetic.v1",
                model_version="no-competence-model.synthetic.v1",
                config_version="synthetic-config.v1",
            ),
        ),
        ItemPresentedEvent(
            **envelope(3),
            payload=ItemPresentedPayload(
                presentation_id=PRESENTATION_ID,
                item_id=ITEM_ID,
                content_version=CONTENT_V1,
                family_id=FAMILY_ID,
                presentation_language="en",
                read_aloud=False,
                input_mode=InputMode.KEYBOARD,
            ),
        ),
        AnswerSubmittedEvent(
            **envelope(4),
            payload=attempt(attempt_number=1, score=0, final_answer="B"),
        ),
        FeedbackShownEvent(
            **envelope(5),
            payload=FeedbackShownPayload(
                presentation_id=PRESENTATION_ID,
                item_id=ITEM_ID,
                correctness_or_partial_score=0,
                feedback_kind="incorrect_try_again",
            ),
        ),
    )
    prefix_state = EventProjector().rebuild(prefix)
    snapshot = StateSnapshotCreatedEvent(
        **envelope(6),
        payload=StateSnapshotCreatedPayload(
            through_sequence=5,
            state_hash=canonical_state_hash(prefix_state),
            projector_version=EVENT_PROJECTOR_VERSION,
        ),
    )
    return (
        *prefix,
        snapshot,
        HintRequestedEvent(
            **envelope(7),
            payload=HintRequestedPayload(
                presentation_id=PRESENTATION_ID,
                item_id=ITEM_ID,
                hint_type="small_strategy_cue",
                assistance_level=AssistanceLevel.SMALL_HINT,
            ),
        ),
        AnswerSubmittedEvent(
            **envelope(8),
            payload=attempt(
                attempt_number=2,
                score=1,
                final_answer="C",
                assistance=AssistanceLevel.SMALL_HINT,
                hints=("small_strategy_cue",),
                interruption="focus_lost",
            ),
        ),
        ItemCorrectedEvent(
            **envelope(9),
            payload=ItemCorrectedPayload(
                presentation_id=PRESENTATION_ID,
                item_id=ITEM_ID,
                final_answer="C",
                correctness_or_partial_score=1,
            ),
        ),
        FeedbackShownEvent(
            **envelope(10),
            payload=FeedbackShownPayload(
                presentation_id=PRESENTATION_ID,
                item_id=ITEM_ID,
                correctness_or_partial_score=1,
                feedback_kind="correct_after_retry",
            ),
        ),
        ContentCorrectionRecordedEvent(
            **envelope(11),
            payload=ContentCorrectionRecordedPayload(
                item_id=ITEM_ID,
                previous_content_version=CONTENT_V1,
                corrected_content_version=CONTENT_V2,
                correction_version="synthetic-content-correction.v1",
                reason="invented replay fixture correction",
            ),
        ),
        SessionEndedEvent(
            **envelope(12),
            payload=SessionEndedPayload(reason="synthetic_session_complete"),
        ),
    )


def nested_keys(value: object):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key
            yield from nested_keys(child)
    elif isinstance(value, list):
        for child in value:
            yield from nested_keys(child)


def test_ac10_event_replay_is_exact_and_snapshot_tail_equivalent() -> None:
    events = reference_event_stream()
    store = InMemoryEventStore()
    results = store.append_many(events)
    assert all(result.appended for result in results)
    stored = store.read_stream(LEARNER_ID)
    assert stored == events

    projector = EventProjector()
    first = projector.rebuild(stored)
    second = projector.rebuild(stored)
    comparison = compare_full_replay_with_snapshot_tail(
        stored,
        split_sequence=5,
        projector=projector,
    )

    assert first == second
    assert canonical_state_hash(first) == canonical_state_hash(second)
    assert comparison.equivalent is True
    assert comparison.full_state_hash == comparison.resumed_state_hash
    assert comparison.evaluation_version == REPLAY_EVALUATION_VERSION
    assert first.state_schema_version == EVIDENCE_STATE_SCHEMA_VERSION
    assert first.projector_version == EVENT_PROJECTOR_VERSION
    assert first.through_sequence == 12
    assert first.event_ids == tuple(event.event_id for event in events)
    assert first.item_exposure_counts[0].name == ITEM_ID
    assert first.item_exposure_counts[0].count == 1
    assert first.family_exposure_counts[0].name == FAMILY_ID
    assert first.independent_first_attempt_count == 1
    assert first.assisted_or_retry_attempt_count == 1
    assert first.full_credit_observation_count == 1
    assert first.non_full_credit_observation_count == 1
    assert first.valid_timing_observation_count == 1
    assert first.interrupted_timing_observation_count == 1
    assert first.total_active_time_ms == 8_000
    assert len(first.content_corrections) == 1

    selection = first.selections[0]
    assert selection.candidate_set_hash == CANDIDATE_HASH
    assert selection.selected_purpose == "broad_diagnostic"
    assert selection.random_seed == 9182
    assert selection.approximate_selection_propensity == 0.35
    assert selection.score_components == (("coverage", 0.7), ("information", 0.8))


def test_hinted_retry_is_recorded_but_not_classified_as_independent() -> None:
    state = EventProjector().rebuild(reference_event_stream())
    first, retry = state.attempts
    assert first.independent_first_attempt is True
    assert retry.independent_first_attempt is False
    assert retry.assistance_level is AssistanceLevel.SMALL_HINT
    assert retry.hint_types == ("small_strategy_cue",)
    assert retry.correctness_or_partial_score == 1
    assert not hasattr(state, "mastery")
    assert not hasattr(state, "competence")


def test_interrupted_timing_is_retained_but_not_marked_valid() -> None:
    state = EventProjector().rebuild(reference_event_stream())
    interrupted = state.attempts[1]
    assert interrupted.active_time_ms == 4_000
    assert interrupted.wall_time_ms == 7_000
    assert interrupted.interruption_or_timeout_reason == "focus_lost"
    assert interrupted.valid_for_timing_analysis is False

    with pytest.raises(ValidationError, match="cannot exceed wall time"):
        AttemptTiming(active_time_ms=10, idle_time_ms=5, wall_time_ms=14)


def test_idempotency_conflicts_and_sequence_gaps_are_rejected_atomically() -> None:
    events = reference_event_stream()
    store = InMemoryEventStore()
    first = store.append(events[0])
    duplicate = store.append(parse_event(events[0].model_dump(mode="json")))
    assert first.appended is True
    assert duplicate.appended is False

    conflicting_idempotency = events[0].model_copy(
        update={"event_id": "synthetic-conflicting-idempotency"}
    )
    with pytest.raises(IdempotencyConflictError):
        store.append(conflicting_idempotency)

    conflicting_event_id = events[0].model_copy(
        update={"idempotency_key": "synthetic-different-key", "sequence": 2}
    )
    with pytest.raises(EventIdentityConflictError):
        store.append(conflicting_event_id)

    with pytest.raises(EventSequenceError, match="expected learner sequence 2"):
        store.append(events[2])

    atomic = InMemoryEventStore()
    with pytest.raises(EventSequenceError):
        atomic.append_many((events[0], events[2]))
    assert atomic.read_stream(LEARNER_ID) == ()


def test_projector_uses_sequence_not_timestamp_order() -> None:
    events = reference_event_stream()
    later_clock = events[0].model_copy(
        update={"timestamp": events[1].timestamp + timedelta(hours=1)}
    )
    changed_prefix = (later_clock, *events[1:5])
    changed_prefix_state = EventProjector().rebuild(changed_prefix)
    snapshot = events[5]
    assert isinstance(snapshot, StateSnapshotCreatedEvent)
    changed_snapshot = snapshot.model_copy(
        update={
            "payload": snapshot.payload.model_copy(
                update={"state_hash": canonical_state_hash(changed_prefix_state)}
            )
        }
    )
    state = EventProjector().rebuild((*changed_prefix, changed_snapshot, *events[6:]))
    assert state.through_sequence == 12

    with pytest.raises(ProjectionSequenceError, match="expected event sequence 2"):
        EventProjector().rebuild((events[0], events[2], events[1]))


def test_snapshot_event_is_versioned_and_records_the_prefix_hash() -> None:
    prefix = reference_event_stream()[:5]
    prefix_state = EventProjector().rebuild(prefix)
    snapshot = StateSnapshotCreatedEvent(
        **envelope(6),
        payload=StateSnapshotCreatedPayload(
            through_sequence=5,
            state_hash=canonical_state_hash(prefix_state),
            projector_version=EVENT_PROJECTOR_VERSION,
        ),
    )
    state = EventProjector().rebuild((*prefix, snapshot))
    assert state.snapshot_events[0].state_hash == canonical_state_hash(prefix_state)

    tail = reference_event_stream()[6:]
    persisted = PersistedSnapshot(state=prefix_state, snapshot_event=snapshot)
    reloaded = PersistedSnapshot.model_validate_json(persisted.model_dump_json())
    resumed = EventProjector().resume_from_snapshot(tail, snapshot=reloaded)
    assert resumed == EventProjector().rebuild(reference_event_stream())

    with pytest.raises(ValidationError, match="projector version"):
        StateSnapshotCreatedPayload(
            through_sequence=5,
            state_hash=canonical_state_hash(prefix_state),
            projector_version="obsolete-projector",
        )

    wrong_hash = snapshot.model_copy(
        update={
            "payload": snapshot.payload.model_copy(
                update={"state_hash": "sha256:" + "f" * 64}
            )
        }
    )
    with pytest.raises(ProjectionReferenceError, match="snapshot hash"):
        EventProjector().rebuild((*prefix, wrong_hash))

    corrupted_state = prefix_state.model_copy(
        update={"total_active_time_ms": prefix_state.total_active_time_ms + 1}
    )
    with pytest.raises(ValidationError, match="snapshot hash"):
        PersistedSnapshot(state=corrupted_state, snapshot_event=snapshot)

    with pytest.raises(ProjectionSequenceError, match="at least one event"):
        EventProjector().resume_from_snapshot((), snapshot=persisted)


def test_event_attempt_versions_and_protected_fields_are_strict() -> None:
    event = reference_event_stream()[3]
    assert event.event_schema_version == EVENT_SCHEMA_VERSION
    assert event.payload.attempt_schema_version == ATTEMPT_SCHEMA_VERSION

    serialized = event.model_dump(mode="json")
    serialized["payload"]["official_answer"] = "C"
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        parse_event(serialized)

    with pytest.raises(ValidationError, match="unsupported event schema"):
        SessionStartedEvent(
            **envelope(1),
            event_schema_version="obsolete-event-schema",
            payload=SessionStartedPayload(
                config_version="synthetic-config.v1",
                policy_version="diagnostic.synthetic.v1",
                random_seed=1,
                presentation_language="en",
            ),
        )

    invalid_attempt = event.payload.model_dump(mode="python")
    invalid_attempt["attempt_schema_version"] = "obsolete-attempt-schema"
    with pytest.raises(ValidationError, match="unsupported attempt schema"):
        AttemptEvidence.model_validate(invalid_attempt)

    naive_envelope = envelope(1)
    naive_envelope["timestamp"] = datetime(2026, 8, 1, 12, 0)
    with pytest.raises(ValidationError):
        SessionStartedEvent(
            **naive_envelope,
            payload=SessionStartedPayload(
                config_version="synthetic-config.v1",
                policy_version="diagnostic.synthetic.v1",
                random_seed=1,
                presentation_language="en",
            ),
        )

    state = EventProjector().rebuild(reference_event_stream())
    forbidden = {
        "official_answer",
        "protected_answer",
        "solution",
        "mastery",
        "competence",
    }
    assert forbidden.isdisjoint(nested_keys(state.model_dump(mode="json")))


def test_stage2_replay_report_is_synthetic_and_privacy_safe(tmp_path) -> None:
    sensitive_label = f"{LEARNER_ID}-answer-C"
    report = evaluate_synthetic_replay_cases(
        {sensitive_label: (reference_event_stream(), 5)},
        fixture_provenance="invented-synthetic-fixtures.v1",
    )
    write_replay_quality_reports(report, tmp_path)

    machine = (tmp_path / "stage2-replay-quality-report.json").read_text(
        encoding="utf-8"
    )
    summary = (tmp_path / "stage2-replay-quality-summary.md").read_text(
        encoding="utf-8"
    )
    assert report["status"] == "SYNTHETIC_PASS"
    assert report["event_count"] == 12
    assert LEARNER_ID not in machine
    assert ITEM_ID not in machine
    assert sensitive_label not in machine
    assert report["cases"][0]["case_id"] == "synthetic-case-001"
    assert "not evidence that Stage 0" in summary

    with pytest.raises(ValueError, match="invented synthetic"):
        evaluate_synthetic_replay_cases(
            {"case": (reference_event_stream(), 5)},
            fixture_provenance="real-stream",
        )


def test_prior_hints_cannot_be_omitted_or_understate_assistance() -> None:
    events = list(reference_event_stream())
    retry = events[7]
    assert isinstance(retry, AnswerSubmittedEvent)
    omitted = retry.model_copy(
        update={
            "payload": retry.payload.model_copy(
                update={
                    "hint_types": (),
                    "assistance_level": AssistanceLevel.NONE,
                }
            )
        }
    )
    with pytest.raises(ProjectionReferenceError, match="exactly match"):
        EventProjector().rebuild(tuple((*events[:7], omitted, *events[8:])))

    understated = retry.model_copy(
        update={
            "payload": retry.payload.model_copy(
                update={"assistance_level": AssistanceLevel.REVEALED_STEP}
            )
        }
    )
    with pytest.raises(ProjectionReferenceError, match="assistance level"):
        EventProjector().rebuild(tuple((*events[:7], understated, *events[8:])))

    before_first = HintRequestedEvent(
        **envelope(4),
        payload=HintRequestedPayload(
            presentation_id=PRESENTATION_ID,
            item_id=ITEM_ID,
            hint_type="pre_answer_hint",
            assistance_level=AssistanceLevel.SMALL_HINT,
        ),
    )
    original_first = events[3]
    assert isinstance(original_first, AnswerSubmittedEvent)
    shifted_first = original_first.model_copy(
        update={
            "sequence": 5,
            "event_id": "shifted-first",
            "idempotency_key": "shifted-first",
        }
    )
    with pytest.raises(ProjectionReferenceError, match="exactly match"):
        EventProjector().rebuild(tuple((*events[:3], before_first, shifted_first)))


def test_content_corrections_form_one_version_chain() -> None:
    events = reference_event_stream()
    prefix = events[:11]
    correction = events[10]
    assert isinstance(correction, ContentCorrectionRecordedEvent)
    fork = ContentCorrectionRecordedEvent(
        **envelope(12),
        payload=ContentCorrectionRecordedPayload(
            item_id=ITEM_ID,
            previous_content_version=CONTENT_V1,
            corrected_content_version="sha256:" + "3" * 64,
            correction_version="synthetic-content-correction.v2",
            reason="invented fork",
        ),
    )
    with pytest.raises(ProjectionReferenceError, match="known head"):
        EventProjector().rebuild((*prefix, fork))

    cycle = fork.model_copy(
        update={
            "payload": fork.payload.model_copy(
                update={
                    "previous_content_version": CONTENT_V2,
                    "corrected_content_version": CONTENT_V1,
                }
            )
        }
    )
    with pytest.raises(ProjectionReferenceError, match="cycle"):
        EventProjector().rebuild((*prefix, cycle))

    reused_version = fork.model_copy(
        update={
            "payload": fork.payload.model_copy(
                update={
                    "previous_content_version": CONTENT_V2,
                    "correction_version": correction.payload.correction_version,
                }
            )
        }
    )
    with pytest.raises(ProjectionReferenceError, match="globally unique"):
        EventProjector().rebuild((*prefix, reused_version))


def test_non_finite_score_components_and_empty_tail_are_rejected() -> None:
    with pytest.raises(ValidationError):
        ScoreComponent(name="bad", value=float("nan"))
    with pytest.raises(ValidationError):
        ScoreComponent(name="bad", value=float("inf"))

    with pytest.raises(ValueError, match="nonempty tail"):
        compare_full_replay_with_snapshot_tail(
            reference_event_stream()[:6], split_sequence=5
        )
