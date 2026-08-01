"""Generate matching JSON and Markdown reports without overstating readiness."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

from math_kangaroo_trainer.domain.skills import OntologyDocument, gold_set_checksum
from math_kangaroo_trainer.storage.repository import AuditRepository
from math_kangaroo_trainer.versions import QUALITY_REPORT_VERSION
from math_kangaroo_trainer.versions import POPULATION_FINDINGS_VERSION


FAITHFUL_PARSING_THRESHOLD = 0.98


def _ontology_evidence_matches_run(
    ontology: OntologyDocument,
    *,
    source_sha256: str,
    item_content_versions: dict[str, str],
) -> tuple[bool, str]:
    """Bind approval evidence to this exact source and deterministic gold set."""

    if not ontology.review_ready:
        return False, "ontology_structure_or_review_incomplete"
    expected_gold_set = gold_set_checksum(item_content_versions)
    if not ontology.provenance.gold_set_evidence:
        return False, "gold_set_evidence_missing"
    for evidence in ontology.provenance.gold_set_evidence:
        if evidence.gold_set_sha256 != expected_gold_set:
            return False, "gold_set_checksum_mismatch"
        if evidence.source_sha256 != source_sha256:
            return False, "gold_set_source_mismatch"
        if evidence.sample_item_content_versions != item_content_versions:
            return False, "gold_set_content_versions_mismatch"

    boundaries: dict[str, Any] = {}
    for evidence in ontology.provenance.item_annotation_evidence:
        if evidence.gold_set_sha256 != expected_gold_set:
            return False, "annotation_gold_set_checksum_mismatch"
        if any(
            item_content_versions.get(item_id) != content_version
            for item_id, content_version in evidence.item_content_versions.items()
        ):
            return False, "annotation_content_versions_mismatch"
        for skill_id, boundary in evidence.skill_boundaries.items():
            if skill_id in boundaries:
                return False, "duplicate_skill_boundary_evidence"
            boundaries[skill_id] = boundary

    if set(boundaries) != {skill.skill_id for skill in ontology.skills}:
        return False, "skill_boundary_coverage_incomplete"
    for skill in ontology.skills:
        boundary = boundaries[skill.skill_id]
        if (
            boundary.positive_item_ids != skill.positive_example_item_ids
            or boundary.negative_item_ids != skill.negative_example_item_ids
        ):
            return False, "skill_boundary_examples_mismatch"
        if not (
            set(boundary.positive_item_ids) | set(boundary.negative_item_ids)
        ).issubset(item_content_versions):
            return False, "skill_boundary_item_not_in_gold_set"
    return True, "matched"


def build_quality_report(
    repository: AuditRepository,
    *,
    run_id: str,
    ontology: OntologyDocument,
    ontology_sha256: str | None = None,
) -> dict[str, Any]:
    run = repository.run(run_id)
    items = repository.items(run_id)
    source_documents = repository.source_documents(run_id)
    review_evidence = repository.review_evidence(run_id)
    duplicates = repository.duplicate_review_evidence(run_id)

    warning_counts = Counter(
        warning for item in items for warning in item["warning_codes"]
    )
    content_gap_counts = Counter(
        gap for item in items for gap in item["content_gap_codes"]
    )
    parser_status_counts = Counter(item["parser_status"] for item in items)
    review_state_counts = Counter(item["review_state"] for item in items)
    population_findings = run["population_findings"]
    population_findings_complete = (
        population_findings.get("schema_version") == POPULATION_FINDINGS_VERSION
        and isinstance(population_findings.get("declared_question_total"), int)
        and isinstance(population_findings.get("observed_question_total"), int)
        and isinstance(
            population_findings.get("source_integrity_warning_counts"), dict
        )
        and isinstance(population_findings.get("ingestion_warning_counts"), dict)
        and isinstance(
            population_findings.get("mandatory_ingestion_item_count"), int
        )
    )
    source_warning_counts = Counter(
        population_findings.get("source_integrity_warning_counts", {})
    )
    if not population_findings_complete:
        source_warning_counts["SOURCE_POPULATION_AUDIT_MISSING"] += 1
    elif (
        population_findings["declared_question_total"]
        != population_findings["observed_question_total"]
    ):
        source_warning_counts["SOURCE_DECLARED_QUESTION_TOTAL_MISMATCH"] += 1
    population_ingestion_warning_counts = Counter(
        population_findings.get("ingestion_warning_counts", {})
    )
    source_format_counts = Counter(
        Path(document["source_path"]).suffix.lower() or "no_extension"
        for document in source_documents
    )
    state_by_item = {item["item_id"]: item["review_state"] for item in items}
    review_timestamps = [
        review["reviewed_at"]
        for evidence in review_evidence
        for review in evidence["reviews"]
    ]
    evidence_as_of = max(review_timestamps) if review_timestamps else None
    missing_coverage = [
        f"{dimension}={value}"
        for dimension, values in run["coverage"].items()
        for value, counts in values.items()
        if counts["population"] > 0 and counts["sample"] == 0
    ]

    double_reviewed = 0
    faithful = 0
    explicit_failures = 0
    reviewer_conflicts = 0
    for evidence in review_evidence:
        reviews = evidence["reviews"]
        independent = len({review["reviewer_id"] for review in reviews}) == 2
        complete = len(reviews) == 2 and independent
        if len(reviews) == 2 and not independent:
            reviewer_conflicts += 1
        if not complete:
            continue
        double_reviewed += 1
        if all(review["disposition"] == "faithful" for review in reviews):
            faithful += 1
        elif state_by_item[evidence["item_id"]] in {"needs_review", "rejected"}:
            explicit_failures += 1

    fidelity = faithful / double_reviewed if double_reviewed else None
    failure_count = double_reviewed - faithful
    full_double_review = double_reviewed == run["sample_size"]
    failures_explicit = (
        failure_count == explicit_failures if full_double_review else None
    )
    stale_review_count = sum(
        evidence["stale_review_count"] for evidence in review_evidence
    )

    sample_item_ids = {item["item_id"] for item in items}
    duplicate_confirmed = 0
    duplicate_rejected = 0
    duplicate_reviewer_conflicts = 0
    duplicate_decision_conflicts = 0
    duplicate_review_timestamps: list[str] = []
    duplicate_members_in_sample = True
    for group in duplicates:
        reviews = group["reviews"]
        duplicate_review_timestamps.extend(
            str(review["reviewed_at"]) for review in reviews
        )
        duplicate_members_in_sample = duplicate_members_in_sample and set(
            group["item_ids"]
        ).issubset(sample_item_ids)
        if len(reviews) != 2:
            continue
        if len({review["reviewer_id"] for review in reviews}) != 2:
            duplicate_reviewer_conflicts += 1
            continue
        decisions = {review["decision"] for review in reviews}
        if decisions == {"confirmed"}:
            duplicate_confirmed += 1
        elif decisions == {"rejected"}:
            duplicate_rejected += 1
        else:
            duplicate_decision_conflicts += 1
    duplicate_adjudicated = duplicate_confirmed + duplicate_rejected
    duplicate_review_complete = (
        duplicate_adjudicated == len(duplicates)
        and duplicate_members_in_sample
        and not duplicate_reviewer_conflicts
        and not duplicate_decision_conflicts
    )
    duplicate_precision = (
        duplicate_confirmed / duplicate_adjudicated
        if duplicate_adjudicated
        else None
    )
    if duplicate_review_timestamps:
        evidence_as_of = max(
            [
                *duplicate_review_timestamps,
                *([evidence_as_of] if evidence_as_of is not None else []),
            ]
        )
    ontology_version_matches = (
        run["versions"].get("ontology") == ontology.ontology_version
    )
    ontology_checksum_matches = ontology_sha256 is None or (
        run["versions"].get("ontology_sha256") == ontology_sha256
    )
    ontology_matches_run = ontology_version_matches and ontology_checksum_matches
    item_content_versions = {
        item["item_id"]: item["content_version"] for item in items
    }
    ontology_evidence_matches_run, ontology_evidence_reason = (
        _ontology_evidence_matches_run(
            ontology,
            source_sha256=run["source_sha256"],
            item_content_versions=item_content_versions,
        )
    )
    source_integrity_passed = (
        bool(source_documents)
        and population_findings_complete
        and not source_warning_counts
    )
    if not source_integrity_passed:
        exit_status = "FAIL"
    elif not ontology_matches_run:
        exit_status = "FAIL"
    elif missing_coverage:
        exit_status = "FAIL"
    elif not full_double_review or reviewer_conflicts:
        exit_status = "PENDING_REVIEW"
    elif (
        fidelity is None
        or fidelity < FAITHFUL_PARSING_THRESHOLD
        or failures_explicit is not True
    ):
        exit_status = "FAIL"
    elif not duplicate_review_complete:
        exit_status = "PENDING_DUPLICATE_REVIEW"
    elif not ontology.review_ready or not ontology_evidence_matches_run:
        exit_status = "PENDING_ONTOLOGY_REVIEW"
    else:
        exit_status = "PASS"
    run["status"] = exit_status.lower()
    repository.update_run_status(run_id, run["status"])

    report = {
        "report_version": QUALITY_REPORT_VERSION,
        "evidence_as_of": evidence_as_of,
        "run": {
            key: value
            for key, value in run.items()
            if key
            not in {
                "source_path",
                "coverage",
                "population_findings",
                "created_at",
            }
        },
        "source": {
            "private_path_redacted": True,
            "source_sha256": run["source_sha256"],
            "item_count": run["source_item_count"],
            "read_only_adapter": True,
            "document_count": len(source_documents),
            "format_counts": dict(sorted(source_format_counts.items())),
            "integrity_warning_counts": dict(sorted(source_warning_counts.items())),
            "all_declared_bytes_verified": source_integrity_passed,
            "declared_question_total": population_findings.get(
                "declared_question_total"
            ),
            "observed_question_total": population_findings.get(
                "observed_question_total"
            ),
        },
        "sample": {
            "size": run["sample_size"],
            "coverage_complete": not missing_coverage,
            "missing_marginal_strata": missing_coverage,
            "coverage": run["coverage"],
        },
        "parser": {
            "status_counts": dict(sorted(parser_status_counts.items())),
            "warning_counts": dict(sorted(warning_counts.items())),
            "items_with_warnings": sum(bool(item["warning_codes"]) for item in items),
            "population_ingestion_warning_counts": dict(
                sorted(population_ingestion_warning_counts.items())
            ),
            "mandatory_ingestion_items_in_sample": population_findings.get(
                "mandatory_ingestion_item_count", 0
            ),
        },
        "content_gaps": {
            "counts": dict(sorted(content_gap_counts.items())),
            "items_with_content_gaps": sum(
                bool(item["content_gap_codes"]) for item in items
            ),
        },
        "gold_review": {
            "required_independent_reviews_per_item": 2,
            "review_state_counts": dict(sorted(review_state_counts.items())),
            "double_reviewed_items": double_reviewed,
            "faithful_items": faithful,
            "explicit_failure_items": explicit_failures,
            "reviewer_conflicts": reviewer_conflicts,
            "stale_content_review_count": stale_review_count,
            "faithful_parsing_rate": fidelity,
            "immutable_review_revision_count": repository.review_history_count(run_id),
        },
        "exact_duplicates": {
            "candidate_group_count": len(duplicates),
            "candidate_membership_count": sum(
                len(group["item_ids"]) for group in duplicates
            ),
            "all_candidate_members_in_gold_sample": duplicate_members_in_sample,
            "double_reviewed_confirmed_groups": duplicate_confirmed,
            "double_reviewed_rejected_groups": duplicate_rejected,
            "unresolved_groups": len(duplicates) - duplicate_adjudicated,
            "reviewer_conflicts": duplicate_reviewer_conflicts,
            "decision_conflicts": duplicate_decision_conflicts,
            "confirmed_candidate_precision": duplicate_precision,
            "review_complete": duplicate_review_complete,
            "immutable_review_revision_count": (
                repository.duplicate_review_history_count(run_id)
            ),
            "groups": [
                {
                    "group_id": group["group_id"],
                    "signature_type": group["signature_type"],
                    "review_status": group["review_status"],
                    "item_ids": group["item_ids"],
                }
                for group in duplicates
            ],
        },
        "ontology": {
            **ontology.summary(),
            "gold_set_sha256": gold_set_checksum(item_content_versions),
            "run_evidence_matches": ontology_evidence_matches_run,
            "run_evidence_reason": ontology_evidence_reason,
        },
        "exit_criterion": {
            "status": exit_status,
            "minimum_faithful_parsing_rate": FAITHFUL_PARSING_THRESHOLD,
            "full_double_review_complete": full_double_review,
            "remaining_failures_explicit": failures_explicit,
            "reason": _exit_reason(
                exit_status,
                double_reviewed=double_reviewed,
                sample_size=run["sample_size"],
                reviewer_conflicts=reviewer_conflicts,
                fidelity=fidelity,
                failures_explicit=failures_explicit,
                ontology_matches_run=ontology_matches_run,
                ontology_ready=(
                    ontology.review_ready and ontology_evidence_matches_run
                ),
                source_integrity_passed=source_integrity_passed,
                coverage_complete=not missing_coverage,
                duplicate_review_complete=duplicate_review_complete,
                duplicate_reviewer_conflicts=duplicate_reviewer_conflicts,
                duplicate_decision_conflicts=duplicate_decision_conflicts,
            ),
            "ontology_matches_run": ontology_matches_run,
            "ontology_review_complete": (
                ontology.review_ready and ontology_evidence_matches_run
            ),
            "ontology_run_evidence_matches": ontology_evidence_matches_run,
            "source_integrity_passed": source_integrity_passed,
            "duplicate_review_complete": duplicate_review_complete,
        },
        "privacy": {
            "raw_question_content_in_report": False,
            "answer_keys_in_report": False,
            "learner_data_collected": False,
            "runtime_network_required": False,
        },
    }
    return report


def _exit_reason(
    status: str,
    *,
    double_reviewed: int,
    sample_size: int,
    reviewer_conflicts: int,
    fidelity: float | None,
    failures_explicit: bool | None,
    ontology_matches_run: bool,
    ontology_ready: bool,
    source_integrity_passed: bool,
    coverage_complete: bool,
    duplicate_review_complete: bool,
    duplicate_reviewer_conflicts: int,
    duplicate_decision_conflicts: int,
) -> str:
    if status == "PASS":
        return "The full sample and duplicate slice have two independent reviews, fidelity is at least 98%, every remaining failure is explicit, and the ontology is approved."
    if not source_integrity_passed:
        return "One or more source documents are missing or do not match their declared bytes, checksum, metadata, or question count."
    if not ontology_matches_run:
        return "The supplied ontology version or checksum does not match this audit run."
    if not coverage_complete:
        return "The gold sample does not cover every populated marginal stratum."
    if reviewer_conflicts:
        return f"{reviewer_conflicts} item(s) use the same reviewer in both review slots."
    if double_reviewed < sample_size:
        return f"{sample_size - double_reviewed} of {sample_size} sample item(s) still need two independent reviews."
    if fidelity is not None and fidelity < FAITHFUL_PARSING_THRESHOLD:
        return f"Faithful parsing is {fidelity:.1%}, below the 98% Stage 0 gate."
    if failures_explicit is False:
        return "At least one review failure is not represented as needs_review or rejected."
    if not duplicate_review_complete:
        if duplicate_reviewer_conflicts:
            return f"{duplicate_reviewer_conflicts} duplicate group(s) use the same reviewer in both review slots."
        if duplicate_decision_conflicts:
            return f"{duplicate_decision_conflicts} duplicate group(s) have unresolved adjudication decisions."
        return "Every exact-duplicate candidate still needs two independent, agreeing adjudications."
    if not ontology_ready:
        return "The ontology is still proposed or lacks two-person approval and gold-set evidence."
    return "Stage 0 evidence is incomplete."


def write_quality_reports(report: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "quality-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (output_dir / "quality-summary.md").write_text(
        render_markdown(report), encoding="utf-8"
    )


def render_markdown(report: dict[str, Any]) -> str:
    exit_criterion = report["exit_criterion"]
    review = report["gold_review"]
    parser = report["parser"]
    fidelity = review["faithful_parsing_rate"]
    fidelity_text = "Not measurable yet" if fidelity is None else f"{fidelity:.1%}"
    warnings = "\n".join(
        f"| `{code}` | {count} |"
        for code, count in parser["warning_counts"].items()
    ) or "| None | 0 |"
    population_ingestion_warnings = "\n".join(
        f"| `{code}` | {count} |"
        for code, count in parser["population_ingestion_warning_counts"].items()
    ) or "| None | 0 |"
    source_warnings = "\n".join(
        f"| `{code}` | {count} |"
        for code, count in report["source"]["integrity_warning_counts"].items()
    ) or "| None | 0 |"
    missing_strata = "\n".join(
        f"- `{stratum}`" for stratum in report["sample"]["missing_marginal_strata"]
    ) or "- None"
    content_gaps = "\n".join(
        f"| `{code}` | {count} |"
        for code, count in report["content_gaps"]["counts"].items()
    ) or "| None | 0 |"
    explicit_text = (
        "Not measurable yet"
        if exit_criterion["remaining_failures_explicit"] is None
        else ("Yes" if exit_criterion["remaining_failures_explicit"] else "No")
    )
    return f"""# Math Kangaroo Stage 0 quality summary

**Exit status: `{exit_criterion['status']}`**

{exit_criterion['reason']}

## Corpus and sample

| Measure | Value |
| --- | ---: |
| Verified source documents | {report['source']['document_count']} |
| Private source items | {report['source']['item_count']} |
| Gold-sample items | {report['sample']['size']} |
| All marginal strata represented | {'Yes' if report['sample']['coverage_complete'] else 'No'} |
| Exact duplicate candidate groups | {report['exact_duplicates']['candidate_group_count']} |

## Independent review gate

| Measure | Value |
| --- | ---: |
| Items with two independent reviews | {review['double_reviewed_items']} / {report['sample']['size']} |
| Faithful items among double-reviewed items | {review['faithful_items']} |
| Faithful parsing rate | {fidelity_text} |
| Required rate | {exit_criterion['minimum_faithful_parsing_rate']:.0%} |
| Explicit remaining failures | {explicit_text} |
| Item reviewer-identity conflicts | {review['reviewer_conflicts']} |
| Stale content-bound review projections | {review['stale_content_review_count']} |

## Whole-corpus source integrity

| Measure | Value |
| --- | ---: |
| Declared questions | {report['source']['declared_question_total']} |
| Observed questions | {report['source']['observed_question_total']} |
| Source integrity passed | {'Yes' if exit_criterion['source_integrity_passed'] else 'No'} |

| Source finding | Count |
| --- | ---: |
{source_warnings}

Missing marginal strata:

{missing_strata}

## Review triggers

| Trigger | Sample items |
| --- | ---: |
{warnings}

Whole-corpus ingestion findings are forced into the gold sample:

| Ingestion finding | Corpus items |
| --- | ---: |
{population_ingestion_warnings}

## Content gaps

These gaps are kept separate from parser failures; they must not be filled by
guessing or silent inference.

| Gap | Sample items |
| --- | ---: |
{content_gaps}

## Ontology

The `{report['ontology']['ontology_version']}` ontology remains
`{report['ontology']['status']}`. It contains {report['ontology']['skill_count']}
teachable knowledge components and
{report['ontology']['curriculum_gating_edge_count']} reviewed curriculum gates.
Proposed edges cannot gate instruction.

## Exact-duplicate adjudication

| Measure | Value |
| --- | ---: |
| Candidate groups | {report['exact_duplicates']['candidate_group_count']} |
| Independently confirmed | {report['exact_duplicates']['double_reviewed_confirmed_groups']} |
| Independently rejected | {report['exact_duplicates']['double_reviewed_rejected_groups']} |
| Unresolved | {report['exact_duplicates']['unresolved_groups']} |
| Reviewer-identity conflicts | {report['exact_duplicates']['reviewer_conflicts']} |
| Decision conflicts | {report['exact_duplicates']['decision_conflicts']} |
| All candidate members in gold sample | {'Yes' if report['exact_duplicates']['all_candidate_members_in_gold_sample'] else 'No'} |

## Privacy boundary

This report contains no question text, answer key, learner data, or raw asset.
The source path is redacted and the audit requires no runtime network service.
"""
