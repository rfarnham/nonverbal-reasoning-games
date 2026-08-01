"""Add independent, append-only exact-duplicate adjudication.

Revision ID: 0005_duplicate_reviews
Revises: 0004_review_history
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_duplicate_reviews"
down_revision = "0004_review_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "duplicate_reviews",
        sa.Column("run_id", sa.String(), nullable=False),
        sa.Column("group_id", sa.String(), nullable=False),
        sa.Column("reviewer_slot", sa.Integer(), nullable=False),
        sa.Column("signature", sa.String(64), nullable=False),
        sa.Column("reviewer_id", sa.String(), nullable=False),
        sa.Column("decision", sa.String(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("reviewed_at", sa.String(), nullable=False),
        sa.Column("schema_version", sa.String(), nullable=False),
        sa.CheckConstraint("reviewer_slot IN (1, 2)", name="duplicate_reviewer_slot"),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["duplicate_groups.group_id"],
            name="fk_duplicate_review_group",
        ),
        sa.PrimaryKeyConstraint("run_id", "group_id", "reviewer_slot"),
    )
    op.create_table(
        "duplicate_review_history",
        sa.Column("review_event_id", sa.String(64), primary_key=True),
        sa.Column("run_id", sa.String(), nullable=False),
        sa.Column("group_id", sa.String(), nullable=False),
        sa.Column("reviewer_slot", sa.Integer(), nullable=False),
        sa.Column("reviewer_id", sa.String(), nullable=False),
        sa.Column("decision", sa.String(), nullable=False),
        sa.Column("reviewed_at", sa.String(), nullable=False),
        sa.Column("schema_version", sa.String(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["group_id"],
            ["duplicate_groups.group_id"],
            name="fk_duplicate_review_history_group",
        ),
    )


def downgrade() -> None:
    op.drop_table("duplicate_review_history")
    op.drop_table("duplicate_reviews")
