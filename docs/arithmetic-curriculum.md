# Arithmetic fluency curriculum

The first implemented curriculum bucket is Grade 1 (`G1`), curriculum version
`1`. It contains the 22 normative core skills and two optional stretch skills.
Curriculum data is independent of React and browser storage.

## Source layout

- `lib/arithmetic-fluency/types.ts` contains JSON-safe public contracts.
- `lib/arithmetic-fluency/exact-number.ts` owns exact arithmetic forms and
  normalization.
- `lib/arithmetic-fluency/g1-curriculum.ts` is the authoritative G1 inventory.
- `lib/arithmetic-fluency/generator.ts` generates and evaluates questions.
- `lib/arithmetic-fluency/validator.ts` checks the catalogue and prerequisite
  graph.
- `lib/arithmetic-fluency/mastery.ts`, `session.ts`, and `storage.ts` own the
  evidence, scheduling, and device-local persistence layers.

## Adding a skill

1. Add its stable ID to `G1_SKILL_IDS` and one complete `defineSkill` entry.
2. Declare direct prerequisites only. A core skill may not depend on stretch.
3. Give it four difficulty bands, structural coverage keys, stable
   misconception tags, examples, nonexamples, and accepted answer forms.
4. Add a constrained candidate family in `buildCandidatePool`. Never broaden a
   band beyond the skill definition.
5. Add an independent constraint assertion and boundary fixtures to the
   generator tests.
6. Run `npm run curriculum:validate` and `npm run arithmetic:verify-all`.

Adding a generator kind also requires registering the kind in
`G1_GENERATOR_KINDS`. The validator deliberately rejects unregistered kinds.

## Mastery and retention

Only the first unassisted answer is independent mastery evidence. Hints,
worked examples, corrected answers, and recognition failures remain useful
event data but cannot silently become first-try successes. Mastery thresholds
are selected by each skill's `masteryProfile`; critical coverage keys and
finite fact universes prevent a high average from hiding a missing subtype.
Every declared coverage bucket must also meet its `minimumShare` inside the
promotion window. FACT and MENTAL speed gates require a representative timing
sample, so a single fast observation cannot stand in for a full window.

The evidence reducer reconstructs learner state from immutable attempt events.
Fluent skills receive retention probes at 1, 3, 7, 14, and 30 days. Core skills
determine grade completion; stretch skills never block it.

`buildG1GradeAssessmentPlan` creates the cumulative Grade 1 check: 20 unique
learner-visible questions, exactly five per major domain, core skills only, and
a fixed three-band-3/two-band-4 mix per domain. Its `assessmentId` embeds a
fingerprint of the exact cards. Completion evidence accepts only an intact,
independent plan and keeps the latest prior complete result when a newer check
is abandoned.

## Version changes and historical evidence

Increment `G1_CURRICULUM_VERSION` when a skill's mathematical meaning,
constraints, or prerequisites change. Increment `G1_GENERATOR_VERSION` when an
identical seed can produce different content. Persistence records both values
on every attempt. Historical evidence remains replayable and is never rewritten
to claim it came from the newer content version. If a changed skill should not
share mastery evidence with the old meaning, give it a new skill ID.
Question snapshots dispatch through generator-version-specific validators;
retain the old validator whenever a new generator version is introduced.

The earlier Borrow Flash adaptive-practice ledger is intentionally preserved
but is not converted into G1 mastery credit. Its skills and evidence rules are
not equivalent to this curriculum, so an automatic crosswalk could unlock
skills or retention from evidence that never met the G1 contract. Profile
clearing removes both ledgers; otherwise they remain isolated.

## Commands

```bash
npm run curriculum:validate
npm run curriculum:list
npm run curriculum:graph
npm run curriculum:coverage
npm run arithmetic:generate -- --skill G1-AS-10 --count 20 --seed demo
npm run arithmetic:explain -- --skill G1-AS-17 --seed demo
npm run arithmetic:verify-all
```

`curriculum:graph` reports cycles, roots, terminal skills, broad fan-in, and
later-grade dependency violations. `arithmetic:verify-all` generates 1,000
seeded instances per skill unless `--seeds` overrides it.
