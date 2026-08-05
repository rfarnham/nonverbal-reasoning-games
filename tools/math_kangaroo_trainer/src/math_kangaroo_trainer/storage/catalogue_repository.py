"""Separate SQLite persistence for whole-corpus catalogue review.

The catalogue database is intentionally not an Alembic revision of the Stage
0 audit database.  It has its own marker, schema version, inventory snapshots,
and append-only review histories so catalogue work cannot mutate or be
mistaken for independent gold-sample evidence.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import stat
import threading
from collections import Counter
from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, TypeAlias
from urllib.parse import quote

from pydantic import BaseModel
from pydantic_core import to_jsonable_python

from math_kangaroo_trainer.domain.catalogue_reviews import (
    CATALOGUE_EVIDENCE_EXPORT_VERSION,
    CatalogueEvidenceExport,
    CatalogueEvidenceItem,
    CatalogueFilters,
    CatalogueInventoryItem,
    CatalogueItemRecord,
    CatalogueItemSummary,
    CatalogueNeighborEvidence,
    CatalogueNeighborJudgement,
    CatalogueNeighborRecord,
    CataloguePage,
    CatalogueReviewConflict,
    CatalogueReviewEvidence,
    CatalogueReviewRecord,
    CatalogueRun,
    CatalogueSkillJudgement,
    CatalogueSkillJudgementEvidence,
    CatalogueSkillJudgementRecord,
    CatalogueSummary,
    CatalogueTeacherReview,
    CatalogueVocabulary,
    PrimaryDomain,
    QuestionType,
    catalogue_inventory_snapshot_sha256,
    compute_promotion,
    validate_inventory_ids,
)


CATALOGUE_DATABASE_SCHEMA_VERSION = 2
CATALOGUE_SCHEMA_MARKER = "catalogue_schema"
CATALOGUE_DIRECTORY_MODE = 0o700
CATALOGUE_SQLITE_MODE = 0o600
CATALOGUE_REQUIRED_TABLES = {
    CATALOGUE_SCHEMA_MARKER,
    "catalogue_runs",
    "catalogue_items",
    "catalogue_reviews",
    "catalogue_review_history",
    "catalogue_neighbor_judgements",
    "catalogue_neighbor_history",
    "catalogue_skill_judgements",
    "catalogue_skill_judgement_history",
}

DatabaseRow: TypeAlias = Mapping[str, Any] | sqlite3.Row


def secure_catalogue_directory(directory_path: Path) -> Path:
    """Create and restrict a directory that contains private corpus artifacts."""

    requested_path = directory_path.absolute()
    if requested_path.is_symlink():
        raise ValueError(f"catalogue output must not be a symlink: {requested_path}")
    requested_path.mkdir(parents=True, exist_ok=True)

    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(requested_path, flags)
    try:
        if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
            raise ValueError(f"catalogue output is not a directory: {requested_path}")
        os.fchmod(descriptor, CATALOGUE_DIRECTORY_MODE)
    finally:
        os.close(descriptor)
    return requested_path.resolve()


def _catalogue_database_location(
    database_path: Path,
    *,
    catalogue_directory: Path | None = None,
) -> tuple[Path, Path]:
    """Resolve a database only after rejecting a symlink escape.

    The directory is kept as a separate trust boundary so callers cannot point
    a catalogue operation at an arbitrary file and have the privacy hardening
    chmod that file.  Catalogue databases are direct children of that private
    directory; their SQLite sidecars share the same boundary.
    """

    requested_database = database_path.absolute()
    requested_directory = (
        requested_database.parent
        if catalogue_directory is None
        else catalogue_directory.absolute()
    )
    if requested_database.is_symlink():
        raise ValueError(
            f"catalogue database must not be a symlink: {requested_database}"
        )
    if requested_directory.is_symlink():
        raise ValueError(
            f"catalogue directory must not be a symlink: {requested_directory}"
        )

    resolved_directory = requested_directory.resolve()
    resolved_database = requested_database.resolve()
    if resolved_database.parent != resolved_directory:
        raise ValueError(
            "catalogue database must be a direct child of its catalogue directory"
        )
    return resolved_database, resolved_directory


def _secure_catalogue_sqlite_files(
    database_path: Path, *, catalogue_directory: Path | None = None
) -> None:
    """Restrict a catalogue database and any SQLite WAL sidecars that exist."""

    database_path, catalogue_directory = _catalogue_database_location(
        database_path,
        catalogue_directory=catalogue_directory,
    )
    directory_flags = (
        os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    )
    directory_descriptor = os.open(catalogue_directory, directory_flags)
    try:
        for name in (
            database_path.name,
            f"{database_path.name}-wal",
            f"{database_path.name}-shm",
        ):
            try:
                metadata = os.stat(
                    name,
                    dir_fd=directory_descriptor,
                    follow_symlinks=False,
                )
            except FileNotFoundError:
                continue
            if stat.S_ISLNK(metadata.st_mode):
                raise ValueError(
                    "catalogue SQLite artifact must not be a symlink: "
                    f"{catalogue_directory / name}"
                )
            if not stat.S_ISREG(metadata.st_mode):
                raise ValueError(
                    f"catalogue SQLite artifact is not a file: "
                    f"{catalogue_directory / name}"
                )
            file_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            try:
                descriptor = os.open(name, file_flags, dir_fd=directory_descriptor)
            except FileNotFoundError:
                # SQLite may remove an idle sidecar between the metadata read
                # and the open.  A later call will secure it if it reappears.
                continue
            try:
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    raise ValueError(
                        f"catalogue SQLite artifact is not a file: "
                        f"{catalogue_directory / name}"
                    )
                os.fchmod(descriptor, CATALOGUE_SQLITE_MODE)
            finally:
                os.close(descriptor)
    finally:
        os.close(directory_descriptor)


def _canonical_json(value: Any) -> str:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    else:
        value = to_jsonable_python(value)
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical_json(value).encode("utf-8")).hexdigest()


def _utc_text(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _existing_tables(database_path: Path) -> set[str]:
    encoded = quote(database_path.resolve().as_posix(), safe="/")
    connection = sqlite3.connect(f"file:{encoded}?mode=ro", uri=True)
    try:
        return {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
            if not str(row[0]).startswith("sqlite_")
        }
    finally:
        connection.close()


def _migration_v1(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        BEGIN IMMEDIATE;

        CREATE TABLE catalogue_schema (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          version INTEGER NOT NULL,
          applied_at TEXT NOT NULL
        );

        CREATE TABLE catalogue_runs (
          run_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          source_sha256 TEXT NOT NULL,
          corpus_snapshot_sha256 TEXT NOT NULL,
          source_item_count INTEGER NOT NULL CHECK (source_item_count > 0),
          source_schema_version TEXT NOT NULL,
          ontology_version TEXT NOT NULL,
          ontology_sha256 TEXT NOT NULL,
          proposal_version TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'superseded')),
          schema_version TEXT NOT NULL
        );

        CREATE TABLE catalogue_items (
          run_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          content_version TEXT NOT NULL,
          inventory_order INTEGER NOT NULL CHECK (inventory_order >= 0),
          source_collection TEXT NOT NULL,
          source_family TEXT NOT NULL,
          year INTEGER NOT NULL,
          grade_band TEXT NOT NULL,
          paper_part TEXT NOT NULL,
          question_number INTEGER NOT NULL,
          page INTEGER NOT NULL,
          end_page INTEGER NOT NULL,
          language TEXT NOT NULL,
          published_point_tier INTEGER,
          extraction_status TEXT NOT NULL,
          crop_status TEXT NOT NULL,
          answer_status TEXT NOT NULL,
          option_count INTEGER NOT NULL CHECK (option_count >= 0),
          parser_status TEXT NOT NULL,
          modality TEXT NOT NULL,
          license_or_use_status TEXT NOT NULL,
          source_metadata_json TEXT NOT NULL,
          warning_codes_json TEXT NOT NULL,
          content_gap_codes_json TEXT NOT NULL,
          duplicate_group_ids_json TEXT NOT NULL,
          source_payload_json TEXT NOT NULL,
          learner_payload_json TEXT NOT NULL,
          protected_payload_json TEXT NOT NULL,
          proposal_payload_json TEXT NOT NULL,
          asset_refs_json TEXT NOT NULL,
          answer_key_ref_json TEXT,
          schema_version TEXT NOT NULL,
          PRIMARY KEY (run_id, item_id),
          UNIQUE (run_id, inventory_order),
          FOREIGN KEY (run_id) REFERENCES catalogue_runs(run_id)
        );

        CREATE INDEX catalogue_items_facets
          ON catalogue_items(run_id, grade_band, source_family, year);
        CREATE INDEX catalogue_items_status
          ON catalogue_items(run_id, answer_status, parser_status, modality);

        CREATE TABLE catalogue_reviews (
          run_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          content_version TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          etag TEXT NOT NULL,
          event_id TEXT NOT NULL,
          reviewer_id TEXT NOT NULL,
          disposition TEXT NOT NULL,
          primary_domain TEXT NOT NULL,
          question_type TEXT NOT NULL,
          curriculum_approved INTEGER NOT NULL CHECK (curriculum_approved IN (0,1)),
          release_asset_approved INTEGER NOT NULL CHECK (release_asset_approved IN (0,1)),
          duplicate_resolved INTEGER NOT NULL CHECK (duplicate_resolved IN (0,1)),
          reviewed_at TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          review_json TEXT NOT NULL,
          PRIMARY KEY (run_id, item_id),
          UNIQUE (etag),
          UNIQUE (event_id),
          FOREIGN KEY (run_id, item_id)
            REFERENCES catalogue_items(run_id, item_id)
        );

        CREATE TABLE catalogue_review_history (
          event_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          content_version TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          etag TEXT NOT NULL UNIQUE,
          reviewer_id TEXT NOT NULL,
          disposition TEXT NOT NULL,
          reviewed_at TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          review_json TEXT NOT NULL,
          UNIQUE (run_id, item_id, revision),
          FOREIGN KEY (run_id, item_id)
            REFERENCES catalogue_items(run_id, item_id)
        );

        CREATE TABLE catalogue_neighbor_judgements (
          run_id TEXT NOT NULL,
          anchor_id TEXT NOT NULL,
          neighbor_id TEXT NOT NULL,
          retrieval_version TEXT NOT NULL,
          retrieval_view TEXT NOT NULL,
          anchor_content_version TEXT NOT NULL,
          neighbor_content_version TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          etag TEXT NOT NULL,
          event_id TEXT NOT NULL,
          reviewer_id TEXT NOT NULL,
          judgement TEXT NOT NULL,
          reviewed_at TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          judgement_json TEXT NOT NULL,
          PRIMARY KEY (
            run_id, anchor_id, neighbor_id, retrieval_version, retrieval_view
          ),
          UNIQUE (etag),
          UNIQUE (event_id),
          FOREIGN KEY (run_id, anchor_id)
            REFERENCES catalogue_items(run_id, item_id),
          FOREIGN KEY (run_id, neighbor_id)
            REFERENCES catalogue_items(run_id, item_id)
        );

        CREATE TABLE catalogue_neighbor_history (
          event_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          anchor_id TEXT NOT NULL,
          neighbor_id TEXT NOT NULL,
          retrieval_version TEXT NOT NULL,
          retrieval_view TEXT NOT NULL,
          anchor_content_version TEXT NOT NULL,
          neighbor_content_version TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          etag TEXT NOT NULL UNIQUE,
          reviewer_id TEXT NOT NULL,
          judgement TEXT NOT NULL,
          reviewed_at TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          judgement_json TEXT NOT NULL,
          UNIQUE (
            run_id, anchor_id, neighbor_id, retrieval_version, retrieval_view,
            revision
          ),
          FOREIGN KEY (run_id, anchor_id)
            REFERENCES catalogue_items(run_id, item_id),
          FOREIGN KEY (run_id, neighbor_id)
            REFERENCES catalogue_items(run_id, item_id)
        );

        CREATE TABLE catalogue_skill_judgements (
          run_id TEXT NOT NULL,
          skill_id TEXT NOT NULL,
          ontology_version TEXT NOT NULL,
          ontology_sha256 TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          etag TEXT NOT NULL,
          event_id TEXT NOT NULL,
          reviewer_id TEXT NOT NULL,
          decision TEXT NOT NULL,
          reviewed_at TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          judgement_json TEXT NOT NULL,
          PRIMARY KEY (run_id, skill_id),
          UNIQUE (etag),
          UNIQUE (event_id),
          FOREIGN KEY (run_id) REFERENCES catalogue_runs(run_id)
        );

        CREATE TABLE catalogue_skill_judgement_history (
          event_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          skill_id TEXT NOT NULL,
          ontology_version TEXT NOT NULL,
          ontology_sha256 TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 1),
          etag TEXT NOT NULL UNIQUE,
          reviewer_id TEXT NOT NULL,
          decision TEXT NOT NULL,
          reviewed_at TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          judgement_json TEXT NOT NULL,
          UNIQUE (run_id, skill_id, revision),
          FOREIGN KEY (run_id) REFERENCES catalogue_runs(run_id)
        );
        """
    )
    connection.execute(
        "INSERT INTO catalogue_schema(singleton, version, applied_at) VALUES (1, ?, ?)",
        (CATALOGUE_DATABASE_SCHEMA_VERSION, _utc_text(datetime.now(timezone.utc))),
    )


def _migration_v2(connection: sqlite3.Connection) -> None:
    connection.execute("BEGIN IMMEDIATE")
    connection.execute(
        "ALTER TABLE catalogue_items ADD COLUMN answer_key_ref_json TEXT"
    )
    connection.execute(
        "UPDATE catalogue_schema SET version=?, applied_at=? WHERE singleton=1",
        (CATALOGUE_DATABASE_SCHEMA_VERSION, _utc_text(datetime.now(timezone.utc))),
    )


def migrate_catalogue_database(
    database_path: Path,
    *,
    allow_create: bool = False,
    catalogue_directory: Path | None = None,
) -> None:
    """Create or validate a dedicated catalogue store.

    An existing non-catalogue SQLite database is refused before any write. This
    is the guard that prevents a caller from accidentally migrating Stage 0.
    """

    database_path, catalogue_directory = _catalogue_database_location(
        database_path,
        catalogue_directory=catalogue_directory,
    )
    if database_path.exists():
        tables = _existing_tables(database_path)
        if tables and CATALOGUE_SCHEMA_MARKER not in tables:
            raise ValueError(
                "refusing to migrate an existing SQLite database that is not a "
                "whole-corpus catalogue store"
            )
        if not tables and not allow_create:
            raise ValueError("catalogue database is empty and cannot be resumed")
        _secure_catalogue_sqlite_files(
            database_path,
            catalogue_directory=catalogue_directory,
        )
    elif not allow_create:
        raise FileNotFoundError(f"catalogue database not found: {database_path}")

    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    try:
        _secure_catalogue_sqlite_files(
            database_path,
            catalogue_directory=catalogue_directory,
        )
        connection.execute("PRAGMA foreign_keys=ON")
        tables = {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
            if not str(row[0]).startswith("sqlite_")
        }
        if not tables:
            try:
                _migration_v1(connection)
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        else:
            row = connection.execute(
                "SELECT version FROM catalogue_schema WHERE singleton=1"
            ).fetchone()
            if row is None:
                raise ValueError("catalogue schema marker is invalid")
            version = int(row[0])
            if version > CATALOGUE_DATABASE_SCHEMA_VERSION:
                raise ValueError(
                    f"catalogue schema {version} is newer than supported "
                    f"schema {CATALOGUE_DATABASE_SCHEMA_VERSION}"
                )
            if version == 1:
                try:
                    _migration_v2(connection)
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
                version = CATALOGUE_DATABASE_SCHEMA_VERSION
            if version < CATALOGUE_DATABASE_SCHEMA_VERSION:
                raise ValueError(
                    f"no migration path from catalogue schema {version} is available"
                )
            missing = CATALOGUE_REQUIRED_TABLES - tables
            if missing:
                raise ValueError(
                    "catalogue database is missing required tables: "
                    + ", ".join(sorted(missing))
                )
    finally:
        connection.close()
        _secure_catalogue_sqlite_files(
            database_path,
            catalogue_directory=catalogue_directory,
        )


class CatalogueRepository:
    """Version-bound inventory and append-only teacher review repository."""

    def __init__(
        self,
        database_path: Path,
        *,
        vocabulary: CatalogueVocabulary | None = None,
        catalogue_directory: Path | None = None,
    ) -> None:
        self.database_path, self.catalogue_directory = _catalogue_database_location(
            database_path,
            catalogue_directory=catalogue_directory,
        )
        migrate_catalogue_database(
            self.database_path,
            catalogue_directory=self.catalogue_directory,
        )
        self._connection = sqlite3.connect(
            self.database_path,
            check_same_thread=False,
            isolation_level=None,
        )
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA foreign_keys=ON")
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA busy_timeout=5000")
        _secure_catalogue_sqlite_files(
            self.database_path,
            catalogue_directory=self.catalogue_directory,
        )
        self._lock = threading.RLock()
        self.vocabulary = vocabulary

    def __enter__(self) -> "CatalogueRepository":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        with self._lock:
            _secure_catalogue_sqlite_files(
                self.database_path,
                catalogue_directory=self.catalogue_directory,
            )
            self._connection.close()
            _secure_catalogue_sqlite_files(
                self.database_path,
                catalogue_directory=self.catalogue_directory,
            )

    def upsert_run(self, run: CatalogueRun) -> None:
        values = run.model_dump(mode="json")
        values["created_at"] = _utc_text(run.created_at)
        with self._lock, self._connection:
            current = self._connection.execute(
                "SELECT * FROM catalogue_runs WHERE run_id=?", (run.run_id,)
            ).fetchone()
            if current is None:
                self._connection.execute(
                    """
                    INSERT INTO catalogue_runs(
                      run_id, created_at, source_sha256, corpus_snapshot_sha256,
                      source_item_count, source_schema_version, ontology_version,
                      ontology_sha256, proposal_version, status, schema_version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        values["run_id"],
                        values["created_at"],
                        values["source_sha256"],
                        values["corpus_snapshot_sha256"],
                        values["source_item_count"],
                        values["source_schema_version"],
                        values["ontology_version"],
                        values["ontology_sha256"],
                        values["proposal_version"],
                        values["status"],
                        values["schema_version"],
                    ),
                )
                return

            immutable = {
                "created_at",
                "source_sha256",
                "corpus_snapshot_sha256",
                "source_item_count",
                "source_schema_version",
                "ontology_version",
                "ontology_sha256",
                "proposal_version",
                "schema_version",
            }
            changed = [key for key in immutable if current[key] != values[key]]
            if changed:
                raise ValueError(
                    f"catalogue run {run.run_id} immutable fields changed: "
                    + ", ".join(sorted(changed))
                )
            self._connection.execute(
                "UPDATE catalogue_runs SET status=? WHERE run_id=?",
                (run.status.value, run.run_id),
            )

    def upsert_items(
        self, run_id: str, records: Iterable[CatalogueInventoryItem]
    ) -> int:
        items = validate_inventory_ids(records)
        run = self.run(run_id)
        if run is None:
            raise ValueError(f"unknown catalogue run: {run_id}")
        if len(items) > run.source_item_count:
            raise ValueError("catalogue inventory exceeds the run's source item count")

        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                for item in items:
                    existing_row = self._connection.execute(
                        """
                        SELECT * FROM catalogue_items
                        WHERE run_id=? AND item_id=?
                        """,
                        (run_id, item.item_id),
                    ).fetchone()
                    if existing_row is not None:
                        if self._item_from_row(existing_row) != item:
                            raise ValueError(
                                "catalogue inventory items are immutable within a run; "
                                "changed evidence requires a new catalogue run"
                            )
                        continue
                    source = item.source_metadata
                    values = (
                        run_id,
                        item.item_id,
                        item.content_version,
                        item.inventory_order,
                        source.source_collection,
                        source.source_family,
                        source.year,
                        source.grade_band,
                        source.paper_part,
                        source.question_number,
                        source.page,
                        source.end_page,
                        source.language,
                        source.published_point_tier,
                        source.extraction_status,
                        source.crop_status,
                        item.answer_status,
                        item.option_count,
                        item.parser_status,
                        item.modality,
                        item.license_or_use_status,
                        _canonical_json(source),
                        _canonical_json(item.warning_codes),
                        _canonical_json(item.content_gap_codes),
                        _canonical_json(item.duplicate_group_ids),
                        _canonical_json(item.source_payload),
                        _canonical_json(item.learner_payload),
                        _canonical_json(item.protected_payload),
                        _canonical_json(item.proposal_payload),
                        _canonical_json(item.asset_refs),
                        (
                            _canonical_json(item.answer_key_ref)
                            if item.answer_key_ref is not None
                            else None
                        ),
                        item.schema_version,
                    )
                    self._connection.execute(
                        """
                        INSERT INTO catalogue_items(
                          run_id, item_id, content_version, inventory_order,
                          source_collection, source_family, year, grade_band,
                          paper_part, question_number, page, end_page, language,
                          published_point_tier, extraction_status, crop_status,
                          answer_status, option_count, parser_status, modality,
                          license_or_use_status, source_metadata_json,
                          warning_codes_json, content_gap_codes_json,
                          duplicate_group_ids_json, source_payload_json,
                          learner_payload_json, protected_payload_json,
                          proposal_payload_json, asset_refs_json,
                          answer_key_ref_json, schema_version
                        ) VALUES (
                          ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
                        )
                        """,
                        values,
                    )
                count = int(
                    self._connection.execute(
                        "SELECT COUNT(*) FROM catalogue_items WHERE run_id=?",
                        (run_id,),
                    ).fetchone()[0]
                )
                if count > run.source_item_count:
                    raise ValueError(
                        "stored inventory exceeds the run's source item count"
                    )
                if count == run.source_item_count:
                    manifest_rows = self._connection.execute(
                        """
                        SELECT * FROM catalogue_items
                        WHERE run_id=? ORDER BY item_id
                        """,
                        (run_id,),
                    ).fetchall()
                    snapshot_sha256 = catalogue_inventory_snapshot_sha256(
                        self._item_from_row(row) for row in manifest_rows
                    )
                    if snapshot_sha256 != run.corpus_snapshot_sha256:
                        raise ValueError(
                            "complete inventory does not match the run's corpus "
                            "snapshot hash"
                        )
                self._connection.commit()
            except Exception:
                self._connection.rollback()
                raise
        return len(items)

    def latest_run_id(self) -> str | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT run_id FROM catalogue_runs
                ORDER BY created_at DESC, run_id DESC LIMIT 1
                """
            ).fetchone()
        return None if row is None else str(row[0])

    def run(self, run_id: str) -> CatalogueRun | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM catalogue_runs WHERE run_id=?", (run_id,)
            ).fetchone()
        if row is None:
            return None
        return CatalogueRun.model_validate(dict(row))

    @staticmethod
    def _item_from_row(row: DatabaseRow) -> CatalogueInventoryItem:
        return CatalogueInventoryItem.model_validate(
            {
                "item_id": row["item_id"],
                "content_version": row["content_version"],
                "inventory_order": row["inventory_order"],
                "source_metadata": json.loads(row["source_metadata_json"]),
                "answer_status": row["answer_status"],
                "option_count": row["option_count"],
                "parser_status": row["parser_status"],
                "modality": row["modality"],
                "license_or_use_status": row["license_or_use_status"],
                "warning_codes": json.loads(row["warning_codes_json"]),
                "content_gap_codes": json.loads(row["content_gap_codes_json"]),
                "duplicate_group_ids": json.loads(row["duplicate_group_ids_json"]),
                "source_payload": json.loads(row["source_payload_json"]),
                "learner_payload": json.loads(row["learner_payload_json"]),
                "protected_payload": json.loads(row["protected_payload_json"]),
                "proposal_payload": json.loads(row["proposal_payload_json"]),
                "asset_refs": json.loads(row["asset_refs_json"]),
                "answer_key_ref": (
                    json.loads(row["answer_key_ref_json"])
                    if row["answer_key_ref_json"] is not None
                    else None
                ),
                "schema_version": row["schema_version"],
            }
        )

    @staticmethod
    def _review_from_row(row: DatabaseRow) -> CatalogueReviewRecord:
        return CatalogueReviewRecord(
            revision=int(row["revision"]),
            etag=str(row["etag"]),
            event_id=str(row["event_id"]),
            review=CatalogueTeacherReview.model_validate(
                json.loads(row["review_json"])
            ),
        )

    @staticmethod
    def _neighbor_from_row(row: DatabaseRow) -> CatalogueNeighborRecord:
        return CatalogueNeighborRecord(
            revision=int(row["revision"]),
            etag=str(row["etag"]),
            event_id=str(row["event_id"]),
            judgement=CatalogueNeighborJudgement.model_validate(
                json.loads(row["judgement_json"])
            ),
        )

    @staticmethod
    def _skill_judgement_from_row(
        row: DatabaseRow,
    ) -> CatalogueSkillJudgementRecord:
        return CatalogueSkillJudgementRecord(
            revision=int(row["revision"]),
            etag=str(row["etag"]),
            event_id=str(row["event_id"]),
            judgement=CatalogueSkillJudgement.model_validate(
                json.loads(row["judgement_json"])
            ),
        )

    def current_review(self, run_id: str, item_id: str) -> CatalogueReviewRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM catalogue_reviews WHERE run_id=? AND item_id=?",
                (run_id, item_id),
            ).fetchone()
        return None if row is None else self._review_from_row(row)

    def review_history(
        self, run_id: str, item_id: str
    ) -> tuple[CatalogueReviewRecord, ...]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM catalogue_review_history
                WHERE run_id=? AND item_id=? ORDER BY revision
                """,
                (run_id, item_id),
            ).fetchall()
        return tuple(self._review_from_row(row) for row in rows)

    def item(self, run_id: str, item_id: str) -> CatalogueItemRecord | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM catalogue_items WHERE run_id=? AND item_id=?",
                (run_id, item_id),
            ).fetchone()
        if row is None:
            return None
        inventory = self._item_from_row(row)
        review = self.current_review(run_id, item_id)
        return CatalogueItemRecord(
            run_id=run_id,
            item=inventory,
            current_review=review,
            promotion=compute_promotion(inventory, review),
        )

    def save_review(
        self,
        review: CatalogueTeacherReview,
        expected_revision: int,
        *,
        expected_etag: str | None = None,
    ) -> CatalogueReviewRecord:
        if expected_revision < 0:
            raise ValueError("expected_revision cannot be negative")
        if self.vocabulary is not None:
            self.vocabulary.validate_classification(review.classification)

        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                item = self._connection.execute(
                    """
                    SELECT content_version FROM catalogue_items
                    WHERE run_id=? AND item_id=?
                    """,
                    (review.run_id, review.item_id),
                ).fetchone()
                if item is None:
                    raise ValueError(
                        f"review references unknown catalogue item "
                        f"{review.run_id}/{review.item_id}"
                    )
                if item["content_version"] != review.content_version:
                    raise ValueError("review content version is stale or incorrect")
                current = self._connection.execute(
                    """
                    SELECT revision, etag FROM catalogue_reviews
                    WHERE run_id=? AND item_id=?
                    """,
                    (review.run_id, review.item_id),
                ).fetchone()
                current_revision = 0 if current is None else int(current["revision"])
                if expected_revision != current_revision:
                    raise CatalogueReviewConflict(
                        f"expected revision {expected_revision}, current revision is "
                        f"{current_revision}"
                    )
                if expected_etag is not None:
                    current_etag = None if current is None else str(current["etag"])
                    if expected_etag != current_etag:
                        raise CatalogueReviewConflict("review ETag does not match")

                revision = current_revision + 1
                review_json = _canonical_json(review)
                event_payload = {
                    "kind": "catalogue_teacher_review",
                    "revision": revision,
                    "review": json.loads(review_json),
                }
                event_id = _sha256_json(event_payload)
                etag = _sha256_json({"event_id": event_id, "revision": revision})
                reviewed_at = _utc_text(review.reviewed_at)
                values = (
                    review.run_id,
                    review.item_id,
                    review.content_version,
                    revision,
                    etag,
                    event_id,
                    review.reviewer_id,
                    review.disposition.value,
                    review.classification.primary_domain.value,
                    review.classification.question_type.value,
                    int(review.curriculum_approved),
                    int(review.release_asset_approved),
                    int(review.duplicate_resolved),
                    reviewed_at,
                    review.schema_version,
                    review_json,
                )
                self._connection.execute(
                    """
                    INSERT INTO catalogue_review_history(
                      run_id, item_id, content_version, revision, etag, event_id,
                      reviewer_id, disposition, reviewed_at, schema_version,
                      review_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        review.run_id,
                        review.item_id,
                        review.content_version,
                        revision,
                        etag,
                        event_id,
                        review.reviewer_id,
                        review.disposition.value,
                        reviewed_at,
                        review.schema_version,
                        review_json,
                    ),
                )
                self._connection.execute(
                    """
                    INSERT INTO catalogue_reviews(
                      run_id, item_id, content_version, revision, etag, event_id,
                      reviewer_id, disposition, primary_domain, question_type,
                      curriculum_approved, release_asset_approved,
                      duplicate_resolved, reviewed_at, schema_version, review_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(run_id, item_id) DO UPDATE SET
                      content_version=excluded.content_version,
                      revision=excluded.revision,
                      etag=excluded.etag,
                      event_id=excluded.event_id,
                      reviewer_id=excluded.reviewer_id,
                      disposition=excluded.disposition,
                      primary_domain=excluded.primary_domain,
                      question_type=excluded.question_type,
                      curriculum_approved=excluded.curriculum_approved,
                      release_asset_approved=excluded.release_asset_approved,
                      duplicate_resolved=excluded.duplicate_resolved,
                      reviewed_at=excluded.reviewed_at,
                      schema_version=excluded.schema_version,
                      review_json=excluded.review_json
                    """,
                    values,
                )
                self._connection.commit()
            except Exception:
                self._connection.rollback()
                raise
        return CatalogueReviewRecord(
            revision=revision,
            etag=etag,
            event_id=event_id,
            review=review,
        )

    def current_neighbor_judgement(
        self,
        run_id: str,
        anchor_id: str,
        neighbor_id: str,
        retrieval_version: str,
        retrieval_view: str,
    ) -> CatalogueNeighborRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM catalogue_neighbor_judgements
                WHERE run_id=? AND anchor_id=? AND neighbor_id=?
                  AND retrieval_version=? AND retrieval_view=?
                """,
                (
                    run_id,
                    anchor_id,
                    neighbor_id,
                    retrieval_version,
                    retrieval_view,
                ),
            ).fetchone()
        return None if row is None else self._neighbor_from_row(row)

    def neighbor_judgement_history(
        self,
        run_id: str,
        anchor_id: str,
        neighbor_id: str,
        retrieval_version: str,
        retrieval_view: str,
    ) -> tuple[CatalogueNeighborRecord, ...]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM catalogue_neighbor_history
                WHERE run_id=? AND anchor_id=? AND neighbor_id=?
                  AND retrieval_version=? AND retrieval_view=?
                ORDER BY revision
                """,
                (
                    run_id,
                    anchor_id,
                    neighbor_id,
                    retrieval_version,
                    retrieval_view,
                ),
            ).fetchall()
        return tuple(self._neighbor_from_row(row) for row in rows)

    def save_neighbor_judgement(
        self,
        judgement: CatalogueNeighborJudgement,
        expected_revision: int,
        *,
        expected_etag: str | None = None,
    ) -> CatalogueNeighborRecord:
        if expected_revision < 0:
            raise ValueError("expected_revision cannot be negative")
        key = (
            judgement.run_id,
            judgement.anchor_id,
            judgement.neighbor_id,
            judgement.retrieval_version,
            judgement.retrieval_view,
        )
        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                item_rows = self._connection.execute(
                    """
                    SELECT item_id, content_version FROM catalogue_items
                    WHERE run_id=? AND item_id IN (?, ?)
                    """,
                    (
                        judgement.run_id,
                        judgement.anchor_id,
                        judgement.neighbor_id,
                    ),
                ).fetchall()
                versions = {
                    str(row["item_id"]): row["content_version"] for row in item_rows
                }
                if set(versions) != {judgement.anchor_id, judgement.neighbor_id}:
                    raise ValueError("neighbor judgement references unknown items")
                if versions[judgement.anchor_id] != judgement.anchor_content_version:
                    raise ValueError("anchor content version is stale or incorrect")
                if (
                    versions[judgement.neighbor_id]
                    != judgement.neighbor_content_version
                ):
                    raise ValueError("neighbor content version is stale or incorrect")

                current = self._connection.execute(
                    """
                    SELECT revision, etag FROM catalogue_neighbor_judgements
                    WHERE run_id=? AND anchor_id=? AND neighbor_id=?
                      AND retrieval_version=? AND retrieval_view=?
                    """,
                    key,
                ).fetchone()
                current_revision = 0 if current is None else int(current["revision"])
                if current_revision != expected_revision:
                    raise CatalogueReviewConflict(
                        f"expected revision {expected_revision}, current revision is "
                        f"{current_revision}"
                    )
                if expected_etag is not None:
                    current_etag = None if current is None else str(current["etag"])
                    if expected_etag != current_etag:
                        raise CatalogueReviewConflict("neighbor ETag does not match")

                revision = current_revision + 1
                judgement_json = _canonical_json(judgement)
                event_payload = {
                    "kind": "catalogue_neighbor_judgement",
                    "revision": revision,
                    "judgement": json.loads(judgement_json),
                }
                event_id = _sha256_json(event_payload)
                etag = _sha256_json({"event_id": event_id, "revision": revision})
                reviewed_at = _utc_text(judgement.reviewed_at)
                history_values = (
                    event_id,
                    judgement.run_id,
                    judgement.anchor_id,
                    judgement.neighbor_id,
                    judgement.retrieval_version,
                    judgement.retrieval_view,
                    judgement.anchor_content_version,
                    judgement.neighbor_content_version,
                    revision,
                    etag,
                    judgement.reviewer_id,
                    judgement.judgement.value,
                    reviewed_at,
                    judgement.schema_version,
                    judgement_json,
                )
                self._connection.execute(
                    """
                    INSERT INTO catalogue_neighbor_history(
                      event_id, run_id, anchor_id, neighbor_id,
                      retrieval_version, retrieval_view, anchor_content_version,
                      neighbor_content_version, revision, etag, reviewer_id,
                      judgement, reviewed_at, schema_version, judgement_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    history_values,
                )
                projection_values = history_values[1:]
                self._connection.execute(
                    """
                    INSERT INTO catalogue_neighbor_judgements(
                      run_id, anchor_id, neighbor_id, retrieval_version,
                      retrieval_view, anchor_content_version,
                      neighbor_content_version, revision, etag, event_id,
                      reviewer_id, judgement, reviewed_at, schema_version,
                      judgement_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(
                      run_id, anchor_id, neighbor_id, retrieval_version,
                      retrieval_view
                    ) DO UPDATE SET
                      anchor_content_version=excluded.anchor_content_version,
                      neighbor_content_version=excluded.neighbor_content_version,
                      revision=excluded.revision,
                      etag=excluded.etag,
                      event_id=excluded.event_id,
                      reviewer_id=excluded.reviewer_id,
                      judgement=excluded.judgement,
                      reviewed_at=excluded.reviewed_at,
                      schema_version=excluded.schema_version,
                      judgement_json=excluded.judgement_json
                    """,
                    (
                        *projection_values[:9],
                        event_id,
                        *projection_values[9:],
                    ),
                )
                self._connection.commit()
            except Exception:
                self._connection.rollback()
                raise
        return CatalogueNeighborRecord(
            revision=revision,
            etag=etag,
            event_id=event_id,
            judgement=judgement,
        )

    def current_skill_judgement(
        self, run_id: str, skill_id: str
    ) -> CatalogueSkillJudgementRecord | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM catalogue_skill_judgements
                WHERE run_id=? AND skill_id=?
                """,
                (run_id, skill_id),
            ).fetchone()
        return None if row is None else self._skill_judgement_from_row(row)

    def list_skill_judgements(
        self, run_id: str
    ) -> tuple[CatalogueSkillJudgementRecord, ...]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM catalogue_skill_judgements
                WHERE run_id=? ORDER BY skill_id
                """,
                (run_id,),
            ).fetchall()
        return tuple(self._skill_judgement_from_row(row) for row in rows)

    def skill_judgement_history(
        self, run_id: str, skill_id: str
    ) -> tuple[CatalogueSkillJudgementRecord, ...]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM catalogue_skill_judgement_history
                WHERE run_id=? AND skill_id=? ORDER BY revision
                """,
                (run_id, skill_id),
            ).fetchall()
        return tuple(self._skill_judgement_from_row(row) for row in rows)

    def save_skill_judgement(
        self,
        judgement: CatalogueSkillJudgement,
        expected_revision: int,
        *,
        expected_etag: str | None = None,
    ) -> CatalogueSkillJudgementRecord:
        if expected_revision < 0:
            raise ValueError("expected_revision cannot be negative")
        run = self.run(judgement.run_id)
        if run is None:
            raise ValueError(f"unknown catalogue run: {judgement.run_id}")
        if (
            judgement.ontology_version != run.ontology_version
            or judgement.ontology_sha256 != run.ontology_sha256
        ):
            raise ValueError("skill judgement does not match the run's ontology")
        if self.vocabulary is not None:
            all_skills = (
                set(self.vocabulary.content_skill_ids)
                | set(self.vocabulary.reasoning_move_ids)
                | set(self.vocabulary.procedure_ids)
            )
            if judgement.skill_id not in all_skills:
                raise ValueError(f"unknown ontology skill: {judgement.skill_id}")
            if (
                judgement.merge_target_skill_id is not None
                and judgement.merge_target_skill_id not in all_skills
            ):
                raise ValueError(
                    "unknown merge target skill: " f"{judgement.merge_target_skill_id}"
                )

        with self._lock:
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                current = self._connection.execute(
                    """
                    SELECT revision, etag FROM catalogue_skill_judgements
                    WHERE run_id=? AND skill_id=?
                    """,
                    (judgement.run_id, judgement.skill_id),
                ).fetchone()
                current_revision = 0 if current is None else int(current["revision"])
                if current_revision != expected_revision:
                    raise CatalogueReviewConflict(
                        f"expected revision {expected_revision}, current revision is "
                        f"{current_revision}"
                    )
                if expected_etag is not None:
                    current_etag = None if current is None else str(current["etag"])
                    if expected_etag != current_etag:
                        raise CatalogueReviewConflict(
                            "skill judgement ETag does not match"
                        )

                revision = current_revision + 1
                judgement_json = _canonical_json(judgement)
                event_payload = {
                    "kind": "catalogue_skill_judgement",
                    "revision": revision,
                    "judgement": json.loads(judgement_json),
                }
                event_id = _sha256_json(event_payload)
                etag = _sha256_json({"event_id": event_id, "revision": revision})
                reviewed_at = _utc_text(judgement.reviewed_at)
                values = (
                    judgement.run_id,
                    judgement.skill_id,
                    judgement.ontology_version,
                    judgement.ontology_sha256,
                    revision,
                    etag,
                    event_id,
                    judgement.reviewer_id,
                    judgement.decision.value,
                    reviewed_at,
                    judgement.schema_version,
                    judgement_json,
                )
                self._connection.execute(
                    """
                    INSERT INTO catalogue_skill_judgement_history(
                      run_id, skill_id, ontology_version, ontology_sha256,
                      revision, etag, event_id, reviewer_id, decision,
                      reviewed_at, schema_version, judgement_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values,
                )
                self._connection.execute(
                    """
                    INSERT INTO catalogue_skill_judgements(
                      run_id, skill_id, ontology_version, ontology_sha256,
                      revision, etag, event_id, reviewer_id, decision,
                      reviewed_at, schema_version, judgement_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(run_id, skill_id) DO UPDATE SET
                      ontology_version=excluded.ontology_version,
                      ontology_sha256=excluded.ontology_sha256,
                      revision=excluded.revision,
                      etag=excluded.etag,
                      event_id=excluded.event_id,
                      reviewer_id=excluded.reviewer_id,
                      decision=excluded.decision,
                      reviewed_at=excluded.reviewed_at,
                      schema_version=excluded.schema_version,
                      judgement_json=excluded.judgement_json
                    """,
                    values,
                )
                self._connection.commit()
            except Exception:
                self._connection.rollback()
                raise
        return CatalogueSkillJudgementRecord(
            revision=revision,
            etag=etag,
            event_id=event_id,
            judgement=judgement,
        )

    def _all_joined_rows(self, run_id: str) -> list[sqlite3.Row]:
        with self._lock:
            return self._connection.execute(
                """
                SELECT i.*,
                       c.ontology_version AS run_ontology_version,
                       c.proposal_version AS run_proposal_version,
                       r.content_version AS review_content_version,
                       r.revision AS review_revision, r.etag AS review_etag,
                       r.event_id AS review_event_id,
                       r.reviewer_id AS review_reviewer_id,
                       r.disposition AS review_disposition,
                       r.primary_domain AS review_primary_domain,
                       r.question_type AS review_question_type,
                       r.review_json AS current_review_json
                FROM catalogue_items i
                JOIN catalogue_runs c ON c.run_id=i.run_id
                LEFT JOIN catalogue_reviews r
                  ON r.run_id=i.run_id AND r.item_id=i.item_id
                WHERE i.run_id=?
                ORDER BY i.inventory_order, i.item_id
                """,
                (run_id,),
            ).fetchall()

    def _summary_from_joined_row(self, row: DatabaseRow) -> CatalogueItemSummary:
        item = self._item_from_row(row)
        proposal_primary_domain, proposal_question_type = self._proposal_labels(
            item,
            expected_ontology_version=str(row["run_ontology_version"]),
            expected_proposal_version=str(row["run_proposal_version"]),
        )
        review = None
        if row["current_review_json"] is not None:
            review = CatalogueReviewRecord(
                revision=int(row["review_revision"]),
                etag=str(row["review_etag"]),
                event_id=str(row["review_event_id"]),
                review=CatalogueTeacherReview.model_validate(
                    json.loads(row["current_review_json"])
                ),
            )
        promotion = compute_promotion(item, review)
        if review is None:
            review_state = "unreviewed"
        elif review.review.content_version != item.content_version:
            review_state = "stale"
        else:
            review_state = review.review.disposition.value
        reviewed_primary_domain = (
            None if review is None else review.review.classification.primary_domain
        )
        reviewed_question_type = (
            None if review is None else review.review.classification.question_type
        )
        classification_source: Literal["teacher_review", "proposal", "none"]
        if review is not None and review.review.content_version == item.content_version:
            effective_primary_domain = reviewed_primary_domain
            effective_question_type = reviewed_question_type
            classification_source = "teacher_review"
        elif proposal_primary_domain is not None or proposal_question_type is not None:
            effective_primary_domain = proposal_primary_domain
            effective_question_type = proposal_question_type
            classification_source = "proposal"
        else:
            effective_primary_domain = None
            effective_question_type = None
            classification_source = "none"
        return CatalogueItemSummary(
            run_id=str(row["run_id"]),
            item_id=item.item_id,
            content_version=item.content_version,
            inventory_order=item.inventory_order,
            source_metadata=item.source_metadata,
            answer_status=item.answer_status,
            option_count=item.option_count,
            parser_status=item.parser_status,
            modality=item.modality,
            license_or_use_status=item.license_or_use_status,
            warning_count=len(item.warning_codes),
            content_gap_count=len(item.content_gap_codes),
            duplicate_group_count=len(item.duplicate_group_ids),
            review_state=review_state,
            current_revision=None if review is None else review.revision,
            current_etag=None if review is None else review.etag,
            reviewer_id=None if review is None else review.review.reviewer_id,
            primary_domain=reviewed_primary_domain,
            question_type=reviewed_question_type,
            proposed_primary_domain=proposal_primary_domain,
            proposed_question_type=proposal_question_type,
            effective_primary_domain=effective_primary_domain,
            effective_question_type=effective_question_type,
            classification_source=classification_source,
            promotion=promotion,
        )

    @staticmethod
    def _proposal_labels(
        item: CatalogueInventoryItem,
        *,
        expected_ontology_version: str,
        expected_proposal_version: str,
    ) -> tuple[PrimaryDomain | None, QuestionType | None]:
        """Read only version-bound, structurally non-authoritative proposals."""

        payload = item.proposal_payload
        expected = {
            "item_id": item.item_id,
            "content_version": item.content_version,
            "ontology_version": expected_ontology_version,
            "classifier_version": expected_proposal_version,
            "status": "proposed",
        }
        if payload.get("authoritative") is not False or any(
            payload.get(key) != value for key, value in expected.items()
        ):
            return None, None
        try:
            primary_domain = PrimaryDomain(str(payload["primary_domain"]))
        except (KeyError, TypeError, ValueError):
            primary_domain = None
        try:
            question_type = QuestionType(str(payload["question_type"]))
        except (KeyError, TypeError, ValueError):
            question_type = None
        return primary_domain, question_type

    @staticmethod
    def _matches(summary: CatalogueItemSummary, filters: CatalogueFilters) -> bool:
        source = summary.source_metadata
        checks = (
            filters.source_family is None
            or source.source_family == filters.source_family,
            filters.grade_band is None or source.grade_band == filters.grade_band,
            filters.year is None or source.year == filters.year,
            filters.published_point_tier is None
            or (
                filters.published_point_tier == "unknown"
                and source.published_point_tier is None
            )
            or source.published_point_tier == filters.published_point_tier,
            filters.answer_status is None
            or summary.answer_status == filters.answer_status,
            filters.parser_status is None
            or summary.parser_status == filters.parser_status,
            filters.modality is None or summary.modality == filters.modality,
            filters.review_state is None
            or summary.review_state == filters.review_state,
            filters.primary_domain is None
            or summary.effective_primary_domain is filters.primary_domain,
            filters.question_type is None
            or summary.effective_question_type is filters.question_type,
            filters.curriculum_ready is None
            or summary.promotion.curriculum_ready is filters.curriculum_ready,
            filters.public_eligible is None
            or summary.promotion.public_eligible is filters.public_eligible,
            filters.has_warnings is None
            or (summary.warning_count > 0) is filters.has_warnings,
            filters.has_content_gaps is None
            or (summary.content_gap_count > 0) is filters.has_content_gaps,
        )
        return all(checks)

    @staticmethod
    def _row_matches_query(row: DatabaseRow, query: str | None) -> bool:
        if query is None:
            return True
        term = query.casefold()
        learner = json.loads(row["learner_payload_json"])
        source = json.loads(row["source_payload_json"])
        stems = (
            learner.get("stem_markdown"),
            learner.get("prompt"),
            source.get("english_stem"),
            source.get("english_prompt_text"),
            source.get("stem_markdown"),
            source.get("prompt_text"),
        )
        haystack = (
            str(row["item_id"]),
            str(row["source_family"]),
            str(row["year"]),
            *(value for value in stems if isinstance(value, str)),
        )
        return any(term in value.casefold() for value in haystack)

    def _filtered_summaries(
        self, run_id: str, filters: CatalogueFilters | None
    ) -> tuple[CatalogueItemSummary, ...]:
        if self.run(run_id) is None:
            raise ValueError(f"unknown catalogue run: {run_id}")
        active = filters or CatalogueFilters()
        result = []
        for row in self._all_joined_rows(run_id):
            if not self._row_matches_query(row, active.query):
                continue
            summary = self._summary_from_joined_row(row)
            if self._matches(summary, active):
                result.append(summary)
        return tuple(result)

    def list_items(
        self,
        run_id: str,
        offset: int = 0,
        limit: int = 50,
        filters: CatalogueFilters | None = None,
    ) -> CataloguePage:
        if offset < 0:
            raise ValueError("offset cannot be negative")
        if not 1 <= limit <= 100:
            raise ValueError("limit must be between 1 and 100")
        summaries = self._filtered_summaries(run_id, filters)
        return CataloguePage(
            offset=offset,
            limit=limit,
            total=len(summaries),
            items=summaries[offset : offset + limit],
        )

    def summary(
        self, run_id: str, filters: CatalogueFilters | None = None
    ) -> CatalogueSummary:
        run = self.run(run_id)
        if run is None:
            raise ValueError(f"unknown catalogue run: {run_id}")
        all_summaries = self._filtered_summaries(run_id, None)
        summaries = (
            all_summaries
            if filters is None
            else self._filtered_summaries(run_id, filters)
        )

        facet_accessors = {
            "source_family": lambda item: item.source_metadata.source_family,
            "grade_band": lambda item: item.source_metadata.grade_band,
            "answer_status": lambda item: item.answer_status,
            "parser_status": lambda item: item.parser_status,
            "modality": lambda item: item.modality,
            "review_state": lambda item: item.review_state,
            "classification_source": lambda item: item.classification_source,
            "primary_domain": lambda item: (
                "unclassified"
                if item.effective_primary_domain is None
                else item.effective_primary_domain.value
            ),
            "question_type": lambda item: (
                "unclassified"
                if item.effective_question_type is None
                else item.effective_question_type.value
            ),
            "reviewed_primary_domain": lambda item: (
                "unclassified"
                if item.primary_domain is None
                else item.primary_domain.value
            ),
            "reviewed_question_type": lambda item: (
                "unclassified"
                if item.question_type is None
                else item.question_type.value
            ),
            "proposed_primary_domain": lambda item: (
                "unclassified"
                if item.proposed_primary_domain is None
                else item.proposed_primary_domain.value
            ),
            "proposed_question_type": lambda item: (
                "unclassified"
                if item.proposed_question_type is None
                else item.proposed_question_type.value
            ),
        }
        facets = {
            name: dict(sorted(Counter(accessor(item) for item in summaries).items()))
            for name, accessor in facet_accessors.items()
        }
        reviewed = sum(item.current_revision is not None for item in summaries)
        return CatalogueSummary(
            run_id=run_id,
            expected_items=run.source_item_count,
            matching_items=len(summaries),
            inventory_items=len(all_summaries),
            inventory_complete=len(all_summaries) == run.source_item_count,
            reviewed_items=reviewed,
            unreviewed_items=len(summaries) - reviewed,
            stale_review_items=sum(item.review_state == "stale" for item in summaries),
            proposal_available_items=sum(
                item.proposed_primary_domain is not None
                and item.proposed_question_type is not None
                for item in summaries
            ),
            proposal_classified_items=sum(
                item.proposed_primary_domain not in (None, PrimaryDomain.UNKNOWN)
                and item.proposed_question_type not in (None, QuestionType.UNKNOWN)
                for item in summaries
            ),
            teacher_classified_items=sum(
                item.primary_domain not in (None, PrimaryDomain.UNKNOWN)
                and item.question_type not in (None, QuestionType.UNKNOWN)
                for item in summaries
            ),
            curriculum_ready_items=sum(
                item.promotion.curriculum_ready for item in summaries
            ),
            public_eligible_items=sum(
                item.promotion.public_eligible for item in summaries
            ),
            facets=facets,
        )

    def export_evidence(self, run_id: str) -> dict[str, Any]:
        """Return an allowlisted evidence package with no private content or paths."""

        run = self.run(run_id)
        if run is None:
            raise ValueError(f"unknown catalogue run: {run_id}")
        rows = self._all_joined_rows(run_id)
        inventory: list[CatalogueEvidenceItem] = []
        reviews: list[CatalogueReviewEvidence] = []
        for row in rows:
            item = self._item_from_row(row)
            inventory.append(
                CatalogueEvidenceItem(
                    item_id=item.item_id,
                    content_version=item.content_version,
                    source_metadata=item.source_metadata,
                    answer_status=item.answer_status,
                    option_count=item.option_count,
                    parser_status=item.parser_status,
                    modality=item.modality,
                    license_or_use_status=item.license_or_use_status,
                    warning_codes=item.warning_codes,
                    content_gap_codes=item.content_gap_codes,
                    duplicate_group_ids=item.duplicate_group_ids,
                )
            )
            if row["current_review_json"] is None:
                continue
            review_record = CatalogueReviewRecord(
                revision=int(row["review_revision"]),
                etag=str(row["review_etag"]),
                event_id=str(row["review_event_id"]),
                review=CatalogueTeacherReview.model_validate(
                    json.loads(row["current_review_json"])
                ),
            )
            review = review_record.review
            reviews.append(
                CatalogueReviewEvidence(
                    item_id=review.item_id,
                    content_version=review.content_version,
                    revision=review_record.revision,
                    etag=review_record.etag,
                    event_id=review_record.event_id,
                    reviewer_id=review.reviewer_id,
                    source_checks=review.source_checks,
                    disposition=review.disposition,
                    classification=review.classification,
                    curriculum_approved=review.curriculum_approved,
                    release_asset_approved=review.release_asset_approved,
                    duplicate_resolved=review.duplicate_resolved,
                    reviewed_at=review.reviewed_at,
                    schema_version=review.schema_version,
                    promotion=compute_promotion(item, review_record),
                )
            )

        with self._lock:
            neighbor_rows = self._connection.execute(
                """
                SELECT * FROM catalogue_neighbor_judgements
                WHERE run_id=?
                ORDER BY anchor_id, neighbor_id, retrieval_version, retrieval_view
                """,
                (run_id,),
            ).fetchall()
        neighbor_evidence = []
        for row in neighbor_rows:
            neighbor_record = self._neighbor_from_row(row)
            neighbor_judgement = neighbor_record.judgement
            neighbor_evidence.append(
                CatalogueNeighborEvidence(
                    anchor_id=neighbor_judgement.anchor_id,
                    anchor_content_version=neighbor_judgement.anchor_content_version,
                    neighbor_id=neighbor_judgement.neighbor_id,
                    neighbor_content_version=neighbor_judgement.neighbor_content_version,
                    retrieval_version=neighbor_judgement.retrieval_version,
                    retrieval_view=neighbor_judgement.retrieval_view,
                    revision=neighbor_record.revision,
                    etag=neighbor_record.etag,
                    event_id=neighbor_record.event_id,
                    reviewer_id=neighbor_judgement.reviewer_id,
                    judgement=neighbor_judgement.judgement,
                    reviewed_at=neighbor_judgement.reviewed_at,
                    schema_version=neighbor_judgement.schema_version,
                )
            )

        skill_evidence = []
        for skill_record in self.list_skill_judgements(run_id):
            skill_judgement = skill_record.judgement
            skill_evidence.append(
                CatalogueSkillJudgementEvidence(
                    skill_id=skill_judgement.skill_id,
                    ontology_version=skill_judgement.ontology_version,
                    ontology_sha256=skill_judgement.ontology_sha256,
                    revision=skill_record.revision,
                    etag=skill_record.etag,
                    event_id=skill_record.event_id,
                    reviewer_id=skill_judgement.reviewer_id,
                    decision=skill_judgement.decision,
                    merge_target_skill_id=skill_judgement.merge_target_skill_id,
                    reviewed_at=skill_judgement.reviewed_at,
                    schema_version=skill_judgement.schema_version,
                )
            )

        payload = CatalogueEvidenceExport(
            schema_version=CATALOGUE_EVIDENCE_EXPORT_VERSION,
            generated_at=datetime.now(timezone.utc),
            run=run,
            inventory=tuple(inventory),
            reviews=tuple(reviews),
            neighbor_judgements=tuple(neighbor_evidence),
            skill_judgements=tuple(skill_evidence),
        )
        return payload.model_dump(mode="json")
