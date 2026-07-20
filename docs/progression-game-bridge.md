# Journey game bridge

Journey is a control and persistence layer around each canonical minigame. It
does not contain a second puzzle engine. Campaign data, Infinite generation,
validation, rendering, correctness, feedback, retry behavior, and teaching
motion remain owned by the game.

This document describes the implemented bridge. The public types live in
`lib/progression/`, and the React integration lives in
`components/progression/useProgressionGameSession.ts`.

## Architecture boundary

Shared Journey code must never:

- branch on a game slug;
- copy a game's Campaign rounds or generated round shape;
- decide which game-specific answer is correct;
- render a puzzle, option, hint, or explanatory animation;
- reproduce a game's generator, distractor, or validation rules; or
- persist a complete domain round object.

Each released game provides a thin local adapter. Its existing page passes that
adapter to the shared hook and continues to render the resolved canonical round.
Fixes to a game's engine or feedback path therefore apply to shelf play and
Journey automatically.

Journey membership still comes from the generated game catalog in
`lib/games.ts`. There is no second list of Journey games.

## Game-owned bridge files

Every released route has these two files beside its page and engine:

```text
app/games/<slug>/progression-metadata.ts
app/games/<slug>/progression-adapter.ts
```

### Version metadata is the single source of truth

`progression-metadata.ts` owns the two content versions:

```ts
export const progressionMetadata = {
  contentVersion: "1",
  generatorVersion: "1",
} as const;
```

Both consumers import this exact object:

```ts
// catalog.tsx
import { progressionMetadata } from "./progression-metadata";

export const gameInfo = {
  // title, description, skills, and other shelf fields
  progression: progressionMetadata,
} satisfies GameInfo;
```

```ts
// progression-adapter.ts
import { progressionMetadata } from "./progression-metadata.ts";

export const progressionAdapter = defineProgressionGameAdapter({
  // canonical engine fields
  contentVersion: progressionMetadata.contentVersion,
  generatorVersion: progressionMetadata.generatorVersion,
});
```

Do not repeat version literals in `catalog.tsx` or the adapter. The catalog
versions are included in a profile's snapshotted game membership and are used
when attempts are created. The adapter versions are used when a question is
materialized or migrated. Keeping both imports pointed at
`progressionMetadata` prevents those paths from disagreeing.

Increment `contentVersion` when the identity or ordering of Campaign content
changes. Increment `generatorVersion` when the same generated seed may produce
different content. Increment both when both contracts change. Fingerprints
still verify individual rounds; versions do not replace fingerprints.

## Persisted question references

Journey stores compact `QuestionReference` values, never rendered or domain
rounds. These are the current types from `lib/progression/types.ts`:

```ts
type QuestionReferenceBase = {
  gameSlug: string;
  level: ProgressionLevel;
  fingerprint?: string;
};

export type CampaignQuestionReference = QuestionReferenceBase & {
  source: "campaign";
  questionIndex: number;
  contentVersion: string;
};

export type GeneratedQuestionReference = QuestionReferenceBase & {
  source: "generated";
  seed: string;
  generatorVersion: string;
};

export type QuestionReference =
  | CampaignQuestionReference
  | GeneratedQuestionReference;
```

Important details:

- `level` is one of `starter`, `junior`, `expert`, or `wizard`.
- `questionIndex` is the zero-based position in the 12-round Campaign level.
  It is not parsed from a page's presentation ID.
- `seed` is a non-empty string, not a number. String seeds can safely include
  attempt, stop, sequence, and candidate identity without integer truncation.
- `fingerprint` may be absent when an attempt is first built. Resolution fills
  it from the canonical engine and persists the normalized reference.
- Campaign refs carry `contentVersion`; generated refs carry
  `generatorVersion`.

`questionReferenceKey()` includes the slug, level, source, matching version,
source identity (`questionIndex` or `seed`), and fingerprint. This key is the
persisted uniqueness key and becomes the resolved question's `playId`.
Migration separately recognizes a logical Campaign question by
slug/level/index and a logical generated question by slug/level/seed, allowing
the stored ref to be replaced when its version or fingerprint changes.

## Per-game adapter API

The adapter contains only canonical engine seams:

```ts
export type ProgressionGameAdapter<
  Round,
  EngineDifficulty extends string,
> = Readonly<{
  gameSlug: string;
  contentVersion: string;
  generatorVersion: string;
  campaignRounds: readonly Round[];
  difficultyByLevel: Readonly<
    Record<ProgressionLevel, EngineDifficulty>
  >;
  difficultyOf(round: Round): EngineDifficulty;
  fingerprint(round: Round): string;
  generate(
    difficulty: EngineDifficulty,
    random: () => number,
  ): Round;
}>;
```

A current Easy/Medium/Hard adapter looks like this:

```ts
import {
  defineProgressionGameAdapter,
} from "../../../lib/progression/game-adapter.ts";
import {
  ROUNDS,
  generateInfiniteRound,
  roundFingerprint,
  type BraceletRound,
  type Difficulty,
} from "./game-engine.ts";
import { progressionMetadata } from "./progression-metadata.ts";

export const progressionAdapter = defineProgressionGameAdapter<
  BraceletRound,
  Difficulty
>({
  gameSlug: "bracelet-search",
  contentVersion: progressionMetadata.contentVersion,
  generatorVersion: progressionMetadata.generatorVersion,
  campaignRounds: ROUNDS,
  difficultyByLevel: {
    starter: "Easy",
    junior: "Medium",
    expert: "Hard",
    wizard: "Wizard",
  },
  difficultyOf: (round) => round.difficulty,
  fingerprint: roundFingerprint,
  generate: (difficulty, random) =>
    generateInfiniteRound(difficulty, random),
});
```

Use the route slug as a literal. The conformance test checks that it matches the
discovered directory. A Starter/Junior/Expert engine changes only
`difficultyByLevel` and its local types/imports.

`defineProgressionGameAdapter()` validates at module initialization that:

- the slug and both versions are non-empty and valid;
- every Journey level maps to a non-empty engine difficulty;
- filtering the canonical array by each mapped difficulty returns exactly 12
  rounds; and
- all 48 Campaign fingerprints are non-empty and globally unique.

The adapter intentionally has no renderer or answer checker. The page still
compares the selected option with its canonical `round.correctIndex` (or the
game's equivalent completion rule).

## Resolution, seeds, and migration

The generic resolver returns the domain round only at runtime:

```ts
export type QuestionResolutionKind =
  | "current"
  | "materialized"
  | "campaign-updated"
  | "generated-fallback";

export type ResolvedProgressionQuestion<Round> = Readonly<{
  ref: QuestionReference;
  round: Round;
  playId: string;
  fingerprint: string;
  resolution: QuestionResolutionKind;
  migrated: boolean;
}>;

export function resolveProgressionQuestion<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  ref: QuestionReference,
  options?: ResolveQuestionOptions,
): ResolvedProgressionQuestion<Round>;
```

Resolution behaves as follows:

1. A ref for another game is rejected.
2. A Campaign ref selects `questionIndex` from the 12 rounds at the mapped
   difficulty. The resolver attaches the current content version and
   fingerprint. A version or fingerprint change keeps the same logical index,
   returns `campaign-updated`, and marks the ref migrated.
3. A generated ref is replayed through the canonical generator with
   `createProgressionRandom(ref.seed)` only when its generator version is
   current. Its output fingerprint must match any stored fingerprint and must
   not collide with the supplied exclusion set.
4. A stale, changed, duplicate, or exhausted generated ref falls back to an
   unused current Campaign question at the same level. The starting Campaign
   index is derived deterministically from the string seed. The normalized ref
   then has `source: "campaign"` and resolution `generated-fallback`.
5. `loadProgressionBrowserSession()` persists a migrated active ref before it
   accepts another action.

Fresh Turbo generation calls `createFreshGeneratedQuestion()` with a string
`seedBase`. The initial seed is used directly; later bounded candidates append
`:candidate:<number>`. The default limit is 48 candidates. Every candidate gets
a fresh seeded random source and excludes already-used fingerprints; its unique
seed also gives it a unique generated key. Campaign fallback selection excludes
both used fingerprints and used question keys. If every generated candidate
fails, the same deterministic Campaign fallback is used.

The current Turbo seed is produced by:

```ts
deterministicTurboSeed(attemptId, stopId, sequence)
// progression:<encoded-attempt-id>:<encoded-stop-id>:<sequence>
```

Do not persist a numeric PRNG state or reuse one long random stream. A stored
string seed must reproduce the question from the beginning on every load.

## Persisted attempt checkpoints

An attempt stores refs and generic outcome state. The relevant structures are:

```ts
export type AttemptRoundPhase = "answering" | "feedback" | "solved";

export type AttemptRound = {
  question: QuestionReference;
  phase: AttemptRoundPhase;
  attemptCount: number;
  firstTryCorrect: boolean | null;
  lastAnswerToken?: string;
};

export type RedemptionState = {
  queue: readonly QuestionReference[];
  currentIndex: number;
  phase: AttemptRoundPhase;
  attemptCount: number;
  lastAnswerToken?: string;
};

export type ProgressionAttempt = {
  schemaVersion: 1;
  id: string;
  stopId: string;
  kind: "normal" | "turbo" | "culmination";
  level: ProgressionLevel;
  phase:
    | "playing"
    | "redemption-ready"
    | "redemption"
    | "summary-ready"
    | "summary"
    | "retry-required"
    | "complete";
  rounds: readonly AttemptRound[];
  currentRoundIndex: number | null;
  sections: readonly AttemptSection[];
  currentSectionIndex: number | null;
  redemption: RedemptionState | null;
  activeTimeMs: number;
  turboRemainingMs?: number;
  startedAtMs: number;
  updatedAtMs: number;
  settlement?: AttemptSettlement;
};
```

Only the first answer writes `firstTryCorrect`. A miss changes the active phase
to `feedback`; the game's inspectable feedback remains on screen before the page
calls `retry()`. Retry returns the same question to `answering` and clears its
temporary `lastAnswerToken` without changing first-try history. A correct answer
sets `solved`; an explicit Next action advances.

`answerToken` is deliberately opaque to shared state. Current four-choice games
write `option-<zero-based-index>`. The shared
`progressionOptionIndexFromAnswerToken()` helper also accepts legacy bare
numeric tokens so a refreshed page can restore the attempted option.

After all main questions are solved, first-attempt misses are copied into the
ordered redemption queue. Redemption has its own phase, attempt count, and last
answer token; its answers never rewrite first-try accuracy. Domain animation
geometry, rendered rounds, React state, and timers are not persisted.

## Shared page hook

Every game page calls:

```ts
const progression = useProgressionGameSession(progressionAdapter);
```

The implemented session surface is:

```ts
export type ProgressionInteractionState =
  | "answering"
  | "mandatory-feedback"
  | "blocked";

export type ProgressionGameSession<Round> =
  | Readonly<{ mode: "booting" }>
  | Readonly<{ mode: "standalone" }>
  | Readonly<{
      mode: "recovery" | "redirect";
      message: string;
      navigationTarget: ProgressionRouteTarget;
    }>
  | ProgressionControlledGameSession<Round>;

export type ProgressionControlledGameSession<Round> = Readonly<{
  mode: "controlled";
  state: ProgressionState;
  profile: PlayerProfile;
  attempt: ProgressionAttempt;
  attemptId: string;
  current: ResolvedProgressionQuestion<Round> | null;
  stage: AttemptPhase;
  roundPhase: AttemptRoundPhase | null;
  runKind: ProgressionAttempt["kind"];
  level: ProgressionLevel;
  isRedemption: boolean;
  currentAttemptCount: number;
  lastAnswerToken: string | null;
  interactionState: ProgressionInteractionState;
  completedQuestions: number;
  currentQuestionNumber: number;
  totalQuestions: number | null;
  turboRemainingMs: number | null;
  turboClockPaused: boolean;
  navigationTarget: null;
  exitTarget: ProgressionRouteTarget;
  answer(result: { correct: boolean; answerToken?: string }): void;
  retry(): void;
  advance(): void;
  beginRedemption(): void;
  setInteractionState(state: ProgressionInteractionState): void;
  setTurboClockPaused(paused: boolean): void;
  refresh(): void;
}>;
```

The URL is intentionally opaque:

```text
/games/<slug>/?progression=<attempt-id>
```

The attempt ID is only a local-storage lookup key. Profile, node, game, level,
run kind, and question details come from validated persisted state. No query
means `standalone`. Invalid storage, an inactive/wrong attempt, an invalid game
membership, or an unresolvable question yields `recovery`. A culmination route
pointing at the wrong game yields `redirect` with the canonical target. Summary
and completed phases also redirect. `current` is intentionally `null` at
`redemption-ready`, allowing the game to render the shared redemption intro.

The hook reads `window.location.search` after mount so static export does not
require `useSearchParams`. It listens for `storage` and `popstate`, persists
every action through the browser session, and exposes normalized progress and
active-attempt metadata for refresh hydration.

`setInteractionState()` controls input and feedback safety; it does not change
a question from `feedback` to `answering` and does not pause Turbo. The game
must call `retry()` after its mandatory wrong-answer review has finished.
`setTurboClockPaused()` is deliberately separate and is reserved for explicit
explanation or teaching modals.

## Mechanical page integration

Use the same control pattern in every game; do not create a Journey-only game
component or copy puzzle logic.

1. Import the local adapter, the shared hook, `ProgressionGameHud`, and the
   shared recovery/redemption panels.
2. Treat `booting` as input-blocked while retaining stable server/client
   markup. Preserve all existing standalone state when mode is `standalone`.
3. In controlled mode, derive `activeSessionRound` from
   `progression.current`. A `null` controlled round must stay null; never use
   `controlledRound ?? standaloneRound`, because that exposes a shelf puzzle at
   `redemption-ready`.
4. Hide standalone mode selection, Campaign tabs/history, Infinite controls,
   and standalone results. Keep the canonical prompt, choices, renderer,
   feedback, sound, shortcuts, focus behavior, and teaching UI.
5. Compute correctness in the game, then persist before beginning visual
   feedback:

   ```ts
   progression.answer({
     correct: optionIndex === round.correctIndex,
     answerToken: `option-${optionIndex}`,
   });
   ```

   Skip standalone score, Campaign, Infinite, and mistake-list mutations in
   this branch.
6. Keep the entire wrong-answer explanation visible. At the end of the game's
   existing review timer, call `progression.retry()`, return local phase to
   idle, and focus the attempted choice. Do not rely on
   `setInteractionState("answering")` to retry persisted state.
7. After a correct teaching animation and any game-owned discovery lesson, keep
   the explicit Next action. Its controlled handler calls
   `progression.advance()`.
8. Derive timing state from both persisted and local state:
   - persisted `feedback` => `mandatory-feedback`;
   - persisted `solved` or navigation/recovery => `blocked`;
   - persisted `answering` plus local idle, unlocked input, and no blocking
     lesson => `answering`;
   - other animations, dialogs, or teaching states =>
     `mandatory-feedback` or `blocked` as appropriate.
   Separately call `setTurboClockPaused(true)` only while an explicit
   explanation/teaching modal blocks play, and call it with `false` once the
   current round is hydrated without such a modal. Ordinary feedback,
   animations, solved states, and Next transitions remain on the Turbo clock.
9. Scope controlled hydration to attempt, main/redemption mode, and play ID,
   for example
   `<attemptId>:<main-or-redemption>:<current.playId>`. Mark that key hydrated
   inside the deferred reset, not before it, so a render cannot expose stale
   local state.
10. Restore persisted checkpoints as semantic UI states:
    - `feedback`: decode `lastAnswerToken`, select the attempted wrong option,
      show the game's final inspectable wrong-review state, linger for the
      reduced/normal review duration, then retry and restore focus;
    - `solved`: select the canonical correct option, restore answered state,
      and preserve any required post-solve lesson before Next;
    - `answering`: clear old visuals and use `currentAttemptCount > 0` to
      restore retry-ready copy. Exact attempted-option focus is unavailable
      after retry because retry intentionally clears `lastAnswerToken`.
11. Pattern Matrix and Libra must reconstruct their rule/strategy learning
    state from resolved prior rounds. Exclude the current solved main round
    before calculating its pending discovery lesson; otherwise refresh skips
    that required lesson. Game-owned lessons continue to block timing.
12. Use `currentQuestionNumber` and `totalQuestions` in
    `ProgressionGameHud`. Render `ProgressionRedemptionIntro` when stage is
    `redemption-ready`; its CTA calls `beginRedemption()`. Handle
    `recovery`/`redirect` with their supplied target rather than falling back to
    shelf play.

Domino Twist performs this integration in `DominoTwistGame.tsx`, not its small
route wrapper.

## Stop behavior through the bridge

### Normal

- The attempt starts with 12 Campaign refs for one game and board level.
- The refs use indices 0 through 11 and the current catalog content version.
- First resolution attaches current fingerprints and persists them.

### Turbo

- The attempt starts with one generated ref at Starter, matching canonical
  Infinite mode.
- After each solved question, `advance()` appends a fresh generated ref while
  `turboRemainingMs` is above zero.
- Adaptive difficulty climbs or falls from Starter using the suite-wide
  Infinite rule, is reconstructed from write-once first attempts, and is
  capped at the board level.
- At zero, no new question is appended; the visible question can still be
  solved before the attempt moves to redemption or summary.
- At least one solved main question is required.

### Culmination

- The attempt has one ordered section per snapshotted game.
- Each section contains one Starter Campaign question plus two current,
  distinct prior misses at or below the board level when eligible. Remaining
  positions are filled deterministically from the current board-level Campaign
  refs.
- A section change redirects to the next canonical game route with the same
  attempt ID. Shared code never imports that game's engine.
- Accuracy and redemption are aggregate across every section.

### Redemption and summary

- Every main question is completed before redemption begins.
- Redemption revisits every first-attempt miss in original order and is
  untimed, including after Turbo.
- Attempt settlement uses first attempts only. Passing is strictly
  `accuracy > 0.70`; XP is awarded idempotently by stop ID outside the game
  page.

## Timing and persistence

The persisted timer fields are `activeTimeMs` and, for Turbo,
`turboRemainingMs`.

- `activeTimeMs` accumulates while a controlled attempt is visible and in
  `playing` or `redemption`. It supplies the summary time.
- `turboRemainingMs` decreases only while the document is visible, the attempt
  is in main `playing`, a current puzzle exists, and no explicit explanation or
  teaching modal is open.
- Ordinary wrong/correct feedback, teaching animations, solved states, and
  puzzle transitions consume the Turbo limit. Explicit explanation modals,
  hidden documents, recovery, and redemption do not.

The hook flushes elapsed time before actions and interaction-state changes, on
visibility/page lifecycle changes, and on a one-second heartbeat. It starts a
fresh interval after hydration; time spent away from the page is never charged.

All mutations reload validated state, update the active profile attempt, and
save the versioned `ProgressionState` to local storage. Storage exceptions,
corrupt data, unsupported schema versions, and quota/security failures degrade
to recovery instead of uncaught errors or volatile XP awards.

## Conformance and regression tests

`tests/progression-adapters.test.mjs` discovers every released game and proves:

- a route-local `progression-adapter.ts` exists and imports no other game;
- the literal adapter slug matches the route;
- adapter versions come from `progressionMetadata`;
- all 48 Campaign refs resolve to canonical fingerprints; and
- generated rounds replay from string seeds and stale generator versions fall
  back to current Campaign content.

The other `tests/progression-*.test.mjs` files cover question persistence,
first-attempt invariants, retry/redemption, Turbo timing and caps, culmination
sections and redirects, migration, storage recovery, profile boundaries,
idempotent settlement, controlled UI hydration, and the no-slug-branch rule.

Run the focused suite with:

```bash
node --test tests/progression-*.test.mjs
```

Before release, run the complete project check and smoke-test standalone and
Journey entry at desktop and the 390px breakpoint:

```bash
npm run check
```
