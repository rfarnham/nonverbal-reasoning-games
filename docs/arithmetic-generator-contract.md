# Arithmetic generator contract

## Public API

```ts
generateG1Question({ skillId, seed, difficultyBand?, orientation? })
generateG1FactQuestion({ skillId, factKey, seed, orientation? })
evaluateG1Answer(question, submitted)
requiredCoverageKeysForSkill(skillId)
factUniverseForSkill(skillId)
factKeyForQuestion(question)
g1QuestionContentFingerprint(question)
g1QuestionMathematicalFingerprint(question)
g1QuestionSemanticFingerprint(question)
buildG1GradeAssessmentPlan({ learnerId?, seed, events?, now? })
```

`generateArithmeticQuestion` and `evaluateArithmeticAnswer` are compatibility
aliases for grade-agnostic adapters. Generation is pure and deterministic from
the generator version, skill ID, seed, requested band, and orientation.

Every `QuestionInstance` is JSON-safe and retains:

- a stable instance ID, curriculum version, and generator version;
- one primary skill and optional prerequisite tags;
- a structured prompt AST, not just display text;
- exact operands and answer;
- requested answer forms;
- band and structural difficulty features;
- coverage keys, misconception-derived distractors, and a solution trace.

The G1 prompt AST variants are `equation`, `part-whole`, `equal-groups`, and
`division-model`. Renderers should branch on the discriminant and use
`renderedPrompt` only as a fallback. Vertical two-operand equations preserve
the suite convention: operator, operands, and bar, with no equals sign.
`part-whole` additionally carries a required `representation` discriminant:
`dot-parts`, `number-bond`, or `equation`. These are genuine rendered surface
forms; part-whole, model, missing-operand, and three-addend questions normalize
to horizontal rather than claiming an unsupported vertical layout.

## Exact numbers and evaluation

Exact values use tagged integer, normalized rational, finite-decimal
coefficient/scale, mixed-number, quotient/remainder/divisor, or percent-backed
rational records. Equality uses integer cross-products, not binary floating
point. Examples such as `1/2`, `0.5`, and `50%` normalize to the same value.

Equivalent value alone is insufficient. The evaluator first parses the
submitted form, then checks that the skill accepts that form. All G1 questions
currently require an integer, so `4/1` is not accepted in place of `4`.

## Difficulty and coverage

Each skill has four deterministic, intrinsic candidate cohorts:

1. clean;
2. ordinary;
3. structurally difficult;
4. adversarial but grade-valid.

Candidate construction applies the normative mathematical constraints before
band selection. Coverage keys describe actual structures (for example,
`decade_crossing`, `new_hundred_regroup`, `row_5`, or `sharing`). Fact skills
expose their full finite expression universe so schedulers can balance facts
instead of relying on random averages.

Multiplication fact generators deliberately use both `focus_factor_left` and
`focus_factor_right` presentations. Their mastery identity is commutative, so
`2 × 9` and `9 × 2` share the single fact key `×:2:9`; presentation
practice therefore cannot falsely inflate finite-universe completion.

`g1QuestionMathematicalFingerprint` intentionally ignores the owning skill and
cosmetic presentation. Session and assessment planners use it to avoid showing
the same learner-visible mathematics through overlapping skills or alternate
part-whole layouts. `g1QuestionContentFingerprint` retains genuine presentation
variants, while `g1QuestionSemanticFingerprint` additionally retains skill
identity for versioned fixtures and evidence.

## Card and handwriting adapters

The existing question card should receive `promptAst`, `orientation`, and the
integer extracted with `exactIntegerValue(question.exactAnswer)`. Existing
tap, keyboard, handwriting, and speech inputs all submit through
`evaluateG1Answer`; they do not maintain separate arithmetic rules.

Handwriting recognition must preserve both raw strokes/result metadata and the
confirmed mathematical answer in the attempt event. A recognition failure is
`not_evaluated`, not a mathematics miss. Only a confidently submitted or
confirmed first answer becomes first-attempt evidence.

## Verification

`tests/arithmetic-g1-generators.test.mjs` independently recomputes answers and
checks 1,000 seeds for every skill. It also checks operand limits, regrouping,
decade crossing, exact division, structured-render semantics, deterministic
regeneration, JSON round trips, coverage, fact universes, and misconception
distractors.

`G1_CANONICAL_FIXTURE_SEEDS` commits 12 literal, reviewable fixtures per skill (no
runtime seed search): four band 1,
four band 2, two band 3, and two band 4. `G1_BOUNDARY_FIXTURE_SEEDS` additionally
pins the applicable global boundary cases `9 + 1` (`G1-AS-03`) and `99 + 1`
(`G1-AS-10`). The other global examples intentionally do not appear in G1:
`100 - 1` has a three-digit minuend, `0 × 9` does not involve a 2, 5, or 10
factor, and `81 ÷ 9` uses divisor 9. They belong in later grade buckets rather
than silently widening a Grade 1 skill.
