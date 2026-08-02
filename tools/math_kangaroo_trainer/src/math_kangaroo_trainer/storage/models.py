"""SQLAlchemy tables for the separately derived audit database."""

from __future__ import annotations

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
)


metadata = MetaData()

audit_runs = Table(
    "audit_runs",
    metadata,
    Column("run_id", String, primary_key=True),
    Column("created_at", String, nullable=False),
    Column("source_path", Text, nullable=False),
    Column("source_sha256", String(64), nullable=False),
    Column("source_item_count", Integer, nullable=False),
    Column("sample_size", Integer, nullable=False),
    Column("seed", Integer, nullable=False),
    Column("versions_json", Text, nullable=False),
    Column("coverage_json", Text, nullable=False),
    Column("population_findings_json", Text, nullable=False),
    Column("status", String, nullable=False),
    CheckConstraint("sample_size BETWEEN 100 AND 200", name="sample_size_100_200"),
)

source_documents = Table(
    "source_documents",
    metadata,
    Column("run_id", String, ForeignKey("audit_runs.run_id"), primary_key=True),
    Column("source_path", Text, primary_key=True),
    Column("metadata_json", Text, nullable=False),
    Column("warning_codes_json", Text, nullable=False),
    Column("local_pdf_path", Text, nullable=False),
    Column("actual_sha256", String(64)),
    Column("actual_bytes", Integer),
)

audit_items = Table(
    "audit_items",
    metadata,
    Column("run_id", String, ForeignKey("audit_runs.run_id"), primary_key=True),
    Column("item_id", String, primary_key=True),
    Column("sample_order", Integer, nullable=False),
    Column("content_version", String, nullable=False),
    Column("source_json", Text, nullable=False),
    Column("learner_json", Text, nullable=False),
    Column("protected_json", Text, nullable=False),
    Column("warning_codes_json", Text, nullable=False),
    Column("content_gap_codes_json", Text, nullable=False),
    Column("parser_status", String, nullable=False),
    Column("review_state", String, nullable=False),
    Column("modality", String, nullable=False),
    Column("year_band", String, nullable=False),
    Column("choice_count_bucket", String, nullable=False),
    Column("asset_path", Text, nullable=False),
    Column("exact_text_sha256", String(64)),
    Column("exact_asset_sha256", String(64)),
    UniqueConstraint("run_id", "sample_order", name="uq_sample_order"),
)

gold_reviews = Table(
    "gold_reviews",
    metadata,
    Column("run_id", String, primary_key=True),
    Column("item_id", String, primary_key=True),
    Column("content_version", String, nullable=False),
    Column("reviewer_slot", Integer, primary_key=True),
    Column("reviewer_id", String, nullable=False),
    Column("question_boundary_verified", Integer, nullable=False),
    Column("choices_verified", Integer, nullable=False),
    Column("answer_key_verified", Integer, nullable=False),
    Column("diagram_verified", Integer, nullable=False),
    Column("source_metadata_verified", Integer, nullable=False),
    Column("disposition", String, nullable=False),
    Column("notes", Text, nullable=False),
    Column("reviewed_at", String, nullable=False),
    Column("schema_version", String, nullable=False),
    ForeignKeyConstraint(
        ["run_id", "item_id"],
        ["audit_items.run_id", "audit_items.item_id"],
        name="fk_review_item",
    ),
    CheckConstraint("reviewer_slot IN (1, 2)", name="reviewer_slot_one_or_two"),
    CheckConstraint(
        "question_boundary_verified IN (0, 1)", name="review_boundary_bool"
    ),
    CheckConstraint("choices_verified IN (0, 1)", name="review_choices_bool"),
    CheckConstraint("answer_key_verified IN (0, 1)", name="review_answer_bool"),
    CheckConstraint("diagram_verified IN (0, 1)", name="review_diagram_bool"),
    CheckConstraint(
        "source_metadata_verified IN (0, 1)", name="review_metadata_bool"
    ),
)

gold_review_history = Table(
    "gold_review_history",
    metadata,
    Column("review_event_id", String(64), primary_key=True),
    Column("run_id", String, nullable=False),
    Column("item_id", String, nullable=False),
    Column("content_version", String, nullable=False),
    Column("reviewer_slot", Integer, nullable=False),
    Column("reviewer_id", String, nullable=False),
    Column("disposition", String, nullable=False),
    Column("reviewed_at", String, nullable=False),
    Column("schema_version", String, nullable=False),
    Column("payload_json", Text, nullable=False),
    ForeignKeyConstraint(
        ["run_id", "item_id"],
        ["audit_items.run_id", "audit_items.item_id"],
        name="fk_review_history_item",
    ),
)

duplicate_groups = Table(
    "duplicate_groups",
    metadata,
    Column("group_id", String, primary_key=True),
    Column("run_id", String, ForeignKey("audit_runs.run_id"), nullable=False),
    Column("signature_type", String, nullable=False),
    Column("signature", String(64), nullable=False),
    Column("algorithm_version", String, nullable=False),
    Column("review_status", String, nullable=False),
    UniqueConstraint(
        "run_id", "signature_type", "signature", name="uq_duplicate_signature"
    ),
)

duplicate_group_members = Table(
    "duplicate_group_members",
    metadata,
    Column(
        "group_id", String, ForeignKey("duplicate_groups.group_id"), primary_key=True
    ),
    Column("item_id", String, primary_key=True),
)

duplicate_reviews = Table(
    "duplicate_reviews",
    metadata,
    Column("run_id", String, primary_key=True),
    Column("group_id", String, primary_key=True),
    Column("reviewer_slot", Integer, primary_key=True),
    Column("signature", String(64), nullable=False),
    Column("reviewer_id", String, nullable=False),
    Column("decision", String, nullable=False),
    Column("notes", Text, nullable=False),
    Column("reviewed_at", String, nullable=False),
    Column("schema_version", String, nullable=False),
    ForeignKeyConstraint(
        ["group_id"], ["duplicate_groups.group_id"], name="fk_duplicate_review_group"
    ),
    CheckConstraint("reviewer_slot IN (1, 2)", name="duplicate_reviewer_slot"),
)

duplicate_review_history = Table(
    "duplicate_review_history",
    metadata,
    Column("review_event_id", String(64), primary_key=True),
    Column("run_id", String, nullable=False),
    Column("group_id", String, nullable=False),
    Column("reviewer_slot", Integer, nullable=False),
    Column("reviewer_id", String, nullable=False),
    Column("decision", String, nullable=False),
    Column("reviewed_at", String, nullable=False),
    Column("schema_version", String, nullable=False),
    Column("payload_json", Text, nullable=False),
    ForeignKeyConstraint(
        ["group_id"],
        ["duplicate_groups.group_id"],
        name="fk_duplicate_review_history_group",
    ),
)

review_carry_forward_events = Table(
    "review_carry_forward_events",
    metadata,
    Column("carry_forward_event_id", String(64), primary_key=True),
    Column("evidence_kind", String, nullable=False),
    Column("source_run_id", String, ForeignKey("audit_runs.run_id"), nullable=False),
    Column("target_run_id", String, ForeignKey("audit_runs.run_id"), nullable=False),
    Column("source_entity_id", String, nullable=False),
    Column("target_entity_id", String, nullable=False),
    Column("reviewer_slot", Integer, nullable=False),
    Column("source_review_event_id", String(64), nullable=False),
    Column("target_review_event_id", String(64), nullable=False),
    Column("match_json", Text, nullable=False),
    Column("carried_at", String, nullable=False),
    Column("schema_version", String, nullable=False),
    CheckConstraint(
        "evidence_kind IN ('item_review', 'duplicate_review')",
        name="carry_forward_evidence_kind",
    ),
    CheckConstraint(
        "source_run_id <> target_run_id", name="carry_forward_distinct_runs"
    ),
    CheckConstraint("reviewer_slot IN (1, 2)", name="carry_forward_reviewer_slot"),
    UniqueConstraint(
        "source_run_id",
        "target_run_id",
        "evidence_kind",
        "source_review_event_id",
        name="uq_carry_forward_source_event",
    ),
    UniqueConstraint(
        "target_run_id",
        "evidence_kind",
        "target_review_event_id",
        name="uq_carry_forward_target_event",
    ),
)
