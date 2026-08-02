"""Canonical hashing and synthetic replay comparisons for factual state."""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from math_kangaroo_trainer.domain.events import (
    EvidenceEvent,
    StateSnapshotCreatedEvent,
)
from math_kangaroo_trainer.domain.learner import (
    LearnerEvidenceState,
    canonical_evidence_state_hash,
    canonical_evidence_state_json,
)
from math_kangaroo_trainer.storage.projectors import EventProjector, PersistedSnapshot
from math_kangaroo_trainer.versions import REPLAY_EVALUATION_VERSION


class ReplayComparison(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    split_sequence: int = Field(ge=1)
    full_state_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    resumed_state_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    equivalent: bool
    evaluation_version: str = REPLAY_EVALUATION_VERSION


def canonical_state_json(state: LearnerEvidenceState) -> str:
    return canonical_evidence_state_json(state)


def canonical_state_hash(state: LearnerEvidenceState) -> str:
    return canonical_evidence_state_hash(state)


def compare_full_replay_with_snapshot_tail(
    events: tuple[EvidenceEvent, ...],
    *,
    split_sequence: int,
    projector: EventProjector | None = None,
) -> ReplayComparison:
    if not events:
        raise ValueError("replay comparison requires at least one event")
    if split_sequence < 1 or split_sequence >= events[-1].sequence - 1:
        raise ValueError(
            "split sequence must leave a snapshot event and a nonempty tail"
        )

    active_projector = projector or EventProjector()
    prefix = tuple(event for event in events if event.sequence <= split_sequence)
    snapshot_events = tuple(
        event for event in events if event.sequence == split_sequence + 1
    )
    tail = tuple(event for event in events if event.sequence > split_sequence + 1)
    if not prefix or prefix[-1].sequence != split_sequence:
        raise ValueError("split sequence must identify an event boundary")
    if len(snapshot_events) != 1 or not isinstance(
        snapshot_events[0], StateSnapshotCreatedEvent
    ):
        raise ValueError("split must be followed by a persisted snapshot event")
    if not tail:
        raise ValueError("snapshot comparison requires a nonempty tail")

    full_state = active_projector.rebuild(events)
    prefix_state = active_projector.rebuild(prefix)
    persisted = PersistedSnapshot(
        state=prefix_state,
        snapshot_event=snapshot_events[0],
    )
    reloaded = PersistedSnapshot.model_validate_json(persisted.model_dump_json())
    resumed_state = active_projector.resume_from_snapshot(tail, snapshot=reloaded)
    full_hash = canonical_state_hash(full_state)
    resumed_hash = canonical_state_hash(resumed_state)
    return ReplayComparison(
        split_sequence=split_sequence,
        full_state_hash=full_hash,
        resumed_state_hash=resumed_hash,
        equivalent=full_state == resumed_state and full_hash == resumed_hash,
    )


def evaluate_synthetic_replay_cases(
    cases: Mapping[str, tuple[tuple[EvidenceEvent, ...], int]],
    *,
    fixture_provenance: str,
    projector: EventProjector | None = None,
) -> dict[str, Any]:
    """Produce a privacy-safe Stage 2 contract report from invented streams."""

    if not cases:
        raise ValueError("replay evaluation requires at least one synthetic case")
    if fixture_provenance != "invented-synthetic-fixtures.v1":
        raise ValueError("replay evaluation accepts invented synthetic fixtures only")
    active_projector = projector or EventProjector()
    results: list[dict[str, Any]] = []
    total_events = 0
    for case_number, source_case_id in enumerate(sorted(cases), start=1):
        if not source_case_id.strip():
            raise ValueError("replay case IDs cannot be blank")
        events, split_sequence = cases[source_case_id]
        comparison = compare_full_replay_with_snapshot_tail(
            events,
            split_sequence=split_sequence,
            projector=active_projector,
        )
        total_events += len(events)
        results.append(
            {
                "case_id": f"synthetic-case-{case_number:03d}",
                "event_count": len(events),
                **comparison.model_dump(mode="json"),
            }
        )
    failed = [result["case_id"] for result in results if not result["equivalent"]]
    return {
        "schema_version": "synthetic-event-replay-quality-report.v1",
        "evaluation_version": REPLAY_EVALUATION_VERSION,
        "execution_scope": "synthetic",
        "status": "SYNTHETIC_PASS" if not failed else "SYNTHETIC_FAIL",
        "reason": (
            "Every invented event stream rebuilt to the same canonical state."
            if not failed
            else "One or more invented event streams did not replay equivalently."
        ),
        "case_count": len(results),
        "event_count": total_events,
        "failed_case_ids": failed,
        "cases": results,
        "report_field_policy": {
            "case_labels": "generated_opaque_labels",
            "event_payloads_included": False,
            "fixture_provenance": fixture_provenance,
        },
    }


def render_replay_quality_markdown(report: Mapping[str, Any]) -> str:
    case_rows = "\n".join(
        "| {case_id} | {event_count} | {split_sequence} | {equivalent} |".format(
            case_id=result["case_id"],
            event_count=result["event_count"],
            split_sequence=result["split_sequence"],
            equivalent="Yes" if result["equivalent"] else "No",
        )
        for result in report["cases"]
    )
    return f"""# Math Kangaroo synthetic event/replay quality summary

**Contract status: `{report['status']}`**

{report['reason']}

| Case | Events | Snapshot split | Equivalent replay |
| --- | ---: | ---: | --- |
{case_rows}

This is a synthetic Stage 2 engineering contract, not evidence that Stage 0 or
the real-corpus diagnostic MVP has passed. Reports use generated case labels
and omit event payloads; the evaluator accepts only explicitly declared,
invented synthetic fixtures.
"""


def write_replay_quality_reports(report: Mapping[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "stage2-replay-quality-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_dir / "stage2-replay-quality-summary.md").write_text(
        render_replay_quality_markdown(report),
        encoding="utf-8",
    )
