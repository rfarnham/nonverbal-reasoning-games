"""Build a version-bound private catalogue inventory over the complete bank."""

from __future__ import annotations

import csv
import hashlib
import json
import mimetypes
import os
import stat
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from math_kangaroo_trainer.config import default_ontology_path
from math_kangaroo_trainer.corpus.audit import import_question
from math_kangaroo_trainer.corpus.catalogue import (
    CATALOGUE_CLASSIFIER_VERSION,
    catalogue_controlled_vocabularies,
    propose_catalogue_classification,
)
from math_kangaroo_trainer.corpus.duplicates import exact_duplicate_groups
from math_kangaroo_trainer.corpus.source_adapter import CompleteBankAdapter
from math_kangaroo_trainer.domain.catalogue_reviews import (
    CatalogueAnswerKeyReference,
    CatalogueAssetReference,
    CatalogueInventoryItem,
    CatalogueRun,
    CatalogueSourceMetadata,
    CatalogueVocabulary,
    catalogue_inventory_snapshot_sha256,
)
from math_kangaroo_trainer.domain.skills import (
    OntologyDocument,
    load_ontology,
    ontology_checksum,
)
from math_kangaroo_trainer.versions import CORPUS_ADAPTER_VERSION


CATALOGUE_PIPELINE_VERSION = "whole-corpus-catalogue-pipeline.v3"

LEGACY_SPATIAL_MECHANIC_MAP = {
    "Assembly, tiling & composition": "assembly",
    "3D objects, nets & views": "three_dimensional",
    "Visual patterns & matrices": "patterns",
    "Paths, routes & directions": "paths",
    "Overlap, layering & order": "layering",
    "Rotation & reflection": "rotation",
    "Folding, cutting & nets": "folding",
    "Other spatial": "other",
}


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _asset_reference(
    *,
    asset_id: str,
    asset_path: Path,
    width: int | None,
    height: int | None,
) -> CatalogueAssetReference:
    """Snapshot one crop with a stable hash/byte-count pair.

    Missing is evidence too.  Recording it explicitly prevents a crop that
    appears later from becoming trusted by an existing catalogue run.
    """

    digest = hashlib.sha256()
    try:
        with asset_path.open("rb") as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise OSError("asset is not a regular file")
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
            after = os.fstat(source.fileno())
    except FileNotFoundError:
        return CatalogueAssetReference(
            asset_id=asset_id,
            local_ref=str(asset_path),
            media_type=mimetypes.guess_type(asset_path.name)[0],
            width=width,
            height=height,
            status="missing",
        )
    except OSError as error:
        raise RuntimeError(f"cannot snapshot crop evidence: {asset_path}") from error
    if (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    ) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise RuntimeError("crop evidence changed while being read")
    return CatalogueAssetReference(
        asset_id=asset_id,
        local_ref=str(asset_path),
        media_type=mimetypes.guess_type(asset_path.name)[0],
        sha256=digest.hexdigest(),
        bytes=after.st_size,
        width=width,
        height=height,
        status="available",
    )


def _answer_key_reference(
    relative_ref: str | None,
    *,
    source_bank_root: Path,
    source_scope_root: Path,
) -> CatalogueAnswerKeyReference | None:
    if relative_ref is None or not relative_ref.strip():
        return None
    candidate = (source_bank_root / relative_ref).resolve()
    try:
        candidate.relative_to(source_scope_root)
    except ValueError as error:
        raise ValueError("answer-key path escapes the private source scope") from error
    if not candidate.exists():
        return CatalogueAnswerKeyReference(
            local_ref=str(candidate),
            media_type=mimetypes.guess_type(candidate.name)[0],
            status="missing",
        )
    digest = hashlib.sha256()
    try:
        with candidate.open("rb") as source:
            before = os.fstat(source.fileno())
            if not stat.S_ISREG(before.st_mode):
                raise OSError("answer key is not a regular file")
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
            after = os.fstat(source.fileno())
    except OSError as error:
        raise RuntimeError(
            f"cannot snapshot answer-key evidence: {candidate}"
        ) from error
    if (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    ) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    ):
        raise RuntimeError("answer-key evidence changed while being read")
    return CatalogueAnswerKeyReference(
        local_ref=str(candidate),
        media_type=mimetypes.guess_type(candidate.name)[0],
        sha256=digest.hexdigest(),
        bytes=after.st_size,
        status="available",
    )


def _legacy_spatial_rows(
    path: Path | None,
) -> dict[tuple[str, str, int], dict[str, Any]]:
    if path is None or not path.is_file():
        return {}
    result: dict[tuple[str, str, int], dict[str, Any]] = {}
    with path.open(encoding="utf-8", newline="") as source:
        for line_number, row in enumerate(csv.DictReader(source), start=2):
            try:
                key = (row["source"], row["grade"], int(row["question"]))
            except (KeyError, TypeError, ValueError) as error:
                raise ValueError(
                    f"{path}:{line_number}: invalid legacy spatial-review key"
                ) from error
            if key in result:
                raise ValueError(f"{path}:{line_number}: duplicate legacy key {key!r}")
            raw_mechanic = row.get("mechanic", "").strip()
            mechanic = LEGACY_SPATIAL_MECHANIC_MAP.get(raw_mechanic, "other")
            result[key] = {
                "provenance": "legacy_spatial_review",
                "status": "proposed",
                "authoritative": False,
                "mechanic": mechanic,
                "source_mechanic": raw_mechanic,
                "tier": row.get("tier", "").strip() or None,
                "score": float(row["score"]) if row.get("score") else None,
                "existing_game_fit": row.get("existing_game_fit", "").strip() or None,
                "short_title": row.get("short_title", "").strip() or None,
            }
    return result


def catalogue_vocabulary(
    ontology: OntologyDocument,
    *,
    spatial_mechanics: frozenset[str] | None = None,
) -> CatalogueVocabulary:
    by_facet: dict[str, set[str]] = defaultdict(set)
    for skill in ontology.skills:
        by_facet[skill.facet].add(skill.skill_id)
    raw_tags = (ontology.model_extra or {}).get("non_mastery_tag_vocabularies", {})

    def tag_ids(name: str) -> frozenset[str]:
        values = raw_tags.get(name, []) if isinstance(raw_tags, dict) else []
        return frozenset(
            str(value["tag_id"])
            for value in values
            if isinstance(value, dict) and value.get("tag_id")
        )

    return CatalogueVocabulary(
        content_skill_ids=frozenset(by_facet["mathematical_content"]),
        reasoning_move_ids=frozenset(by_facet["reasoning_move"]),
        procedure_ids=frozenset(by_facet["procedure"]),
        representation_ids=tag_ids("representation"),
        cognitive_demand_ids=tag_ids("cognitive_demand"),
        nuisance_load_ids=tag_ids("nuisance_load"),
        spatial_mechanics=(
            spatial_mechanics
            if spatial_mechanics is not None
            else frozenset(LEGACY_SPATIAL_MECHANIC_MAP.values())
        ),
    )


def build_catalogue_inventory(
    *,
    source_path: Path,
    asset_root: Path | None = None,
    ontology_path: Path | None = None,
    legacy_spatial_path: Path | None = None,
) -> tuple[CatalogueRun, tuple[CatalogueInventoryItem, ...], CatalogueVocabulary]:
    """Read the complete canonical bank once and create derived inventory rows."""

    source_path = source_path.resolve()
    ontology_path = (ontology_path or default_ontology_path()).resolve()
    source_sha256_before = file_sha256(source_path)
    adapter = CompleteBankAdapter(source_path, asset_root=asset_root)
    source_bank_root = source_path.parent.parent.resolve()
    source_questions, _source_documents = adapter.snapshot()
    ontology = load_ontology(ontology_path)
    imported = tuple(
        import_question(question, asset_path=adapter.asset_path(question))
        for question in source_questions
    )
    asset_paths = {
        item.source.item_id: adapter.asset_path(item.source) for item in imported
    }
    duplicate_groups = exact_duplicate_groups(imported, asset_paths=asset_paths)
    duplicate_ids: dict[str, list[str]] = defaultdict(list)
    for group in duplicate_groups:
        group_id = (
            "dup-"
            + hashlib.sha256(
                f"{group.signature_type}:{group.signature}".encode("utf-8")
            ).hexdigest()[:24]
        )
        for item_id in group.item_ids:
            duplicate_ids[item_id].append(group_id)

    legacy_rows = _legacy_spatial_rows(
        legacy_spatial_path.resolve() if legacy_spatial_path is not None else None
    )
    matched_legacy_keys: set[tuple[str, str, int]] = set()
    answer_key_refs: dict[str, CatalogueAnswerKeyReference] = {}
    records: list[CatalogueInventoryItem] = []
    for inventory_order, item in enumerate(imported):
        proposal = propose_catalogue_classification(item, ontology)
        legacy_key = (
            item.source.source_path,
            item.source.grade_band,
            item.source.question_number,
        )
        legacy = legacy_rows.get(legacy_key)
        if legacy is not None:
            matched_legacy_keys.add(legacy_key)
        asset_path = asset_paths[item.source.item_id]
        asset_reference = _asset_reference(
            asset_id=item.source.asset_id,
            asset_path=asset_path,
            width=item.source.image_width,
            height=item.source.image_height,
        )
        answer_key_ref = None
        answer_source_file = item.protected.answer_source_file
        if answer_source_file is not None and answer_source_file.strip():
            answer_key_ref = answer_key_refs.get(answer_source_file)
            if answer_key_ref is None:
                answer_key_ref = _answer_key_reference(
                    answer_source_file,
                    source_bank_root=source_bank_root,
                    source_scope_root=adapter.source_scope_root,
                )
                if answer_key_ref is None:
                    raise AssertionError("nonblank answer-key reference disappeared")
                answer_key_refs[answer_source_file] = answer_key_ref
        proposal_payload = proposal.model_dump(mode="json")
        proposal_payload["legacy_spatial"] = legacy
        records.append(
            CatalogueInventoryItem(
                item_id=item.source.item_id,
                content_version=item.learner.content_version,
                inventory_order=inventory_order,
                source_metadata=CatalogueSourceMetadata(
                    source_collection=item.source.source_collection,
                    source_family=item.source.source_family,
                    year=item.source.year,
                    grade_band=item.source.grade_band,
                    paper_part=item.source.paper_part,
                    question_number=item.source.question_number,
                    page=item.source.page,
                    end_page=item.source.end_page,
                    language=item.source.language,
                    published_point_tier=item.learner.published_point_value_or_tier,
                    extraction_status=item.source.extraction_status,
                    crop_status=item.source.crop_status,
                ),
                answer_status=item.protected.answer_status,
                option_count=item.source.option_count,
                parser_status=item.learner.status.value,
                modality=item.modality,
                license_or_use_status=item.learner.license_or_use_status,
                warning_codes=item.warning_codes,
                content_gap_codes=item.content_gap_codes,
                duplicate_group_ids=tuple(sorted(duplicate_ids[item.source.item_id])),
                source_payload=item.source.model_dump(mode="json"),
                learner_payload=item.learner.model_dump(mode="json"),
                protected_payload=item.protected.model_dump(mode="json"),
                proposal_payload=proposal_payload,
                asset_refs=(asset_reference,),
                answer_key_ref=answer_key_ref,
            )
        )

    unmatched_legacy = set(legacy_rows) - matched_legacy_keys
    if unmatched_legacy:
        sample = sorted(unmatched_legacy)[:3]
        raise ValueError(
            f"legacy spatial review has {len(unmatched_legacy)} unmapped rows; sample={sample!r}"
        )
    source_sha256_after = file_sha256(source_path)
    if source_sha256_before != source_sha256_after:
        raise RuntimeError("source database changed while building the catalogue")

    for question, expected in zip(source_questions, records, strict=True):
        asset_path = adapter.asset_path(question)
        refreshed = import_question(question, asset_path=asset_path)
        if refreshed.learner.content_version != expected.content_version:
            raise RuntimeError("crop evidence changed while building the catalogue")
        current_reference = _asset_reference(
            asset_id=question.asset_id,
            asset_path=asset_path,
            width=question.image_width,
            height=question.image_height,
        )
        if expected.asset_refs != (current_reference,):
            raise RuntimeError("crop evidence changed while building the catalogue")

    for relative_ref, expected_answer_key in answer_key_refs.items():
        current = _answer_key_reference(
            relative_ref,
            source_bank_root=source_bank_root,
            source_scope_root=adapter.source_scope_root,
        )
        if current != expected_answer_key:
            raise RuntimeError(
                "answer-key evidence changed while building the catalogue"
            )

    snapshot_sha256 = catalogue_inventory_snapshot_sha256(records)
    versions = {
        "source_sha256": source_sha256_before,
        "snapshot_sha256": snapshot_sha256,
        "ontology_sha256": ontology_checksum(ontology_path),
        "proposal_version": CATALOGUE_CLASSIFIER_VERSION,
        "pipeline_version": CATALOGUE_PIPELINE_VERSION,
    }
    run_digest = hashlib.sha256(_canonical_json(versions).encode("utf-8")).hexdigest()
    run = CatalogueRun(
        run_id=f"catalogue-{run_digest[:24]}",
        created_at=datetime.now(timezone.utc),
        source_sha256=source_sha256_before,
        corpus_snapshot_sha256=snapshot_sha256,
        source_item_count=len(records),
        source_schema_version=CORPUS_ADAPTER_VERSION,
        ontology_version=ontology.ontology_version,
        ontology_sha256=ontology_checksum(ontology_path),
        proposal_version=CATALOGUE_CLASSIFIER_VERSION,
    )
    vocabulary = catalogue_vocabulary(ontology)
    return run, tuple(records), vocabulary


def catalogue_taxonomy_payload(ontology: OntologyDocument) -> dict[str, Any]:
    """Safe metadata-only taxonomy payload for the local dashboard."""

    controlled = catalogue_controlled_vocabularies(ontology)
    return {
        **controlled.model_dump(mode="json"),
        "ontology_status": ontology.status,
        "ontology_review_ready": ontology.review_ready,
        "relations": [
            relation.model_dump(mode="json") for relation in ontology.relations
        ],
    }


__all__ = [
    "CATALOGUE_PIPELINE_VERSION",
    "LEGACY_SPATIAL_MECHANIC_MAP",
    "build_catalogue_inventory",
    "catalogue_taxonomy_payload",
    "catalogue_vocabulary",
    "file_sha256",
]
