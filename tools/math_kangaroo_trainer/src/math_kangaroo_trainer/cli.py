"""Command-line entry point for private, offline Stage 0 work."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from math_kangaroo_trainer.config import default_ontology_path
from math_kangaroo_trainer.corpus.audit import import_question
from math_kangaroo_trainer.corpus.duplicates import exact_duplicate_groups
from math_kangaroo_trainer.corpus.sampling import (
    coverage_summary,
    select_stratified_sample,
)
from math_kangaroo_trainer.corpus.source_adapter import CompleteBankAdapter
from math_kangaroo_trainer.domain.reviews import DuplicateGoldReview, GoldReview
from math_kangaroo_trainer.domain.items import ItemStatus
from math_kangaroo_trainer.domain.skills import (
    load_ontology,
    ontology_checksum,
)
from math_kangaroo_trainer.quality.reporting import (
    build_quality_report,
    write_quality_reports,
)
from math_kangaroo_trainer.storage import AuditRepository, migrate_audit_database
from math_kangaroo_trainer.versions import (
    AUDIT_POLICY_VERSION,
    CORPUS_ADAPTER_VERSION,
    DUPLICATE_ALGORITHM_VERSION,
    DUPLICATE_REVIEW_SCHEMA_VERSION,
    ITEM_SCHEMA_VERSION,
    POPULATION_FINDINGS_VERSION,
    REVIEW_SCHEMA_VERSION,
    SAMPLING_POLICY_VERSION,
)


DEFAULT_SAMPLE_SIZE = 180
DEFAULT_SEED = 20260801
AUDIT_DATABASE_NAME = "stage0-audit.sqlite3"


def _repository_root(start: Path) -> Path | None:
    for candidate in (start.resolve(), *start.resolve().parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def _require_private_output(path: Path) -> None:
    """Prevent derived private artifacts from entering a tracked site path."""

    repository = _repository_root(path)
    if repository is None or not path.is_relative_to(repository):
        return
    work_root = (repository / "work").resolve()
    if not path.is_relative_to(work_root):
        raise ValueError(
            "derived audit artifacts inside this repository must stay below work/"
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _versions(ontology_path: Path) -> dict[str, str]:
    ontology = load_ontology(ontology_path)
    return {
        "audit_policy": AUDIT_POLICY_VERSION,
        "corpus_adapter": CORPUS_ADAPTER_VERSION,
        "duplicate_algorithm": DUPLICATE_ALGORITHM_VERSION,
        "duplicate_review_schema": DUPLICATE_REVIEW_SCHEMA_VERSION,
        "item_schema": ITEM_SCHEMA_VERSION,
        "population_findings": POPULATION_FINDINGS_VERSION,
        "ontology": ontology.ontology_version,
        "ontology_sha256": ontology_checksum(ontology_path),
        "review_schema": REVIEW_SCHEMA_VERSION,
        "sampling_policy": SAMPLING_POLICY_VERSION,
    }


def _corpus_snapshot_sha256(items: tuple[Any, ...]) -> str:
    manifest = [
        [item.source.item_id, item.learner.content_version]
        for item in sorted(items, key=lambda value: value.source.item_id)
    ]
    return hashlib.sha256(_json(manifest).encode("utf-8")).hexdigest()


def _source_document_snapshot_sha256(documents: tuple[Any, ...]) -> str:
    manifest = [
        [
            document.source_path,
            document.declared_sha256,
            document.actual_sha256 or "missing",
        ]
        for document in sorted(documents, key=lambda value: value.source_path)
    ]
    return hashlib.sha256(_json(manifest).encode("utf-8")).hexdigest()


def _run_id(
    *, source_sha256: str, sample_size: int, seed: int, versions: dict[str, str]
) -> str:
    digest = hashlib.sha256(
        _json(
            {
                "source_sha256": source_sha256,
                "sample_size": sample_size,
                "seed": seed,
                "versions": versions,
            }
        ).encode("utf-8")
    ).hexdigest()
    return "stage0-" + digest[:24]


def stage0_build(args: argparse.Namespace) -> int:
    source_path = args.source.resolve()
    output_dir = args.output.resolve()
    ontology_path = args.ontology.resolve()
    _require_private_output(output_dir)
    if not source_path.is_file():
        raise FileNotFoundError(f"source database not found: {source_path}")
    audit_database = output_dir / AUDIT_DATABASE_NAME
    if audit_database == source_path:
        raise ValueError("derived audit database must not overwrite the source")

    source_sha256_before = _sha256(source_path)
    adapter = CompleteBankAdapter(source_path, asset_root=args.asset_root)
    source_questions, source_documents = adapter.snapshot()
    observed_source_counts = Counter(
        question.source_path for question in source_questions
    )
    source_by_path = {document.source_path: document for document in source_documents}
    validated_documents = []
    for document in source_documents:
        warnings = list(document.warning_codes)
        if observed_source_counts[document.source_path] != document.question_count:
            warnings.append("SOURCE_QUESTION_COUNT_MISMATCH")
        validated_documents.append(
            document.model_copy(
                update={"warning_codes": tuple(sorted(set(warnings)))}
            )
        )
    source_documents = tuple(validated_documents)
    validated_questions = []
    for question in source_questions:
        warnings = list(question.adapter_warning_codes)
        document = source_by_path.get(question.source_path)
        if document is None:
            warnings.append("SOURCE_DOCUMENT_NOT_IN_INVENTORY")
        else:
            if question.source_checksum != document.declared_sha256:
                warnings.append("SOURCE_CHECKSUM_INCONSISTENT")
            if question.source_family != document.source_family:
                warnings.append("SOURCE_FAMILY_INCONSISTENT")
            if question.source_label != document.source_label:
                warnings.append("SOURCE_LABEL_INCONSISTENT")
        validated_questions.append(
            question.model_copy(
                update={"adapter_warning_codes": tuple(sorted(set(warnings)))}
            )
        )
    source_questions = tuple(validated_questions)
    source_integrity_warning_counts = Counter(
        warning
        for document in source_documents
        for warning in document.warning_codes
    )
    source_integrity_warning_counts.update(
        warning
        for question in source_questions
        for warning in question.adapter_warning_codes
        if warning.startswith("SOURCE_")
    )
    declared_question_total = sum(
        document.question_count for document in source_documents
    )
    if declared_question_total != len(source_questions):
        source_integrity_warning_counts[
            "SOURCE_DECLARED_QUESTION_TOTAL_MISMATCH"
        ] += 1
    ingestion_warning_counts = Counter(
        warning
        for question in source_questions
        for warning in question.adapter_warning_codes
        if not warning.startswith("SOURCE_")
    )
    ingestion_item_ids = {
        question.item_id
        for question in source_questions
        if question.adapter_field_errors
        or any(
            warning.startswith(
                ("OPTIONS_JSON_", "ENGLISH_OPTIONS_JSON_", "OPTION_COUNT_")
            )
            for warning in question.adapter_warning_codes
        )
    }
    population_findings = {
        "schema_version": POPULATION_FINDINGS_VERSION,
        "source_integrity_warning_counts": dict(
            sorted(source_integrity_warning_counts.items())
        ),
        "ingestion_warning_counts": dict(sorted(ingestion_warning_counts.items())),
        "mandatory_ingestion_item_count": len(ingestion_item_ids),
        "declared_question_total": declared_question_total,
        "observed_question_total": len(source_questions),
    }
    imported = tuple(
        import_question(question, asset_path=adapter.asset_path(question))
        for question in source_questions
    )
    asset_paths = {
        item.source.item_id: adapter.asset_path(item.source) for item in imported
    }
    duplicates = exact_duplicate_groups(imported, asset_paths=asset_paths)
    duplicate_item_ids = {
        item_id for group in duplicates for item_id in group.item_ids
    }
    imported = tuple(
        item.model_copy(
            update={
                "warning_codes": tuple(
                    sorted(set((*item.warning_codes, "EXACT_DUPLICATE_CANDIDATE")))
                ),
                "learner": item.learner.model_copy(
                    update={"status": ItemStatus.NEEDS_REVIEW}
                ),
            }
        )
        if item.source.item_id in duplicate_item_ids
        else item
        for item in imported
    )
    sample = select_stratified_sample(
        imported,
        sample_size=args.sample_size,
        seed=args.seed,
        mandatory_item_ids=duplicate_item_ids | ingestion_item_ids,
    )
    coverage = coverage_summary(imported, sample)
    versions = _versions(ontology_path)
    versions["corpus_snapshot_sha256"] = _corpus_snapshot_sha256(imported)
    versions["source_document_snapshot_sha256"] = _source_document_snapshot_sha256(
        source_documents
    )
    source_sha256 = _sha256(source_path)
    if source_sha256 != source_sha256_before:
        raise RuntimeError(
            "source database changed during the audit; rerun from a stable snapshot"
        )
    run_id = _run_id(
        source_sha256=source_sha256,
        sample_size=args.sample_size,
        seed=args.seed,
        versions=versions,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    migrate_audit_database(audit_database, allow_create=True)
    repository = AuditRepository(audit_database)
    try:
        repository.upsert_run(
            {
                "run_id": run_id,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "source_path": str(source_path),
                "source_sha256": source_sha256,
                "source_item_count": len(imported),
                "sample_size": len(sample),
                "seed": args.seed,
                "versions_json": _json(versions),
                "coverage_json": _json(coverage),
                "population_findings_json": _json(population_findings),
                "status": "pending_review",
            }
        )
        repository.upsert_items(run_id, sample, asset_paths=asset_paths)
        repository.upsert_source_documents(run_id, source_documents)
        repository.replace_duplicate_groups(run_id, duplicates)
        stored_items = repository.items(run_id)
        _write_review_files(stored_items, run_id, output_dir)
        _write_duplicate_review_files(
            stored_items,
            repository.duplicate_groups(run_id),
            run_id,
            output_dir,
        )
        _write_source_inventory(source_documents, run_id, output_dir)
        ontology = load_ontology(ontology_path)
        report = build_quality_report(
            repository,
            run_id=run_id,
            ontology=ontology,
            ontology_sha256=ontology_checksum(ontology_path),
        )
        write_quality_reports(report, output_dir)
    finally:
        repository.close()

    print(
        _json(
            {
                "run_id": run_id,
                "source_items": len(imported),
                "sample_items": len(sample),
                "duplicate_candidate_groups": len(duplicates),
                "exit_status": report["exit_criterion"]["status"],
                "output": str(output_dir),
            }
        )
    )
    return 0


def _write_review_files(
    items: list[dict[str, Any]], run_id: str, output_dir: Path
) -> None:
    queue_path = output_dir / "review-queue.jsonl"
    template_path = output_dir / "review-template.jsonl"
    with queue_path.open("w", encoding="utf-8") as queue:
        for item in items:
            queue.write(
                _json(
                    {
                        "run_id": run_id,
                        "item_id": item["item_id"],
                        "sample_order": item["sample_order"],
                        "content_version": item["content_version"],
                        "source": item["source"],
                        "learner_safe_item": item["learner"],
                        "protected_answer": item["protected"],
                        "warning_codes": item["warning_codes"],
                        "content_gap_codes": item["content_gap_codes"],
                        "asset_path": item["asset_path"],
                    }
                )
                + "\n"
            )
    with template_path.open("w", encoding="utf-8") as template:
        for item in items:
            for slot in (1, 2):
                template.write(
                    _json(
                        {
                            "run_id": run_id,
                            "item_id": item["item_id"],
                            "content_version": item["content_version"],
                            "reviewer_slot": slot,
                            "reviewer_id": "REPLACE_ME",
                            "question_boundary_verified": False,
                            "choices_verified": False,
                            "answer_key_verified": False,
                            "diagram_verified": False,
                            "source_metadata_verified": False,
                            "disposition": "needs_review",
                            "notes": "",
                            "reviewed_at": "REPLACE_WITH_ISO_8601",
                            "schema_version": REVIEW_SCHEMA_VERSION,
                        }
                    )
                    + "\n"
                )


def _write_source_inventory(
    documents: tuple[Any, ...], run_id: str, output_dir: Path
) -> None:
    path = output_dir / "source-inventory.jsonl"
    with path.open("w", encoding="utf-8") as destination:
        for document in documents:
            destination.write(
                _json(
                    {
                        "run_id": run_id,
                        "source_document": document.model_dump(mode="json"),
                    }
                )
                + "\n"
            )


def _write_duplicate_review_files(
    items: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    run_id: str,
    output_dir: Path,
) -> None:
    """Write private evidence packets and independent adjudication slots."""

    item_by_id = {item["item_id"]: item for item in items}
    queue_path = output_dir / "duplicate-review-queue.jsonl"
    template_path = output_dir / "duplicate-review-template.jsonl"
    with (
        queue_path.open("w", encoding="utf-8") as queue,
        template_path.open("w", encoding="utf-8") as template,
    ):
        for group in groups:
            members = []
            for item_id in group["item_ids"]:
                item = item_by_id.get(item_id)
                if item is None:
                    raise ValueError(
                        f"duplicate candidate {group['group_id']} member {item_id} "
                        "is not present in the gold sample"
                    )
                members.append(
                    {
                        "item_id": item_id,
                        "content_version": item["content_version"],
                        "source": item["source"],
                        "learner_safe_item": item["learner"],
                        "protected_answer": item["protected"],
                        "asset_path": item["asset_path"],
                    }
                )
            queue.write(
                _json(
                    {
                        "run_id": run_id,
                        "group_id": group["group_id"],
                        "signature_type": group["signature_type"],
                        "signature": group["signature"],
                        "algorithm_version": group["algorithm_version"],
                        "members": members,
                    }
                )
                + "\n"
            )
            for slot in (1, 2):
                template.write(
                    _json(
                        {
                            "run_id": run_id,
                            "group_id": group["group_id"],
                            "signature": group["signature"],
                            "reviewer_slot": slot,
                            "reviewer_id": "REPLACE_ME",
                            "decision": "needs_review",
                            "notes": "",
                            "reviewed_at": "REPLACE_WITH_ISO_8601",
                            "schema_version": DUPLICATE_REVIEW_SCHEMA_VERSION,
                        }
                    )
                    + "\n"
                )


def _load_reviews(path: Path) -> tuple[GoldReview, ...]:
    reviews: list[GoldReview] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            reviews.append(GoldReview.model_validate_json(line))
        except ValidationError as error:
            raise ValueError(f"{path}:{line_number}: invalid review: {error}") from error
    if not reviews:
        raise ValueError("review file contains no records")
    return tuple(reviews)


def _load_duplicate_reviews(path: Path) -> tuple[DuplicateGoldReview, ...]:
    reviews: list[DuplicateGoldReview] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            reviews.append(DuplicateGoldReview.model_validate_json(line))
        except ValidationError as error:
            raise ValueError(
                f"{path}:{line_number}: invalid duplicate review: {error}"
            ) from error
    if not reviews:
        raise ValueError("duplicate-review file contains no records")
    return tuple(reviews)


def stage0_import_reviews(args: argparse.Namespace) -> int:
    audit_database = args.audit_db.resolve()
    output_dir = args.output.resolve() if args.output else audit_database.parent
    _require_private_output(audit_database)
    _require_private_output(output_dir)
    ontology = load_ontology(args.ontology.resolve())
    migrate_audit_database(audit_database)
    repository = AuditRepository(audit_database)
    try:
        reviews = _load_reviews(args.input.resolve())
        run_ids = sorted({review.run_id for review in reviews})
        if len(run_ids) != 1:
            raise ValueError("one review import file must target exactly one audit run")
        count = repository.import_reviews(reviews)
        run_id = run_ids[0]
        report = build_quality_report(
            repository,
            run_id=run_id,
            ontology=ontology,
            ontology_sha256=ontology_checksum(args.ontology.resolve()),
        )
        write_quality_reports(report, output_dir)
    finally:
        repository.close()
    print(_json({"imported_reviews": count, "run_ids": run_ids}))
    return 0


def stage0_import_duplicate_reviews(args: argparse.Namespace) -> int:
    audit_database = args.audit_db.resolve()
    output_dir = args.output.resolve() if args.output else audit_database.parent
    _require_private_output(audit_database)
    _require_private_output(output_dir)
    ontology_path = args.ontology.resolve()
    ontology = load_ontology(ontology_path)
    migrate_audit_database(audit_database)
    repository = AuditRepository(audit_database)
    try:
        reviews = _load_duplicate_reviews(args.input.resolve())
        run_ids = sorted({review.run_id for review in reviews})
        if len(run_ids) != 1:
            raise ValueError(
                "one duplicate-review import file must target exactly one audit run"
            )
        count = repository.import_duplicate_reviews(reviews)
        run_id = run_ids[0]
        report = build_quality_report(
            repository,
            run_id=run_id,
            ontology=ontology,
            ontology_sha256=ontology_checksum(ontology_path),
        )
        write_quality_reports(report, output_dir)
    finally:
        repository.close()
    print(_json({"imported_duplicate_reviews": count, "run_ids": run_ids}))
    return 0


def stage0_report(args: argparse.Namespace) -> int:
    audit_database = args.audit_db.resolve()
    output_dir = args.output.resolve()
    _require_private_output(audit_database)
    _require_private_output(output_dir)
    ontology = load_ontology(args.ontology.resolve())
    migrate_audit_database(audit_database)
    repository = AuditRepository(audit_database)
    try:
        run_id = args.run_id or repository.latest_run_id()
        report = build_quality_report(
            repository,
            run_id=run_id,
            ontology=ontology,
            ontology_sha256=ontology_checksum(args.ontology.resolve()),
        )
        write_quality_reports(report, output_dir)
    finally:
        repository.close()
    print(_json({"run_id": run_id, "exit_status": report["exit_criterion"]["status"]}))
    return 0


def validate_ontology(args: argparse.Namespace) -> int:
    ontology = load_ontology(args.ontology.resolve())
    print(_json(ontology.summary()))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="math-kangaroo-trainer",
        description="Offline, private-data Math Kangaroo adaptive-core tooling.",
    )
    command = parser.add_subparsers(dest="command", required=True)
    stage0 = command.add_parser("stage0", help="Stage 0 corpus audit and gold set")
    stage0_commands = stage0.add_subparsers(dest="stage0_command", required=True)

    build = stage0_commands.add_parser("build", help="build or resume a Stage 0 audit")
    build.add_argument("--source", type=Path, required=True)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--asset-root", type=Path)
    build.add_argument("--sample-size", type=int, default=DEFAULT_SAMPLE_SIZE)
    build.add_argument("--seed", type=int, default=DEFAULT_SEED)
    build.add_argument("--ontology", type=Path, default=default_ontology_path())
    build.set_defaults(handler=stage0_build)

    import_reviews = stage0_commands.add_parser(
        "import-reviews", help="import one or both independent review slots"
    )
    import_reviews.add_argument("--audit-db", type=Path, required=True)
    import_reviews.add_argument("--input", type=Path, required=True)
    import_reviews.add_argument("--output", type=Path)
    import_reviews.add_argument(
        "--ontology", type=Path, default=default_ontology_path()
    )
    import_reviews.set_defaults(handler=stage0_import_reviews)

    import_duplicate_reviews = stage0_commands.add_parser(
        "import-duplicate-reviews",
        help="import one or both independent exact-duplicate adjudication slots",
    )
    import_duplicate_reviews.add_argument("--audit-db", type=Path, required=True)
    import_duplicate_reviews.add_argument("--input", type=Path, required=True)
    import_duplicate_reviews.add_argument("--output", type=Path)
    import_duplicate_reviews.add_argument(
        "--ontology", type=Path, default=default_ontology_path()
    )
    import_duplicate_reviews.set_defaults(handler=stage0_import_duplicate_reviews)

    report = stage0_commands.add_parser("report", help="regenerate quality reports")
    report.add_argument("--audit-db", type=Path, required=True)
    report.add_argument("--output", type=Path, required=True)
    report.add_argument("--run-id")
    report.add_argument("--ontology", type=Path, default=default_ontology_path())
    report.set_defaults(handler=stage0_report)

    ontology = command.add_parser("validate-ontology", help="validate ontology and DAG")
    ontology.add_argument("--ontology", type=Path, default=default_ontology_path())
    ontology.set_defaults(handler=validate_ontology)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except (FileNotFoundError, ValueError, RuntimeError, ValidationError) as error:
        parser.exit(2, f"error: {error}\n")


if __name__ == "__main__":
    sys.exit(main())
