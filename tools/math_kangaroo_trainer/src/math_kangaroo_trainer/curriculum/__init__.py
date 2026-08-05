"""Explainable, non-authoritative curriculum-policy experiments."""

from .recommendations import (
    POLICY_VERSION,
    CandidateEvidence,
    RecommendationContext,
    RecommendationMode,
    RecommendationPreview,
    preview_recommendations,
)

__all__ = [
    "POLICY_VERSION",
    "CandidateEvidence",
    "RecommendationContext",
    "RecommendationMode",
    "RecommendationPreview",
    "preview_recommendations",
]
