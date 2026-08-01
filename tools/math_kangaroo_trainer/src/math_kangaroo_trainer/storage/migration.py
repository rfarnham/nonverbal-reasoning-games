"""Run Alembic only against a derived audit database."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from urllib.parse import quote

from alembic import command
from alembic.config import Config


DERIVED_MARKER_TABLES = {"alembic_version", "audit_runs"}


def _existing_tables(database_path: Path) -> set[str]:
    encoded_path = quote(database_path.as_posix(), safe="/")
    connection = sqlite3.connect(f"file:{encoded_path}?mode=ro", uri=True)
    try:
        return {
            str(row[0])
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    finally:
        connection.close()


def migrate_audit_database(
    database_path: Path, *, allow_create: bool = False
) -> None:
    database_path = database_path.resolve()
    if database_path.exists():
        tables = _existing_tables(database_path)
        if tables and not DERIVED_MARKER_TABLES.issubset(tables):
            raise ValueError(
                "refusing to migrate an existing SQLite database that is not a "
                "derived Stage 0 audit store"
            )
        if not tables and not allow_create:
            raise ValueError("audit database is empty and cannot be resumed")
    elif not allow_create:
        raise FileNotFoundError(f"audit database not found: {database_path}")
    database_path.parent.mkdir(parents=True, exist_ok=True)
    scripts = Path(__file__).with_name("migrations")
    config = Config()
    config.set_main_option("script_location", str(scripts))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path.as_posix()}")
    command.upgrade(config, "head")
