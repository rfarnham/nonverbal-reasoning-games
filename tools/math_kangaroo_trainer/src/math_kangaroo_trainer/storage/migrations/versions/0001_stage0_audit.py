"""Create the versioned Stage 0 audit and gold-review schema.

Revision ID: 0001_stage0_audit
Revises: None
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001_stage0_audit"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "audit_runs",
        sa.Column("run_id", sa.String(), primary_key=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("source_item_count", sa.Integer(), nullable=False),
        sa.Column("sample_size", sa.Integer(), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("versions_json", sa.Text(), nullable=False),
        sa.Column("coverage_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.CheckConstraint(
            "sample_size BETWEEN 100 AND 200", name="sample_size_100_200"
        ),
    )
    op.create_table(
        "audit_items",
        sa.Column("run_id", sa.String(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("sample_order", sa.Integer(), nullable=False),
        sa.Column("content_version", sa.String(), nullable=False),
        sa.Column("source_json", sa.Text(), nullable=False),
        sa.Column("learner_json", sa.Text(), nullable=False),
        sa.Column("protected_json", sa.Text(), nullable=False),
        sa.Column("warning_codes_json", sa.Text(), nullable=False),
        sa.Column("parser_status", sa.String(), nullable=False),
        sa.Column("review_state", sa.String(), nullable=False),
        sa.Column("modality", sa.String(), nullable=False),
        sa.Column("year_band", sa.String(), nullable=False),
        sa.Column("choice_count_bucket", sa.String(), nullable=False),
        sa.Column("asset_path", sa.Text(), nullable=False),
        sa.Column("exact_text_sha256", sa.String(64)),
        sa.Column("exact_asset_sha256", sa.String(64)),
        sa.ForeignKeyConstraint(["run_id"], ["audit_runs.run_id"]),
        sa.PrimaryKeyConstraint("run_id", "item_id"),
        sa.UniqueConstraint("run_id", "sample_order", name="uq_sample_order"),
    )
    op.create_table(
        "gold_reviews",
        sa.Column("run_id", sa.String(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.Column("reviewer_slot", sa.Integer(), nullable=False),
        sa.Column("reviewer_id", sa.String(), nullable=False),
        sa.Column("question_boundary_verified", sa.Integer(), nullable=False),
        sa.Column("choices_verified", sa.Integer(), nullable=False),
        sa.Column("answer_key_verified", sa.Integer(), nullable=False),
        sa.Column("diagram_verified", sa.Integer(), nullable=False),
        sa.Column("source_metadata_verified", sa.Integer(), nullable=False),
        sa.Column("disposition", sa.String(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("reviewed_at", sa.String(), nullable=False),
        sa.Column("schema_version", sa.String(), nullable=False),
        sa.CheckConstraint("reviewer_slot IN (1, 2)", name="reviewer_slot_one_or_two"),
        sa.CheckConstraint(
            "question_boundary_verified IN (0, 1)", name="review_boundary_bool"
        ),
        sa.CheckConstraint("choices_verified IN (0, 1)", name="review_choices_bool"),
        sa.CheckConstraint("answer_key_verified IN (0, 1)", name="review_answer_bool"),
        sa.CheckConstraint("diagram_verified IN (0, 1)", name="review_diagram_bool"),
        sa.CheckConstraint(
            "source_metadata_verified IN (0, 1)", name="review_metadata_bool"
        ),
        sa.ForeignKeyConstraint(
            ["run_id", "item_id"],
            ["audit_items.run_id", "audit_items.item_id"],
            name="fk_review_item",
        ),
        sa.PrimaryKeyConstraint("run_id", "item_id", "reviewer_slot"),
    )
    op.create_table(
        "duplicate_groups",
        sa.Column("group_id", sa.String(), primary_key=True),
        sa.Column("run_id", sa.String(), nullable=False),
        sa.Column("signature_type", sa.String(), nullable=False),
        sa.Column("signature", sa.String(64), nullable=False),
        sa.Column("algorithm_version", sa.String(), nullable=False),
        sa.Column("review_status", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["audit_runs.run_id"]),
        sa.UniqueConstraint(
            "run_id", "signature_type", "signature", name="uq_duplicate_signature"
        ),
    )
    op.create_table(
        "duplicate_group_members",
        sa.Column("group_id", sa.String(), nullable=False),
        sa.Column("item_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["group_id"], ["duplicate_groups.group_id"]),
        sa.PrimaryKeyConstraint("group_id", "item_id"),
    )


def downgrade() -> None:
    op.drop_table("duplicate_group_members")
    op.drop_table("duplicate_groups")
    op.drop_table("gold_reviews")
    op.drop_table("audit_items")
    op.drop_table("audit_runs")
