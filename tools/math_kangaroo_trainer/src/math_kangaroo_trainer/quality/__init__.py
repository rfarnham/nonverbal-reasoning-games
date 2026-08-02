"""Machine- and human-readable quality evidence."""

from .annotation import (
    AnnotationCandidateProvenance,
    AnnotationEvaluationContext,
    AnnotationQualityCandidate,
    AnnotationQualityThresholds,
    DistractorQualityEvidence,
    GoldAnnotation,
    SolutionPathQualityEvidence,
    evaluate_annotation_quality,
    write_annotation_quality_reports,
)
from .reporting import build_quality_report, write_quality_reports

__all__ = [
    "AnnotationCandidateProvenance",
    "AnnotationQualityCandidate",
    "AnnotationEvaluationContext",
    "AnnotationQualityThresholds",
    "DistractorQualityEvidence",
    "GoldAnnotation",
    "SolutionPathQualityEvidence",
    "build_quality_report",
    "evaluate_annotation_quality",
    "write_annotation_quality_reports",
    "write_quality_reports",
]
