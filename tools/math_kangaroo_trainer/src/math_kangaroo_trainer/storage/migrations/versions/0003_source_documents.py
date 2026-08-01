"""Persist verified source-document inventory separately from questions.

Revision ID: 0003_source_documents
Revises: 0002_content_gaps
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_source_documents"
down_revision = "0002_content_gaps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "source_documents",
        sa.Column("run_id", sa.String(), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=False),
        sa.Column("warning_codes_json", sa.Text(), nullable=False),
        sa.Column("local_pdf_path", sa.Text(), nullable=False),
        sa.Column("actual_sha256", sa.String(64)),
        sa.Column("actual_bytes", sa.Integer()),
        sa.ForeignKeyConstraint(["run_id"], ["audit_runs.run_id"]),
        sa.PrimaryKeyConstraint("run_id", "source_path"),
    )


def downgrade() -> None:
    op.drop_table("source_documents")
