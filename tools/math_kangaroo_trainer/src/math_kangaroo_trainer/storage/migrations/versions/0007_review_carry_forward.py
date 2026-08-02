"""Record strict cross-run review carry-forward provenance.

Revision ID: 0007_review_carry_forward
Revises: 0006_population_findings
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0007_review_carry_forward"
down_revision = "0006_population_findings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "review_carry_forward_events",
        sa.Column("carry_forward_event_id", sa.String(64), primary_key=True),
        sa.Column("evidence_kind", sa.String(), nullable=False),
        sa.Column("source_run_id", sa.String(), nullable=False),
        sa.Column("target_run_id", sa.String(), nullable=False),
        sa.Column("source_entity_id", sa.String(), nullable=False),
        sa.Column("target_entity_id", sa.String(), nullable=False),
        sa.Column("reviewer_slot", sa.Integer(), nullable=False),
        sa.Column("source_review_event_id", sa.String(64), nullable=False),
        sa.Column("target_review_event_id", sa.String(64), nullable=False),
        sa.Column("match_json", sa.Text(), nullable=False),
        sa.Column("carried_at", sa.String(), nullable=False),
        sa.Column("schema_version", sa.String(), nullable=False),
        sa.CheckConstraint(
            "evidence_kind IN ('item_review', 'duplicate_review')",
            name="carry_forward_evidence_kind",
        ),
        sa.CheckConstraint(
            "source_run_id <> target_run_id", name="carry_forward_distinct_runs"
        ),
        sa.CheckConstraint(
            "reviewer_slot IN (1, 2)", name="carry_forward_reviewer_slot"
        ),
        sa.ForeignKeyConstraint(["source_run_id"], ["audit_runs.run_id"]),
        sa.ForeignKeyConstraint(["target_run_id"], ["audit_runs.run_id"]),
        sa.UniqueConstraint(
            "source_run_id",
            "target_run_id",
            "evidence_kind",
            "source_review_event_id",
            name="uq_carry_forward_source_event",
        ),
        sa.UniqueConstraint(
            "target_run_id",
            "evidence_kind",
            "target_review_event_id",
            name="uq_carry_forward_target_event",
        ),
    )


def downgrade() -> None:
    op.drop_table("review_carry_forward_events")
