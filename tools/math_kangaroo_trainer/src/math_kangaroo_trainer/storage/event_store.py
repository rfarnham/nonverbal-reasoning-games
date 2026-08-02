"""Deterministic in-memory evidence store for synthetic replay tests only."""

from __future__ import annotations

import json
from dataclasses import dataclass
from threading import RLock
from typing import Protocol, runtime_checkable

from math_kangaroo_trainer.domain.events import EvidenceEvent


class EventStoreError(ValueError):
    """Base class for deterministic event-store contract violations."""


class IdempotencyConflictError(EventStoreError):
    pass


class EventIdentityConflictError(EventStoreError):
    pass


class EventSequenceError(EventStoreError):
    pass


@dataclass(frozen=True, slots=True)
class AppendResult:
    event: EvidenceEvent
    appended: bool


def canonical_event_json(event: EvidenceEvent) -> str:
    return json.dumps(
        event.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


@runtime_checkable
class EventStore(Protocol):
    def append(self, event: EvidenceEvent) -> AppendResult: ...

    def append_many(
        self, events: tuple[EvidenceEvent, ...]
    ) -> tuple[AppendResult, ...]: ...

    def read_stream(
        self,
        learner_id: str,
        *,
        after_sequence: int = 0,
        session_id: str | None = None,
    ) -> tuple[EvidenceEvent, ...]: ...


class InMemoryEventStore:
    """Append-only reference store; it never persists learner or child data."""

    def __init__(self) -> None:
        self._events_by_learner: dict[str, list[EvidenceEvent]] = {}
        self._idempotency: dict[tuple[str, str], tuple[str, EvidenceEvent]] = {}
        self._event_ids: dict[str, tuple[str, EvidenceEvent]] = {}
        self._lock = RLock()

    def _append_unlocked(self, event: EvidenceEvent) -> AppendResult:
        canonical = canonical_event_json(event)
        idempotency_identity = (event.learner_id, event.idempotency_key)
        existing_idempotency = self._idempotency.get(idempotency_identity)
        if existing_idempotency is not None:
            existing_payload, existing_event = existing_idempotency
            if existing_payload != canonical:
                raise IdempotencyConflictError(
                    "an idempotency key cannot identify two different event payloads"
                )
            return AppendResult(event=existing_event, appended=False)

        existing_event_id = self._event_ids.get(event.event_id)
        if existing_event_id is not None:
            existing_payload, existing_event = existing_event_id
            if existing_payload != canonical:
                raise EventIdentityConflictError(
                    "an event ID cannot identify two different event payloads"
                )
            return AppendResult(event=existing_event, appended=False)

        stream = self._events_by_learner.setdefault(event.learner_id, [])
        expected_sequence = len(stream) + 1
        if event.sequence != expected_sequence:
            raise EventSequenceError(
                f"expected learner sequence {expected_sequence}, got {event.sequence}"
            )

        stream.append(event)
        self._idempotency[idempotency_identity] = (canonical, event)
        self._event_ids[event.event_id] = (canonical, event)
        return AppendResult(event=event, appended=True)

    def append(self, event: EvidenceEvent) -> AppendResult:
        with self._lock:
            return self._append_unlocked(event)

    def append_many(
        self, events: tuple[EvidenceEvent, ...]
    ) -> tuple[AppendResult, ...]:
        """Append atomically: any conflict leaves the store completely unchanged."""

        with self._lock:
            events_snapshot = {
                learner_id: list(stream)
                for learner_id, stream in self._events_by_learner.items()
            }
            idempotency_snapshot = dict(self._idempotency)
            event_ids_snapshot = dict(self._event_ids)
            results: list[AppendResult] = []
            try:
                for event in events:
                    results.append(self._append_unlocked(event))
            except Exception:
                self._events_by_learner = events_snapshot
                self._idempotency = idempotency_snapshot
                self._event_ids = event_ids_snapshot
                raise
            return tuple(results)

    def read_stream(
        self,
        learner_id: str,
        *,
        after_sequence: int = 0,
        session_id: str | None = None,
    ) -> tuple[EvidenceEvent, ...]:
        if after_sequence < 0:
            raise ValueError("after_sequence cannot be negative")
        with self._lock:
            stream = tuple(self._events_by_learner.get(learner_id, ()))
        return tuple(
            event
            for event in stream
            if event.sequence > after_sequence
            and (session_id is None or event.session_id == session_id)
        )
