"""Deterministic, coverage-first sampling for the Stage 0 gold set."""

from __future__ import annotations

import hashlib
from collections import Counter
from collections.abc import Callable, Iterable

from math_kangaroo_trainer.domain.items import ImportedItem


MIN_SAMPLE_SIZE = 100
MAX_SAMPLE_SIZE = 200


Dimension = tuple[str, Callable[[ImportedItem], str]]


DIMENSIONS: tuple[Dimension, ...] = (
    ("source_family", lambda item: item.source.source_family),
    ("year_band", lambda item: item.year_band),
    ("grade_band", lambda item: item.source.grade_band),
    (
        "point_tier",
        lambda item: str(item.learner.published_point_value_or_tier or "unknown"),
    ),
    ("modality", lambda item: item.modality),
    ("answer_status", lambda item: item.protected.answer_status),
    ("choice_count", lambda item: item.choice_count_bucket),
    ("language", lambda item: item.source.language),
    ("extraction_status", lambda item: item.source.extraction_status),
)


def stratum_tokens(item: ImportedItem) -> tuple[str, ...]:
    return tuple(f"{name}={accessor(item)}" for name, accessor in DIMENSIONS)


def _rank(item_id: str, seed: int) -> str:
    return hashlib.sha256(f"{seed}:{item_id}".encode()).hexdigest()


def _mandatory(item: ImportedItem) -> bool:
    return item.protected.answer_status in {"official-void", "official-multiple"}


def select_stratified_sample(
    items: Iterable[ImportedItem],
    *,
    sample_size: int,
    seed: int,
    mandatory_item_ids: Iterable[str] = (),
) -> tuple[ImportedItem, ...]:
    """Select a stable 100–200 item sample with marginal coverage.

    Official void and multiple-answer records are mandatory boundary cases.
    A greedy set-cover pass then represents every observed marginal category.
    The remaining slots minimize proportional deficits across all dimensions.
    Hash ranking makes every tie reproducible without depending on input order.
    """

    if not MIN_SAMPLE_SIZE <= sample_size <= MAX_SAMPLE_SIZE:
        raise ValueError(
            f"sample_size must be between {MIN_SAMPLE_SIZE} and {MAX_SAMPLE_SIZE}"
        )
    population = sorted(items, key=lambda item: (_rank(item.source.item_id, seed), item.source.item_id))
    if sample_size > len(population):
        raise ValueError("sample_size cannot exceed population")
    if len({item.source.item_id for item in population}) != len(population):
        raise ValueError("population contains duplicate item IDs")
    requested_mandatory = set(mandatory_item_ids)
    unknown_mandatory = requested_mandatory - {
        item.source.item_id for item in population
    }
    if unknown_mandatory:
        raise ValueError(
            "mandatory item IDs are not in the population: "
            + ", ".join(sorted(unknown_mandatory))
        )

    tokens_by_id = {item.source.item_id: stratum_tokens(item) for item in population}
    universe = {token for tokens in tokens_by_id.values() for token in tokens}
    population_counts = Counter(
        token for tokens in tokens_by_id.values() for token in tokens
    )
    targets = {
        token: max(1, round(sample_size * count / len(population)))
        for token, count in population_counts.items()
    }

    selected: list[ImportedItem] = []
    selected_ids: set[str] = set()
    selected_counts: Counter[str] = Counter()

    def add(item: ImportedItem) -> None:
        if item.source.item_id in selected_ids:
            return
        selected.append(item)
        selected_ids.add(item.source.item_id)
        selected_counts.update(tokens_by_id[item.source.item_id])

    for item in population:
        if _mandatory(item) or item.source.item_id in requested_mandatory:
            add(item)
    if len(selected) > sample_size:
        raise ValueError("mandatory boundary cases exceed requested sample size")

    uncovered = universe - set(selected_counts)
    while uncovered and len(selected) < sample_size:
        candidates = [item for item in population if item.source.item_id not in selected_ids]
        best = max(
            candidates,
            key=lambda item: (
                len(uncovered.intersection(tokens_by_id[item.source.item_id])),
                -int(_rank(item.source.item_id, seed), 16),
            ),
        )
        add(best)
        uncovered -= set(tokens_by_id[best.source.item_id])

    if uncovered:
        missing = ", ".join(sorted(uncovered))
        raise ValueError(f"sample too small to cover observed strata: {missing}")

    while len(selected) < sample_size:
        candidates = [item for item in population if item.source.item_id not in selected_ids]

        def deficit_score(item: ImportedItem) -> tuple[float, int]:
            score = sum(
                max(targets[token] - selected_counts[token], 0) / targets[token]
                for token in tokens_by_id[item.source.item_id]
            )
            return score, -int(_rank(item.source.item_id, seed), 16)

        add(max(candidates, key=deficit_score))

    return tuple(sorted(selected, key=lambda item: item.source.item_id))


def coverage_summary(
    population: Iterable[ImportedItem], sample: Iterable[ImportedItem]
) -> dict[str, dict[str, dict[str, int]]]:
    population_items = tuple(population)
    sample_items = tuple(sample)
    summary: dict[str, dict[str, dict[str, int]]] = {}
    for name, accessor in DIMENSIONS:
        population_counts = Counter(accessor(item) for item in population_items)
        sample_counts = Counter(accessor(item) for item in sample_items)
        summary[name] = {
            value: {
                "population": count,
                "sample": sample_counts[value],
            }
            for value, count in sorted(population_counts.items())
        }
    return summary
