# Folded Items design and mechanics audit

Audited against `AGENTS.md` and the owner's October 12, 2026 feedback, including
the follow-up removing baseline marks and making glyph orientation part of Wizard.
The photograph is a visual reference for legible folds; it is not an independent
source of product instructions.

## Findings and changes

| Area | Original issue | Revised contract |
| --- | --- | --- |
| Wrong answers | Starter, Junior, and Expert replayed the complete solution and added missing answer tokens to the chosen option. The review offer repeated the answer tokens. | Keep the original prompt and all option contents unchanged. Mark the attempted option with a cross, diagnose the relationship without naming solution items, and restore focus after the retry delay. Play the solution only after a correct answer or in a completed historical review. |
| Fold meaning | All folds moved underneath; arrows showed planar direction without clearly showing layer placement. | Each fold specifies a direction, an over/under sense, and a crease. The cue shows which flap moves and its path relative to the stationary paper. |
| Question wording | “Under” assumed that the named item was necessarily the top item. | Ask which item is stacked with the named item at Starter. From Junior, ask for the complete stack and explicitly read answers from top to bottom. |
| Curriculum | Harder paper remained 4×4; item styles appeared in clusters. | Interleave numbers, letters, and shapes. Introduce ordered stacks at Junior; use 5×5 paper at Expert and Wizard, with later off-center folds. Wizard uses the Expert stimulus complexity and hides one fold. |
| Answer model | Item sets discarded stack order, so reversing a fold could be immaterial. | Starter compares group membership. Junior and above compare the full ordered stack, including the named item. The moving flap reverses its complete stack before it is placed over or under the stationary stack. |
| Traps | Advanced alternatives changed item membership but did not test the handedness of a fold. | Validate distinct alternatives from mistaken layer order, over/under placement, and spatial grouping. Use generous distinctions at Starter and Junior and closer mistakes at Expert and Wizard. |
| Wizard evidence | The hidden-fold catalogue described only the four directions of an underneath fold. | Prove uniqueness across the full legal direction, crease, and over/under catalogue. Evidence must exclude the target stack so it does not supply the answer. Wrong feedback must be identical across Wizard options. |
| Pictures | Many similar flowers required counting small petal details. | Use flat geometric shapes with simple marks that remain distinct without color. |
| Rotated labels | Baseline marks add visual noise; some unmarked glyphs are symmetric or resemble another item after turning. | Keep letters and numbers unmarked. Wizard answers retain their real folded orientation; earlier-level answers stay upright. Normalize visual symmetries and cross-item aliases before accepting a supposedly different answer. |
| Wizard orientation | All answer tokens were rendered upright, discarding the mirrored or flipped result of folding. | Compare both ordered identities and the displayed final glyphs. Include a visibly different orientation-only trap with the exact correct identities and order; retain those transforms in solved and historical views. |
| Generator failure | A bounded failure was described as using every available puzzle. | Catch failure, try bounded deterministic recovery, use an unused authored puzzle at the requested difficulty, then offer results if no fresh puzzle can be prepared. |

## Session audit

The existing session foundation already followed most suite rules. Retain these
behaviors while changing the mechanic:

- Campaign has four independently selectable sequential levels, twelve rounds
  per level, two-row progress, and an explicit checkpoint after round twelve.
- Only the first answer determines score and the permanent red/green marker.
  Correct retries and redemption cannot rewrite that observation.
- Historical review is read-only, opens only from a completed idle marker,
  receives focus, and returns focus to its originating marker.
- The level checkpoint prioritizes **Review Mistakes** for that level. Redemption
  returns to the completed checkpoint, clears the outstanding queue, and keeps
  the red first-attempt marker. Final results retain other outstanding misses.
- Infinite uses the shared three-win/two-miss adaptation, starts at Starter,
  records each round once, resets combo on a miss, and offers untimed redemption.
  An end action is available after at least one solved puzzle.
- Journey continues through the canonical adapter and shared session. Standalone
  play cannot alter Journey progress. Controlled retries and redemption must
  survive reload without changing first-attempt accuracy or XP history.
- Real buttons expose number shortcuts 1–4, and shortcuts ignore native fields
  and editable descendants. Correct feedback, retries, checkpoints, history,
  and results each receive the appropriate focus handoff.
- Earcons and the remembered sound preference use the suite helper. Gameplay
  does not depend on successful audio playback.
- Feedback locks input. Animation timers and animation frames are cancelled on
  unmount. The SVG folds stay inside their paper panel while scrolling; resize
  settles the teaching animation. Both CSS and JavaScript honor reduced motion.

## Deliberate mechanic-specific choices

The owner's request takes precedence over the usual flat-only rendering rule:
use a restrained perspective fold and a small functional depth/shadow cue to
explain whether the moving flap passes over or under. The paper and item tokens
stay flat and high-contrast; depth is teaching information, not decoration.

The owner also explicitly introduces stack order at Junior. Ordered alternatives
may contain the same item identities in different positions, because their
vertical positions are the reasoning task. At Junior, alternatives must differ
in at least two layer positions and never rely on a style-only distinction.
Wizard may keep the exact same identities and order while changing one visibly
asymmetric glyph's orientation, as explicitly requested by the owner.

A wrong-answer comparison normally highlights missing components in the suite.
Here it would reveal the solution, so the owner's no-reveal requirement uses a
concise membership/order diagnosis instead. Wizard receives only a generic
mismatch that preserves its hidden-fold and glyph-orientation challenge. It must
not identify an orientation error, restore glyphs upright, or display the correct
stack after an incorrect choice.

The follow-up explicitly removes baseline and ground marks. No substitute marks
are added to answer tokens. A flip is a real difficulty feature only when it
changes the visible glyph: a horizontally mirrored triangle is unchanged, and
centered circle/square/diamond/hexagon shapes with symmetric marks do not encode
facing. Letter and number equivalences such as M/W and 6/9 also require
normalization. These are validation cases, not errors the player should detect
through tiny font differences.

Wizard’s overlap evidence is explicitly captioned **symbols shown upright**.
It communicates identities and layer order without silently exposing the hidden
fold through glyph facing. The actual answer and solved teaching sequence retain
the computed orientations.

## Verification record

The dedicated checks are:

- `tests/folded-items-engine.test.mjs`: physical stack conservation, exact ordered
  answers, distinct traps, curriculum and style coverage, hidden-fold uniqueness,
  answer balance, deterministic generation, nonrepetition, and hostile inputs.
- `tests/folded-items-journey.test.mjs`: canonical standalone and Journey banks,
  compact versioned references, deterministic replay, and generic discovery.
- `tests/folded-items-ui.test.mjs`: actual runtime recovery from generator
  exhaustion, immutable historical-review eligibility, nonspoiling feedback,
  answer-independent Wizard feedback, and safe version-one/two reference recovery
  to version-three content. The actual TSX renderer is also exercised
  for unmarked alphanumeric glyphs, Wizard transforms, upright earlier tiers,
  and perceptible orientation-only traps.
- `tests/browser/folded-items.test.mjs`: first-attempt immutability, history focus,
  checkpoint/redemption, Infinite promotion and combo, Journey reload/award
  behavior, native keyboard exclusions, wrong-answer non-disclosure at every
  level in both motion preferences, normal fold motion, sound persistence,
  and 390/620/820px layouts. A native-click regression keeps both animated folds
  in the phone viewport across consecutive rounds. Wizard checks preserve each
  transformed choice through incorrect feedback, the solved view, and historical
  inspection of both the correct answer and the first incorrect answer.

Final orientation follow-up verification on October 12, 2026, after integrating
the newer `main`:

- All ten UI, actual-renderer, feedback, and legacy-reference tests passed.
- The full repository check passed: 1,179 JavaScript tests passed (8 existing
  skips), 174 Python tests, and 10 search-build tests,
  plus lint, TypeScript, and the Pages export.
- All nine dedicated browser scenarios passed against the final merged Pages
  export, including Wizard orientation-only traps, nonspoiling wrong feedback,
  transformed solved and historical views, and the upright evidence caption.
- Desktop and 390px phone screenshots were visually inspected: unmarked glyphs,
  transformed choices, and the upright caption remain legible without clipping
  or horizontal overflow.
- Production deployment verification remains the final delivery gate.
