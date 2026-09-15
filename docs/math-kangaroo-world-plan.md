# Math Kangaroo Worlds: product and technical plan

**Status:** fresh product direction and playable first world, 9 August 2026

**Playable route:** `/math-world/`

**First world:** Counting Coast

## Product decision

Math Kangaroo Worlds is a new flagship progression surface. It is not a Journey
reskin and does not inherit Journey's seven-board structure, XP economy,
Starter/Junior/Expert names, or minigame-heavy cadence.

The composition is deliberately simple:

```text
mostly Math Kangaroo questions
        + occasional optional minigames
        + occasional fact-fluency Turbo
        + visible geographic restoration
```

Curriculum order is static. There is no personalization, adaptive placement,
account, backend, analytics, lives system, streak pressure, or time pressure on
rich reasoning.

Review status does not block release. Imported placements retain
`provisional-playtest` provenance, and the world includes local question-level
QA capture. Actual play supplies the editorial feedback loop.

Mechanical fairness still applies. A scored question needs:

- a stable question ID and existing question-scoped asset;
- a stored answer that resolves to one displayed control;
- a complete response surface; and
- no player-visible answer-key annotation in the displayed crop.

This is not an editorial-review gate. It only prevents impossible or
self-answering rounds.

## What is playable now

Counting Coast is an original responsive SVG/DOM world with:

- nine required Math Kangaroo stops and two optional breaks;
- 38 frozen Grades 1–2 questions: eight four-question trails and a six-question
  lighthouse culmination;
- three active curriculum realms: Number & Operations, Shape & Space, and
  Measurement & Modeling;
- retry-until-correct rounds with first-attempt history;
- exact stop/question/feedback-phase persistence in local storage;
- A–E and 1–5 keyboard shortcuts, native buttons, visible focus, reduced
  motion, and shared local earcons;
- original question cards that can be enlarged;
- a question flag form for answer, wording, crop, placement, order, and
  accessibility concerns;
- local JSON export of playtest notes; and
- `?qa=1` to open every stop without changing the authored route.

Turbo Wharf links to Borrow Flash. Pattern Picnic links to Pattern Matrix. Both
are optional side stops and never gate the Math Kangaroo road.

The runtime package is intentionally small: one 68 KB question manifest and
about 768 KB of local question images. The browser never receives SQLite,
private paths, protected answer-key evidence, or the entire corpus.

## Corpus launch boundary

The current corpus already supports a genuine many-world campaign:

| Population | Count |
| --- | ---: |
| Total questions with an asset | 4,213 |
| Questions with some stored answer | 3,991 |
| Questions with an A–E answer and asset | 3,773 |
| A–E questions with known four/five-choice metadata | 3,142 |
| Alternate-response questions | 218 |
| Questions without a stored key | 222 |

Immediate A–E coverage by band is 883, 1,006, 918, 506, 231, and 229 from
Grades 1–2 through Grades 11–12. At roughly 96 new questions per large map,
that is about 43 maps before alternate-response renderers are needed.

Do not require equal realm quotas. Current automatic proposals are heavily
skewed toward Number and Geometry, while Combinatorics is under-detected.
Worlds should be content-proportional and placements should improve through
playtest corrections.

The private databases remain authoring inputs. `work/` is absent from normal
CI, so the static app consumes only committed, world-sized packages. The
authoring command pins an explicit catalogue run instead of silently selecting
one of several rows marked active:

```bash
python3 scripts/build-math-world-content.py \
  --run-id catalogue-c08d01a42b45e1116a6591dd
```

## Approved ontology

The product ontology is now `mk-map-ontology.v1`, stored at
[`content/math-world/mk-map-ontology.v1.json`](../content/math-world/mk-map-ontology.v1.json).
It is approved for static map placement and descriptive tagging, not as a
mastery or psychometric model.

Keep two connected hierarchies:

```text
Curriculum: Realm → District → Skill → Stage
Geography:  Chapter → World → Zone → Stop → Question
```

A world is an authored slice across two to four realms. It is not another
curriculum parent. This separation permits a coastal Number world, a mountain
Geometry world, and a later mixed festival to reuse stable semantic IDs without
repeating the same map.

The six realms and 27 districts are:

| Realm | Districts |
| --- | --- |
| Number & Operations | Count & Compare; Join & Separate; Equal Groups & Sharing; Equal Parts & Fractions; Number & Digit Structure |
| Patterns & Algebra | Repeat & Grow; Equality & Missing Values; Tables, Codes & Correspondence; Order, Rank & Relations |
| Logic & Constraints | Clues & Ordering; Constraint Placement; Work Backward; Elimination & Invariants |
| Possibilities, Chance & Data | Arrangements & Selections; Systematic Counting; Paths & Networks; Chance & Outcomes |
| Shape & Space | Shape Properties; Compose, Dissect & Tile; Turn, Reflect & Symmetry; Solids, Stacks & Views; Position & Direction |
| Measurement & Modeling | Clock & Calendar; Money & Value; Length & Distance; Perimeter, Area & Covering; Weight, Capacity & Units |

`mixed` and `unknown` are routing states, not seventh and eighth realms. Mixed
questions belong at Crossroads and culminations. Unknown questions enter the
playtest-placement queue.

Representation, reasoning move, procedure, cognitive demand, incidental load,
and provenance are cross-cutting facets. They do not become landmasses. Every
question receives one primary geographic location plus any number of secondary
skills and facets.

The internal stages are `concrete → direct → structured → integrated → novel`.
They replace Starter/Junior/Expert-style labels and need not be exposed to the
player.

## World grammar

Use three scales:

1. **Atlas:** selects a world and gives every destination a memorable
   silhouette.
2. **World map:** shows 9–15 nearby stops, one unmistakable required road, and
   a few shallow branches.
3. **Stop:** a compact untimed Math Kangaroo set, optional Turbo, or optional
   minigame.

Realm grammar remains stable while geography changes. Number uses terraces,
markets, bridges, and stacked markers; Patterns uses mosaics and signal
gardens; Logic uses gates and maze structures; Possibilities uses branching
routes; Geometry uses folded or crystalline forms; Measurement uses clocks,
docks, observatories, and scales.

The world geography is independent: lagoon, river delta, desert, forest
canopy, caves, sky islands, fjords, canal city, reef, moon, and other forms can
all carry the same curriculum icons.

Counting Coast activates three realms instead of forcing six equal zones onto
every map. Future Grades 1–2 worlds can be:

1. Counting Coast — lagoon and small islands;
2. Orchard Bridges — fields split by rivers;
3. Patternwood — spiral forest and canopy routes;
4. Clockwork Harbor — canal city with clocks and docks;
5. Tiling Tidepools — reef shelves and mosaic beaches;
6. Sharing Jungle — waterfall terraces and tree villages;
7. Mirror Mountains — switchback peaks and crystal caves;
8. Puzzle Citadel — a walled maze city;
9. Route Delta — braided rivers, ferries, and rail junctions; and
10. Lantern Crossroads — a night festival culmination.

See the researched map patterns and official references in
[`docs/math-world-map-atlas.md`](./math-world-map-atlas.md).

## Cadence

The default large-world recipe is:

```text
MK → MK → MK → Turbo
→ MK → optional minigame
→ MK → MK → Turbo
→ MK → MK → culmination
```

Nine of twelve nodes are Math Kangaroo when the culmination is included;
eleven of twelve are mathematical. A smaller world can use the same ratio.
Turbo and minigame branches should be short enough to feel like welcome
contrast, not the purpose of the expedition.

Ordinary stops can contain 4–12 questions depending on the world scale. Large
authored maps use twelve-question stops; Counting Coast uses four-question
trails so the first playable build reaches frequent checkpoints. A wrong
answer never advances. The learner retries until correct, while first-attempt
evidence remains unchanged.

Turbo is the only timed surface. It measures active answering time, lets the
live problem finish at zero, pauses while hidden, and ends with untimed
redemption. Rich Math Kangaroo reasoning is untimed and time is never praised
as ability.

## Comparable products and mechanics

| Product | Useful idea | Applied here | Avoided here |
| --- | --- | --- | --- |
| Duolingo | One obvious next action and practice embedded in forward progress ([path rationale](https://blog.duolingo.com/new-duolingo-home-screen-design/)) | A highlighted next stop and frequent compact checkpoints | Hearts, streak loss, guilt, and leaderboard pressure |
| Beast Academy | Rigorous core problems plus optional hard work and full solutions ([class overview](https://help.beastacademy.com/a/1798922-class-overview)) | Math Kangaroo is the core road; enrichment lives on shallow branches | Lockouts and punitive waiting |
| Super Mario maps | Memorable regions, readable roads, culminations, and secrets ([World Maker](https://supermariomaker.nintendo.com/news/super-mario-maker-2-april-2020-update/)) | Geography chunks a large curriculum into revisitable maps | Decorative complexity that hides the next action |
| ST Math | Nested journey/objective/game/puzzle structure and visible mathematical consequence ([student experience](https://help.stmath.com/hc/en-us/articles/25919319116695-Student-Experience-Overview)) | Atlas → world → stop, with restoration after learning | Restarting substantial progress after mistakes |
| DragonBox | Mathematical manipulation is the play, with notation revealed gradually ([Algebra 5+](https://dragonbox.com/products/algebra-5)) | New minigames must make the target relation the mechanic | A quiz pasted over unrelated action |
| Zoombinis | A small number of deep logic mechanics revisited at greater complexity ([TERC overview](https://www.terc.edu/edge/games-for-learning/zoombinis/)) | Reuse the strongest Spatial Gym mechanics as occasional breaks | Many shallow one-off minigames |
| Prodigy | Strong place identity, quests, and avatar ownership ([overview](https://www.prodigygame.com/main-en/components)) | A light expedition fantasy and visible restoration | Math tollbooths, shops, loot, random drops, and FOMO |

The blend is Mario/ST Math for topology, Duolingo for clarity, Beast Academy
for rigor, and DragonBox/Zoombinis for the quality bar on minigames.

## Engine and tooling decision

Use React, semantic HTML, layered SVG, CSS, and local Web Audio. This is the
lowest-complexity path to a polished world in the existing static Next.js app.
Every stop remains a real button, the map works at 390 px, and content stays
independent from art.

| Tool | Best use | Decision |
| --- | --- | --- |
| React + SVG/CSS | Accessible map, state, persistence, restoration, responsive routes | Current and default world shell |
| PixiJS 8 | Dense sprites, particles, parallax, or camera movement beneath a DOM control layer ([renderers](https://pixijs.com/8.x/guides/components/renderers), [accessibility](https://pixijs.com/8.x/guides/components/accessibility)) | Escalate only after profiling a representative dense map |
| Phaser | Continuous-simulation browser action game ([official overview](https://docs.phaser.io/phaser/getting-started/what-is-phaser)) | Route-isolated minigame only |
| Excalibur | Smaller TypeScript action-game engine ([docs](https://excaliburjs.com/docs/)) | Secondary minigame option |
| GDevelop | Disposable no-code action prototype ([project](https://github.com/4ian/GDevelop)) | Prototype minigames, not the progression shell |
| Construct 3 | Designer-owned HTML5 action prototype ([export docs](https://www.construct.net/en/make-games/manuals/construct-3/overview/publishing-projects)) | Optional prototype tool, not a second app architecture |
| Godot | Free-roaming standalone 2D/3D game | Reject for this static browser shell because of WASM/WebGL and accessibility duplication ([web export constraints](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)) |
| Tiled / LDtk | Build-time authoring of repeated route templates ([Tiled](https://doc.mapeditor.org/en/stable/manual/introduction/), [LDtk](https://ldtk.io/docs/general/world/)) | Add only when normalized coordinates become painful to author |
| Rive / Lottie | One focal mascot or landmark animation | Optional decoration; never navigation or puzzle truth |

The art pipeline stays cheap and editable:

1. original SVG composition with a stable `viewBox`;
2. normalized stop coordinates stored separately from illustration layers;
3. native DOM controls positioned over the art;
4. local question-scoped assets and no runtime CDN;
5. CSS/WAAPI restoration and avatar travel with reduced-motion equivalents;
6. one portrait mobile composition rather than pan-and-hunt navigation; and
7. GPU canvas only if measured density requires it.

## Playtesting as the QA system

Every question can save:

- looks good / needs change;
- answer-key concern;
- prompt wording;
- image/crop;
- curriculum placement;
- difficulty/order;
- layout/accessibility;
- free notes; and
- the first response observed in that play session.

The export binds those observations to the content version, question ID, stop,
and realm. This turns ordinary world play into the highest-leverage editorial
workflow without introducing analytics or a backend.

## Non-negotiable architecture boundaries

- The map does not import `lib/progression/*` or Journey state.
- The full private corpus is never one client bundle.
- Source answer order is preserved when it is visible in the crop.
- Static world manifests, not prerequisite edges, define order.
- Reclassification can move a question without changing its ID or erasing
  completed progress.
- Review uncertainty is visible to authoring and QA, not used to block release.
- Math Kangaroo remains the road; minigames remain the scenery.
