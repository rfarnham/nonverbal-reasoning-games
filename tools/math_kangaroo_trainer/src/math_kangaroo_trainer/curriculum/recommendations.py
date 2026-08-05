"""Auditable recommendation-policy preview for curriculum QA.

This module deliberately stops short of a learner model.  It lets a curriculum
reviewer inspect how provisional item evidence would affect eligibility,
ranking, and slate constraints.  Proposed Q-matrix labels may be explored, but
they are called out in every result and can never be mistaken for mastery.
"""

from __future__ import annotations

import math
import random
from enum import StrEnum
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


POLICY_VERSION: Final = "curriculum-preview.v1"
POLICY_CONFIG_VERSION: Final = "curriculum-preview-weights.v1"


class _StrictFrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class RecommendationMode(StrEnum):
    PRACTICE = "practice"
    DIAGNOSTIC = "diagnostic"
    REMEDIATION = "remediation"
    TRANSFER = "transfer"


class CandidateEvidence(_StrictFrozenModel):
    """Small, content-free input shape used by the policy preview."""

    item_id: str = Field(min_length=1)
    content_version: str = Field(min_length=1)
    grade_band: str = Field(min_length=1)
    published_point_tier: int | None = Field(default=None, ge=3, le=5)
    skill_ids: tuple[str, ...] = ()
    representation_ids: tuple[str, ...] = ()
    family_id: str | None = Field(default=None, min_length=1)
    exact_duplicate_group_ids: tuple[str, ...] = ()
    question_type: str = "unknown"
    parser_ready: bool
    answer_ready: bool
    playable_choices_ready: bool
    required_asset_ready: bool = True
    classification_source: Literal["proposal", "teacher"] = "proposal"
    curriculum_approved: bool = False
    teacher_disposition: Literal[
        "unreviewed", "faithful", "needs_review", "rejected", "stale"
    ] = "unreviewed"
    source_warning_count: int = Field(default=0, ge=0)
    recent_semantic_similarity: float = Field(default=0, ge=-1, le=1)
    target_surface_similarity: float | None = Field(default=None, ge=-1, le=1)
    same_family_as_recent: bool = False
    same_exact_duplicate_group_as_recent: bool = False

    @field_validator("skill_ids", "representation_ids", "exact_duplicate_group_ids")
    @classmethod
    def canonical_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if any(not item.strip() for item in value):
            raise ValueError("controlled IDs cannot be blank")
        if tuple(sorted(set(value))) != value:
            raise ValueError("controlled IDs must be sorted and unique")
        return value

    @field_validator("family_id")
    @classmethod
    def canonical_optional_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("group IDs cannot be blank")
        return stripped

    @model_validator(mode="after")
    def coherent_review_evidence(self) -> "CandidateEvidence":
        if self.curriculum_approved and self.classification_source != "teacher":
            raise ValueError(
                "curriculum approval requires teacher classification provenance"
            )
        if self.curriculum_approved and self.teacher_disposition != "faithful":
            raise ValueError(
                "curriculum approval requires a faithful teacher disposition"
            )
        return self


class RecommendationContext(_StrictFrozenModel):
    target_skill_id: str = Field(min_length=1)
    target_item_id: str | None = Field(default=None, min_length=1)
    grade_band: str = Field(min_length=1)
    mastery: float = Field(ge=0, le=1)
    uncertainty: float = Field(ge=0, le=1)
    mode: RecommendationMode = RecommendationMode.PRACTICE
    recent_item_ids: tuple[str, ...] = ()
    slate_size: int = Field(default=8, ge=1, le=24)
    seed: int = 0
    evidence_mode: Literal["proposals", "reviewed_only"] = "proposals"


class ScoreComponent(_StrictFrozenModel):
    value: float
    weight: float
    contribution: float


class RankedCandidate(_StrictFrozenModel):
    item_id: str
    rank: int
    score: float
    predicted_success: float
    components: dict[str, ScoreComponent]
    reasons: tuple[str, ...]
    classification_source: Literal["proposal", "teacher"]
    curriculum_approved: bool
    evidence_status: Literal[
        "proposal", "teacher_classification", "curriculum_approved"
    ]


class ExcludedCandidate(_StrictFrozenModel):
    item_id: str
    reasons: tuple[str, ...]


class RecommendationPreview(_StrictFrozenModel):
    policy_version: Literal["curriculum-preview.v1"] = POLICY_VERSION
    config_version: Literal["curriculum-preview-weights.v1"] = POLICY_CONFIG_VERSION
    authoritative: Literal[False] = False
    learner_model_used: Literal[False] = False
    purpose: RecommendationMode
    target_skill_id: str
    warnings: tuple[str, ...]
    slate: tuple[RankedCandidate, ...]
    excluded: tuple[ExcludedCandidate, ...]
    content_gap: bool
    content_gap_reason: str | None = None


_TARGET_SUCCESS = {
    RecommendationMode.PRACTICE: 0.78,
    RecommendationMode.DIAGNOSTIC: 0.60,
    RecommendationMode.REMEDIATION: 0.86,
    RecommendationMode.TRANSFER: 0.72,
}

_TARGET_SURFACE_SIMILARITY = {
    RecommendationMode.PRACTICE: 0.55,
    RecommendationMode.DIAGNOSTIC: 0.40,
    RecommendationMode.REMEDIATION: 0.82,
    RecommendationMode.TRANSFER: 0.25,
}

_WEIGHTS = {
    "learnability": 0.28,
    "target_skill": 0.28,
    "information": 0.12,
    "transfer_fit": 0.10,
    "novelty": 0.10,
    "exploration": 0.04,
    "family_penalty": -0.45,
    "redundancy_penalty": -0.16,
    "load_penalty": -0.10,
}


def _round(value: float) -> float:
    return round(float(value), 6)


def _difficulty(candidate: CandidateEvidence) -> float:
    # A broad metadata prior for QA only; it is not calibrated item difficulty.
    metadata_prior: dict[int | None, float] = {3: 0.28, 4: 0.52, 5: 0.76}
    return metadata_prior.get(candidate.published_point_tier, 0.52)


def _predicted_success(candidate: CandidateEvidence, mastery: float) -> float:
    logit = 3.2 * (mastery - _difficulty(candidate) + 0.18)
    return 1.0 / (1.0 + math.exp(-logit))


def _gaussian_fit(value: float, target: float, spread: float) -> float:
    return math.exp(-((value - target) ** 2) / (2 * spread**2))


def _eligibility(
    candidate: CandidateEvidence, context: RecommendationContext
) -> tuple[str, ...]:
    reasons: list[str] = []
    if candidate.grade_band != context.grade_band:
        reasons.append("GRADE_BAND_MISMATCH")
    if context.target_skill_id not in candidate.skill_ids:
        reasons.append("TARGET_SKILL_NOT_MAPPED")
    if not candidate.parser_ready:
        reasons.append("SOURCE_REVIEW_REQUIRED")
    if not candidate.answer_ready:
        reasons.append("AUTHORITATIVE_SINGLE_ANSWER_REQUIRED")
    if not candidate.playable_choices_ready:
        reasons.append("PLAYABLE_CHOICES_REQUIRED")
    if not candidate.required_asset_ready:
        reasons.append("REQUIRED_ASSET_INCOMPLETE")
    if candidate.teacher_disposition == "needs_review":
        reasons.append("TEACHER_REVIEW_NEEDS_CORRECTION")
    elif candidate.teacher_disposition == "rejected":
        reasons.append("TEACHER_REVIEW_EXCLUDED")
    elif candidate.teacher_disposition == "stale":
        reasons.append("TEACHER_REVIEW_STALE")
    if candidate.item_id in set(context.recent_item_ids):
        reasons.append("RECENT_ITEM_REPEAT")
    if (
        context.target_item_id is not None
        and candidate.item_id == context.target_item_id
    ):
        reasons.append("TARGET_ITEM_REPEAT")
    if candidate.same_family_as_recent:
        reasons.append("RECENT_FAMILY_REPEAT")
    if candidate.same_exact_duplicate_group_as_recent:
        reasons.append("RECENT_EXACT_DUPLICATE_GROUP")
    if context.evidence_mode == "reviewed_only" and not candidate.curriculum_approved:
        reasons.append("CURRICULUM_APPROVAL_REQUIRED")
    return tuple(reasons)


def _component(value: float, name: str) -> ScoreComponent:
    value = _round(value)
    weight = _WEIGHTS[name]
    return ScoreComponent(
        value=value,
        weight=weight,
        contribution=_round(value * weight),
    )


def preview_recommendations(
    context: RecommendationContext,
    candidates: tuple[CandidateEvidence, ...] | list[CandidateEvidence],
) -> RecommendationPreview:
    """Rank an explainable constrained slate from content-free evidence.

    The function is deterministic for a fixed seed and inputs. It never writes
    learner state and never interprets semantic distance as competence.
    """

    eligible: list[
        tuple[CandidateEvidence, dict[str, ScoreComponent], float, float]
    ] = []
    excluded: list[ExcludedCandidate] = []
    target_success = _TARGET_SUCCESS[context.mode]
    target_surface = _TARGET_SURFACE_SIMILARITY[context.mode]
    rng = random.Random(context.seed)

    for candidate in sorted(candidates, key=lambda value: value.item_id):
        blockers = _eligibility(candidate, context)
        if blockers:
            excluded.append(
                ExcludedCandidate(item_id=candidate.item_id, reasons=blockers)
            )
            continue

        predicted = _predicted_success(candidate, context.mastery)
        surface = (
            candidate.target_surface_similarity
            if candidate.target_surface_similarity is not None
            else 0.5
        )
        components = {
            "learnability": _component(
                _gaussian_fit(predicted, target_success, 0.16), "learnability"
            ),
            "target_skill": _component(1.0, "target_skill"),
            "information": _component(
                4 * predicted * (1 - predicted) * context.uncertainty,
                "information",
            ),
            "transfer_fit": _component(
                _gaussian_fit(surface, target_surface, 0.22), "transfer_fit"
            ),
            "novelty": _component(
                1 - max(0.0, candidate.recent_semantic_similarity), "novelty"
            ),
            "exploration": _component(rng.random(), "exploration"),
            "family_penalty": _component(
                1.0 if candidate.same_family_as_recent else 0.0,
                "family_penalty",
            ),
            "redundancy_penalty": _component(
                max(0.0, candidate.recent_semantic_similarity),
                "redundancy_penalty",
            ),
            "load_penalty": _component(
                min(1.0, candidate.source_warning_count / 4), "load_penalty"
            ),
        }
        score = _round(sum(component.contribution for component in components.values()))
        eligible.append((candidate, components, score, predicted))

    eligible.sort(key=lambda value: (-value[2], value[0].item_id))

    # Small, inspectable hard diversity constraints: a slate cannot repeat a
    # known source family or exact-duplicate group, and it cannot contain more
    # than two consecutive questions with the same primary representation or
    # type. Never backfill with a violating candidate: a short slate is more
    # honest than silently weakening a declared hard constraint.
    selected: list[
        tuple[CandidateEvidence, dict[str, ScoreComponent], float, float]
    ] = []
    selected_family_ids: set[str] = set()
    selected_duplicate_group_ids: set[str] = set()
    remaining = list(eligible)
    while remaining and len(selected) < context.slate_size:
        next_index: int | None = None
        for index, ranked_entry in enumerate(remaining):
            value = ranked_entry[0]
            repeats_family = (
                value.family_id is not None and value.family_id in selected_family_ids
            )
            repeats_exact_duplicate = bool(
                set(value.exact_duplicate_group_ids).intersection(
                    selected_duplicate_group_ids
                )
            )
            recent = selected[-2:]
            primary_rep = (
                value.representation_ids[0] if value.representation_ids else "unknown"
            )
            repeats_rep = len(recent) == 2 and all(
                (
                    entry[0].representation_ids[0]
                    if entry[0].representation_ids
                    else "unknown"
                )
                == primary_rep
                for entry in recent
            )
            repeats_type = len(recent) == 2 and all(
                entry[0].question_type == value.question_type for entry in recent
            )
            if (
                not repeats_family
                and not repeats_exact_duplicate
                and not repeats_rep
                and not repeats_type
            ):
                next_index = index
                break
        if next_index is None:
            break
        next_entry = remaining.pop(next_index)
        selected.append(next_entry)
        next_candidate = next_entry[0]
        if next_candidate.family_id is not None:
            selected_family_ids.add(next_candidate.family_id)
        selected_duplicate_group_ids.update(next_candidate.exact_duplicate_group_ids)

    diversity_shortfall = len(selected) < min(context.slate_size, len(eligible))
    slate = tuple(
        RankedCandidate(
            item_id=candidate.item_id,
            rank=index,
            score=score,
            predicted_success=_round(predicted),
            components=components,
            reasons=tuple(
                ["TARGET_SKILL_MATCH", f"MODE_{context.mode.value.upper()}"]
                + (
                    ["PROPOSED_CLASSIFICATION"]
                    if candidate.classification_source == "proposal"
                    else ["TEACHER_CLASSIFICATION"]
                )
                + (["CURRICULUM_APPROVED"] if candidate.curriculum_approved else [])
            ),
            classification_source=candidate.classification_source,
            curriculum_approved=candidate.curriculum_approved,
            evidence_status=(
                "curriculum_approved"
                if candidate.curriculum_approved
                else (
                    "teacher_classification"
                    if candidate.classification_source == "teacher"
                    else "proposal"
                )
            ),
        )
        for index, (candidate, components, score, predicted) in enumerate(
            selected, start=1
        )
    )

    content_gap = not slate
    warnings = (
        (
            "EXPERIMENTAL_POLICY_PREVIEW",
            "NO_LEARNER_MODEL_OR_MASTERY_UPDATE",
            "NO_CALIBRATED_ITEM_DIFFICULTY",
            "STRATEGY_EMBEDDING_UNAVAILABLE",
            "NO_REVIEWED_PREREQUISITE_GATES",
        )
        + (("PROPOSAL_ONLY_Q_MATRIX",) if context.evidence_mode == "proposals" else ())
        + (("SLATE_SHORT_DIVERSITY_CONSTRAINT",) if diversity_shortfall else ())
        + (("CONTENT_GAP",) if content_gap else ())
    )
    return RecommendationPreview(
        purpose=context.mode,
        target_skill_id=context.target_skill_id,
        warnings=warnings,
        slate=slate,
        excluded=tuple(excluded),
        content_gap=content_gap,
        content_gap_reason=(
            "No eligible item matches the requested evidence mode and hard eligibility gates."
            if content_gap
            else None
        ),
    )


__all__ = [
    "POLICY_CONFIG_VERSION",
    "POLICY_VERSION",
    "CandidateEvidence",
    "ExcludedCandidate",
    "RankedCandidate",
    "RecommendationContext",
    "RecommendationMode",
    "RecommendationPreview",
    "ScoreComponent",
    "preview_recommendations",
]
