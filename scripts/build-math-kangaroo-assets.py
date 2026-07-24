#!/usr/bin/env python3
"""Build prompt-free selected Math Kangaroo illustration composites.

This is a conservative first-pass asset builder. It renders only the selected
question interval from the private source PDF, removes embedded prose using the
PDF word boxes, replaces punctuated source option markers with 1-5 when all
five can be located, trims surrounding whitespace, and writes a public
question-scoped WebP.

An automatically cleaned crop is never promoted on its own. A crop becomes
``release-ready`` only when its decoded-pixel digest exactly matches a
separately recorded manual review in ``asset-release-reviews.json``. Any later
rendering change invalidates that review and returns the crop to the visual-QA
queue.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import shutil
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium
from PIL import Image, ImageChops, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "work/math-kangaroo-spatial-review"
MANIFEST = (
    ROOT
    / "app/journey/reviews/math-kangaroo/data/selection-manifest.json"
)
AUDIT = ROOT / "app/journey/reviews/math-kangaroo/data/asset-build-audit.json"
ASSET_CLEANUP_OVERRIDES = (
    ROOT
    / "app/journey/reviews/math-kangaroo/data/asset-cleanup-overrides.json"
)
ASSET_RELEASE_REVIEWS = (
    ROOT
    / "app/journey/reviews/math-kangaroo/data/asset-release-reviews.json"
)
PUBLIC_DIR = ROOT / "public/journey/math-kangaroo"
RENDER_DPI = 200
PAGE_MARGIN_POINTS = 18.0

# Older papers use ``A)`` while newer papers usually use ``(A)``. Match both
# punctuated forms, but deliberately do not match a bare A-E because those
# letters often label meaningful pieces inside a diagram.
OPTION_MARKER = re.compile(
    r"^(?:\(([A-EΑΒΓΔΕ])\)(?:[A-Za-z]{1,3})?|([A-EΑΒΓΔΕ])[\).])$"
)
# A few scans use the unusual ``19.)`` form in addition to ``19.``/``19)``.
QUESTION_MARKER = re.compile(r"^(\d+)[.)]{1,2}$")
GREEK = re.compile(r"[\u0370-\u03ff\u1f00-\u1fff]")
GREEK_LETTER = re.compile(r"[\u0370-\u03ff\u1f00-\u1fff]")
LATIN_WORD = re.compile(r"[A-Za-z]{2,}")
PRESERVE_LABELS = {
    "START",
    "FINISH",
    "TOP",
    "FRONT",
    "BACK",
    "LEFT",
    "RIGHT",
    "OPEN",
    "CLOSE",
}
PRESERVE_LINE_PHRASES = {
    "ground floor",
    "first floor",
}


def clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def reject_duplicate_json_keys(
    pairs: list[tuple[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def asset_release_reviews() -> dict[str, dict[str, Any]]:
    if not ASSET_RELEASE_REVIEWS.exists():
        return {}
    payload = json.loads(
        ASSET_RELEASE_REVIEWS.read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicate_json_keys,
    )
    if payload.get("schemaVersion") != 1:
        raise ValueError("Unsupported Math Kangaroo asset review schema")
    items = payload.get("items")
    if not isinstance(items, dict):
        raise ValueError("Math Kangaroo asset reviews need an items object")
    return items


def decoded_asset_fingerprint(path: Path) -> str:
    """Hash the pixels players receive, independent of WebP file metadata."""

    with Image.open(path) as source:
        image = source.convert("RGBA")
        digest = hashlib.sha256()
        digest.update(f"{image.width}x{image.height}:RGBA:".encode("ascii"))
        digest.update(image.tobytes())
        return digest.hexdigest()


def release_review_matches(
    review: dict[str, Any] | None,
    fingerprint: str,
) -> bool:
    return bool(
        review
        and review.get("pixelSha256") == fingerprint
        and review.get("promptFree") is True
        and review.get("optionsRelabeled") is True
        and review.get("diagramComplete") is True
        and review.get("reviewed") is True
    )


def greek_letter_count(value: str) -> int:
    return len(GREEK_LETTER.findall(value))


def option_markers_in_line(
    line: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return answer markers without mistaking sentence-final ``A.``–``E.``.

    Older papers sometimes write answer rows as ``A. ...`` instead of
    ``(A) ...``. A bare punctuated letter is only an option marker when it
    starts its line or when the line contains several such markers. This keeps
    prose such as ``but not to D. She can...`` from expanding a semantic
    answer-row mask over the puzzle diagram.
    """

    candidates = [
        word
        for word in line
        if OPTION_MARKER.fullmatch(clean(word["text"]))
    ]
    if not candidates:
        return []
    parenthesized = [
        word
        for word in candidates
        if clean(word["text"]).startswith("(")
    ]
    if parenthesized:
        return parenthesized
    if len(candidates) > 1:
        return candidates
    first_x = min(float(word["x0"]) for word in line)
    return [
        word
        for word in candidates
        if abs(float(word["x0"]) - first_x) <= 2.0
    ]


def source_id(source: str) -> str:
    path = Path(source)
    return f"{path.parent.name}--{path.stem}"


def words_path(source: str, page: int) -> Path:
    return (
        CORPUS
        / "data/pages"
        / source_id(source)
        / f"page-{page:04d}.words.json"
    )


def page_words(source: str, page: int) -> tuple[float, float, list[dict[str, Any]]]:
    path = words_path(source, page)
    payload = json.loads(path.read_text(encoding="utf-8"))
    return (
        float(payload["width_points"]),
        float(payload["height_points"]),
        list(payload["words"]),
    )


def question_index() -> dict[tuple[str, str, int], dict[str, Any]]:
    payload = json.loads(
        (CORPUS / "data/questions_raw.json").read_text(encoding="utf-8")
    )
    return {
        (
            clean(item["source"]),
            clean(item["grade"]),
            int(item["question_number"]),
        ): item
        for item in payload["questions"]
    }


def asset_cleanup_overrides() -> dict[str, dict[str, Any]]:
    if not ASSET_CLEANUP_OVERRIDES.exists():
        return {}
    payload = json.loads(
        ASSET_CLEANUP_OVERRIDES.read_text(encoding="utf-8")
    )
    rounds = payload.get("rounds", {})
    if not isinstance(rounds, dict):
        raise ValueError("Asset cleanup overrides need a rounds object.")
    return rounds


def marker_on_page(
    source: str, page: int, question: int
) -> dict[str, Any] | None:
    _, _, words = page_words(source, page)
    matches = []
    for word in words:
        text = clean(word["text"])
        match = QUESTION_MARKER.fullmatch(text)
        if match and int(match.group(1)) == question:
            matches.append(word)
    if not matches:
        for word in words:
            if clean(word["text"]) == str(question):
                matches.append(word)
    if not matches:
        return None
    leftmost = min(float(word["x0"]) for word in matches)
    matches = [
        word for word in matches if abs(float(word["x0"]) - leftmost) < 1.0
    ]
    return matches[0] if len(matches) == 1 else None


def locate_question(
    source: str,
    grade: str,
    question: int,
    fallback_page: int,
    indexed: dict[tuple[str, str, int], dict[str, Any]],
) -> tuple[int, float] | None:
    item = indexed.get((source, grade, question))
    if item:
        bbox = item.get("start_bbox_points") or {}
        top = float(bbox.get("top", 0))
        if top > 0:
            return int(item["start_page"]), top
    marker = marker_on_page(source, fallback_page, question)
    if marker:
        return fallback_page, float(marker["top"])
    return None


def locate_next_question(
    source: str,
    grade: str,
    question: int,
    start_page: int,
    fallback_end_page: int,
    indexed: dict[tuple[str, str, int], dict[str, Any]],
) -> tuple[int, float] | None:
    item = indexed.get((source, grade, question + 1))
    if item:
        bbox = item.get("start_bbox_points") or {}
        top = float(bbox.get("top", 0))
        if top > 0:
            return int(item["start_page"]), top
    for page in range(start_page, fallback_end_page + 2):
        path = words_path(source, page)
        if not path.exists():
            continue
        marker = marker_on_page(source, page, question + 1)
        if marker:
            return page, float(marker["top"])
    return None


def group_lines(words: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    lines: list[list[dict[str, Any]]] = []
    for word in sorted(words, key=lambda item: (float(item["top"]), float(item["x0"]))):
        top = float(word["top"])
        matching = next(
            (
                line
                for line in reversed(lines[-5:])
                if abs(float(line[0]["top"]) - top) <= 2.2
            ),
            None,
        )
        if matching is None:
            lines.append([word])
        else:
            matching.append(word)
    for line in lines:
        line.sort(key=lambda item: float(item["x0"]))
    return lines


def greek_prose_start_x(line: list[dict[str, Any]]) -> float | None:
    """Return the x position where a duplicate Greek translation begins.

    Cyprus papers are bilingual. Some English answer rows still use Greek
    glyphs for the C/D marker, so an option marker alone is not evidence that
    the whole line is Greek. A non-marker Greek token is. Older answer tables
    place English and Greek choices side by side on the same PDF text line, so
    only the words at and after the first Greek prose token should be removed.
    """

    prose_starts = [
        float(word["x0"])
        for word in line
        if greek_letter_count(clean(word["text"])) >= 2
        and not OPTION_MARKER.fullmatch(clean(word["text"]))
    ]
    if not prose_starts:
        return None
    prose_start = min(prose_starts)
    preceding_markers = [
        float(word["x0"])
        for word in option_markers_in_line(line)
        if float(word["x0"]) < prose_start
    ]
    # Include the translated row's own marker in the removable region. On a
    # side-by-side bilingual row this is the final marker before Greek prose;
    # on a Greek-only row it is the sole marker.
    return max(preceding_markers, default=prose_start)


def line_has_greek_prose(line: list[dict[str, Any]]) -> bool:
    return greek_prose_start_x(line) is not None


def line_is_footer(line: list[dict[str, Any]]) -> bool:
    normalized = " ".join(clean(word["text"]) for word in line).lower()
    return any(
        phrase in normalized
        for phrase in (
            "thales foundation",
            "thales cyprus",
            "kangourou mathematics competition",
            "kangaroo mathematics competition",
            "point problems",
            "points problems",
            "μονάδες",
        )
    )


def usable_option_markers(
    words: list[dict[str, Any]],
    top_points: float,
    bottom_points: float,
) -> list[dict[str, Any]]:
    """Locate one English/diagram choice row, excluding Greek duplicates."""

    markers: list[dict[str, Any]] = []
    for line in group_lines(words):
        line_top = min(float(word["top"]) for word in line)
        line_bottom = max(float(word["bottom"]) for word in line)
        if line_bottom < top_points or line_top > bottom_points:
            continue
        greek_start = greek_prose_start_x(line)
        markers.extend(
            word
            for word in option_markers_in_line(line)
            if (
                greek_start is None
                or float(word["x0"]) < greek_start
            )
        )
    return markers


def prose_token(text: str) -> bool:
    stripped = text.strip(".,;:!?\"'“”‘’[]{}")
    if not stripped:
        return False
    if OPTION_MARKER.fullmatch(stripped):
        return False
    if stripped.upper() in PRESERVE_LABELS:
        return False
    return bool(
        greek_letter_count(stripped) >= 2
        or LATIN_WORD.search(stripped)
    )


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/System/Library/Fonts/SFNS.ttf"),
    )
    for path in candidates:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size=size)
            except OSError:
                pass
    return ImageFont.load_default()


def draw_mask(
    draw: ImageDraw.ImageDraw,
    word: dict[str, Any],
    scale_x: float,
    scale_y: float,
    padding: int = 2,
) -> tuple[int, int, int, int]:
    box = (
        max(0, round(float(word["x0"]) * scale_x) - padding),
        max(0, round(float(word["top"]) * scale_y) - padding),
        round(float(word["x1"]) * scale_x) + padding,
        round(float(word["bottom"]) * scale_y) + padding,
    )
    draw.rectangle(box, fill="white")
    return box


def trim_white(image: Image.Image, margin: int = 18) -> Image.Image:
    background = Image.new("RGB", image.size, "white")
    difference = ImageChops.difference(image.convert("RGB"), background).convert("L")
    # Treat faint scan noise as white while retaining normal grey outlines.
    difference = difference.point(lambda value: 255 if value > 18 else 0)
    bbox = difference.getbbox()
    if bbox is None:
        return image
    left, top, right, bottom = bbox
    return image.crop(
        (
            max(0, left - margin),
            max(0, top - margin),
            min(image.width, right + margin),
            min(image.height, bottom + margin),
        )
    )


def compact_tall_blank_bands(
    image: Image.Image,
    *,
    minimum_gap: int = 150,
    retained_gap: int = 28,
) -> Image.Image:
    """Collapse only very large blank vertical gaps left by removed prose.

    The source layout sometimes places a required direction sequence hundreds
    of pixels above its diagram. Masking bilingual prose leaves that whitespace
    inside the crop, so ordinary outer trimming cannot remove it. Keeping a
    small gap preserves grouping without shrinking any puzzle geometry.
    """

    rgb = image.convert("RGB")
    grayscale = ImageOps.grayscale(rgb)
    occupied = [
        grayscale.crop((0, y, grayscale.width, y + 1)).getextrema()[0] < 238
        for y in range(grayscale.height)
    ]
    remove: list[tuple[int, int]] = []
    start: int | None = None
    for y, has_content in enumerate(occupied + [True]):
        if not has_content and start is None:
            start = y
        elif has_content and start is not None:
            gap = y - start
            if gap >= minimum_gap:
                trim = gap - retained_gap
                remove.append(
                    (
                        start + retained_gap // 2,
                        start + retained_gap // 2 + trim,
                    )
                )
            start = None
    if not remove:
        return rgb
    segments: list[Image.Image] = []
    cursor = 0
    for top, bottom in remove:
        if top > cursor:
            segments.append(rgb.crop((0, cursor, rgb.width, top)))
        cursor = bottom
    if cursor < rgb.height:
        segments.append(rgb.crop((0, cursor, rgb.width, rgb.height)))
    output = Image.new(
        "RGB",
        (rgb.width, sum(segment.height for segment in segments)),
        "white",
    )
    offset = 0
    for segment in segments:
        output.paste(segment, (0, offset))
        offset += segment.height
    return output


def tesseract_words(
    image: Image.Image, page_segmentation_mode: int
) -> list[dict[str, Any]]:
    """Return offline OCR boxes used only to remove text baked into scans."""

    executable = shutil.which("tesseract")
    if executable is None:
        return []
    with tempfile.NamedTemporaryFile(suffix=".png") as temporary:
        image.save(temporary.name, "PNG")
        result = subprocess.run(
            [
                executable,
                temporary.name,
                "stdout",
                "--psm",
                str(page_segmentation_mode),
                "tsv",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
    if result.returncode != 0:
        return []
    rows: list[dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(result.stdout), delimiter="\t"):
        if row.get("level") != "5" or not clean(row.get("text")):
            continue
        try:
            rows.append(
                {
                    **row,
                    "left": int(row["left"]),
                    "top": int(row["top"]),
                    "width": int(row["width"]),
                    "height": int(row["height"]),
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    return rows


def raster_prose_line(words: list[dict[str, Any]]) -> bool:
    texts = [clean(word["text"]) for word in words]
    normalized = " ".join(texts).lower()
    if any(phrase in normalized for phrase in PRESERVE_LINE_PHRASES):
        return False
    meaningful = [
        text
        for text in texts
        if re.search(r"[A-Za-z\u0370-\u03ff\u1f00-\u1fff]{2}", text)
        and text.upper().strip(".,;:!?()[]{}") not in PRESERVE_LABELS
    ]
    letter_count = sum(
        len(re.findall(r"[A-Za-z\u0370-\u03ff\u1f00-\u1fff]", text))
        for text in meaningful
    )
    footer = any(
        phrase in normalized
        for phrase in (
            "thales foundation",
            "point problems",
            "points",
            "μονάδες",
        )
    )
    return (
        footer
        or (len(meaningful) >= 3 and letter_count >= 12)
        or (len(meaningful) == 1 and letter_count >= 9)
    )


def postprocess_raster_text(
    image: Image.Image,
    *,
    pdf_option_marker_count: int,
    semantic_choices: bool,
) -> tuple[Image.Image, dict[str, Any]]:
    """Mask prose that has no PDF text layer and relabel scanned choices."""

    cleaned_image = image.convert("RGB").copy()
    draw = ImageDraw.Draw(cleaned_image)
    sparse_words = tesseract_words(cleaned_image, 11)
    dense_words = tesseract_words(cleaned_image, 6)
    raster_markers = [
        word
        for word in dense_words
        if OPTION_MARKER.fullmatch(clean(word["text"]))
    ]
    raster_markers.sort(
        key=lambda word: (
            round(int(word["top"]) / 12),
            int(word["left"]),
        )
    )
    if raster_markers:
        first_marker_top = min(
            int(word["top"]) for word in raster_markers
        )
    elif pdf_option_marker_count == 5:
        # Embedded source choices were already relabelled and their textual
        # content must remain. The PDF word pass has already removed its prompt.
        first_marker_top = 0
    else:
        # With no readable raster marker, restrict prompt cleanup to the upper
        # portion instead of erasing legitimate textual choices.
        first_marker_top = round(cleaned_image.height * 0.58)
    lines: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for word in sparse_words:
        lines[
            (
                str(word.get("block_num")),
                str(word.get("par_num")),
                str(word.get("line_num")),
            )
        ].append(word)
    removed_lines = 0
    removed_words = 0
    for words in lines.values():
        normalized = " ".join(clean(word["text"]) for word in words).lower()
        is_footer = any(
            phrase in normalized
            for phrase in (
                "thales foundation",
                "thales cyprus",
                "kangourou mathematics competition",
                "kangaroo mathematics competition",
                "point problems",
                "points problems",
                "μονάδες",
            )
        )
        has_greek = any(
            GREEK.search(clean(word["text"])) for word in words
        )
        line_bottom = max(
            int(word["top"]) + int(word["height"]) for word in words
        )
        # Preserve textual answer choices below their first source marker.
        # Earlier cleanup erased those choices because it treated prose in the
        # entire raster crop as prompt text.
        if not is_footer and not has_greek and (
            line_bottom >= first_marker_top - 4
            or not raster_prose_line(words)
        ):
            continue
        left = min(int(word["left"]) for word in words)
        top = min(int(word["top"]) for word in words)
        right = max(
            int(word["left"]) + int(word["width"]) for word in words
        )
        bottom = max(
            int(word["top"]) + int(word["height"]) for word in words
        )
        draw.rectangle(
            (
                max(0, left - 5),
                max(0, top - 4),
                min(cleaned_image.width, right + 5),
                min(cleaned_image.height, bottom + 4),
            ),
            fill="white",
        )
        removed_lines += 1
        removed_words += len(words)

    # Dense-layout OCR is much better at finding five raster-only (A)-(E)
    # labels. PDF-layer labels have already become 1-5 and therefore do not
    # match this expression.
    markers = [
        word
        for word in tesseract_words(cleaned_image, 6)
        if OPTION_MARKER.fullmatch(clean(word["text"]))
    ]
    markers.sort(
        key=lambda word: (
            round(int(word["top"]) / 12),
            int(word["left"]),
        )
    )
    if semantic_choices and markers:
        first_top = min(int(word["top"]) for word in markers)
        answer_words = [
            word
            for word in tesseract_words(cleaned_image, 6)
            if int(word["top"]) >= first_top - 8
        ]
        if answer_words:
            left = min(int(word["left"]) for word in answer_words)
            top = min(int(word["top"]) for word in answer_words)
            right = max(
                int(word["left"]) + int(word["width"])
                for word in answer_words
            )
            bottom = max(
                int(word["top"]) + int(word["height"])
                for word in answer_words
            )
            draw.rectangle(
                (
                    max(0, left - 10),
                    max(0, top - 8),
                    min(cleaned_image.width, right + 10),
                    min(cleaned_image.height, bottom + 8),
                ),
                fill="white",
            )
    elif len(markers) == 5:
        for index, word in enumerate(markers, start=1):
            left = int(word["left"])
            top = int(word["top"])
            right = left + int(word["width"])
            bottom = top + int(word["height"])
            draw.rectangle(
                (
                    max(0, left - 5),
                    max(0, top - 4),
                    min(cleaned_image.width, right + 5),
                    min(cleaned_image.height, bottom + 4),
                ),
                fill="white",
            )
            text_font = font(max(16, round((bottom - top) * 0.85)))
            draw.text(
                (left + 2, top - 1),
                str(index),
                fill="#17213d",
                font=text_font,
            )

    cleaned_image = compact_tall_blank_bands(
        trim_white(cleaned_image, margin=16)
    )
    return trim_white(cleaned_image, margin=16), {
        "rasterOcrAvailable": shutil.which("tesseract") is not None,
        "removedRasterProseLineCount": removed_lines,
        "removedRasterProseWordCount": removed_words,
        "locatedRasterOptionMarkerCount": len(markers),
        "semanticChoiceRowRemoved": semantic_choices,
    }


def render_clean_asset(
    item: dict[str, Any],
    indexed: dict[tuple[str, str, int], dict[str, Any]],
    cleanup: dict[str, Any] | None = None,
) -> tuple[Image.Image, dict[str, Any]]:
    cleanup = cleanup or {}
    source_relative = item["source"]["privateSourcePdf"].removeprefix(
        "work/math-kangaroo-spatial-review/"
    )
    source = clean(source_relative)
    grade = "1-2" if item["source"]["gradeBand"] == "grades-1-2" else "3-4"
    question = int(item["source"]["questionNumber"])
    semantic_choices = bool(item.get("choices")) and all(
        clean(choice.get("displayText"))
        for choice in item["choices"]
    )
    fallback_start = int(item["source"]["sourcePage"])
    fallback_end = int(item["source"]["sourceEndPage"])
    current = locate_question(
        source, grade, question, fallback_start, indexed
    )
    if current is None:
        raise ValueError("question marker could not be located")
    start_page, start_top = current
    following = locate_next_question(
        source,
        grade,
        question,
        start_page,
        fallback_end,
        indexed,
    )
    # The next question often begins on the following page. In that case the
    # current question ends at its curated ``sourceEndPage``; rendering the
    # header before the next marker pulled unrelated footer art and option
    # labels into otherwise clean crops.
    end_page = fallback_end
    if following and following[0] <= fallback_end:
        # Question extraction stores the page containing the next marker as the
        # current interval's inclusive end. When that marker is on a later page,
        # the current question normally ended on the preceding page. A few
        # older papers continue their answers near the top of the next page;
        # a later following marker proves there is room for that continuation.
        end_page = (
            following[0]
            if following[0] == start_page or following[1] >= 140
            else following[0] - 1
        )
    page_inputs: dict[
        int, tuple[float, float, float, float, list[dict[str, Any]]]
    ] = {}
    ordered_markers: list[tuple[int, dict[str, Any]]] = []
    for page_number in range(start_page, end_page + 1):
        width_points, height_points, words = page_words(source, page_number)
        top_points = (
            # A broad pre-marker margin repeatedly captured the tail of the
            # preceding question (bars, option labels, and dotted rules).
            # Puzzle art normally begins at or below its own marker. A small
            # reviewed subset places an essential exemplar immediately above
            # the marker; its data-driven margin keeps that diagram intact.
            max(
                0.0,
                start_top
                - float(cleanup.get("sourceTopMarginPoints", 4.0)),
            )
            if page_number == start_page
            else PAGE_MARGIN_POINTS
        )
        bottom_points = height_points - PAGE_MARGIN_POINTS
        if following and page_number == following[0]:
            bottom_points = min(bottom_points, following[1] - 12.0)
        page_inputs[page_number] = (
            width_points,
            height_points,
            top_points,
            bottom_points,
            words,
        )
        if page_number != start_page and bottom_points - top_points < 50:
            continue
        ordered_markers.extend(
            (page_number, word)
            for word in usable_option_markers(
                words, top_points, bottom_points
            )
        )
    ordered_markers.sort(
        key=lambda record: (
            record[0],
            round(float(record[1]["top"]) / 4),
            float(record[1]["x0"]),
        )
    )
    label_by_word = (
        {
            (page, int(word["index"])): str(index + 1)
            for index, (page, word) in enumerate(ordered_markers)
        }
        if len(ordered_markers) == 5
        else {}
    )
    pdf_path = CORPUS / source
    document = pdfium.PdfDocument(str(pdf_path))
    segments: list[Image.Image] = []
    removed_word_count = 0
    try:
        for page_number in range(start_page, end_page + 1):
            (
                width_points,
                height_points,
                top_points,
                bottom_points,
                words,
            ) = page_inputs[page_number]
            # A tiny sliver before the next question is normally only a repeated
            # page header. Omitting it avoids the private report's historic
            # minimum-height expansion into the following question.
            if (
                page_number != start_page
                and bottom_points - top_points < 50
            ):
                continue
            pdf_page = document[page_number - 1]
            try:
                bitmap = pdf_page.render(scale=RENDER_DPI / 72)
                try:
                    page_image = bitmap.to_pil().convert("RGB")
                finally:
                    bitmap.close()
            finally:
                pdf_page.close()
            scale_x = page_image.width / width_points
            scale_y = page_image.height / height_points
            draw = ImageDraw.Draw(page_image)
            for mask in cleanup.get("sourceMasks", []):
                if int(mask["page"]) != page_number:
                    continue
                x = float(mask["x"])
                y = float(mask["y"])
                mask_width = float(mask["width"])
                mask_height = float(mask["height"])
                if (
                    x < 0
                    or y < 0
                    or mask_width <= 0
                    or mask_height <= 0
                    or x + mask_width > width_points + 0.01
                    or y + mask_height > height_points + 0.01
                ):
                    raise ValueError(
                        f"Invalid source cleanup mask on page {page_number}"
                    )
                draw.rectangle(
                    (
                        round(x * scale_x),
                        round(y * scale_y),
                        round((x + mask_width) * scale_x),
                        round((y + mask_height) * scale_y),
                    ),
                    fill="white",
                )

            page_markers = usable_option_markers(
                words, top_points, bottom_points
            )
            semantic_option_lines = [
                line
                for line in group_lines(words)
                if max(float(word["bottom"]) for word in line) >= top_points
                and min(float(word["top"]) for word in line) <= bottom_points
                and option_markers_in_line(line)
            ]
            if semantic_choices and semantic_option_lines:
                # Mask the semantic answer text word-by-word. A single broad
                # row rectangle can erase a prompt diagram placed beside or
                # partly behind the answer row (for example, marked points
                # A-E in a park). Decorative table borders that remain are
                # handled by explicit, reviewed cleanup masks.
                for line in semantic_option_lines:
                    for word in line:
                        draw_mask(
                            draw,
                            word,
                            scale_x,
                            scale_y,
                            padding=3,
                        )
            first_option_top = min(
                (float(word["top"]) for word in page_markers),
                default=bottom_points,
            )
            for line in group_lines(words):
                line_option_indices = {
                    int(word["index"])
                    for word in option_markers_in_line(line)
                }
                line_top = min(float(word["top"]) for word in line)
                line_bottom = max(float(word["bottom"]) for word in line)
                if line_bottom < top_points or line_top > bottom_points:
                    continue
                line_is_prose = any(
                    prose_token(clean(word["text"])) for word in line
                )
                greek_start = greek_prose_start_x(line)
                line_is_source_footer = line_is_footer(line)
                before_options = line_top < first_option_top - 2
                for word in line:
                    text = clean(word["text"])
                    word_is_greek_translation = bool(
                        greek_start is not None
                        and float(word["x0"]) >= greek_start
                    )
                    if int(word["index"]) in line_option_indices:
                        box = draw_mask(
                            draw, word, scale_x, scale_y, padding=3
                        )
                        label = (
                            None
                            if semantic_choices
                            or word_is_greek_translation
                            else label_by_word.get(
                                (page_number, int(word["index"]))
                            )
                        )
                        if label:
                            text_font = font(
                                max(16, round((box[3] - box[1]) * 0.85))
                            )
                            draw.text(
                                (box[0] + 2, box[1] - 1),
                                label,
                                fill="#17213d",
                                font=text_font,
                            )
                        continue
                    question_match = QUESTION_MARKER.fullmatch(text)
                    is_question_number = bool(
                        question_match
                        and int(question_match.group(1)) == question
                        and abs(float(word["top"]) - start_top) < 8
                    )
                    is_page_number = bool(
                        text.isdigit()
                        and float(word["top"]) >= height_points - 70
                    )
                    if is_question_number or is_page_number or (
                        (
                            word_is_greek_translation
                            or line_is_source_footer
                            or (line_is_prose and before_options)
                        )
                        and text.upper() not in PRESERVE_LABELS
                    ):
                        draw_mask(draw, word, scale_x, scale_y)
                        removed_word_count += 1

            left = max(0, round(PAGE_MARGIN_POINTS * scale_x))
            right = min(
                page_image.width,
                round((width_points - PAGE_MARGIN_POINTS) * scale_x),
            )
            top = max(0, round(top_points * scale_y))
            bottom = min(page_image.height, round(bottom_points * scale_y))
            if bottom <= top:
                continue
            segments.append(trim_white(page_image.crop((left, top, right, bottom))))
    finally:
        document.close()

    if not segments:
        raise ValueError("no non-empty source segment was rendered")

    # Relabel markers only when a complete five-choice set is available.
    # Marker drawing must happen on each segment before final assembly, but the
    # source markers were already masked. Add compact 1-5 chips near the
    # corresponding positions after remapping their page coordinates.
    #
    # The current output intentionally relies on the route's semantic numbered
    # buttons when the marker set is incomplete; those assets remain flagged.
    marker_count = len(ordered_markers)

    separator = 12
    width = max(segment.width for segment in segments)
    height = sum(segment.height for segment in segments) + separator * (
        len(segments) - 1
    )
    canvas = Image.new("RGB", (width, height), "white")
    offset = 0
    for index, segment in enumerate(segments):
        canvas.paste(segment, ((width - segment.width) // 2, offset))
        offset += segment.height
        if index < len(segments) - 1:
            offset += separator
    canvas = compact_tall_blank_bands(trim_white(canvas, margin=16))
    canvas, raster_audit = postprocess_raster_text(
        canvas,
        pdf_option_marker_count=marker_count,
        semantic_choices=semantic_choices,
    )
    final_masks = cleanup.get("finalMasks", [])
    if final_masks:
        draw = ImageDraw.Draw(canvas)
        for mask in final_masks:
            mask_x = float(mask["x"])
            mask_y = float(mask["y"])
            mask_width = float(mask["width"])
            mask_height = float(mask["height"])
            if (
                mask_x < 0
                or mask_y < 0
                or mask_width <= 0
                or mask_height <= 0
                or mask_x + mask_width > 1 + 1e-9
                or mask_y + mask_height > 1 + 1e-9
            ):
                raise ValueError("Invalid normalized final cleanup mask")
            draw.rectangle(
                (
                    round(mask_x * canvas.width),
                    round(mask_y * canvas.height),
                    round((mask_x + mask_width) * canvas.width),
                    round((mask_y + mask_height) * canvas.height),
                ),
                fill="white",
            )
        if not cleanup.get("preserveCanvasAfterFinalMasks", False):
            canvas = compact_tall_blank_bands(trim_white(canvas, margin=16))
    final_grid_repairs = cleanup.get("finalGridRepairs", [])
    if final_grid_repairs:
        draw = ImageDraw.Draw(canvas)
        for repair in final_grid_repairs:
            grid_x = float(repair["x"])
            grid_y = float(repair["y"])
            grid_width = float(repair["width"])
            grid_height = float(repair["height"])
            rows = int(repair["rows"])
            columns = int(repair["columns"])
            line_width = int(repair.get("lineWidth", 2))
            if (
                grid_x < 0
                or grid_y < 0
                or grid_width <= 0
                or grid_height <= 0
                or grid_x + grid_width > 1 + 1e-9
                or grid_y + grid_height > 1 + 1e-9
                or rows <= 0
                or columns <= 0
                or line_width <= 0
            ):
                raise ValueError("Invalid normalized final grid repair")
            left = round(grid_x * canvas.width)
            top = round(grid_y * canvas.height)
            right = round((grid_x + grid_width) * canvas.width)
            bottom = round((grid_y + grid_height) * canvas.height)
            for cell in repair.get("cells", []):
                row = int(cell["row"])
                column = int(cell["column"])
                if row < 0 or row >= rows or column < 0 or column >= columns:
                    raise ValueError("Invalid final grid repair cell")
                cell_left = round(
                    left + (right - left) * column / columns
                )
                cell_top = round(top + (bottom - top) * row / rows)
                cell_right = round(
                    left + (right - left) * (column + 1) / columns
                )
                cell_bottom = round(
                    top + (bottom - top) * (row + 1) / rows
                )
                draw.rectangle(
                    (cell_left, cell_top, cell_right, cell_bottom),
                    fill=clean(cell.get("fill")) or "white",
                )
            line_color = clean(repair.get("lineColor")) or "#252525"
            for column in range(columns + 1):
                x = round(left + (right - left) * column / columns)
                draw.line(
                    (x, top, x, bottom),
                    fill=line_color,
                    width=line_width,
                )
            for row in range(rows + 1):
                y = round(top + (bottom - top) * row / rows)
                draw.line(
                    (left, y, right, y),
                    fill=line_color,
                    width=line_width,
                )
    final_text_labels = cleanup.get("finalTextLabels", [])
    if final_text_labels:
        draw = ImageDraw.Draw(canvas)
        for label in final_text_labels:
            label_x = float(label["x"])
            label_y = float(label["y"])
            label_width = float(label["width"])
            label_height = float(label["height"])
            label_text = clean(label.get("text"))
            if (
                label_x < 0
                or label_y < 0
                or label_width <= 0
                or label_height <= 0
                or label_x + label_width > 1 + 1e-9
                or label_y + label_height > 1 + 1e-9
                or not label_text
            ):
                raise ValueError("Invalid normalized final text label")
            box = (
                round(label_x * canvas.width),
                round(label_y * canvas.height),
                round((label_x + label_width) * canvas.width),
                round((label_y + label_height) * canvas.height),
            )
            if label.get("background"):
                draw.rectangle(box, fill=clean(label["background"]))
            text_font = font(
                max(
                    12,
                    round(
                        (box[3] - box[1])
                        * float(label.get("fontScale", 0.56))
                    ),
                )
            )
            text_bounds = draw.textbbox((0, 0), label_text, font=text_font)
            text_width = text_bounds[2] - text_bounds[0]
            text_height = text_bounds[3] - text_bounds[1]
            draw.text(
                (
                    box[0] + (box[2] - box[0] - text_width) / 2,
                    box[1] + (box[3] - box[1] - text_height) / 2
                    - text_bounds[1],
                ),
                label_text,
                fill=clean(label.get("fill")) or "#17213d",
                font=text_font,
            )
    final_crop = cleanup.get("finalCrop")
    if final_crop:
        crop_x = float(final_crop["x"])
        crop_y = float(final_crop["y"])
        crop_width = float(final_crop["width"])
        crop_height = float(final_crop["height"])
        if (
            crop_x < 0
            or crop_y < 0
            or crop_width <= 0
            or crop_height <= 0
            or crop_x + crop_width > 1 + 1e-9
            or crop_y + crop_height > 1 + 1e-9
        ):
            raise ValueError("Invalid normalized final cleanup crop")
        canvas = trim_white(
            canvas.crop(
                (
                    round(crop_x * canvas.width),
                    round(crop_y * canvas.height),
                    round((crop_x + crop_width) * canvas.width),
                    round((crop_y + crop_height) * canvas.height),
                )
            ),
            margin=16,
        )
    final_choice_markers = cleanup.get("finalChoiceMarkers", [])
    if final_choice_markers:
        draw = ImageDraw.Draw(canvas)
        seen_choice_indices: set[int] = set()
        for marker in final_choice_markers:
            choice_index = int(marker["choiceIndex"])
            marker_x = float(marker["x"])
            marker_y = float(marker["y"])
            marker_width = float(marker["width"])
            marker_height = float(marker["height"])
            if (
                choice_index < 0
                or choice_index > 4
                or choice_index in seen_choice_indices
                or marker_x < 0
                or marker_y < 0
                or marker_width <= 0
                or marker_height <= 0
                or marker_x + marker_width > 1 + 1e-9
                or marker_y + marker_height > 1 + 1e-9
            ):
                raise ValueError("Invalid normalized final choice marker")
            seen_choice_indices.add(choice_index)
            box = (
                round(marker_x * canvas.width),
                round(marker_y * canvas.height),
                round((marker_x + marker_width) * canvas.width),
                round((marker_y + marker_height) * canvas.height),
            )
            if marker.get("eraseSource", True):
                draw.rectangle(box, fill="white")
            text_font = font(max(16, round((box[3] - box[1]) * 0.72)))
            draw.text(
                (box[0] + 2, box[1]),
                str(choice_index + 1),
                fill="#17213d",
                font=text_font,
            )
    if canvas.width > 1400:
        ratio = 1400 / canvas.width
        canvas = canvas.resize(
            (1400, round(canvas.height * ratio)),
            Image.Resampling.LANCZOS,
        )
    audit = {
        "sourcePages": [start_page, end_page],
        "locatedNextQuestion": following is not None,
        "removedWordCount": removed_word_count,
        "locatedOptionMarkerCount": marker_count,
        "appliedSourceMaskCount": sum(
            1
            for mask in cleanup.get("sourceMasks", [])
            if start_page <= int(mask["page"]) <= end_page
        ),
        "appliedSourceTopMarginPoints": float(
            cleanup.get("sourceTopMarginPoints", 4.0)
        ),
        "appliedFinalMaskCount": len(final_masks),
        "appliedFinalGridRepairCount": len(final_grid_repairs),
        "appliedFinalTextLabelCount": len(final_text_labels),
        "appliedFinalCrop": bool(final_crop),
        "appliedFinalChoiceMarkerCount": len(final_choice_markers),
        **raster_audit,
        "status": (
            "generated-needs-visual-qa"
            if marker_count in {0, 5}
            else "generated-option-markers-need-manual-qa"
        ),
    }
    return canvas, audit


def main() -> None:
    payload = json.loads(MANIFEST.read_text(encoding="utf-8"))
    indexed = question_index()
    cleanup_by_round = asset_cleanup_overrides()
    release_reviews = asset_release_reviews()
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    audit_items: list[dict[str, Any]] = []
    failures = 0
    for index, item in enumerate(payload["rounds"], start=1):
        output = PUBLIC_DIR / f"{item['id']}.webp"
        try:
            image, audit = render_clean_asset(
                item,
                indexed,
                cleanup_by_round.get(item["id"]),
            )
            image.save(output, "WEBP", quality=92, method=6)
            fingerprint = decoded_asset_fingerprint(output)
            release_ready = release_review_matches(
                release_reviews.get(item["id"]),
                fingerprint,
            )
            item["asset"]["publicWidth"] = image.width
            item["asset"]["publicHeight"] = image.height
            item["asset"]["status"] = (
                "release-ready" if release_ready else audit["status"]
            )
            item["asset"]["qa"] = {
                "promptFree": release_ready,
                "optionsRelabeled": release_ready,
                "diagramComplete": release_ready,
                "reviewed": release_ready,
            }
            audit_items.append(
                {
                    "id": item["id"],
                    **audit,
                    "reviewFingerprint": fingerprint,
                    "releaseReviewMatched": release_ready,
                    "status": item["asset"]["status"],
                }
            )
        except Exception as error:
            failures += 1
            item["asset"]["status"] = "unresolved-asset-build"
            item["asset"]["qa"] = {
                "promptFree": False,
                "optionsRelabeled": False,
                "diagramComplete": False,
                "reviewed": False,
            }
            audit_items.append(
                {
                    "id": item["id"],
                    "status": "unresolved-asset-build",
                    "error": str(error),
                }
            )
        if index % 24 == 0 or index == len(payload["rounds"]):
            print(f"Prepared {index}/{len(payload['rounds'])} selected assets")

    temporary_manifest = MANIFEST.with_name(MANIFEST.name + ".tmp")
    temporary_manifest.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_manifest.replace(MANIFEST)
    temporary_audit = AUDIT.with_name(AUDIT.name + ".tmp")
    temporary_audit.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "generatedBy": "scripts/build-math-kangaroo-assets.py",
                "releaseReady": (
                    failures == 0
                    and len(audit_items) == len(payload["rounds"])
                    and all(
                        item.get("status") == "release-ready"
                        for item in audit_items
                    )
                ),
                "failureCount": failures,
                "items": audit_items,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    temporary_audit.replace(AUDIT)
    print(
        f"Wrote {len(payload['rounds']) - failures} public QA candidates; "
        f"{failures} unresolved."
    )


if __name__ == "__main__":
    main()
