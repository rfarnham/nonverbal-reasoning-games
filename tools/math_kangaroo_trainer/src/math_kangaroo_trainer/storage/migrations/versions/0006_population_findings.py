"""Persist whole-corpus source and ingestion findings.

Revision ID: 0006_population_findings
Revises: 0005_duplicate_reviews
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0006_population_findings"
down_revision = "0005_duplicate_reviews"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_runs",
        sa.Column(
            "population_findings_json",
            sa.Text(),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("audit_runs", "population_findings_json")
