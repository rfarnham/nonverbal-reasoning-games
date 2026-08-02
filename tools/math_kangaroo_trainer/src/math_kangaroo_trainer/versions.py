"""Immutable identifiers for corpus transformations and synthetic contracts."""

CORPUS_ADAPTER_VERSION = "complete-question-bank.sqlite.v1"
ITEM_SCHEMA_VERSION = "corpus-item.v1"
SAMPLING_POLICY_VERSION = "stage0-stratified-greedy.v1"
AUDIT_POLICY_VERSION = "stage0-review-triggers.v1"
DUPLICATE_ALGORITHM_VERSION = "normalized-content-and-asset-sha256.v1"
REVIEW_SCHEMA_VERSION = "gold-review.v1"
DUPLICATE_REVIEW_SCHEMA_VERSION = "duplicate-review.v1"
REVIEW_CARRY_FORWARD_SCHEMA_VERSION = "review-carry-forward.v1"
QUALITY_REPORT_VERSION = "stage0-quality-report.v1"
POPULATION_FINDINGS_VERSION = "stage0-population-findings.v1"
ONTOLOGY_VERSION = "0.1.0-proposed.1"

# Synthetic-only evidence/replay contracts for future diagnostic stages. These
# versions do not imply that Stage 0 has passed or that learner persistence is
# approved for production use.
ATTEMPT_SCHEMA_VERSION = "attempt-evidence.v1"
EVENT_SCHEMA_VERSION = "learner-evidence-event.v1"
EVIDENCE_STATE_SCHEMA_VERSION = "learner-evidence-state.v1"
EVENT_PROJECTOR_VERSION = "learner-evidence-projector.v1"
REPLAY_EVALUATION_VERSION = "synthetic-replay-evaluation.v1"

# Stage 1 quality evidence is intentionally metric-only while the real-corpus
# evidence gate is not yet bound to immutable Stage 0 audit artifacts.
ANNOTATION_QUALITY_REPORT_VERSION = "stage1-annotation-quality-report.v2"
ANNOTATION_QUALITY_THRESHOLDS_VERSION = "stage1-quality-thresholds.v2"
ANNOTATION_CANDIDATE_MANIFEST_VERSION = "annotation-candidate-manifest.v1"
