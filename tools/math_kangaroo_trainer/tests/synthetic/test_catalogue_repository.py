from __future__ import annotations

import hashlib
import json
import sqlite3
import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from math_kangaroo_trainer.curriculum.grade12_world import (
    GRADE12_WORLD_LAYOUT_VERSION,
    GRADE12_WORLD_ONTOLOGY_VERSION,
    grade12_world_ontology_checksum,
)
from math_kangaroo_trainer.domain.catalogue_reviews import (
    CatalogueAssetReference,
    CatalogueClassification,
    CatalogueDisposition,
    CatalogueFilters,
    CatalogueInventoryItem,
    CatalogueNeighborJudgement,
    CatalogueReviewConflict,
    CatalogueRun,
    CatalogueSkillJudgement,
    CatalogueSourceChecks,
    CatalogueSourceMetadata,
    CatalogueTeacherReview,
    CatalogueVocabulary,
    CatalogueWorldPlacementJudgement,
    GradeAppropriateness,
    NeighborJudgementValue,
    PrimaryDomain,
    QuestionType,
    TaxonomySkillDecision,
    TeacherDifficulty,
    WorldPlacementVerdict,
    catalogue_inventory_snapshot_sha256,
)
from math_kangaroo_trainer.storage.catalogue_repository import (
    CATALOGUE_DATABASE_SCHEMA_VERSION,
    CatalogueRepository,
    _migration_v1,
    _secure_catalogue_sqlite_files,
    migrate_catalogue_database,
    secure_catalogue_directory,
)


NOW = datetime(2026, 8, 5, 12, 0, tzinfo=timezone.utc)
SOURCE_SHA = "a" * 64
ONTOLOGY_SHA = "c" * 64


def content_version(character: str) -> str:
    return "sha256:" + character * 64


def run(*, item_count: int = 3) -> CatalogueRun:
    manifest = [
        [
            f"invented-item-{index}",
            content_version(str(index + 1)),
            [
                {
                    "asset_id": f"asset-{index}",
                    "status": "available",
                    "sha256": "d" * 64,
                    "bytes": 100 + index,
                }
            ],
            None,
        ]
        for index in range(item_count)
    ]
    snapshot_sha256 = hashlib.sha256(
        json.dumps(
            manifest,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return CatalogueRun(
        run_id="catalogue-test-run",
        created_at=NOW,
        source_sha256=SOURCE_SHA,
        corpus_snapshot_sha256=snapshot_sha256,
        source_item_count=item_count,
        source_schema_version="complete-bank.v2",
        ontology_version="ontology.test.v1",
        ontology_sha256=ONTOLOGY_SHA,
        proposal_version="proposal.test.v1",
    )


def item(
    index: int,
    *,
    version_character: str | None = None,
    license_status: str = "private-research-only",
    point_tier: int | None = None,
) -> CatalogueInventoryItem:
    marker = version_character or str(index + 1)
    return CatalogueInventoryItem(
        item_id=f"invented-item-{index}",
        content_version=content_version(marker),
        inventory_order=index,
        source_metadata=CatalogueSourceMetadata(
            source_collection="invented",
            source_family="Invented A" if index < 2 else "Invented B",
            year=2020 + index,
            grade_band="1-2" if index < 2 else "3-4",
            paper_part="single",
            question_number=index + 1,
            page=1,
            end_page=1,
            language="en",
            published_point_tier=point_tier,
            extraction_status="indexed_complete_text",
            crop_status="indexed",
        ),
        answer_status="official-verified",
        option_count=2 if index == 2 else 5,
        parser_status="parsed",
        modality="text_extractable",
        license_or_use_status=license_status,
        warning_codes=("INVENTED_WARNING",) if index == 1 else (),
        content_gap_codes=(
            ("INVENTED_GAP", "OFFICIAL_SOLUTION_NOT_AVAILABLE") if index == 2 else ()
        ),
        duplicate_group_ids=("invented-duplicate",) if index == 1 else (),
        source_payload={
            "prompt_text": f"PRIVATE STEM SENTINEL {index}",
            "options": ["PRIVATE CHOICE SENTINEL"],
        },
        learner_payload={"stem_markdown": f"Searchable private stem {index}"},
        protected_payload={"official_answer": "PRIVATE ANSWER SENTINEL"},
        proposal_payload={
            "item_id": f"invented-item-{index}",
            "content_version": content_version(marker),
            "ontology_version": "ontology.test.v1",
            "classifier_version": "proposal.test.v1",
            "status": "proposed",
            "authoritative": False,
            "primary_domain": (
                "geometry_spatial"
                if index == 0
                else "number_arithmetic"
                if index == 1
                else "unknown"
            ),
            "question_type": (
                "spatial_visual"
                if index == 0
                else "word_problem"
                if index == 1
                else "unknown"
            ),
            "private_rationale": "PRIVATE PROPOSAL SENTINEL",
        },
        asset_refs=(
            CatalogueAssetReference(
                asset_id=f"asset-{index}",
                local_ref=f"/private/PDF-PATH-SENTINEL/item-{index}.webp",
                media_type="image/webp",
                sha256="d" * 64,
                bytes=100 + index,
                width=100,
                height=80,
                status="available",
            ),
        ),
    )


def vocabulary() -> CatalogueVocabulary:
    return CatalogueVocabulary(
        content_skill_ids=frozenset({"content-count"}),
        reasoning_move_ids=frozenset({"reason-eliminate"}),
        procedure_ids=frozenset({"procedure-table"}),
        representation_ids=frozenset({"rep-story"}),
        cognitive_demand_ids=frozenset({"demand-direct"}),
        nuisance_load_ids=frozenset({"load-reading-low"}),
        spatial_mechanics=frozenset({"assembly"}),
    )


def classification() -> CatalogueClassification:
    return CatalogueClassification(
        primary_domain=PrimaryDomain.NUMBER_ARITHMETIC,
        question_type=QuestionType.WORD_PROBLEM,
        content_skill_ids=("content-count",),
        reasoning_move_ids=("reason-eliminate",),
        procedure_ids=("procedure-table",),
        representation_ids=("rep-story",),
        cognitive_demand_id="demand-direct",
        nuisance_load_ids=("load-reading-low",),
        grade_appropriateness=GradeAppropriateness.APPROPRIATE,
        teacher_difficulty=TeacherDifficulty.STARTER,
    )


def review(
    *,
    item_record: CatalogueInventoryItem,
    reviewer_id: str = "teacher-one",
    reviewed_at: datetime = NOW,
    notes: str = "PRIVATE REVIEW NOTE SENTINEL",
) -> CatalogueTeacherReview:
    return CatalogueTeacherReview(
        run_id="catalogue-test-run",
        item_id=item_record.item_id,
        content_version=item_record.content_version,
        reviewer_id=reviewer_id,
        source_checks=CatalogueSourceChecks(
            question_boundary_verified=True,
            choices_verified=True,
            answer_evidence_verified=True,
            diagram_verified=True,
            source_metadata_verified=True,
        ),
        disposition=CatalogueDisposition.FAITHFUL,
        classification=classification(),
        curriculum_approved=True,
        release_asset_approved=True,
        duplicate_resolved=True,
        notes=notes,
        reviewed_at=reviewed_at,
    )


def world_placement(
    *,
    item_record: CatalogueInventoryItem,
    verdict: WorldPlacementVerdict = WorldPlacementVerdict.FITS,
    presented_realm_id: str | None = "number_arithmetic",
    presented_district_id: str | None = "count_compare",
    selected_realm_id: str | None = "number_arithmetic",
    selected_district_id: str | None = "count_compare",
    prior_event_id: str | None = None,
    reviewed_at: datetime = NOW,
    notes: str = "PRIVATE WORLD PLACEMENT NOTE SENTINEL",
) -> CatalogueWorldPlacementJudgement:
    return CatalogueWorldPlacementJudgement(
        run_id="catalogue-test-run",
        item_id=item_record.item_id,
        content_version=item_record.content_version,
        ontology_version=GRADE12_WORLD_ONTOLOGY_VERSION,
        ontology_sha256=grade12_world_ontology_checksum(),
        layout_version=GRADE12_WORLD_LAYOUT_VERSION,
        presented_realm_id=presented_realm_id,
        presented_district_id=presented_district_id,
        selected_realm_id=selected_realm_id,
        selected_district_id=selected_district_id,
        verdict=verdict,
        reviewer_id="teacher-one",
        prior_event_id=prior_event_id,
        notes=notes,
        reviewed_at=reviewed_at,
    )


@pytest.fixture()
def repository(
    tmp_path: Path,
) -> tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]]:
    database = tmp_path / "catalogue.sqlite3"
    migrate_catalogue_database(database, allow_create=True)
    repo = CatalogueRepository(database, vocabulary=vocabulary())
    records = tuple(item(index) for index in range(3))
    repo.upsert_run(run())
    assert repo.upsert_items(run().run_id, records) == 3
    try:
        yield repo, records
    finally:
        repo.close()


def test_catalogue_migration_refuses_stage0_database(tmp_path: Path) -> None:
    stage0 = tmp_path / "stage0.sqlite3"
    with sqlite3.connect(stage0) as connection:
        connection.execute("CREATE TABLE audit_runs(run_id TEXT PRIMARY KEY)")

    with pytest.raises(ValueError, match="not a whole-corpus catalogue store"):
        migrate_catalogue_database(stage0, allow_create=True)

    with sqlite3.connect(stage0) as connection:
        assert (
            connection.execute(
                "SELECT name FROM sqlite_master WHERE name='catalogue_schema'"
            ).fetchone()
            is None
        )


def test_catalogue_sqlite_hardening_restricts_database_and_wal_sidecars(
    tmp_path: Path,
) -> None:
    database = tmp_path / "catalogue.sqlite3"
    database.write_bytes(b"invented database")
    wal = Path(f"{database}-wal")
    shm = Path(f"{database}-shm")
    wal.write_bytes(b"invented stale wal")
    shm.write_bytes(b"invented stale shm")
    database.chmod(0o644)
    wal.chmod(0o644)
    shm.chmod(0o666)

    _secure_catalogue_sqlite_files(database)

    assert stat.S_IMODE(database.stat().st_mode) == 0o600
    assert stat.S_IMODE(wal.stat().st_mode) == 0o600
    assert stat.S_IMODE(shm.stat().st_mode) == 0o600


def test_catalogue_migration_leaves_no_permissive_sqlite_sidecars(
    tmp_path: Path,
) -> None:
    database = tmp_path / "catalogue.sqlite3"
    migrate_catalogue_database(database, allow_create=True)
    database.chmod(0o644)
    wal = Path(f"{database}-wal")
    shm = Path(f"{database}-shm")
    wal.write_bytes(b"invented stale wal")
    shm.write_bytes(b"invented stale shm")
    wal.chmod(0o644)
    shm.chmod(0o666)

    migrate_catalogue_database(database)

    assert stat.S_IMODE(database.stat().st_mode) == 0o600
    for sidecar in (wal, shm):
        # SQLite may delete invalid stale sidecars while opening the database;
        # if it retains one, the migration must leave it private.
        assert not sidecar.exists() or stat.S_IMODE(sidecar.stat().st_mode) == 0o600


def test_catalogue_database_symlink_is_rejected_without_chmodding_target(
    tmp_path: Path,
) -> None:
    catalogue_directory = tmp_path / "catalogue"
    catalogue_directory.mkdir()
    outside = tmp_path / "outside.sqlite3"
    outside.write_bytes(b"not a catalogue")
    outside.chmod(0o644)
    database_link = catalogue_directory / "catalogue.sqlite3"
    database_link.symlink_to(outside)

    with pytest.raises(ValueError, match="database must not be a symlink"):
        migrate_catalogue_database(
            database_link,
            allow_create=True,
            catalogue_directory=catalogue_directory,
        )

    assert outside.read_bytes() == b"not a catalogue"
    assert stat.S_IMODE(outside.stat().st_mode) == 0o644


def test_catalogue_database_must_remain_inside_explicit_private_directory(
    tmp_path: Path,
) -> None:
    catalogue_directory = tmp_path / "catalogue"
    catalogue_directory.mkdir()
    outside = tmp_path / "outside.sqlite3"

    with pytest.raises(ValueError, match="direct child"):
        migrate_catalogue_database(
            outside,
            allow_create=True,
            catalogue_directory=catalogue_directory,
        )

    assert not outside.exists()


def test_private_catalogue_directory_itself_must_not_be_a_symlink(
    tmp_path: Path,
) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    outside.chmod(0o755)
    directory_link = tmp_path / "catalogue"
    directory_link.symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="output must not be a symlink"):
        secure_catalogue_directory(directory_link)

    assert stat.S_IMODE(outside.stat().st_mode) == 0o755


def test_asset_snapshot_requires_integrity_and_binds_missing_state() -> None:
    with pytest.raises(ValidationError, match="require sha256 and bytes"):
        CatalogueAssetReference(
            asset_id="asset",
            local_ref="/private/asset.webp",
            sha256="d" * 64,
            status="available",
        )
    with pytest.raises(ValidationError, match="cannot claim sha256 or bytes"):
        CatalogueAssetReference(
            asset_id="asset",
            local_ref="/private/asset.webp",
            sha256="d" * 64,
            bytes=10,
            status="missing",
        )

    available = item(0)
    missing = available.model_copy(
        update={
            "asset_refs": (
                available.asset_refs[0].model_copy(
                    update={"sha256": None, "bytes": None, "status": "missing"}
                ),
            )
        }
    )
    assert catalogue_inventory_snapshot_sha256((available,)) != (
        catalogue_inventory_snapshot_sha256((missing,))
    )


def test_catalogue_repository_creates_private_wal_sidecars(tmp_path: Path) -> None:
    database = tmp_path / "catalogue.sqlite3"
    migrate_catalogue_database(database, allow_create=True)
    repo = CatalogueRepository(database)
    try:
        repo.upsert_run(run())
        artifacts = (
            database,
            Path(f"{database}-wal"),
            Path(f"{database}-shm"),
        )
        assert all(path.is_file() for path in artifacts)
        assert all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in artifacts)
    finally:
        repo.close()


def test_catalogue_schema_creation_is_one_atomic_transaction(tmp_path: Path) -> None:
    database = tmp_path / "rolled-back-catalogue.sqlite3"
    with sqlite3.connect(database) as connection:
        _migration_v1(connection)
        assert connection.in_transaction is True
        connection.rollback()
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
    assert tables == set()


def test_catalogue_schema_one_migrates_answer_key_integrity_column(
    tmp_path: Path,
) -> None:
    database = tmp_path / "catalogue-v1.sqlite3"
    migrate_catalogue_database(database, allow_create=True)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "ALTER TABLE catalogue_items DROP COLUMN answer_key_ref_json"
        )
        connection.execute("UPDATE catalogue_schema SET version=1 WHERE singleton=1")

    migrate_catalogue_database(database)
    with sqlite3.connect(database) as connection:
        version = connection.execute(
            "SELECT version FROM catalogue_schema WHERE singleton=1"
        ).fetchone()[0]
        columns = {
            row[1] for row in connection.execute("PRAGMA table_info(catalogue_items)")
        }
    assert version == CATALOGUE_DATABASE_SCHEMA_VERSION
    assert "answer_key_ref_json" in columns


def test_catalogue_schema_two_migrates_world_placement_history(
    tmp_path: Path,
) -> None:
    database = tmp_path / "catalogue-v2.sqlite3"
    migrate_catalogue_database(database, allow_create=True)
    with sqlite3.connect(database) as connection:
        connection.execute("DROP TABLE catalogue_world_placement_judgements")
        connection.execute("DROP TABLE catalogue_world_placement_history")
        connection.execute("UPDATE catalogue_schema SET version=2 WHERE singleton=1")

    migrate_catalogue_database(database)
    with sqlite3.connect(database) as connection:
        version = connection.execute(
            "SELECT version FROM catalogue_schema WHERE singleton=1"
        ).fetchone()[0]
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
    assert version == CATALOGUE_DATABASE_SCHEMA_VERSION
    assert "catalogue_world_placement_judgements" in tables
    assert "catalogue_world_placement_history" in tables


def test_complete_inventory_must_match_run_snapshot(tmp_path: Path) -> None:
    database = tmp_path / "snapshot-mismatch.sqlite3"
    migrate_catalogue_database(database, allow_create=True)
    wrong_run = run().model_copy(update={"corpus_snapshot_sha256": "e" * 64})
    records = tuple(item(index) for index in range(3))
    with CatalogueRepository(database, vocabulary=vocabulary()) as repo:
        repo.upsert_run(wrong_run)
        with pytest.raises(ValueError, match="snapshot hash"):
            repo.upsert_items(wrong_run.run_id, records)
        assert repo.summary(wrong_run.run_id).inventory_items == 0


def test_catalogue_schema_inventory_pagination_filters_and_private_search(
    repository: tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]],
) -> None:
    repo, _ = repository
    with sqlite3.connect(repo.database_path) as connection:
        assert (
            connection.execute(
                "SELECT version FROM catalogue_schema WHERE singleton=1"
            ).fetchone()[0]
            == CATALOGUE_DATABASE_SCHEMA_VERSION
        )

    assert repo.latest_run_id() == "catalogue-test-run"
    summary = repo.summary("catalogue-test-run")
    assert summary.inventory_complete is True
    assert summary.inventory_items == 3
    assert summary.facets["grade_band"] == {"1-2": 2, "3-4": 1}
    assert summary.proposal_available_items == 3
    assert summary.proposal_classified_items == 2
    assert summary.teacher_classified_items == 0
    assert summary.facets["classification_source"] == {"proposal": 3}
    assert summary.facets["primary_domain"] == {
        "geometry_spatial": 1,
        "number_arithmetic": 1,
        "unknown": 1,
    }
    assert summary.facets["reviewed_primary_domain"] == {"unclassified": 3}

    page = repo.list_items("catalogue-test-run", offset=1, limit=1)
    assert page.total == 3
    assert [entry.item_id for entry in page.items] == ["invented-item-1"]
    assert not hasattr(page.items[0], "source_payload")

    filtered = repo.list_items(
        "catalogue-test-run",
        filters=CatalogueFilters(
            source_family="Invented A",
            published_point_tier="unknown",
            has_warnings=True,
        ),
    )
    assert [entry.item_id for entry in filtered.items] == ["invented-item-1"]

    searched = repo.list_items(
        "catalogue-test-run",
        filters=CatalogueFilters(query="searchable private stem 2"),
    )
    assert [entry.item_id for entry in searched.items] == ["invented-item-2"]
    injection = repo.list_items(
        "catalogue-test-run",
        filters=CatalogueFilters(query="%' OR 1=1 --"),
    )
    assert injection.total == 0

    with pytest.raises(ValueError, match="between 1 and 100"):
        repo.list_items("catalogue-test-run", limit=101)


def test_filters_use_teacher_labels_then_fall_back_to_proposals(
    repository: tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]],
) -> None:
    repo, records = repository
    proposed = repo.list_items(
        "catalogue-test-run",
        filters=CatalogueFilters(
            primary_domain=PrimaryDomain.GEOMETRY_SPATIAL,
            question_type=QuestionType.SPATIAL_VISUAL,
        ),
    )
    assert [entry.item_id for entry in proposed.items] == ["invented-item-0"]
    assert proposed.items[0].classification_source == "proposal"
    assert proposed.items[0].primary_domain is None
    assert proposed.items[0].proposed_primary_domain is PrimaryDomain.GEOMETRY_SPATIAL

    numeric_false_payload = dict(records[2].proposal_payload)
    numeric_false_payload["authoritative"] = 0
    with sqlite3.connect(repo.database_path) as connection:
        connection.execute(
            """
            UPDATE catalogue_items SET proposal_payload_json=?
            WHERE run_id=? AND item_id=?
            """,
            (
                json.dumps(numeric_false_payload, sort_keys=True),
                "catalogue-test-run",
                records[2].item_id,
            ),
        )
    numeric_false = next(
        entry
        for entry in repo.list_items("catalogue-test-run").items
        if entry.item_id == records[2].item_id
    )
    assert numeric_false.classification_source == "none"

    stale_proposal_payload = dict(records[2].proposal_payload)
    stale_proposal_payload["content_version"] = content_version("e")
    with sqlite3.connect(repo.database_path) as connection:
        connection.execute(
            """
            UPDATE catalogue_items SET proposal_payload_json=?
            WHERE run_id=? AND item_id=?
            """,
            (
                json.dumps(stale_proposal_payload, sort_keys=True),
                "catalogue-test-run",
                records[2].item_id,
            ),
        )
    unbound = next(
        entry
        for entry in repo.list_items("catalogue-test-run").items
        if entry.item_id == records[2].item_id
    )
    assert unbound.classification_source == "none"
    assert unbound.proposed_primary_domain is None

    repo.save_review(review(item_record=records[0]), expected_revision=0)
    replaced = repo.list_items(
        "catalogue-test-run",
        filters=CatalogueFilters(primary_domain=PrimaryDomain.NUMBER_ARITHMETIC),
    )
    assert [entry.item_id for entry in replaced.items] == [
        "invented-item-0",
        "invented-item-1",
    ]
    reviewed = replaced.items[0]
    assert reviewed.classification_source == "teacher_review"
    assert reviewed.primary_domain is PrimaryDomain.NUMBER_ARITHMETIC
    assert reviewed.proposed_primary_domain is PrimaryDomain.GEOMETRY_SPATIAL

    no_longer_effective = repo.list_items(
        "catalogue-test-run",
        filters=CatalogueFilters(primary_domain=PrimaryDomain.GEOMETRY_SPATIAL),
    )
    assert no_longer_effective.total == 0


def test_review_contract_and_vocabulary_are_strict() -> None:
    source_item = item(0)
    unresolved_taxonomy = CatalogueClassification(
        primary_domain=PrimaryDomain.NUMBER_ARITHMETIC,
        question_type=QuestionType.WORD_PROBLEM,
    )
    source_only_review = CatalogueTeacherReview(
        **{
            **review(item_record=source_item).model_dump(),
            "classification": unresolved_taxonomy.model_dump(),
            "curriculum_approved": False,
        }
    )
    assert source_only_review.classification.cognitive_demand_id is None
    with pytest.raises(ValidationError, match="cognitive demand"):
        CatalogueTeacherReview(
            **{
                **source_only_review.model_dump(),
                "curriculum_approved": True,
            }
        )

    no_skill_classification = classification().model_copy(
        update={
            "content_skill_ids": (),
            "reasoning_move_ids": (),
            "procedure_ids": (),
        }
    )
    with pytest.raises(ValidationError, match="at least one ontology skill"):
        CatalogueTeacherReview(
            **{
                **review(item_record=source_item).model_dump(),
                "classification": no_skill_classification.model_dump(),
            }
        )

    with pytest.raises(ValidationError, match="every source check"):
        CatalogueTeacherReview(
            **{
                **review(item_record=source_item).model_dump(),
                "source_checks": {
                    "question_boundary_verified": True,
                    "choices_verified": False,
                    "answer_evidence_verified": True,
                    "diagram_verified": True,
                    "source_metadata_verified": True,
                },
            }
        )

    with pytest.raises(ValidationError, match="surrounding whitespace"):
        CatalogueTeacherReview(
            **{
                **review(item_record=source_item).model_dump(),
                "reviewer_id": " teacher-one",
            }
        )

    invalid = classification().model_copy(
        update={"content_skill_ids": ("unknown-content",)}
    )
    with pytest.raises(ValueError, match="unknown content_skill_ids"):
        vocabulary().validate_classification(invalid)


@pytest.mark.parametrize(
    "grade_appropriateness",
    (
        GradeAppropriateness.TOO_EASY,
        GradeAppropriateness.TOO_HARD,
        GradeAppropriateness.UNCERTAIN,
    ),
)
def test_curriculum_approval_requires_appropriate_grade(
    grade_appropriateness: GradeAppropriateness,
) -> None:
    source_item = item(0)
    nonappropriate = classification().model_copy(
        update={"grade_appropriateness": grade_appropriateness}
    )

    with pytest.raises(
        ValidationError,
        match="grade appropriateness to be appropriate",
    ):
        CatalogueTeacherReview(
            **{
                **review(item_record=source_item).model_dump(),
                "classification": nonappropriate.model_dump(),
            }
        )


def test_append_only_review_revisions_etags_and_stale_content(
    repository: tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]],
) -> None:
    repo, records = repository
    first = repo.save_review(review(item_record=records[0]), expected_revision=0)
    assert first.revision == 1
    assert repo.current_review("catalogue-test-run", records[0].item_id) == first

    with pytest.raises(CatalogueReviewConflict, match="current revision is 1"):
        repo.save_review(
            review(item_record=records[0], reviewed_at=NOW + timedelta(minutes=1)),
            expected_revision=0,
        )

    second_review = review(
        item_record=records[0],
        reviewer_id="teacher-two",
        reviewed_at=NOW + timedelta(minutes=2),
    )
    second = repo.save_review(
        second_review,
        expected_revision=1,
        expected_etag=first.etag,
    )
    assert second.revision == 2
    assert [
        record.review.reviewer_id
        for record in repo.review_history("catalogue-test-run", records[0].item_id)
    ] == ["teacher-one", "teacher-two"]

    replacement = item(0, version_character="f")
    assert repo.upsert_items("catalogue-test-run", (records[0],)) == 1
    with pytest.raises(ValueError, match="immutable within a run"):
        repo.upsert_items("catalogue-test-run", (replacement,))

    # Simulate a stale row from a legacy/corrupt store. The supported repository
    # API above must never create this state, but reads remain conservative.
    with sqlite3.connect(repo.database_path) as connection:
        connection.execute(
            """
            UPDATE catalogue_items
            SET content_version=?, proposal_payload_json=?
            WHERE run_id=? AND item_id=?
            """,
            (
                replacement.content_version,
                json.dumps(replacement.proposal_payload, sort_keys=True),
                "catalogue-test-run",
                replacement.item_id,
            ),
        )
    detail = repo.item("catalogue-test-run", replacement.item_id)
    assert detail is not None
    assert "TEACHER_REVIEW_STALE" in detail.promotion.curriculum_blockers
    stale_summary = repo.list_items(
        "catalogue-test-run",
        filters=CatalogueFilters(primary_domain=PrimaryDomain.GEOMETRY_SPATIAL),
    ).items[0]
    assert stale_summary.review_state == "stale"
    assert stale_summary.classification_source == "proposal"
    assert stale_summary.primary_domain is PrimaryDomain.NUMBER_ARITHMETIC
    assert stale_summary.effective_primary_domain is PrimaryDomain.GEOMETRY_SPATIAL
    with pytest.raises(ValueError, match="stale or incorrect"):
        repo.save_review(second_review, expected_revision=2)


def test_curriculum_readiness_does_not_override_private_release_block(
    repository: tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]],
) -> None:
    repo, records = repository
    repo.save_review(review(item_record=records[0]), expected_revision=0)
    detail = repo.item("catalogue-test-run", records[0].item_id)
    assert detail is not None
    assert detail.promotion.curriculum_ready is True
    assert detail.promotion.public_eligible is False
    assert "PRIVATE_RESEARCH_ONLY" in detail.promotion.public_blockers


@pytest.mark.parametrize(
    ("grade_appropriateness", "expected_blocker"),
    (
        (
            GradeAppropriateness.TOO_EASY,
            "GRADE_APPROPRIATENESS_TOO_EASY",
        ),
        (
            GradeAppropriateness.TOO_HARD,
            "GRADE_APPROPRIATENESS_TOO_HARD",
        ),
        (
            GradeAppropriateness.UNCERTAIN,
            "GRADE_APPROPRIATENESS_UNCERTAIN",
        ),
    ),
)
def test_nonappropriate_grade_blocks_curriculum_and_public_promotion(
    repository: tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]],
    grade_appropriateness: GradeAppropriateness,
    expected_blocker: str,
) -> None:
    repo, records = repository
    nonappropriate = classification().model_copy(
        update={"grade_appropriateness": grade_appropriateness}
    )
    teacher_review = CatalogueTeacherReview(
        **{
            **review(item_record=records[0]).model_dump(),
            "classification": nonappropriate.model_dump(),
            "curriculum_approved": False,
        }
    )
    repo.save_review(teacher_review, expected_revision=0)

    detail = repo.item("catalogue-test-run", records[0].item_id)
    assert detail is not None
    assert detail.promotion.curriculum_ready is False
    assert detail.promotion.public_eligible is False
    assert expected_blocker in detail.promotion.curriculum_blockers
    assert expected_blocker in detail.promotion.public_blockers


def test_solution_path_and_playable_choices_are_independent_promotion_gates(
    repository: tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]],
) -> None:
    repo, records = repository
    incomplete = records[2]
    repo.save_review(review(item_record=incomplete), expected_revision=0)

    detail = repo.item("catalogue-test-run", incomplete.item_id)
    assert detail is not None
    assert detail.promotion.curriculum_ready is False
    assert "SOLUTION_PATH_REVIEW_REQUIRED" in detail.promotion.curriculum_blockers
    assert "PLAYABLE_CHOICES_REQUIRED" in detail.promotion.public_blockers


def test_catalogue_duplicate_checkbox_cannot_clear_independent_gate(
    repository: tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]],
) -> None:
    repo, records = repository
    duplicate = records[1]
    assert review(item_record=duplicate).duplicate_resolved is True
    repo.save_review(review(item_record=duplicate), expected_revision=0)

    detail = repo.item("catalogue-test-run", duplicate.item_id)
    assert detail is not None
    assert "DUPLICATE_REVIEW_UNRESOLVED" in detail.promotion.public_blockers


def test_neighbor_and_skill_judgements_are_append_only_and_advisory(
    repository: tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]],
) -> None:
    repo, records = repository
    neighbor = CatalogueNeighborJudgement(
        run_id="catalogue-test-run",
        anchor_id=records[0].item_id,
        anchor_content_version=records[0].content_version,
        neighbor_id=records[1].item_id,
        neighbor_content_version=records[1].content_version,
        retrieval_version="retrieval.test.v1",
        retrieval_view="strategy-neighbors",
        reviewer_id="teacher-one",
        judgement=NeighborJudgementValue.SAME_STRATEGY,
        notes="PRIVATE NEIGHBOR NOTE SENTINEL",
        reviewed_at=NOW,
    )
    saved_neighbor = repo.save_neighbor_judgement(neighbor, expected_revision=0)
    assert saved_neighbor.revision == 1
    assert (
        repo.current_neighbor_judgement(
            neighbor.run_id,
            neighbor.anchor_id,
            neighbor.neighbor_id,
            neighbor.retrieval_version,
            neighbor.retrieval_view,
        )
        == saved_neighbor
    )
    with pytest.raises(CatalogueReviewConflict):
        repo.save_neighbor_judgement(neighbor, expected_revision=0)

    skill = CatalogueSkillJudgement(
        run_id="catalogue-test-run",
        skill_id="content-count",
        ontology_version="ontology.test.v1",
        ontology_sha256=ONTOLOGY_SHA,
        reviewer_id="teacher-one",
        decision=TaxonomySkillDecision.REVISE,
        proposed_name="Counting carefully",
        proposed_description="Clarify the count-once boundary.",
        notes="PRIVATE SKILL NOTE SENTINEL",
        reviewed_at=NOW,
    )
    saved_skill = repo.save_skill_judgement(skill, expected_revision=0)
    assert saved_skill.revision == 1
    assert repo.list_skill_judgements("catalogue-test-run") == (saved_skill,)
    assert not hasattr(saved_skill.judgement, "ontology_approved")


def test_world_placement_judgements_are_reversible_versioned_advisory_evidence(
    repository: tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]],
) -> None:
    repo, records = repository
    first = repo.save_world_placement_judgement(
        world_placement(item_record=records[0]),
        expected_revision=0,
    )
    assert first.revision == 1
    assert (
        repo.current_world_placement_judgement("catalogue-test-run", records[0].item_id)
        == first
    )

    with pytest.raises(CatalogueReviewConflict, match="current revision is 1"):
        repo.save_world_placement_judgement(
            world_placement(item_record=records[0]),
            expected_revision=0,
        )

    changed_judgement = world_placement(
        item_record=records[0],
        verdict=WorldPlacementVerdict.CHANGE,
        selected_district_id="join_separate",
        prior_event_id=first.event_id,
        reviewed_at=NOW + timedelta(minutes=1),
    )
    changed = repo.save_world_placement_judgement(
        changed_judgement,
        expected_revision=1,
        expected_etag=first.etag,
    )
    assert changed.revision == 2

    unsure_judgement = world_placement(
        item_record=records[0],
        verdict=WorldPlacementVerdict.UNSURE,
        selected_realm_id=None,
        selected_district_id=None,
        prior_event_id=changed.event_id,
        reviewed_at=NOW + timedelta(minutes=2),
    )
    unsure = repo.save_world_placement_judgement(
        unsure_judgement,
        expected_revision=2,
        expected_etag=changed.etag,
    )
    assert unsure.revision == 3
    history = repo.world_placement_judgement_history(
        "catalogue-test-run", records[0].item_id
    )
    assert [entry.judgement.verdict for entry in history] == [
        WorldPlacementVerdict.FITS,
        WorldPlacementVerdict.CHANGE,
        WorldPlacementVerdict.UNSURE,
    ]
    assert [entry.judgement.prior_event_id for entry in history] == [
        None,
        first.event_id,
        changed.event_id,
    ]

    # The UI's Heaven queue is represented by a null presented pair. A teacher
    # can move that item only to a real, validated curricular location.
    from_heaven = world_placement(
        item_record=records[1],
        verdict=WorldPlacementVerdict.CHANGE,
        presented_realm_id=None,
        presented_district_id=None,
        selected_realm_id="geometry_spatial",
        selected_district_id="position_direction",
    )
    saved_from_heaven = repo.save_world_placement_judgement(
        from_heaven,
        expected_revision=0,
    )
    assert saved_from_heaven.judgement.presented_realm_id is None
    assert saved_from_heaven.judgement.selected_realm_id == "geometry_spatial"

    detail = repo.item("catalogue-test-run", records[0].item_id)
    assert detail is not None
    assert detail.current_review is None
    assert "TEACHER_REVIEW_MISSING" in detail.promotion.curriculum_blockers

    invalid_heaven = world_placement(
        item_record=records[1],
        presented_realm_id="heaven",
        presented_district_id="count_compare",
        selected_realm_id="heaven",
        selected_district_id="count_compare",
    )
    with pytest.raises(ValueError, match="invalid Grades 1–2 presented"):
        repo.save_world_placement_judgement(invalid_heaven, expected_revision=1)

    with pytest.raises(ValueError, match="only for Grades 1–2"):
        repo.save_world_placement_judgement(
            world_placement(item_record=records[2]),
            expected_revision=0,
        )

    stale = world_placement(item_record=records[1]).model_copy(
        update={"content_version": content_version("f")}
    )
    with pytest.raises(ValueError, match="content version is stale"):
        repo.save_world_placement_judgement(stale, expected_revision=1)


def test_evidence_export_is_structurally_unable_to_emit_private_content(
    repository: tuple[CatalogueRepository, tuple[CatalogueInventoryItem, ...]],
) -> None:
    repo, records = repository
    repo.save_review(review(item_record=records[0]), expected_revision=0)
    neighbor = CatalogueNeighborJudgement(
        run_id="catalogue-test-run",
        anchor_id=records[0].item_id,
        anchor_content_version=records[0].content_version,
        neighbor_id=records[1].item_id,
        neighbor_content_version=records[1].content_version,
        retrieval_version="retrieval.test.v1",
        retrieval_view="all",
        reviewer_id="teacher-one",
        judgement=NeighborJudgementValue.UNRELATED,
        notes="PRIVATE NEIGHBOR NOTE SENTINEL",
        reviewed_at=NOW,
    )
    repo.save_neighbor_judgement(neighbor, expected_revision=0)
    skill = CatalogueSkillJudgement(
        run_id="catalogue-test-run",
        skill_id="content-count",
        ontology_version="ontology.test.v1",
        ontology_sha256=ONTOLOGY_SHA,
        reviewer_id="teacher-one",
        decision=TaxonomySkillDecision.REVISE,
        proposed_description=(
            "Boundary line one.\nPRIVATE SKILL PROPOSAL SENTINEL on line two."
        ),
        notes="PRIVATE SKILL NOTE SENTINEL",
        reviewed_at=NOW,
    )
    repo.save_skill_judgement(skill, expected_revision=0)
    placement = world_placement(item_record=records[0])
    repo.save_world_placement_judgement(placement, expected_revision=0)

    payload = repo.export_evidence("catalogue-test-run")
    encoded = json.dumps(payload, sort_keys=True)
    assert len(payload["inventory"]) == 3
    assert len(payload["reviews"]) == 1
    assert len(payload["neighbor_judgements"]) == 1
    assert len(payload["skill_judgements"]) == 1
    assert len(payload["world_placement_judgements"]) == 1
    assert payload["schema_version"] == "catalogue-evidence-export.v2"
    assert payload["world_placement_judgements"][0]["verdict"] == "fits"
    assert payload["world_placement_judgements"][0]["selected_district_id"] == (
        "count_compare"
    )
    for forbidden in (
        "PRIVATE STEM SENTINEL",
        "PRIVATE CHOICE SENTINEL",
        "PRIVATE ANSWER SENTINEL",
        "PDF-PATH-SENTINEL",
        "PRIVATE PROPOSAL SENTINEL",
        "PRIVATE REVIEW NOTE SENTINEL",
        "PRIVATE NEIGHBOR NOTE SENTINEL",
        "PRIVATE SKILL NOTE SENTINEL",
        "PRIVATE SKILL PROPOSAL SENTINEL",
        "PRIVATE WORLD PLACEMENT NOTE SENTINEL",
        "source_payload",
        "learner_payload",
        "protected_payload",
        "proposal_payload",
        "asset_refs",
    ):
        assert forbidden not in encoded
    assert "proposed_name" not in payload["skill_judgements"][0]
    assert "proposed_description" not in payload["skill_judgements"][0]
