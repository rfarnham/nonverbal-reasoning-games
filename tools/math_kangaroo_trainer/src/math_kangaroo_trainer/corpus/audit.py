"""Versioned, deterministic Stage 0 parser and review triggers."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from math_kangaroo_trainer.domain.items import (
    AnswerType,
    ImportedItem,
    ItemStatus,
    LearnerSafeItem,
    ProtectedAnswer,
    SourceQuestion,
)
from math_kangaroo_trainer.versions import ITEM_SCHEMA_VERSION


STRONG_DIAGRAM_NOTE = re.compile(
    r"(?:answer choices?.{0,30}(?:graphical|image-only)|prompt depends|"
    r"illustration|image-only|not fully represented|grid and symbols|"
    r"diagram (?:is|that|which|shown)|transparent|source-page choices)",
    re.I,
)
POSSIBLE_DIAGRAM_PROMPT = re.compile(
    r"\b(?:picture|pictures|figure|figures|diagram|drawing|shown|illustration|"
    r"grid|shape|shapes|square|triangle|rectangle|cube|cubes|piece|pieces|"
    r"route|road|path|maze|transparent|fold|mirror|tile|clock face|bead|beads|"
    r"block|blocks|view|pattern|stick|sticks|bowl|bowls|table|gate|gates|"
    r"ball|balls|scale|scales|box|boxes|tree|trees|rubber band|rubber bands|"
    r"photograph|photographs|circle|fish|marked point|marked points|located)\b",
    re.I,
)
RISKY_SOURCE_NOTE = re.compile(
    r"(?:manual|not preserve|not fully|no reliable|merged|skipped|image-only|"
    r"graphical|depends on|ocr|boundary|placeholder)",
    re.I,
)


@dataclass(frozen=True)
class AuditClassification:
    warning_codes: tuple[str, ...]
    content_gap_codes: tuple[str, ...]
    modality: str
    year_band: str
    choice_count_bucket: str
    point_tier: int | None
    answer_type: AnswerType
    status: ItemStatus


def published_point_tier(question: SourceQuestion) -> int | None:
    """Return only an explicitly published tier; never guess from position."""

    match = re.fullmatch(r"\s*([345])[- ]?points?\s*", question.section or "", re.I)
    return int(match.group(1)) if match else None


def answer_type(question: SourceQuestion) -> AnswerType:
    if question.answer_status == "official-void":
        return AnswerType.VOID
    if question.answer_status == "official-multiple":
        return AnswerType.MULTIPLE_CHOICE
    if question.answer_status == "official-verified" and question.official_answer:
        return AnswerType.SINGLE_CHOICE
    return AnswerType.UNKNOWN


def modality(question: SourceQuestion) -> str:
    status = question.extraction_status.lower()
    notes = question.source_notes or ""
    if (
        question.option_count == 0
        or "visual" in status
        or "diagram" in status
        or STRONG_DIAGRAM_NOTE.search(notes)
    ):
        return "diagram_dependent"
    prompt = question.english_stem or question.stem_markdown
    if POSSIBLE_DIAGRAM_PROMPT.search(prompt):
        return "diagram_review_required"
    return "text_extractable"


def year_band(year: int) -> str:
    if year <= 2005:
        return "through_2005"
    if year <= 2012:
        return "2006_2012"
    if year <= 2019:
        return "2013_2019"
    return "2020_and_later"


def choice_count_bucket(count: int) -> str:
    if count == 0:
        return "none_extracted"
    if count == 2:
        return "two"
    if count == 4:
        return "four"
    if count == 5:
        return "five"
    return "other"


def classify(question: SourceQuestion, *, asset_path: Path) -> AuditClassification:
    warnings = list(question.adapter_warning_codes)
    content_gaps = ["OFFICIAL_SOLUTION_NOT_AVAILABLE"]
    point_tier = published_point_tier(question)
    item_modality = modality(question)

    if question.answer_status != "official-verified":
        warnings.append("ANSWER_NOT_SINGLE_VERIFIED")
    if "ocr" in question.extraction_status.lower():
        content_gaps.append("OCR_CONFIDENCE_NOT_AVAILABLE")
    if question.option_count == 0:
        warnings.append("CHOICES_NOT_TEXT_EXTRACTED")
    elif question.option_count not in {4, 5}:
        warnings.append("IRREGULAR_CHOICE_COUNT")
    if item_modality == "diagram_dependent":
        warnings.append("DIAGRAM_DEPENDENT")
    elif item_modality == "diagram_review_required":
        warnings.append("DIAGRAM_DEPENDENCE_REVIEW_REQUIRED")
    risky_markers = ("ocr", "manual", "partial", "visual", "boundary")
    if any(marker in question.extraction_status.lower() for marker in risky_markers):
        warnings.append("PARSER_REVIEW_REQUIRED")
    if question.english_helper_needed:
        warnings.append("TRANSLATION_HELPER_USED")
        if question.translation_review_status != "translated":
            warnings.append("TRANSLATION_REVIEW_STATUS_UNRESOLVED")
    if question.page != question.end_page:
        warnings.append("MULTI_PAGE_BOUNDARY")
    if not question.visual_verified:
        warnings.append("VISUAL_NOT_VERIFIED")
    if not asset_path.is_file():
        warnings.append("ASSET_MISSING")
    elif asset_path.stat().st_size != question.image_bytes:
        warnings.append("ASSET_BYTE_COUNT_MISMATCH")
    if question.crop_status != "indexed":
        warnings.append("NONSTANDARD_CROP_BOUNDARY")
    if question.source_notes and RISKY_SOURCE_NOTE.search(question.source_notes):
        warnings.append("SOURCE_NOTE_REVIEW_REQUIRED")
    if question.answer_notes:
        warnings.append("ANSWER_NOTE_REVIEW_REQUIRED")
    if point_tier is None:
        content_gaps.append("PUBLISHED_POINT_TIER_UNKNOWN")

    deduplicated = tuple(sorted(set(warnings)))
    status = ItemStatus.NEEDS_REVIEW if deduplicated else ItemStatus.PARSED
    return AuditClassification(
        warning_codes=deduplicated,
        content_gap_codes=tuple(sorted(set(content_gaps))),
        modality=item_modality,
        year_band=year_band(question.year),
        choice_count_bucket=choice_count_bucket(question.option_count),
        point_tier=point_tier,
        answer_type=answer_type(question),
        status=status,
    )


def _asset_checksum(asset_path: Path) -> str:
    if not asset_path.is_file():
        return "missing"
    digest = hashlib.sha256()
    with asset_path.open("rb") as asset:
        for chunk in iter(lambda: asset.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _content_version(question: SourceQuestion, *, asset_path: Path) -> str:
    content = {
        "source_question": question.model_dump(mode="json"),
        "asset_sha256": _asset_checksum(asset_path),
    }
    encoded = json.dumps(
        content, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def import_question(question: SourceQuestion, *, asset_path: Path) -> ImportedItem:
    classification = classify(question, asset_path=asset_path)
    content_version = _content_version(question, asset_path=asset_path)
    learner = LearnerSafeItem(
        item_id=question.item_id,
        content_version=content_version,
        source_collection=question.source_collection,
        source_file_id=question.source_file_id,
        source_checksum=question.source_checksum,
        year=question.year,
        contest_track_or_grade_band=question.grade_band,
        question_number=question.question_number,
        published_point_value_or_tier=classification.point_tier,
        language=question.language,
        stem_markdown=question.english_stem or question.stem_markdown,
        choices=question.english_choices or question.choices,
        answer_type=classification.answer_type,
        asset_ids=(question.asset_id,),
        status=classification.status,
        license_or_use_status="private-research-only",
        schema_version=ITEM_SCHEMA_VERSION,
    )
    protected = ProtectedAnswer(
        item_id=question.item_id,
        content_version=content_version,
        official_answer=question.official_answer,
        answer_status=question.answer_status,
        answer_source_label=question.answer_source_label,
        answer_source_file=question.answer_source_file,
        answer_source_url=question.answer_source_url,
    )
    return ImportedItem(
        source=question,
        learner=learner,
        protected=protected,
        warning_codes=classification.warning_codes,
        content_gap_codes=classification.content_gap_codes,
        modality=classification.modality,
        year_band=classification.year_band,
        choice_count_bucket=classification.choice_count_bucket,
    )
