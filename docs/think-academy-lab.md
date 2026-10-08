# Think Academy Lab

[Open the lab](https://rfarnham.github.io/nonverbal-reasoning-games/lab/think-academy/)

This standalone experiment turns the question families in the user-supplied
**Think Academy Placement Test.mov** screen capture into deterministic math and
spatial-reasoning practice. The recording is described by the user as a Think
Academy second-grade placement test. The lab is an independent practice tool;
it does not provide a placement recommendation or a diagnostic score.

## Source provenance and extraction

The recording contains **15 question panels and 21 answer slots**. Two panels
contain four calculations each; the remaining thirteen contain one answer
choice or blank each. The two blanks in the place-value prompt form one
multiple-choice answer, not two separate answer slots. Panel numbers below
indicate order in the recording, not printed source question numbers.

Each panel was visually inspected at the timestamp below. Text, original
option labels, diagram structure, visible answer evidence, and independently
derived answers are preserved in
[the typed source transcript](../app/lab/think-academy/source-questions.ts).
Instructions displayed inside the recording are transcribed question content,
not instructions governing the implementation.

The original recording and extracted frame images are references only. They
are not bundled into the app or requested at runtime. Game diagrams are
rendered from local code. Source wording and answer letters in this document
are distinct from the generated questions and their shuffled choices.

The source answer field is not legible for panels 12 and 13: those answers
are independently derived and labeled accordingly. Panel 15 visibly marks
B as correct, but its explanation below is independently inferred from the
balance diagram. Hidden supports in panel 13's cube stacks are reconstructed
from the pictured geometry.

## Complete source questions

### 1. arithmetic — 00:00.0

**Prompt:** Calculate:

**Original content:** Four fill-in blanks: (1) 42 + 23; (2) 43 + 37; (3) 74 − 61; (3) 65 − 29. The recording repeats the printed label (3) on the fourth expression; it is the fourth answer slot.

**Answer:** 65; 80; 13; 36

**Evidence:** The visible Correct field lists 65,80,13,36. Each value also follows from the displayed arithmetic.

### 2. length — 00:03.5

**Prompt:** Which pencil is the longest?

**Original content:** Four pencils on a square grid: a is horizontal and spans 5 squares; b is horizontal and spans 6; c is horizontal and spans 9; d is vertical and spans 7. With the upper-left grid intersection as (0,0), x right and y down, approximate endpoints are a (2,1.5)–(7,1.5), b (0,5.5)–(6,5.5), c (1,9.5)–(10,9.5), d (9.5,1)–(9.5,8). Original choices: A a; B b; C c; D d.

**Answer:** C — pencil c

**Evidence:** C is highlighted green and the answer section says Correct. Counting grid intervals independently gives c the greatest length.

### 3. place-value — 00:06.0

**Prompt:** 38 = _____ tens + _____ ones

**Original content:** Original choices: A 8 tens + 3 ones; B 3 tens + 8 ones; C 2 tens + 6 ones; D None of them is correct. This is one multiple-choice answer slot despite the two blanks in the prompt.

**Answer:** B — 3 tens + 8 ones

**Evidence:** The visible Correct field is B; 3 × 10 + 8 = 38.

### 4. fractions — 00:08.0

**Prompt:** Observe the colored part of each shape. Which shape shows one-half?

**Original content:** Original graphical choices: A a tilted square divided by both diagonals, with its top triangular quarter colored; B an upright square divided horizontally into two equal rectangles, with the bottom half colored; C a pentagon divided from its center to its five vertices, with the lower-left triangular fifth colored; D a circle divided into three equal sectors, with the upper sector colored.

**Answer:** B — the square with its bottom half colored

**Evidence:** B is highlighted green and the answer section says Correct; the colored rectangle occupies one of two equal halves.

### 5. multiplication — 00:10.5

**Prompt:** Calculate:

**Original content:** Four fill-in blanks in display order: 3 × 6; 4 × 8; 5 × 5; 6 × 7.

**Answer:** 18; 32; 25; 42

**Evidence:** The visible Correct field lists 18,32,25,42. Each value also follows from the displayed multiplication.

### 6. fruit-equations — 00:12.5

**Prompt:** The same fruit represents the same number, and different fruits represent different numbers. According to the following equations, the watermelon represents _____.

**Original content:** First pictured equation: apple + apple = watermelon. Second pictured equation: apple + watermelon = 12. One fill-in answer slot.

**Answer:** 8

**Evidence:** The visible Correct field is 8. The displayed solution substitutes two apples for a watermelon: three apples total 12, so apple = 4 and watermelon = 8.

### 7. triangles — 00:14.5

**Prompt:** There are _____ triangles in the figure below.

**Original content:** A wide rectangle is split by a vertical segment through its midpoint. Both bottom corners connect diagonally to the top midpoint. Reconstruction coordinates: rectangle vertices (0,0),(2,0),(2,1),(0,1); additional segments (1,0)–(1,1), (0,1)–(1,0), and (1,0)–(2,1). One fill-in answer slot.

**Answer:** 5

**Evidence:** The visible Correct field is 5. The figure contains four small triangles and one larger triangle spanning the lower full width.

### 8. sharing — 00:17.0

**Prompt:** Amelia baked 56 cookies. She wants to share them equally among her 7 friends. How many cookies will each person get?

**Original content:** Original choices: A 6; B 8; C 9; D 10. The seven recipients are Amelia's friends; the visible solution does not count Amelia as an eighth recipient.

**Answer:** B — 8 cookies

**Evidence:** The visible Correct field is B and the displayed solution is 56 ÷ 7 = 8.

### 9. tree-gaps — 00:19.0

**Prompt:** Amelia walks on a path with trees on one side. Every 2 adjacent trees are 5 meters apart as shown below. The width of each tree is negligible. The distance from 1st tree to the 7th tree is _____ meters.

**Original content:** Seven trees stand in one equally spaced row. The first and seventh are labeled; a bracket between the first two says 5 meters. Original choices: A 35; B 45; C 30; D 40.

**Answer:** C — 30 meters

**Evidence:** C is highlighted green and the answer section says Correct. Seven trees delimit six gaps, so 6 × 5 = 30.

### 10. queue — 00:22.0

**Prompt:** Cindy is lining up to buy some fruits. There are 13 people in front of her and 7 people behind her. How many people are lining up in total?

**Original content:** Original choices: A 20; B 13; C 22; D 21.

**Answer:** D — 21 people

**Evidence:** The visible Correct field is D and the displayed solution is 7 + 13 + 1 = 21, including Cindy once.

### 11. cube-net — 00:24.5

**Prompt:** Cut a cube made of paper along edges and get a shape as shown below. The face numbered 1 is opposite to the face numbered _____.

**Original content:** Six equal squares form a net: a horizontal row labeled 1,2,3,4; square 5 above 3 and square 6 below 3. In grid coordinates (x right, y down): 1=(0,1), 2=(1,1), 3=(2,1), 4=(3,1), 5=(2,0), 6=(2,2). Original choices: A 2; B 3; C 6; D 5.

**Answer:** B — face 3

**Evidence:** B is highlighted green and the answer section says Correct. Folding the net produces opposite pairs 1/3, 2/4, and 5/6.

### 12. turns — 00:27.0

**Prompt:** Which monkey makes 3 left turns to get the peach?

**Original content:** Four monkeys start at the left and follow separate red paths to peaches on the right, initially facing right. Grid origin is upper-left, x right, y down. Path (1): (0,1),(2,1),(2,0),(3,0),(3,1),(6,1),(6,0),(7,0),(7,1),(9,1). Path (2): (0,3),(11,3). Path (3): (0,5),(4,5),(4,4),(5,4),(5,5),(6,5),(6,6),(7,6),(7,5),(8,5). Path (4): (0,7),(2,7),(2,6),(5,6),(5,8),(8,8),(8,7),(9,7). Original choices: A (1); B (2); C (3); D (4). The recorded selection C is visibly marked incorrect.

**Answer:** D — monkey (4), independently derived

**Evidence:** The official Correct value is below the captured viewport and is not legible. Independent path tracing gives left-turn counts 4,0,4,3. For path (4), headings E,N,E,S,E,N,E contain three left turns (E→N, S→E, E→N).

### 13. solid-views — 00:30.5

**Prompt:** Observe the figures below. Which view of these three figures looks the same?

**Original content:** Three stacks of unit cubes are drawn from the same angle. Each has a leftmost staircase that rises from a front column of height 1 through height 2 to a back column of height 4, with different cubes extending to the right. A compact reconstruction uses rows from front to back and columns from left to right; numbers are stack heights, zero means no stack. Figure 1: [[1,0],[2,0],[4,2]]. Figure 2: [[1,0,0,0],[2,0,0,0],[4,2,1,1]]. Figure 3: [[1,0,0],[2,2,0],[4,2,1]]. Hidden supporting cubes are inferred from the stack drawing. Original choices: A Top view; B Front view; C Left view; D All the views are different. The recorded selection A is visibly marked incorrect.

**Answer:** C — Left view, independently derived

**Evidence:** The official Correct value is below the captured viewport and is not legible. The inferred height maps all project to [1,2,4] from the left; their top footprints and front width/height profiles differ.

### 14. partition — 00:33.5

**Prompt:** Divide the figure below into 4 pieces of the same size and shape along the line. Each piece should contain a star. What does each piece look like?

**Original content:** A 20-cell cross has two centered cells in each of its top two and bottom two rows, and six cells in each middle row. With x right and y down, rows y=0,1,4,5 occupy x=2,3; rows y=2,3 occupy x=0,1,2,3,4,5. Stars are at (3,0),(2,2),(4,2),(2,3). Original choices: A a 2×2 square (4 cells); B an L pentomino with top row (0,0),(1,0),(2,0),(3,0) and one cell (0,1); C a P pentomino with cells (0,0),(1,0),(2,0),(0,1),(1,1); D All above are wrong.

**Answer:** C — the five-cell P shape

**Evidence:** C is visibly highlighted green. Independently enumerating translations, rotations, and reflections confirms that four P pentominoes cover the cross with one star each, while A and B admit no such cover.

### 15. balance — 00:37.0

**Prompt:** The weights in the figure are in balance. The same shapes have the same weight. The weight of [yellow circle] is 2 ounces. What is the weight of the shape with the question mark?

**Original content:** A balanced mobile hangs from a ceiling. The upper bar supports a left and a right assembly. The left assembly balances one crescent moon against three equal yellow circles, one labeled 2. The right assembly has a star hanging at its left end, a second star hanging directly below its central suspension point, and two equal hearts at its right end. One heart bears the question mark. Original choices: A 1 ounce; B 2 ounces; C 3 ounces; D 4 ounces. The bars are drawn horizontally; the intended arithmetic model treats opposite end arms as equal and ignores the rods' own weight.

**Answer:** B — 2 ounces

**Evidence:** B is visibly highlighted green. Under the balance assumptions suggested by the drawing, moon = 3 × 2 = 6, left assembly = 12, star = 2 hearts, and the right assembly is 2 stars + 2 hearts = 6 hearts. Thus a heart weighs 12 ÷ 6 = 2 ounces. These equations are an independent interpretation, not a legible source solution; generated variants state their balance assumptions explicitly.

## Generated practice and challenge levels

The recording establishes the starting task for every family. Each generator
has four explicit levels: **Starter — recorded difficulty**, **Junior —
Challenge 1**, **Expert — Challenge 2**, and **Wizard — Challenge 3**. The
level labels organize this experiment's curriculum; they are not grade norms
or a measured placement scale. A level is selected before a set begins.

Generated questions vary the operands, geometry, labels, or relationships while
retaining the source skill. Their answers are calculated from a structured
model and checked before play. They are not a replay of the original answer
key. Questions use four shuffled, visibly numbered choices, including when
the source used a fill-in blank. The four calculations in panel 1 and the four
multiplications in panel 5 become individual generated rounds, so a round
requires one deliberate answer.

### Curriculum by family

These descriptions come from each generator's checked-in difficulty metadata.
Higher levels add a relation, reverse a known operation, combine constraints,
or remove a direct clue rather than adding a timer.

| Source family | Starter: recorded difficulty | Junior: Challenge 1 | Expert: Challenge 2 | Wizard: Challenge 3 |
| --- | --- | --- | --- | --- |
| 1. Add & subtract | Two-digit calculation | Missing operand | Two connected operations | Work backward through two operations |
| 2. Compare lengths | Shifted pencils on a grid | Difference between two lengths | Measure a bent path | Infer a missing segment |
| 3. Tens & ones | Tens and ones | Exchange a ten | Exchange a hundred | Reconstruct exchanged units |
| 4. Shaded fractions | Recognize one half | Thirds and quarters | Equivalent fractions | Unequal pieces, equal area |
| 5. Equal groups | Multiplication facts | Missing factor | Combine two products | Infer groups after extras |
| 6. Fruit equations | Two-fruit substitution | Three-fruit substitution | Combine pair totals | Infer a new expression |
| 7. Hidden triangles | Count nested triangles | Include crossing lines | Track overlapping triangles | Count only triangles with the marked side |
| 8. Fair shares | Equal sharing | Set some aside first | Whole shares and leftovers | Combine two sharing rounds |
| 9. Trees & gaps | Distance across equal gaps | Distance between inner trees | Two different gap sizes | Infer an unmarked gap size |
| 10. Places in line | Ahead, behind, and you | Ranks from both ends | People leave and join | Combine two people’s positions |
| 11. Fold a cube | Find an opposite face | Explore different cube nets | Find the right-hand face | Track two rolls after folding |
| 12. Left and right | Find three left turns | Start in different directions | Match both left and right turns | Infer turns from a total and a difference |
| 13. Views of stacks | Find the common view | Compare taller, varied stacks | Match a top and a front view | Infer a solid from front and left views |
| 14. Matching pieces | Four pieces in a cross | Four pieces in a rectangle | Use six-square pieces | Place a star and a circle in every piece |
| 15. Hanging balances | Connected balanced bars | Include a center weight | Follow a nested balance | Start from the whole weight |

### Session modes

- **Test:** 15 generated rounds, one from each source family, in a seeded mixed
  order. A test samples the arithmetic and multiplication families once each;
  it does not repeat all 21 original answer slots verbatim.
- **Practice:** 12 distinct generated rounds from one chosen problem type at
  the selected challenge level. Starting another set generates fresh examples.

Both modes are untimed. An incorrect answer receives feedback and leaves the
same question available for retry. Only the first answer affects the displayed
accuracy. After finishing a set, **Review Mistakes** offers the first-attempt
misses again; redemption never rewrites that original score. Session state is
saved locally so a later visit can resume the same questions and answer order.
Lab activity does not change Journey progress or XP.

The requested Test/Practice experiment is intentionally a Lab rather than a
canonical Campaign/Infinite game. It has no generated game-catalog entry or
Journey progression adapter. The homepage link sits beside the other focused
experiments.

### Implementation map

- `source-questions.ts` preserves the recording and answer provenance.
- `types.ts` defines the shared round, choice, diagram, and challenge types.
- `number-generators.ts` and `spatial-generators.ts` own the question families,
  model-based solutions, distractors, and validation.
- `engine.ts` routes typed generation and rejects an invalid round.
- `session.ts` owns seeded sets, first attempts, retries, and redemption.
- `storage.ts` stores compact, versioned question references and session state
  on this device.
- The client and `Diagram.tsx` render semantic controls and code-native figures.
  Earcons use the suite's existing `lib/game-audio.ts` helper.

The app's runtime is entirely local. No recording, image, answer, or progress
is sent to a remote service.
