import type { ProblemType } from "./types.ts";

/** Transcription of the user-provided recording, not executable game rules. */
export interface SourceQuestion {
  number: number;
  type: ProblemType;
  timestamp: string;
  prompt: string;
  details: string;
  answers: string;
  answerEvidence: string;
}

export const SOURCE_QUESTIONS: readonly SourceQuestion[] = [
  {
    number: 1,
    type: "arithmetic",
    timestamp: "00:00.0",
    prompt: "Calculate:",
    details: "Four fill-in blanks: (1) 42 + 23; (2) 43 + 37; (3) 74 − 61; (3) 65 − 29. The recording repeats the printed label (3) on the fourth expression; it is the fourth answer slot.",
    answers: "65; 80; 13; 36",
    answerEvidence: "The visible Correct field lists 65,80,13,36. Each value also follows from the displayed arithmetic.",
  },
  {
    number: 2,
    type: "length",
    timestamp: "00:03.5",
    prompt: "Which pencil is the longest?",
    details: "Four pencils on a square grid: a is horizontal and spans 5 squares; b is horizontal and spans 6; c is horizontal and spans 9; d is vertical and spans 7. With the upper-left grid intersection as (0,0), x right and y down, approximate endpoints are a (2,1.5)–(7,1.5), b (0,5.5)–(6,5.5), c (1,9.5)–(10,9.5), d (9.5,1)–(9.5,8). Original choices: A a; B b; C c; D d.",
    answers: "C — pencil c",
    answerEvidence: "C is highlighted green and the answer section says Correct. Counting grid intervals independently gives c the greatest length.",
  },
  {
    number: 3,
    type: "place-value",
    timestamp: "00:06.0",
    prompt: "38 = _____ tens + _____ ones",
    details: "Original choices: A 8 tens + 3 ones; B 3 tens + 8 ones; C 2 tens + 6 ones; D None of them is correct. This is one multiple-choice answer slot despite the two blanks in the prompt.",
    answers: "B — 3 tens + 8 ones",
    answerEvidence: "The visible Correct field is B; 3 × 10 + 8 = 38.",
  },
  {
    number: 4,
    type: "fractions",
    timestamp: "00:08.0",
    prompt: "Observe the colored part of each shape. Which shape shows one-half?",
    details: "Original graphical choices: A a tilted square divided by both diagonals, with its top triangular quarter colored; B an upright square divided horizontally into two equal rectangles, with the bottom half colored; C a pentagon divided from its center to its five vertices, with the lower-left triangular fifth colored; D a circle divided into three equal sectors, with the upper sector colored.",
    answers: "B — the square with its bottom half colored",
    answerEvidence: "B is highlighted green and the answer section says Correct; the colored rectangle occupies one of two equal halves.",
  },
  {
    number: 5,
    type: "multiplication",
    timestamp: "00:10.5",
    prompt: "Calculate:",
    details: "Four fill-in blanks in display order: 3 × 6; 4 × 8; 5 × 5; 6 × 7.",
    answers: "18; 32; 25; 42",
    answerEvidence: "The visible Correct field lists 18,32,25,42. Each value also follows from the displayed multiplication.",
  },
  {
    number: 6,
    type: "fruit-equations",
    timestamp: "00:12.5",
    prompt: "The same fruit represents the same number, and different fruits represent different numbers. According to the following equations, the watermelon represents _____.",
    details: "First pictured equation: apple + apple = watermelon. Second pictured equation: apple + watermelon = 12. One fill-in answer slot.",
    answers: "8",
    answerEvidence: "The visible Correct field is 8. The displayed solution substitutes two apples for a watermelon: three apples total 12, so apple = 4 and watermelon = 8.",
  },
  {
    number: 7,
    type: "triangles",
    timestamp: "00:14.5",
    prompt: "There are _____ triangles in the figure below.",
    details: "A wide rectangle is split by a vertical segment through its midpoint. Both bottom corners connect diagonally to the top midpoint. Reconstruction coordinates: rectangle vertices (0,0),(2,0),(2,1),(0,1); additional segments (1,0)–(1,1), (0,1)–(1,0), and (1,0)–(2,1). One fill-in answer slot.",
    answers: "5",
    answerEvidence: "The visible Correct field is 5. The figure contains four small triangles and one larger triangle spanning the lower full width.",
  },
  {
    number: 8,
    type: "sharing",
    timestamp: "00:17.0",
    prompt: "Amelia baked 56 cookies. She wants to share them equally among her 7 friends. How many cookies will each person get?",
    details: "Original choices: A 6; B 8; C 9; D 10. The seven recipients are Amelia's friends; the visible solution does not count Amelia as an eighth recipient.",
    answers: "B — 8 cookies",
    answerEvidence: "The visible Correct field is B and the displayed solution is 56 ÷ 7 = 8.",
  },
  {
    number: 9,
    type: "tree-gaps",
    timestamp: "00:19.0",
    prompt: "Amelia walks on a path with trees on one side. Every 2 adjacent trees are 5 meters apart as shown below. The width of each tree is negligible. The distance from 1st tree to the 7th tree is _____ meters.",
    details: "Seven trees stand in one equally spaced row. The first and seventh are labeled; a bracket between the first two says 5 meters. Original choices: A 35; B 45; C 30; D 40.",
    answers: "C — 30 meters",
    answerEvidence: "C is highlighted green and the answer section says Correct. Seven trees delimit six gaps, so 6 × 5 = 30.",
  },
  {
    number: 10,
    type: "queue",
    timestamp: "00:22.0",
    prompt: "Cindy is lining up to buy some fruits. There are 13 people in front of her and 7 people behind her. How many people are lining up in total?",
    details: "Original choices: A 20; B 13; C 22; D 21.",
    answers: "D — 21 people",
    answerEvidence: "The visible Correct field is D and the displayed solution is 7 + 13 + 1 = 21, including Cindy once.",
  },
  {
    number: 11,
    type: "cube-net",
    timestamp: "00:24.5",
    prompt: "Cut a cube made of paper along edges and get a shape as shown below. The face numbered 1 is opposite to the face numbered _____.",
    details: "Six equal squares form a net: a horizontal row labeled 1,2,3,4; square 5 above 3 and square 6 below 3. In grid coordinates (x right, y down): 1=(0,1), 2=(1,1), 3=(2,1), 4=(3,1), 5=(2,0), 6=(2,2). Original choices: A 2; B 3; C 6; D 5.",
    answers: "B — face 3",
    answerEvidence: "B is highlighted green and the answer section says Correct. Folding the net produces opposite pairs 1/3, 2/4, and 5/6.",
  },
  {
    number: 12,
    type: "turns",
    timestamp: "00:27.0",
    prompt: "Which monkey makes 3 left turns to get the peach?",
    details: "Four monkeys start at the left and follow separate red paths to peaches on the right, initially facing right. Grid origin is upper-left, x right, y down. Path (1): (0,1),(2,1),(2,0),(3,0),(3,1),(6,1),(6,0),(7,0),(7,1),(9,1). Path (2): (0,3),(11,3). Path (3): (0,5),(4,5),(4,4),(5,4),(5,5),(6,5),(6,6),(7,6),(7,5),(8,5). Path (4): (0,7),(2,7),(2,6),(5,6),(5,8),(8,8),(8,7),(9,7). Original choices: A (1); B (2); C (3); D (4). The recorded selection C is visibly marked incorrect.",
    answers: "D — monkey (4), independently derived",
    answerEvidence: "The official Correct value is below the captured viewport and is not legible. Independent path tracing gives left-turn counts 4,0,4,3. For path (4), headings E,N,E,S,E,N,E contain three left turns (E→N, S→E, E→N).",
  },
  {
    number: 13,
    type: "solid-views",
    timestamp: "00:30.5",
    prompt: "Observe the figures below. Which view of these three figures looks the same?",
    details: "Three stacks of unit cubes are drawn from the same angle. Each has a leftmost staircase that rises from a front column of height 1 through height 2 to a back column of height 4, with different cubes extending to the right. A compact reconstruction uses rows from front to back and columns from left to right; numbers are stack heights, zero means no stack. Figure 1: [[1,0],[2,0],[4,2]]. Figure 2: [[1,0,0,0],[2,0,0,0],[4,2,1,1]]. Figure 3: [[1,0,0],[2,2,0],[4,2,1]]. Hidden supporting cubes are inferred from the stack drawing. Original choices: A Top view; B Front view; C Left view; D All the views are different. The recorded selection A is visibly marked incorrect.",
    answers: "C — Left view, independently derived",
    answerEvidence: "The official Correct value is below the captured viewport and is not legible. The inferred height maps all project to [1,2,4] from the left; their top footprints and front width/height profiles differ.",
  },
  {
    number: 14,
    type: "partition",
    timestamp: "00:33.5",
    prompt: "Divide the figure below into 4 pieces of the same size and shape along the line. Each piece should contain a star. What does each piece look like?",
    details: "A 20-cell cross has two centered cells in each of its top two and bottom two rows, and six cells in each middle row. With x right and y down, rows y=0,1,4,5 occupy x=2,3; rows y=2,3 occupy x=0,1,2,3,4,5. Stars are at (3,0),(2,2),(4,2),(2,3). Original choices: A a 2×2 square (4 cells); B an L pentomino with top row (0,0),(1,0),(2,0),(3,0) and one cell (0,1); C a P pentomino with cells (0,0),(1,0),(2,0),(0,1),(1,1); D All above are wrong.",
    answers: "C — the five-cell P shape",
    answerEvidence: "C is visibly highlighted green. Independently enumerating translations, rotations, and reflections confirms that four P pentominoes cover the cross with one star each, while A and B admit no such cover.",
  },
  {
    number: 15,
    type: "balance",
    timestamp: "00:37.0",
    prompt: "The weights in the figure are in balance. The same shapes have the same weight. The weight of [yellow circle] is 2 ounces. What is the weight of the shape with the question mark?",
    details: "A balanced mobile hangs from a ceiling. The upper bar supports a left and a right assembly. The left assembly balances one crescent moon against three equal yellow circles, one labeled 2. The right assembly has a star hanging at its left end, a second star hanging directly below its central suspension point, and two equal hearts at its right end. One heart bears the question mark. Original choices: A 1 ounce; B 2 ounces; C 3 ounces; D 4 ounces. The bars are drawn horizontally; the intended arithmetic model treats opposite end arms as equal and ignores the rods' own weight.",
    answers: "B — 2 ounces",
    answerEvidence: "B is visibly highlighted green. Under the balance assumptions suggested by the drawing, moon = 3 × 2 = 6, left assembly = 12, star = 2 hearts, and the right assembly is 2 stars + 2 hearts = 6 hearts. Thus a heart weighs 12 ÷ 6 = 2 ounces. These equations are an independent interpretation, not a legible source solution; generated variants state their balance assumptions explicitly.",
  },
];
