#!/usr/bin/env python3
"""Build the exact private-corpus selection for Journey Math Kangaroo review.

The source PDFs, answer-key PDFs, and research crops intentionally live under
the git-ignored ``work/math-kangaroo-spatial-review`` directory. This script
turns the curated Cyprus Tier A review into a checked-in, source-auditable
selection manifest without copying a complete paper or answer key into the
application.

Run with the bundled Codex Python runtime, which includes pdfplumber and Pillow:

  ~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12 \
    scripts/build-math-kangaroo-selection.py
"""

from __future__ import annotations

import csv
import json
import math
import random
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import pdfplumber
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "work/math-kangaroo-spatial-review"
OUTPUT = (
    ROOT
    / "app/journey/reviews/math-kangaroo/data/selection-manifest.json"
)
SOLUTION_OVERRIDES = (
    ROOT
    / "app/journey/reviews/math-kangaroo/data/solution-overrides.json"
)
CHOICE_OVERRIDES = (
    ROOT
    / "app/journey/reviews/math-kangaroo/data/choice-overrides.json"
)
ANSWER_KEY_DIR = CORPUS / "originals/cyprus-official/answer-keys"

LEVELS = (
    ("junior-1", "junior", "grades-1-2", 4.5),
    ("junior-2", "junior", "grades-1-2", 10.5),
    ("expert-1", "expert", "grades-1-2", 18.5),
    ("expert-2", "expert", "grades-3-4", 4.5),
    ("wizard-1", "wizard", "grades-3-4", 10.5),
    ("wizard-2", "wizard", "grades-3-4", 18.5),
)

ANSWER_KEY_URLS = {
    2012: "https://thalescyprus.com/wp-content/uploads/2019/08/Math-Competition-Correct-Answers-8May2012.pdf",
    2013: "https://thalescyprus.com/wp-content/uploads/2019/08/Kangourou-Math-Competitions-Answers-2013corrected.pdf",
    2014: "https://thalescyprus.com/wp-content/uploads/2019/08/Kangourou-Math-Competitions-Answers-2014.pdf",
    2015: "https://thalescyprus.com/wp-content/uploads/2019/08/Kangourou-Mathematics-2015-Correct-Answers-Final.pdf",
    2016: "https://thalescyprus.com/wp-content/uploads/2019/08/Correct-Answers-Final-2016.pdf.pdf",
    2017: "https://thalescyprus.com/wp-content/uploads/2019/08/MATHS-2017-CORRECT-ANS.pdf",
    2018: "https://thalescyprus.com/wp-content/uploads/2019/08/KANGOUROU-MATHEMATICS-ANSWERS-2018.pdf",
    2019: "https://thalescyprus.com/wp-content/uploads/2019/08/KANGOUROU-MATHEMATICS-2019-_-CORRECT-ANSWERS-1.pdf",
    2020: "https://thalescyprus.com/wp-content/uploads/2020/06/KANGOUROU-MATHEMATICS-COMPETITION-2020-_-PART-A-ONLINE.pdf",
    2021: "https://thalescyprus.com/wp-content/uploads/2021/04/KANGOUROU-MATHEMATICS-ANSWERS-2021.pdf",
    2022: "https://thalescyprus.com/wp-content/uploads/2022/04/KANGOUROU-MATHEMATICS-ANSWERS-2022-Cyprus-1.pdf",
    2023: "https://thalescyprus.com/wp-content/uploads/2023/05/KANGOUROU-MATHEMATICS-COMPETITION-2023-CORRECT-ANSWERS.pdf",
    2024: "https://thalescyprus.com/wp-content/uploads/2024/04/KANG-MATHS-2024-CORRECT-ANS.pdf",
    2025: "https://thalescyprus.com/wp-content/uploads/2025/06/KANGOUROU-MATHS-2025-CORRECT-ANS.pdf",
    2026: "https://thalescyprus.com/wp-content/uploads/2026/04/KANGOUROU-MATHS-2025-2026_EN-GR-CORRECT-ANS-1.pdf",
}

GREEK_ANSWER_TO_LATIN = {
    "Α": "A",
    "Β": "B",
    "Γ": "C",
    "Δ": "D",
    "Ε": "E",
}

NUMBER_WORD_TOKENS = {
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
}

SEMANTIC_TOKEN_STOPWORDS = {
    "a",
    "all",
    "an",
    "and",
    "answer",
    "are",
    "choice",
    "is",
    "of",
    "only",
    "or",
    "the",
    "to",
}

MECHANIC_MAP = {
    "2D dissection/assembly": ("assembly", "assemble"),
    "tiling/coverage": ("assembly", "assemble"),
    "rotation/reflection": ("rotation-reflection", "rotate"),
    "path/directions": ("paths-directions", "trace"),
    "3D cubes/nets/views": ("objects-views", "viewpoint"),
    "folding/cutting": ("folding-nets", "fold"),
    "overlap/layering/occlusion": ("layering-order", "layer"),
    "weaving/knot/ordering": ("layering-order", "layer"),
    "visual sequence/pattern": ("patterns-relations", "pattern"),
    "relative position": ("other-spatial", "trace"),
    "other (color-inversion transformation)": (
        "patterns-relations",
        "pattern",
    ),
    "other (line-of-sight/occlusion)": ("other-spatial", "trace"),
    "other (visual equivalence)": ("other-spatial", "pattern"),
    "other (neighbourhood deduction)": ("patterns-relations", "pattern"),
}

# The same seven-sticks puzzle appears in both the 2014 grades 1-2 and 3-4
# papers. Keep the higher-scored grades 3-4 review and exclude its duplicate
# before the two grade bands are selected independently.
EXCLUDED_SEMANTIC_DUPLICATES = {
    ("grades-1-2", 2014, "single", 15):
        "duplicates 2014 grades 3-4 question 13",
}

# These two reserves replace otherwise strong rows whose extracted diagrams did
# not expose enough information to author and visually verify a complete
# explanation. The replacements preserve the source band and official answer
# letter, so stop answer balance and culmination freshness remain unchanged.
FORCED_REPLACEMENTS = {
    "mk-cyprus-2013-34-q12": "mk-cyprus-2019-34-q11",
    "mk-cyprus-2024-34-q15": "mk-cyprus-2025-34-q18",
}

# Two 12-question stops. Every answer occurs 2-3 times per stop, adjacent
# positions never repeat, and rotating the second sequence keeps the combined
# 24-question answer distribution within one.
STOP_ANSWER_SEQUENCES = (
    tuple("ABCDEABCDEAE"),
    tuple("EDCBAEDCBADE"),
)

CULMINATION_ANSWER_SEQUENCES = {
    0: tuple("ABCE"),
    1: tuple("ABDE"),
    2: tuple("ABCE"),
}


@dataclass(frozen=True)
class Candidate:
    source: str
    source_url: str
    year: int
    grade: str
    grade_band: str
    part: str
    question: int
    page: int
    end_page: int
    score: float
    tier: str
    raw_mechanic: str
    mechanic: str
    animation: str
    existing_game_fit: str
    short_title: str
    prompt: str
    rationale: str
    adaptation_note: str
    visual_verified: str
    answer: str
    answer_key_url: str
    answer_key_local: str
    report_crop: str
    crop_width: int
    crop_height: int
    crop_top_points: float | None
    crop_bottom_points: float | None

    @property
    def source_key(self) -> str:
        return f"{self.year}:{self.grade_band}:{self.part}:{self.question}"

    @property
    def id(self) -> str:
        part = "" if self.part == "single" else f"-{self.part.lower()}"
        return (
            f"mk-cyprus-{self.year}-{self.grade.replace('-', '')}"
            f"{part}-q{self.question:02d}"
        )


def cleaned(value: Any) -> str:
    return " ".join(str(value or "").split())


def load_json_without_duplicate_keys(path: Path) -> Any:
    """Load authored JSON while rejecting silently shadowed object keys."""

    def build_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'duplicate JSON key "{key}"')
            result[key] = value
        return result

    try:
        return json.loads(
            path.read_text(encoding="utf-8"),
            object_pairs_hook=build_object,
        )
    except ValueError as error:
        raise ValueError(f"{path.relative_to(ROOT)}: {error}") from error


def cleaned_prompt(value: Any) -> str:
    """Keep the authored question while dropping OCR pulled from its diagram.

    The review CSV stores the English prompt followed, on a small subset of
    rows, by labels that OCR read from the illustration or answer area. Math
    Kangaroo prompts contain one question, so anything after its first question
    mark is diagram text rather than part of the prompt.
    """

    prompt = cleaned(value)
    if "?" in prompt:
        prompt = prompt.split("?", 1)[0].rstrip() + "?"
    return re.sub(r"\s+([,.:;!?])", r"\1", prompt)


def complete_headline(value: Any, prompt: str) -> str:
    """Replace OCR-truncated titles with the complete authored question.

    The private review CSV deliberately shortens some source prompts with a
    terminal ellipsis. Those snippets are useful during corpus research but
    are not acceptable as final player-facing explanation headlines.
    """

    headline = cleaned(value)
    if re.search(r"(?:\.{3}|…)\s*$", headline):
        headline = cleaned_prompt(prompt).rstrip(" ?")
    return headline


def semantic_answer_tokens(value: Any) -> set[str]:
    """Return comparison tokens for an authored semantic answer claim."""

    tokens: set[str] = set()
    for raw_token in re.findall(r"[a-z0-9]+", cleaned(value).lower()):
        token = NUMBER_WORD_TOKENS.get(raw_token, raw_token)
        if token in SEMANTIC_TOKEN_STOPWORDS:
            continue
        if len(token) > 4 and token.endswith("s"):
            token = token[:-1]
        tokens.add(token)
    return tokens


def final_solution_sentence(explanation: dict[str, Any]) -> str:
    steps = explanation.get("solutionSteps", [])
    if not steps:
        return ""
    sentences = [
        sentence.strip()
        for sentence in re.split(
            r"[.!?]+",
            cleaned(steps[-1].get("body")),
        )
        if sentence.strip()
    ]
    return sentences[-1] if sentences else ""


def validate_explanation_answer_claim(
    item: dict[str, Any],
    explanation: dict[str, Any],
) -> None:
    """Keep authored answer language synchronized with the official key."""

    expected_choice = item["correctIndex"] + 1
    final_claim = final_solution_sentence(explanation)
    referenced_choices = [
        int(value)
        for value in re.findall(
            r"\b(?:choice|answer)\s+([1-5])\b",
            final_claim,
            flags=re.IGNORECASE,
        )
    ]
    if any(value != expected_choice for value in referenced_choices):
        raise ValueError(
            f"{item['id']} explanation references a choice that "
            "disagrees with its answer key"
        )

    display_choices = [
        cleaned(choice.get("displayText"))
        for choice in item.get("choices", [])
    ]
    if len(display_choices) != 5 or not all(display_choices):
        return
    token_sets = [
        semantic_answer_tokens(display_choice)
        for display_choice in display_choices
    ]
    common_tokens = set.intersection(*token_sets)
    expected_tokens = (
        token_sets[item["correctIndex"]] - common_tokens
    )
    # Counts, labelled objects, and numbered-piece combinations can be
    # checked generically. Free-form prose answers such as path descriptions
    # remain covered by the official choice index and manual source audit.
    if not any(
        token.isdigit() or (len(token) == 1 and token.isalpha())
        for token in expected_tokens
    ):
        return
    claim_tokens = semantic_answer_tokens(
        final_solution_sentence(explanation)
    )
    if not expected_tokens.issubset(claim_tokens):
        expected_answer = display_choices[item["correctIndex"]]
        raise ValueError(
            f"{item['id']} final solution claim does not name the "
            f"verified semantic answer {expected_answer!r}"
        )


def normalize_answer(value: str) -> str:
    answer = GREEK_ANSWER_TO_LATIN.get(value.strip(), value.strip().upper())
    return answer if answer in {"A", "B", "C", "D", "E"} else ""


def extract_key_rows(path: Path) -> dict[str, dict[int, str]]:
    with pdfplumber.open(path) as document:
        text = "\n".join(
            page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            for page in document.pages
        )

    answers: dict[str, dict[int, str]] = {"1-2": {}, "3-4": {}}
    for line in text.splitlines():
        tokens = line.split()
        if not tokens or not tokens[0].isdigit():
            continue
        question = int(tokens[0])
        if question < 1 or question > 30:
            continue
        try:
            # Newer tables repeat the question number for every grade column.
            if len(tokens) > 4 and tokens[3].isdigit():
                grade_12 = tokens[1]
                grade_34 = tokens[4]
            else:
                grade_12 = tokens[1]
                grade_34 = tokens[3]
        except IndexError:
            continue
        answers["1-2"][question] = normalize_answer(grade_12)
        answers["3-4"][question] = normalize_answer(grade_34)
    return answers


def answer_keys() -> dict[tuple[int, str], dict[str, dict[int, str]]]:
    result: dict[tuple[int, str], dict[str, dict[int, str]]] = {}
    for year in range(2012, 2027):
        part = "A" if year == 2020 else "single"
        suffix = "a" if year == 2020 else ""
        path = ANSWER_KEY_DIR / f"key-{year}{suffix}.pdf"
        if not path.exists():
            raise FileNotFoundError(f"Missing private official answer key: {path}")
        result[(year, part)] = extract_key_rows(path)
    return result


def source_urls() -> dict[str, str]:
    path = CORPUS / "data/cyprus-official-manifest.csv"
    urls: dict[str, str] = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            local = cleaned(row["local_path"])
            prefix = "work/math-kangaroo-spatial-review/"
            if local.startswith(prefix):
                local = local[len(prefix) :]
            urls[local] = cleaned(row["direct_url"])
    return urls


def ranked_crops() -> dict[tuple[str, int], str]:
    path = CORPUS / "report/ranked_questions.csv"
    crops: dict[tuple[str, int], str] = {}
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row["source_label"] != "Cyprus official":
                continue
            crops[(cleaned(row["source"]), int(row["question"]))] = cleaned(
                row["image"]
            )
    return crops


def indexed_question_bounds() -> dict[tuple[str, str, int], tuple[float, float | None]]:
    payload = json.loads(
        (CORPUS / "data/questions_raw.json").read_text(encoding="utf-8")
    )
    by_source: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for question in payload["questions"]:
        by_source[
            (cleaned(question["source"]), cleaned(question["grade"]))
        ].append(question)

    bounds: dict[tuple[str, str, int], tuple[float, float | None]] = {}
    for (source, grade), questions in by_source.items():
        questions.sort(
            key=lambda item: (
                int(item["start_page"]),
                float((item.get("start_bbox_points") or {}).get("top", 0)),
            )
        )
        for index, question in enumerate(questions):
            top = float((question.get("start_bbox_points") or {}).get("top", 0))
            crop_top = max(0.0, top - 18.0)
            crop_bottom: float | None = None
            if index + 1 < len(questions):
                following = questions[index + 1]
                if int(following["start_page"]) == int(question["end_page"]):
                    next_top = float(
                        (following.get("start_bbox_points") or {}).get("top", 0)
                    )
                    if next_top > 0:
                        crop_bottom = next_top - 12.0
            bounds[(source, grade, int(question["question_number"]))] = (
                crop_top,
                crop_bottom,
            )
    return bounds


def load_candidates() -> dict[str, list[Candidate]]:
    keys = answer_keys()
    source_url_by_path = source_urls()
    crop_by_question = ranked_crops()
    bounds_by_question = indexed_question_bounds()
    candidates: dict[str, list[Candidate]] = {
        "grades-1-2": [],
        "grades-3-4": [],
    }
    for grade_file, grade, grade_band in (
        ("1_2", "1-2", "grades-1-2"),
        ("3_4", "3-4", "grades-3-4"),
    ):
        path = CORPUS / f"data/review_cyprus_grades_{grade_file}.csv"
        with path.open(newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        for row in rows:
            if cleaned(row["tier"]) != "A":
                continue
            year = int(row["year"])
            part = cleaned(row["part"])
            question = int(row["question"])
            if (grade_band, year, part, question) in EXCLUDED_SEMANTIC_DUPLICATES:
                continue
            answer = keys[(year, part)][grade].get(question, "")
            # VOID, CANCELED, and multi-answer source questions are excluded.
            if answer not in {"A", "B", "C", "D", "E"}:
                continue
            raw_mechanic = cleaned(row["mechanic"])
            if raw_mechanic not in MECHANIC_MAP:
                raise ValueError(f"Unmapped mechanic: {raw_mechanic}")
            mechanic, animation = MECHANIC_MAP[raw_mechanic]
            source = cleaned(row["source"])
            source_url = source_url_by_path.get(source, "")
            report_crop = crop_by_question.get((source, question), "")
            crop_path = CORPUS / "report" / report_crop
            if not source_url or not report_crop or not crop_path.exists():
                raise ValueError(
                    f"Missing source URL or crop for {source} question {question}"
                )
            with Image.open(crop_path) as image:
                crop_width, crop_height = image.size
            crop_top, crop_bottom = bounds_by_question.get(
                (source, grade, question), (None, None)
            )
            suffix = "a" if year == 2020 else ""
            answer_key_local = (
                "work/math-kangaroo-spatial-review/originals/"
                f"cyprus-official/answer-keys/key-{year}{suffix}.pdf"
            )
            candidates[grade_band].append(
                Candidate(
                    source=source,
                    source_url=source_url,
                    year=year,
                    grade=grade,
                    grade_band=grade_band,
                    part=part,
                    question=question,
                    page=int(row["page"]),
                    end_page=int(row["end_page"]),
                    score=float(row["score"]),
                    tier="A",
                    raw_mechanic=raw_mechanic,
                    mechanic=mechanic,
                    animation=animation,
                    existing_game_fit=cleaned(row["existing_game_fit"]),
                    short_title=cleaned(row["short_title"]),
                    prompt=cleaned_prompt(row["question_text"]),
                    rationale=cleaned(row["rationale"]),
                    adaptation_note=cleaned(row["adaptation_note"]),
                    visual_verified=cleaned(row["visual_verified"]),
                    answer=answer,
                    answer_key_url=ANSWER_KEY_URLS[year],
                    answer_key_local=answer_key_local,
                    report_crop=f"work/math-kangaroo-spatial-review/report/{report_crop}",
                    crop_width=crop_width,
                    crop_height=crop_height,
                    crop_top_points=crop_top,
                    crop_bottom_points=crop_bottom,
                )
            )
    return candidates


def difficulty_cost(candidate: Candidate, target: float) -> float:
    question = candidate.question
    cost = abs(question - target)
    if target < 6:
        cost += max(0, question - 8) * 2.2
    elif target < 14:
        cost += max(0, 7 - question) * 1.7
        cost += max(0, question - 16) * 1.7
    else:
        cost += max(0, 16 - question) * 2.2
    return cost


def choose_candidate(
    pool: list[Candidate],
    answer: str | None,
    target: float,
    stop: list[Candidate],
    level: list[Candidate],
    rng: random.Random,
) -> Candidate:
    eligible = [candidate for candidate in pool if answer is None or candidate.answer == answer]
    if not eligible:
        raise RuntimeError(f"No eligible candidate remains for answer {answer}")
    stop_mechanics = Counter(candidate.mechanic for candidate in stop)
    stop_years = Counter(candidate.year for candidate in stop)
    level_mechanics = Counter(candidate.mechanic for candidate in level)
    level_years = Counter(candidate.year for candidate in level)

    scored: list[tuple[float, Candidate]] = []
    for candidate in eligible:
        score = difficulty_cost(candidate, target)
        score += (100.0 - candidate.score) * 0.2
        score += stop_mechanics[candidate.mechanic] * 2.9
        score += stop_years[candidate.year] * 1.4
        score += level_mechanics[candidate.mechanic] * 0.45
        score += level_years[candidate.year] * 0.25
        score += rng.random() * 2.5
        scored.append((score, candidate))
    scored.sort(key=lambda item: (item[0], item[1].id))
    # Small seeded variation lets the global search escape a locally attractive
    # choice without making the checked-in manifest nondeterministic.
    window = scored[: min(6, len(scored))]
    weights = [math.exp(-(score - window[0][0]) / 1.8) for score, _ in window]
    return rng.choices([candidate for _, candidate in window], weights=weights, k=1)[0]


def build_grade_trial(
    candidates: list[Candidate], rng: random.Random
) -> dict[int, list[Candidate]]:
    remaining = list(candidates)
    chosen: dict[int, list[Candidate]] = {}

    # Protect scarce hard questions by assigning the hardest collection first.
    for level_index, target in ((2, 18.5), (1, 10.5), (0, 4.5)):
        level: list[Candidate] = []
        for sequence in STOP_ANSWER_SEQUENCES:
            stop: list[Candidate] = []
            for answer in sequence:
                candidate = choose_candidate(
                    remaining,
                    answer,
                    target,
                    stop,
                    level,
                    rng,
                )
                stop.append(candidate)
                level.append(candidate)
                remaining.remove(candidate)
        culmination: list[Candidate] = []
        for answer in CULMINATION_ANSWER_SEQUENCES[level_index]:
            candidate = choose_candidate(
                remaining,
                answer,
                target + 1.5,
                culmination,
                level,
                rng,
            )
            culmination.append(candidate)
            level.append(candidate)
            remaining.remove(candidate)
        chosen[level_index] = level
    return chosen


def trial_score(chosen: dict[int, list[Candidate]]) -> float:
    score = 0.0
    means: list[float] = []
    targets = (4.5, 10.5, 18.5)
    selected: list[Candidate] = []
    for index in range(3):
        level = chosen[index]
        selected.extend(level)
        means.append(sum(candidate.question for candidate in level) / len(level))
        score += sum(
            difficulty_cost(candidate, targets[index]) for candidate in level
        )
        score += sum((100.0 - candidate.score) * 0.12 for candidate in level)
        mechanics = Counter(candidate.mechanic for candidate in level)
        years = Counter(candidate.year for candidate in level)
        score += max(0, 7 - len(mechanics)) * 18
        score += max(0, 11 - len(years)) * 4
        score += sum(max(0, count - 7) ** 2 for count in mechanics.values()) * 0.8
        for offset in (0, 12):
            stop = level[offset : offset + 12]
            score += max(0, 5 - len({item.mechanic for item in stop})) * 14
            score += max(0, 8 - len({item.year for item in stop})) * 2
        culmination = level[24:28]
        score += max(0, 3 - len({item.mechanic for item in culmination})) * 12
        score += max(0, 4 - len({item.year for item in culmination})) * 4
    if not (means[0] < means[1] < means[2]):
        score += 500
    aggregate_mechanics = Counter(item.mechanic for item in selected)
    score += sum(
        max(0, count - 18) ** 2 for count in aggregate_mechanics.values()
    )
    return score


def select_grade(candidates: list[Candidate], seed: int) -> dict[int, list[Candidate]]:
    if len(candidates) < 84:
        raise ValueError(f"Need at least 84 candidates; found {len(candidates)}")
    best: dict[int, list[Candidate]] | None = None
    best_score = float("inf")
    for trial in range(2400):
        rng = random.Random(seed + trial * 7919)
        try:
            chosen = build_grade_trial(candidates, rng)
        except RuntimeError:
            continue
        score = trial_score(chosen)
        if score < best_score:
            best = chosen
            best_score = score
    if best is None:
        raise RuntimeError("Could not construct a valid grade-band selection")
    return best


def apply_forced_replacements(
    selections: dict[str, dict[int, list[Candidate]]],
    candidates: dict[str, list[Candidate]],
) -> None:
    by_id = {
        candidate.id: candidate
        for grade_candidates in candidates.values()
        for candidate in grade_candidates
    }
    selected_ids = {
        candidate.id
        for grade_selections in selections.values()
        for level in grade_selections.values()
        for candidate in level
    }
    for grade_band, grade_selections in selections.items():
        for level in grade_selections.values():
            for index, original in enumerate(level):
                replacement_id = FORCED_REPLACEMENTS.get(original.id)
                if replacement_id is None:
                    continue
                replacement = by_id.get(replacement_id)
                if replacement is None:
                    raise ValueError(
                        f"Missing forced replacement candidate {replacement_id}"
                    )
                if replacement.id in selected_ids:
                    raise ValueError(
                        f"Forced replacement {replacement.id} is already selected"
                    )
                if (
                    replacement.grade_band != grade_band
                    or replacement.answer != original.answer
                ):
                    raise ValueError(
                        f"Forced replacement {replacement.id} changes grade band "
                        f"or answer position for {original.id}"
                    )
                level[index] = replacement
                selected_ids.remove(original.id)
                selected_ids.add(replacement.id)


def has_repeated_answer_cycle(answer_sequence: tuple[str, ...]) -> bool:
    """Reject a locally repeated answer pattern that a player could exploit."""

    for cycle_width in range(2, min(5, len(answer_sequence) // 2) + 1):
        for start in range(len(answer_sequence) - cycle_width * 2 + 1):
            if (
                answer_sequence[start : start + cycle_width]
                == answer_sequence[
                    start + cycle_width : start + cycle_width * 2
                ]
            ):
                return True
    return False


def has_monotone_answer_run(answer_sequence: tuple[str, ...]) -> bool:
    """Detect four-option clockwise or counter-clockwise catalogue walks."""

    indices = tuple(ord(answer) - ord("A") for answer in answer_sequence)
    for start in range(len(indices) - 3):
        deltas = tuple(
            (indices[index + 1] - indices[index]) % 5
            for index in range(start, start + 3)
        )
        if deltas in ((1, 1, 1), (4, 4, 4)):
            return True
    return False


def reorder_selection_segment(
    candidates: list[Candidate],
    *,
    seed: int,
    prior_schedules: set[tuple[str, ...]],
    reject_monotone_runs: bool,
) -> list[Candidate]:
    """Choose a stable, varied order without changing segment membership."""

    rng = random.Random(seed)
    best: tuple[tuple[Any, ...], list[Candidate]] | None = None
    for _ in range(5000):
        ordered = list(candidates)
        rng.shuffle(ordered)
        schedule = tuple(candidate.answer for candidate in ordered)
        if any(
            schedule[index] == schedule[index - 1]
            for index in range(1, len(schedule))
        ):
            continue
        if schedule in prior_schedules or has_repeated_answer_cycle(schedule):
            continue
        if reject_monotone_runs and has_monotone_answer_run(schedule):
            continue

        # Prefer a curriculum order that also alternates mechanics and source
        # years. The answer safeguards above are hard constraints; this score
        # is only a deterministic tie-breaker among safe schedules.
        mechanic_repeats = sum(
            ordered[index].mechanic == ordered[index - 1].mechanic
            for index in range(1, len(ordered))
        )
        year_repeats = sum(
            ordered[index].year == ordered[index - 1].year
            for index in range(1, len(ordered))
        )
        key: tuple[Any, ...] = (
            mechanic_repeats,
            year_repeats,
            tuple(candidate.id for candidate in ordered),
        )
        if best is None or key < best[0]:
            best = (key, ordered)

    if best is None:
        raise RuntimeError("Could not construct a safe answer order")
    ordered = best[1]
    prior_schedules.add(tuple(candidate.answer for candidate in ordered))
    return ordered


def reorder_level_for_journey(
    candidates: list[Candidate],
    *,
    journey_level_index: int,
    stop_schedules: set[tuple[str, ...]],
    culmination_schedules: set[tuple[str, ...]],
) -> list[Candidate]:
    """Reorder the two stops and culmination while preserving their members."""

    if len(candidates) != 28:
        raise ValueError("A Journey review level must contain 28 questions")
    ordered: list[Candidate] = []
    for segment_index, (start, end) in enumerate(
        ((0, 12), (12, 24), (24, 28))
    ):
        is_culmination = segment_index == 2
        ordered.extend(
            reorder_selection_segment(
                candidates[start:end],
                seed=71001 + journey_level_index * 137 + segment_index * 29,
                prior_schedules=(
                    culmination_schedules
                    if is_culmination
                    else stop_schedules
                ),
                reject_monotone_runs=not is_culmination,
            )
        )
    if {candidate.id for candidate in ordered} != {
        candidate.id for candidate in candidates
    }:
        raise ValueError("Answer-ordering changed level membership")
    return ordered


def manifest_round(
    candidate: Candidate,
    journey_level: str,
    difficulty: str,
    level_position: int,
    solution: dict[str, Any] | None,
    choice_display_text: list[str] | None,
    existing_asset: dict[str, Any] | None,
) -> dict[str, Any]:
    if level_position < 24:
        usage = {
            "kind": "stop",
            "stopIndex": level_position // 12,
            "positionInStop": level_position % 12,
        }
    else:
        usage = {
            "kind": "culmination",
            "positionInCulmination": level_position - 24,
        }
    prompt = candidate.prompt
    explanation_plan: dict[str, Any] = {
        "headline": candidate.short_title,
        "reasoning": candidate.rationale,
        "animation": candidate.animation,
        "adaptation": candidate.adaptation_note,
        "status": "needs-final-authored-solution-steps",
        "solutionSteps": [],
        "wrongAnswerHint": "",
        "animationPlan": {
            "kind": candidate.animation,
            "beats": [],
        },
    }
    if solution:
        prompt = cleaned(solution.get("prompt") or prompt)
        explanation_plan.update(
            {
                key: value
                for key, value in solution.items()
                if key != "prompt"
            }
        )
    explanation_plan["headline"] = complete_headline(
        explanation_plan.get("headline"),
        prompt,
    )
    target_public_path = f"/journey/math-kangaroo/{candidate.id}.webp"
    asset: dict[str, Any] = {
        "privateReportCrop": candidate.report_crop,
        "privateCropWidth": candidate.crop_width,
        "privateCropHeight": candidate.crop_height,
        "sourceCropTopPoints": candidate.crop_top_points,
        "sourceCropBottomPoints": candidate.crop_bottom_points,
        "targetPublicPath": target_public_path,
        "status": "needs-prompt-removal-and-option-relabel",
        "qa": {
            "promptFree": False,
            "optionsRelabeled": False,
            "diagramComplete": False,
            "reviewed": False,
        },
    }
    if existing_asset:
        if existing_asset.get("targetPublicPath") == target_public_path:
            for key in ("status", "publicWidth", "publicHeight"):
                if key in existing_asset:
                    asset[key] = existing_asset[key]
            if isinstance(existing_asset.get("qa"), dict):
                asset["qa"] = existing_asset["qa"]
    public_file = ROOT / "public" / target_public_path.removeprefix("/")
    if public_file.exists():
        with Image.open(public_file) as public_image:
            asset["publicWidth"], asset["publicHeight"] = public_image.size
    choices = [
        {
            "label": str(index + 1),
            "sourceAnswer": chr(ord("A") + index),
            "accessibleLabel": (
                f"Choice {index + 1}: {choice_display_text[index]}"
                if choice_display_text
                else f"Answer {index + 1}"
            ),
            **(
                {"displayText": choice_display_text[index]}
                if choice_display_text
                else {}
            ),
        }
        for index in range(5)
    ]
    return {
        "id": candidate.id,
        "journeyLevel": journey_level,
        "difficulty": difficulty,
        "gradeBand": candidate.grade_band,
        "levelPosition": level_position,
        "usage": usage,
        "mechanic": candidate.mechanic,
        "rawMechanic": candidate.raw_mechanic,
        "prompt": prompt,
        "choices": choices,
        "correctIndex": ord(candidate.answer) - ord("A"),
        "explanationPlan": explanation_plan,
        "source": {
            "provider": "Thales Foundation Cyprus official archive",
            "year": candidate.year,
            "gradeBand": candidate.grade_band,
            "part": candidate.part,
            "questionNumber": candidate.question,
            "sourceDocument": candidate.source_url,
            "privateSourcePdf": (
                "work/math-kangaroo-spatial-review/" + candidate.source
            ),
            "sourcePage": candidate.page,
            "sourceEndPage": candidate.end_page,
            "answer": candidate.answer,
            "answerKeyDocument": candidate.answer_key_url,
            "privateAnswerKeyPdf": candidate.answer_key_local,
            "answerKeyVerified": True,
            "reviewScore": candidate.score,
            "reviewTier": candidate.tier,
            "visualVerified": candidate.visual_verified,
            "existingGameFit": candidate.existing_game_fit,
        },
        "asset": asset,
        "transcription": {
            "source": "curated Cyprus spatial-review CSV",
            "diagramAwareReviewRequired": True,
        },
    }


def validate_manifest(payload: dict[str, Any]) -> None:
    rounds = payload["rounds"]
    if len(rounds) != 168:
        raise ValueError(f"Expected 168 rounds; found {len(rounds)}")
    ids = [item["id"] for item in rounds]
    source_keys = [
        (
            item["source"]["year"],
            item["source"]["gradeBand"],
            item["source"]["part"],
            item["source"]["questionNumber"],
        )
        for item in rounds
    ]
    if len(set(ids)) != 168 or len(set(source_keys)) != 168:
        raise ValueError("Selection reuses an ID or source question")

    by_level: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in rounds:
        by_level[item["journeyLevel"]].append(item)
        expected_index = ord(item["source"]["answer"]) - ord("A")
        if item["correctIndex"] != expected_index:
            raise ValueError(f"{item['id']} disagrees with its answer key")
        if not item["source"]["answerKeyVerified"]:
            raise ValueError(f"{item['id']} lacks answer-key verification")
        public_file = (
            ROOT
            / "public"
            / item["asset"]["targetPublicPath"].removeprefix("/")
        )
        if public_file.exists() and (
            not isinstance(item["asset"].get("publicWidth"), int)
            or not isinstance(item["asset"].get("publicHeight"), int)
            or item["asset"]["publicWidth"] <= 0
            or item["asset"]["publicHeight"] <= 0
        ):
            raise ValueError(f"{item['id']} lacks public asset dimensions")
        explanation = item["explanationPlan"]
        status = explanation["status"]
        if status in {"authored-needs-visual-qa", "final-reviewed"}:
            if re.search(
                r"(?:\.{3}|…)\s*$",
                cleaned(explanation.get("headline")),
            ):
                raise ValueError(
                    f"{item['id']} has a truncated explanation headline"
                )
            if (
                len(explanation.get("solutionSteps", [])) < 2
                or not cleaned(explanation.get("wrongAnswerHint"))
                or len(
                    (explanation.get("animationPlan") or {}).get("beats", [])
                )
                < 2
            ):
                raise ValueError(
                    f"{item['id']} has incomplete authored explanation fields"
                )
            validate_explanation_answer_claim(item, explanation)
            if status == "final-reviewed":
                visual = explanation.get("visualExplanation")
                if (
                    not isinstance(visual, dict)
                    or not isinstance(visual.get("regions"), list)
                    or not isinstance(visual.get("paths"), list)
                    or not isinstance(visual.get("beats"), list)
                    or len(visual["beats"]) < 3
                ):
                    raise ValueError(
                        f"{item['id']} lacks a grounded visual explanation"
                    )
                reveals = [
                    beat
                    for beat in visual["beats"]
                    if isinstance(beat, dict)
                    and beat.get("kind") == "reveal"
                    and "verifiedChoiceIndex" in beat
                ]
                if (
                    not reveals
                    or int(reveals[-1]["verifiedChoiceIndex"])
                    != item["correctIndex"]
                ):
                    raise ValueError(
                        f"{item['id']} visual explanation does not end in "
                        "the official-key answer"
                    )
        if status.startswith("unresolved") and not cleaned(
            explanation.get("unresolvedReason")
        ):
            raise ValueError(f"{item['id']} lacks an unresolved reason")

    seen_stop_schedules: dict[tuple[str, ...], str] = {}
    seen_culmination_schedules: dict[tuple[str, ...], str] = {}
    for journey_level, _, _, _ in LEVELS:
        level = sorted(by_level[journey_level], key=lambda item: item["levelPosition"])
        if len(level) != 28:
            raise ValueError(f"{journey_level} has {len(level)} rounds")
        if len({item["mechanic"] for item in level}) < 5:
            raise ValueError(f"{journey_level} lacks mechanic breadth")
        if len({item["source"]["year"] for item in level}) < 6:
            raise ValueError(f"{journey_level} lacks year breadth")
        for offset in (0, 12):
            stop = level[offset : offset + 12]
            answers = Counter(item["source"]["answer"] for item in stop)
            if any(answers[answer] < 1 or answers[answer] > 4 for answer in "ABCDE"):
                raise ValueError(f"{journey_level} stop answer imbalance")
            if any(
                stop[index]["correctIndex"] == stop[index - 1]["correctIndex"]
                for index in range(1, len(stop))
            ):
                raise ValueError(f"{journey_level} repeats adjacent answers")
            schedule = tuple(item["source"]["answer"] for item in stop)
            if has_repeated_answer_cycle(schedule):
                raise ValueError(f"{journey_level} repeats an answer cycle")
            if has_monotone_answer_run(schedule):
                raise ValueError(f"{journey_level} has a monotone answer run")
            if schedule in seen_stop_schedules:
                raise ValueError(
                    f"{journey_level} duplicates the answer schedule from "
                    f"{seen_stop_schedules[schedule]}"
                )
            seen_stop_schedules[schedule] = (
                f"{journey_level} stop {offset // 12 + 1}"
            )
            if len({item["mechanic"] for item in stop}) < 4:
                raise ValueError(f"{journey_level} stop lacks mechanic breadth")
        if any(item["usage"]["kind"] != "culmination" for item in level[24:]):
            raise ValueError(f"{journey_level} culmination split is invalid")
        culmination_schedule = tuple(
            item["source"]["answer"] for item in level[24:]
        )
        if culmination_schedule in seen_culmination_schedules:
            raise ValueError(
                f"{journey_level} duplicates the culmination answer schedule "
                f"from {seen_culmination_schedules[culmination_schedule]}"
            )
        seen_culmination_schedules[culmination_schedule] = journey_level


def summarize(payload: dict[str, Any]) -> None:
    rounds = payload["rounds"]
    print(f"Wrote {len(rounds)} verified selections to {OUTPUT.relative_to(ROOT)}")
    for journey_level, _, _, _ in LEVELS:
        level = [
            item for item in rounds if item["journeyLevel"] == journey_level
        ]
        mean_question = sum(
            item["source"]["questionNumber"] for item in level
        ) / len(level)
        answers = Counter(item["source"]["answer"] for item in level[:24])
        print(
            f"  {journey_level}: mean source question {mean_question:.1f}; "
            f"{len({item['mechanic'] for item in level})} mechanics; "
            f"{len({item['source']['year'] for item in level})} years; "
            f"stop answers {dict(sorted(answers.items()))}"
        )


def main() -> None:
    candidates = load_candidates()
    solution_payload = load_json_without_duplicate_keys(SOLUTION_OVERRIDES)
    solutions = solution_payload["solutions"]
    choice_payload = load_json_without_duplicate_keys(CHOICE_OVERRIDES)
    choice_overrides = choice_payload["rounds"]
    for round_id, display_text in choice_overrides.items():
        if (
            not isinstance(display_text, list)
            or len(display_text) != 5
            or any(not cleaned(value) for value in display_text)
        ):
            raise ValueError(
                f"{round_id} choice override needs five non-empty strings"
            )
    existing_assets: dict[str, dict[str, Any]] = {}
    if OUTPUT.exists():
        try:
            existing_payload = json.loads(OUTPUT.read_text(encoding="utf-8"))
            existing_assets = {
                item["id"]: item["asset"]
                for item in existing_payload.get("rounds", [])
                if isinstance(item.get("asset"), dict)
            }
        except (json.JSONDecodeError, KeyError, TypeError):
            existing_assets = {}
    selections = {
        "grades-1-2": select_grade(candidates["grades-1-2"], 12026),
        "grades-3-4": select_grade(candidates["grades-3-4"], 34026),
    }
    apply_forced_replacements(selections, candidates)
    rounds: list[dict[str, Any]] = []
    grade_level_index = {"grades-1-2": 0, "grades-3-4": 0}
    stop_schedules: set[tuple[str, ...]] = set()
    culmination_schedules: set[tuple[str, ...]] = set()
    for journey_level_index, (
        journey_level,
        difficulty,
        grade_band,
        _,
    ) in enumerate(LEVELS):
        index = grade_level_index[grade_band]
        chosen = reorder_level_for_journey(
            selections[grade_band][index],
            journey_level_index=journey_level_index,
            stop_schedules=stop_schedules,
            culmination_schedules=culmination_schedules,
        )
        grade_level_index[grade_band] += 1
        rounds.extend(
            manifest_round(
                candidate,
                journey_level,
                difficulty,
                level_position,
                solutions.get(candidate.id),
                choice_overrides.get(candidate.id),
                existing_assets.get(candidate.id),
            )
            for level_position, candidate in enumerate(chosen)
        )
    payload = {
        "schemaVersion": 1,
        "contentVersion": "mk-spatial-cyprus-2026.1",
        "generatedBy": "scripts/build-math-kangaroo-selection.py",
        "selectionPolicy": {
            "source": "Cyprus official papers, 2012-2026",
            "tiers": ["A"],
            "excludedAnswers": ["VOID", "CANCELED", "multiple answers"],
            "roundsPerJourneyLevel": 28,
            "stopRoundsPerJourneyLevel": 24,
            "culminationRoundsPerJourneyLevel": 4,
            "privateCorpusNotForPublication": True,
            "selectedQuestionIllustrationsAuthorizedByCopyrightHolder": True,
            "forcedReplacements": FORCED_REPLACEMENTS,
        },
        "rounds": rounds,
    }
    selected_ids = {item["id"] for item in payload["rounds"]}
    unknown_solution_ids = set(solutions) - selected_ids
    if unknown_solution_ids:
        raise ValueError(
            "Solution overrides reference unselected IDs: "
            + ", ".join(sorted(unknown_solution_ids))
        )
    unknown_choice_ids = set(choice_overrides) - selected_ids
    if unknown_choice_ids:
        raise ValueError(
            "Choice overrides reference unselected IDs: "
            + ", ".join(sorted(unknown_choice_ids))
        )
    validate_manifest(payload)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = OUTPUT.with_name(OUTPUT.name + ".tmp")
    temporary_output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_output.replace(OUTPUT)
    summarize(payload)


if __name__ == "__main__":
    main()
