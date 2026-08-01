"""Record Stage 0 content gaps separately from parser review triggers.

Revision ID: 0002_content_gaps
Revises: 0001_stage0_audit
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_content_gaps"
down_revision = "0001_stage0_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_items",
        sa.Column(
            "content_gap_codes_json",
            sa.Text(),
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("audit_items", "content_gap_codes_json")
