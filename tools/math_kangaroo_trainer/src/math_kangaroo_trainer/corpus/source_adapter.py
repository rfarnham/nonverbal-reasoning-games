"""Read-only adapter for the private complete-question-bank SQLite database."""

from __future__ import annotations

import json
import hashlib
import math
import re
import sqlite3
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path
from urllib.parse import quote

from math_kangaroo_trainer.domain.items import SourceDocument, SourceQuestion


REQUIRED_COLUMNS = frozenset(
    {
        "id",
        "source",
        "source_label",
        "source_family",
        "corpus_group",
        "year",
        "grade",
        "paper_part",
        "section",
        "competition_level",
        "question",
        "page",
        "end_page",
        "language",
        "prompt_text",
        "options_json",
        "option_count",
        "english_prompt_text",
        "english_options_json",
        "english_helper_needed",
        "english_prompt_status",
        "english_options_status",
        "translation_source_language",
        "translation_method",
        "translation_review_status",
        "translation_notes",
        "extraction_status",
        "visual_verified",
        "answer",
        "answer_status",
        "answer_source_label",
        "answer_source_file",
        "answer_source_url",
        "answer_notes",
        "notes",
        "source_pdf_url",
        "source_archive_url",
        "source_pdf_sha256",
        "image",
        "image_width",
        "image_height",
        "image_bytes",
        "crop_status",
        "crop_top_points",
        "crop_bottom_points",
        "source_page_link",
        "answer_source_link",
    }
)
REQUIRED_SOURCE_COLUMNS = frozenset(
    {
        "source",
        "source_family",
        "source_label",
        "years_json",
        "grades_json",
        "question_count",
        "page_count",
        "bytes",
        "sha256",
        "official_pdf_url",
        "official_archive_url",
        "manifest_notes",
        "pdf_link",
    }
)

QUESTION_QUERY = """
    SELECT
        rowid AS _rowid, id, source, source_label, source_family,
        corpus_group, year, grade, paper_part, section, competition_level,
        question, page, end_page, language, prompt_text, options_json,
        option_count, english_prompt_text, english_options_json,
        english_helper_needed, english_prompt_status, english_options_status,
        translation_source_language, translation_method,
        translation_review_status, translation_notes, extraction_status,
        visual_verified, answer, answer_status, answer_source_label,
        answer_source_file, answer_source_url, answer_notes, notes,
        source_pdf_url, source_archive_url, source_pdf_sha256, image,
        image_width, image_height, image_bytes, crop_status, crop_top_points,
        crop_bottom_points, source_page_link, answer_source_link
    FROM questions
    ORDER BY id
"""

SOURCE_QUERY = """
    SELECT rowid AS _rowid, source, source_family, source_label, years_json,
           grades_json, question_count, page_count, bytes, sha256,
           official_pdf_url, official_archive_url, manifest_notes, pdf_link
    FROM sources
    ORDER BY source
"""


class SourceSchemaError(RuntimeError):
    """The canonical bank does not match the adapter's versioned contract."""


class CompleteBankAdapter:
    """Open the canonical corpus with SQLite write operations disabled."""

    def __init__(self, source_path: Path, *, asset_root: Path | None = None) -> None:
        self.source_path = source_path.resolve()
        self.asset_root = (
            asset_root.resolve()
            if asset_root is not None
            else (self.source_path.parent.parent / "report").resolve()
        )
        self.source_scope_root = self.source_path.parent.parent.parent.resolve()

    def connect(self) -> sqlite3.Connection:
        encoded_path = quote(self.source_path.as_posix(), safe="/")
        connection = sqlite3.connect(
            f"file:{encoded_path}?mode=ro",
            uri=True,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only = ON")
        return connection

    def validate(self) -> None:
        with closing(self.connect()) as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise SourceSchemaError(f"source integrity check failed: {integrity}")
            rows = connection.execute("PRAGMA table_info(questions)").fetchall()
            columns = {str(row[1]) for row in rows}
            missing = sorted(REQUIRED_COLUMNS - columns)
            if missing:
                raise SourceSchemaError(
                    "questions table is missing required columns: " + ", ".join(missing)
                )
            source_rows = connection.execute("PRAGMA table_info(sources)").fetchall()
            source_columns = {str(row[1]) for row in source_rows}
            source_missing = sorted(REQUIRED_SOURCE_COLUMNS - source_columns)
            if source_missing:
                raise SourceSchemaError(
                    "sources table is missing required columns: "
                    + ", ".join(source_missing)
                )

    def count(self) -> int:
        with closing(self.connect()) as connection:
            return int(connection.execute("SELECT COUNT(*) FROM questions").fetchone()[0])

    def iter_questions(self) -> Iterator[SourceQuestion]:
        self.validate()
        with closing(self.connect()) as connection:
            for row in connection.execute(QUESTION_QUERY):
                yield self._map_row(row)

    def iter_sources(self) -> Iterator[SourceDocument]:
        self.validate()
        with closing(self.connect()) as connection:
            for row in connection.execute(SOURCE_QUERY):
                yield self._map_source(row)

    def snapshot(
        self,
    ) -> tuple[tuple[SourceQuestion, ...], tuple[SourceDocument, ...]]:
        """Read questions and source manifests from one consistent transaction."""

        self.validate()
        with closing(self.connect()) as connection:
            connection.execute("BEGIN")
            questions = tuple(
                self._map_row(row) for row in connection.execute(QUESTION_QUERY)
            )
            sources = tuple(
                self._map_source(row) for row in connection.execute(SOURCE_QUERY)
            )
            connection.rollback()
        return questions, sources

    def asset_path(self, question: SourceQuestion) -> Path:
        candidate = (self.asset_root / question.asset_id).resolve()
        try:
            candidate.relative_to(self.asset_root)
        except ValueError as error:
            raise SourceSchemaError(
                f"{question.item_id}: asset path escapes the configured asset root"
            ) from error
        return candidate

    @staticmethod
    def _parse_choices(
        raw: str, *, item_id: str, field: str
    ) -> tuple[tuple[str, ...], tuple[str, ...]]:
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return (), (f"{field.upper()}_INVALID_JSON",)
        if not isinstance(value, list) or not all(isinstance(choice, str) for choice in value):
            return (), (f"{field.upper()}_NOT_STRING_ARRAY",)
        return tuple(value), ()

    @staticmethod
    def _parse_scalar_array(raw: str, expected_type: type) -> tuple[tuple, bool]:
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return (), False
        if not isinstance(value, list) or not all(
            isinstance(element, expected_type) for element in value
        ):
            return (), False
        return tuple(value), True

    @staticmethod
    def _raw_evidence(value: object) -> str:
        return "<NULL>" if value is None else repr(value)

    @classmethod
    def _safe_required_text(
        cls,
        value: object,
        *,
        field: str,
        warnings: list[str],
        field_errors: dict[str, str],
        fallback: str,
        redact: bool = False,
    ) -> str:
        if isinstance(value, str) and value.strip():
            return value
        warnings.append(f"{field.upper()}_INVALID")
        if value in (None, ""):
            evidence = "<NULL>" if value is None else "<BLANK>"
        elif redact:
            evidence = f"<INVALID_{type(value).__name__.upper()}>"
        else:
            evidence = cls._raw_evidence(value)
        field_errors[field] = evidence
        return fallback

    @classmethod
    def _safe_bool(
        cls,
        value: object,
        *,
        field: str,
        warnings: list[str],
        field_errors: dict[str, str],
        fallback: bool = False,
    ) -> bool:
        if value in (0, 1) and not isinstance(value, str):
            return bool(value)
        if isinstance(value, str) and value.strip().lower() in {
            "0",
            "1",
            "false",
            "true",
        }:
            warnings.append(f"{field.upper()}_NONCANONICAL")
            field_errors[field] = cls._raw_evidence(value)
            return value.strip().lower() in {"1", "true"}
        warnings.append(f"{field.upper()}_INVALID")
        field_errors[field] = cls._raw_evidence(value)
        return fallback

    @classmethod
    def _safe_sha256(
        cls,
        value: object,
        *,
        field: str,
        warnings: list[str],
        field_errors: dict[str, str],
    ) -> str:
        if isinstance(value, str) and re.fullmatch(r"[0-9a-fA-F]{64}", value):
            return value.lower()
        warnings.append(f"{field.upper()}_INVALID")
        field_errors[field] = cls._raw_evidence(value)
        return "0" * 64

    @classmethod
    def _safe_int(
        cls,
        value: object,
        *,
        field: str,
        warnings: list[str],
        field_errors: dict[str, str],
        minimum: int,
        fallback: int,
        maximum: int | None = None,
    ) -> int:
        valid_shape = isinstance(value, int) and not isinstance(value, bool)
        if isinstance(value, str) and re.fullmatch(r"[+-]?\d+", value.strip()):
            valid_shape = True
        try:
            parsed = int(value) if valid_shape else fallback
        except (TypeError, ValueError, OverflowError):
            parsed = fallback
            valid_shape = False
        valid_range = parsed >= minimum and (
            maximum is None or parsed <= maximum
        )
        if not valid_shape or not valid_range:
            warnings.append(f"{field.upper()}_INVALID")
            field_errors[field] = cls._raw_evidence(value)
            return fallback
        return parsed

    @classmethod
    def _safe_float(
        cls,
        value: object,
        *,
        field: str,
        warnings: list[str],
        field_errors: dict[str, str],
        minimum: float,
        fallback: float | None,
        nullable: bool = False,
    ) -> float | None:
        if value is None and nullable:
            return None
        try:
            parsed = float(value)
        except (TypeError, ValueError, OverflowError):
            parsed = math.nan
        if not math.isfinite(parsed) or parsed < minimum:
            warnings.append(f"{field.upper()}_INVALID")
            field_errors[field] = cls._raw_evidence(value)
            return fallback
        return parsed

    def _map_source(self, row: sqlite3.Row) -> SourceDocument:
        warnings: list[str] = []
        field_errors: dict[str, str] = {}
        source_id = self._safe_required_text(
            row["source"], field="source", warnings=warnings,
            field_errors=field_errors,
            fallback=f"unknown-source-{row['_rowid']}.pdf",
        )
        years, years_valid = self._parse_scalar_array(str(row["years_json"]), int)
        grades, grades_valid = self._parse_scalar_array(str(row["grades_json"]), str)
        if not years_valid:
            warnings.append("SOURCE_YEARS_INVALID_JSON")
        if not grades_valid:
            warnings.append("SOURCE_GRADES_INVALID_JSON")
        pdf_link = self._safe_required_text(
            row["pdf_link"], field="source_pdf_link", warnings=warnings,
            field_errors=field_errors,
            fallback=f"sources/missing-source-{row['_rowid']}.pdf",
        )
        source_family = self._safe_required_text(
            row["source_family"], field="source_family", warnings=warnings,
            field_errors=field_errors, fallback="unknown-source-family",
        )
        source_label = self._safe_required_text(
            row["source_label"], field="source_label", warnings=warnings,
            field_errors=field_errors, fallback="Unknown source",
        )
        question_count = self._safe_int(
            row["question_count"], field="source_question_count",
            warnings=warnings, field_errors=field_errors, minimum=1, fallback=1,
        )
        page_count = self._safe_int(
            row["page_count"], field="source_page_count", warnings=warnings,
            field_errors=field_errors, minimum=1, fallback=1,
        )
        declared_bytes = self._safe_int(
            row["bytes"], field="source_bytes", warnings=warnings,
            field_errors=field_errors, minimum=1, fallback=1,
        )
        declared_sha256 = self._safe_sha256(
            row["sha256"], field="source_sha256", warnings=warnings,
            field_errors=field_errors,
        )
        local_path = (self.asset_root / pdf_link).resolve()
        try:
            local_path.relative_to(self.source_scope_root)
        except ValueError as error:
            raise SourceSchemaError(
                f"{source_id}: source PDF link escapes the private work scope"
            ) from error
        actual_bytes: int | None = None
        actual_sha256: str | None = None
        if not local_path.is_file():
            warnings.append("SOURCE_PDF_MISSING")
        else:
            actual_bytes = local_path.stat().st_size
            digest = hashlib.sha256()
            with local_path.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            actual_sha256 = digest.hexdigest()
            if actual_bytes != declared_bytes:
                warnings.append("SOURCE_PDF_BYTE_COUNT_MISMATCH")
            if actual_sha256 != declared_sha256:
                warnings.append("SOURCE_PDF_CHECKSUM_MISMATCH")
        return SourceDocument(
            source_path=source_id,
            source_family=source_family,
            source_label=source_label,
            years=years,
            grade_bands=grades,
            question_count=question_count,
            page_count=page_count,
            declared_bytes=declared_bytes,
            declared_sha256=declared_sha256,
            official_pdf_url=(
                str(row["official_pdf_url"])
                if row["official_pdf_url"] not in (None, "")
                else None
            ),
            official_archive_url=(
                str(row["official_archive_url"])
                if row["official_archive_url"] not in (None, "")
                else None
            ),
            manifest_notes=(
                str(row["manifest_notes"])
                if row["manifest_notes"] not in (None, "")
                else None
            ),
            pdf_link=pdf_link,
            local_pdf_path=str(local_path),
            actual_bytes=actual_bytes,
            actual_sha256=actual_sha256,
            warning_codes=tuple(sorted(set(warnings))),
            adapter_field_errors=field_errors,
        )

    def _map_row(self, row: sqlite3.Row) -> SourceQuestion:
        adapter_warnings: list[str] = []
        field_errors: dict[str, str] = {}
        item_id = self._safe_required_text(
            row["id"], field="id", warnings=adapter_warnings,
            field_errors=field_errors,
            fallback=f"ingestion-row-{row['_rowid']}",
        )
        raw_options = (
            row["options_json"] if isinstance(row["options_json"], str) else ""
        )
        raw_english_options = (
            row["english_options_json"]
            if isinstance(row["english_options_json"], str)
            else ""
        )
        choices, choice_warnings = self._parse_choices(
            raw_options, item_id=item_id, field="options_json"
        )
        english_choices, english_choice_warnings = self._parse_choices(
            raw_english_options,
            item_id=item_id,
            field="english_options_json",
        )
        option_count = self._safe_int(
            row["option_count"],
            field="option_count",
            warnings=adapter_warnings,
            field_errors=field_errors,
            minimum=0,
            fallback=len(choices),
        )
        adapter_warnings.extend((*choice_warnings, *english_choice_warnings))
        if option_count != len(choices):
            adapter_warnings.append("OPTION_COUNT_MISMATCH")
        year = self._safe_int(
            row["year"], field="year", warnings=adapter_warnings,
            field_errors=field_errors, minimum=1900, maximum=2200, fallback=1900
        )
        question_number = self._safe_int(
            row["question"], field="question", warnings=adapter_warnings,
            field_errors=field_errors, minimum=1, fallback=1
        )
        page = self._safe_int(
            row["page"], field="page", warnings=adapter_warnings,
            field_errors=field_errors, minimum=1, fallback=1
        )
        end_page = self._safe_int(
            row["end_page"], field="end_page", warnings=adapter_warnings,
            field_errors=field_errors, minimum=1, fallback=page
        )
        if end_page < page:
            adapter_warnings.append("END_PAGE_BEFORE_PAGE")
            field_errors["end_page"] = self._raw_evidence(row["end_page"])
            end_page = page
        image_width = self._safe_int(
            row["image_width"], field="image_width", warnings=adapter_warnings,
            field_errors=field_errors, minimum=1, fallback=1
        )
        image_height = self._safe_int(
            row["image_height"], field="image_height", warnings=adapter_warnings,
            field_errors=field_errors, minimum=1, fallback=1
        )
        image_bytes = self._safe_int(
            row["image_bytes"], field="image_bytes", warnings=adapter_warnings,
            field_errors=field_errors, minimum=1, fallback=1
        )
        crop_top_points = self._safe_float(
            row["crop_top_points"], field="crop_top_points",
            warnings=adapter_warnings, field_errors=field_errors,
            minimum=0, fallback=0.0
        )
        crop_bottom_points = self._safe_float(
            row["crop_bottom_points"], field="crop_bottom_points",
            warnings=adapter_warnings, field_errors=field_errors,
            minimum=0, fallback=None, nullable=True
        )
        source_path = self._safe_required_text(
            row["source"], field="source", warnings=adapter_warnings,
            field_errors=field_errors,
            fallback=f"unknown-source/ingestion-row-{row['_rowid']}.pdf",
        )
        source_collection = self._safe_required_text(
            row["corpus_group"], field="corpus_group", warnings=adapter_warnings,
            field_errors=field_errors, fallback="unknown-corpus",
        )
        source_label = self._safe_required_text(
            row["source_label"], field="source_label", warnings=adapter_warnings,
            field_errors=field_errors, fallback="Unknown source",
        )
        source_family = self._safe_required_text(
            row["source_family"], field="source_family", warnings=adapter_warnings,
            field_errors=field_errors, fallback="unknown-source-family",
        )
        source_checksum = self._safe_sha256(
            row["source_pdf_sha256"], field="source_pdf_sha256",
            warnings=adapter_warnings, field_errors=field_errors,
        )
        grade_band = self._safe_required_text(
            row["grade"], field="grade", warnings=adapter_warnings,
            field_errors=field_errors, fallback="unknown-grade",
        )
        paper_part = self._safe_required_text(
            row["paper_part"], field="paper_part", warnings=adapter_warnings,
            field_errors=field_errors, fallback="unknown-part",
        )
        language = self._safe_required_text(
            row["language"], field="language", warnings=adapter_warnings,
            field_errors=field_errors, fallback="unknown-language",
        )
        stem = self._safe_required_text(
            row["prompt_text"], field="prompt_text", warnings=adapter_warnings,
            field_errors=field_errors, fallback="", redact=True,
        )
        english_stem = (
            row["english_prompt_text"]
            if isinstance(row["english_prompt_text"], str)
            else ""
        )
        english_prompt_status = self._safe_required_text(
            row["english_prompt_status"], field="english_prompt_status",
            warnings=adapter_warnings, field_errors=field_errors,
            fallback="invalid",
        )
        english_options_status = self._safe_required_text(
            row["english_options_status"], field="english_options_status",
            warnings=adapter_warnings, field_errors=field_errors,
            fallback="invalid",
        )
        extraction_status = self._safe_required_text(
            row["extraction_status"], field="extraction_status",
            warnings=adapter_warnings, field_errors=field_errors,
            fallback="invalid-needs-review",
        )
        answer_status = self._safe_required_text(
            row["answer_status"], field="answer_status", warnings=adapter_warnings,
            field_errors=field_errors, fallback="invalid-needs-review",
        )
        asset_id = self._safe_required_text(
            row["image"], field="image", warnings=adapter_warnings,
            field_errors=field_errors,
            fallback=f"assets/questions/missing-{item_id}.webp",
        )
        crop_status = self._safe_required_text(
            row["crop_status"], field="crop_status", warnings=adapter_warnings,
            field_errors=field_errors, fallback="invalid-needs-review",
        )
        source_page_link = self._safe_required_text(
            row["source_page_link"], field="source_page_link",
            warnings=adapter_warnings, field_errors=field_errors,
            fallback="unavailable",
        )
        english_helper_needed = self._safe_bool(
            row["english_helper_needed"], field="english_helper_needed",
            warnings=adapter_warnings, field_errors=field_errors,
        )
        visual_verified = self._safe_bool(
            row["visual_verified"], field="visual_verified",
            warnings=adapter_warnings, field_errors=field_errors,
        )
        return SourceQuestion(
            item_id=item_id,
            source_collection=source_collection,
            source_path=source_path,
            source_file_id=Path(source_path).name,
            source_label=source_label,
            source_checksum=source_checksum,
            source_family=source_family,
            corpus_group=source_collection,
            year=year,
            grade_band=grade_band,
            paper_part=paper_part,
            section=str(row["section"]) if row["section"] is not None else None,
            competition_level=(
                str(row["competition_level"])
                if row["competition_level"] not in (None, "")
                else None
            ),
            question_number=question_number,
            page=page,
            end_page=end_page,
            language=language,
            stem_markdown=stem,
            raw_options_json=raw_options,
            choices=choices,
            english_stem=english_stem,
            raw_english_options_json=raw_english_options,
            english_choices=english_choices,
            english_helper_needed=english_helper_needed,
            english_prompt_status=english_prompt_status,
            english_options_status=english_options_status,
            translation_source_language=(
                str(row["translation_source_language"])
                if row["translation_source_language"] not in (None, "")
                else None
            ),
            translation_method=(
                str(row["translation_method"])
                if row["translation_method"] not in (None, "")
                else None
            ),
            translation_review_status=(
                str(row["translation_review_status"])
                if row["translation_review_status"] not in (None, "")
                else None
            ),
            translation_notes=(
                str(row["translation_notes"])
                if row["translation_notes"] not in (None, "")
                else None
            ),
            extraction_status=extraction_status,
            adapter_warning_codes=tuple(sorted(set(adapter_warnings))),
            adapter_field_errors=field_errors,
            visual_verified=visual_verified,
            official_answer=str(row["answer"]) if row["answer"] is not None else None,
            answer_status=answer_status,
            answer_source_label=(
                str(row["answer_source_label"])
                if row["answer_source_label"] is not None
                else None
            ),
            answer_source_file=(
                str(row["answer_source_file"])
                if row["answer_source_file"] is not None
                else None
            ),
            answer_source_url=(
                str(row["answer_source_url"])
                if row["answer_source_url"] is not None
                else None
            ),
            answer_notes=(
                str(row["answer_notes"])
                if row["answer_notes"] not in (None, "")
                else None
            ),
            source_notes=(
                str(row["notes"]) if row["notes"] not in (None, "") else None
            ),
            source_pdf_url=(
                str(row["source_pdf_url"])
                if row["source_pdf_url"] not in (None, "")
                else None
            ),
            source_archive_url=(
                str(row["source_archive_url"])
                if row["source_archive_url"] not in (None, "")
                else None
            ),
            asset_id=asset_id,
            image_width=image_width,
            image_height=image_height,
            image_bytes=image_bytes,
            crop_status=crop_status,
            crop_top_points=crop_top_points,
            crop_bottom_points=crop_bottom_points,
            source_page_link=source_page_link,
            answer_source_link=(
                str(row["answer_source_link"])
                if row["answer_source_link"] not in (None, "")
                else None
            ),
            option_count=option_count,
        )
