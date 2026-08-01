"""Bind reviews to content and preserve immutable review revisions.

Revision ID: 0004_review_history
Revises: 0003_source_documents
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004_review_history"
down_revision = "0003_source_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "gold_reviews",
        sa.Column("content_version", sa.String(), nullable=False, server_default=""),
    )
    op.create_table(
        "gold_review_history",
        sa.Column("review_event_id", sa.String(64), primary_key=True),
        sa.Column("run_id", sa.String(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("content_version", sa.String(), nullable=False),
        sa.Column("reviewer_slot", sa.Integer(), nullable=False),
        sa.Column("reviewer_id", sa.String(), nullable=False),
        sa.Column("disposition", sa.String(), nullable=False),
        sa.Column("reviewed_at", sa.String(), nullable=False),
        sa.Column("schema_version", sa.String(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id", "item_id"],
            ["audit_items.run_id", "audit_items.item_id"],
            name="fk_review_history_item",
        ),
    )


def downgrade() -> None:
    op.drop_table("gold_review_history")
    op.drop_column("gold_reviews", "content_version")
