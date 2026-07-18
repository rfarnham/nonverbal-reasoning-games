# Project decisions

These defaults let development move while keeping the choices inexpensive to
change. They are product decisions, not permanent constraints.

## Decided for the first version

| Topic | Initial choice | Why |
| --- | --- | --- |
| Audience | Teens and adults, with plain instructions | A useful baseline without pretending the games are age-normed assessments |
| Session style | Short, untimed rounds | Encourages reasoning before speed and works for casual practice |
| Feedback | Immediate, non-color-only feedback | Makes each answer a learning moment and stays accessible |
| Difficulty | Starter, Junior, Expert, and Wizard levels in authored Campaign and adaptive Infinite modes | Gives every game a deliberate learning path and an unbounded practice mode with the same verified rules |
| Roadmap | Transformation Match, Pattern Matrix, and Libra establish the initial suite; the next reasoning skill is still open | Establishes transformation, rule-finding, and relational-reasoning games before expanding the suite |
| Progress | Session-only; no account | Keeps the launch private and frictionless |
| Devices | Phone, tablet, and desktop | The public link should be useful wherever it is opened |
| Input | Keyboard, touch, and mouse | A basic accessibility and usability requirement |
| Hosting | Static GitHub Pages | Free, public, and directly linked from the repository |
| Architecture | One repository, one route per game | Shared tooling without premature packages or separate release cycles |
| Privacy | No analytics or third-party runtime calls | No policy or consent burden before there is a real measurement need |
| License | MIT for project code | Makes reuse and community contributions straightforward |

The site name is **Spatial Gym**; the repository remains descriptively named
`nonverbal-reasoning-games`.

## Libra strategy coverage

Libra treats the route to an answer as authored puzzle data, not just an
incidental solver outcome. Later Junior rounds introduce cross-scale addition
and subtraction; Expert and Wizard deliberately cover substitution, adding
balances, subtracting balances, and creating repeated target groups that must
be divided evenly. Infinite generation samples the same archetypes.

Every Libra round stores an exact integer derivation. Its signed relation
multipliers and final normalization factor must algebraically reproduce the
question target and answer. This certificate drives the post-answer teaching
cue and prevents family labels from overstating the reasoning a puzzle really
requires.

## Good next decisions

None of these block the initial release, but they should be decided before the
related feature is built:

1. **Target range:** Is the main audience students, adults practicing aptitude
   tests, older adults, or a deliberately broad group?
2. **Scoring:** Should speed ever affect score, or should accuracy and streaks
   remain the only signals?
3. **Roadmap order:** Prioritize paper folding, visual sequences, spatial
   memory, or another skill next?
4. **Persistence:** Should progress stay local, be exportable, or eventually
   sync through optional accounts?
5. **Accessibility boundary:** What alternate experience should be offered when
   a task is inherently visual and a text equivalent would reveal its answer?
6. **Community:** Invite new-game contributions immediately, or first stabilize
   a stronger puzzle and review contract?
7. **Measurement:** If analytics become useful, what smallest privacy-preserving
   event set would answer a concrete question?

## Product guardrail

These are practice games, not validated cognitive tests. Avoid diagnostic,
clinical, or intelligence-score claims unless future work supplies the research,
norming, and review needed to support them.
