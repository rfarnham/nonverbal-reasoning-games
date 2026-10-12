import { CAMPAIGN_ROUND_SPECS } from "./campaign-data.ts";

export type Difficulty = "Easy" | "Medium" | "Hard" | "Wizard";
export type FoldDirection = "up" | "down" | "left" | "right";
export type ItemStyle = "letters" | "numbers" | "flowers";
export type Flower = Readonly<{
  petals: 4 | 5 | 6 | 8;
  petalShape: "round" | "pointed";
  center: "circle" | "diamond";
  color: string;
}>;
export type Item = Readonly<{
  id: number;
  kind: "letter" | "number" | "flower";
  label: string;
  flower?: Flower;
}>;
export type Source = Readonly<{
  rows: number;
  cols: number;
  items: readonly Item[];
}>;
export type PaperState = Readonly<{
  rows: number;
  cols: number;
  /** Row-major cells; each stack is ordered from the visible top down. */
  stacks: readonly (readonly number[])[];
}>;
export type FoldStep = Readonly<{
  index: number;
  direction: FoldDirection;
  before: PaperState;
  after: PaperState;
}>;
export type OverlapClue = Readonly<{ aboveId: number; belowId: number }>;
export type ItemSet = readonly number[];
export type OptionKind = "correct" | "wrong-axis" | "neighbor-stack" | "one-item-off" | "two-items-off";
export type Round = Readonly<{
  difficulty: Difficulty;
  source: Source;
  folds: readonly FoldDirection[];
  foldSteps: readonly FoldStep[];
  hiddenFoldIndex: null | 0;
  overlapClue: OverlapClue | null;
  targetId: number;
  correctItems: ItemSet;
  options: readonly ItemSet[];
  optionKinds: readonly OptionKind[];
  correctIndex: number;
}>;
export type AuthoredFoldedItemsRoundSpec = Readonly<{
  difficulty: Difficulty;
  rows: number;
  cols: number;
  itemStyle: ItemStyle;
  itemOrder: readonly number[];
  folds: readonly FoldDirection[];
  targetCell: number;
  correctIndex: number;
  distractorSalt: number;
  overlapCell?: number;
  numberOffset?: number;
}>;
export type RandomSource = () => number;
export const GENERATOR_MAX_ATTEMPTS = 64;
export const FOLD_DIRECTIONS: readonly FoldDirection[] = ["up", "down", "left", "right"];
export const DIFFICULTIES: readonly Difficulty[] = ["Easy", "Medium", "Hard", "Wizard"];

function axis(direction: FoldDirection): "rows" | "cols" {
  return direction === "up" || direction === "down" ? "rows" : "cols";
}

export function foldDirectionLabel(direction: FoldDirection): string {
  const labels: Record<FoldDirection, string> = {
    up: "Fold the bottom half underneath the top half",
    down: "Fold the top half underneath the bottom half",
    left: "Fold the right half underneath the left half",
    right: "Fold the left half underneath the right half",
  };
  return labels[direction];
}

export function initialPaper(source: Source): PaperState {
  if (!Number.isInteger(source.rows) || !Number.isInteger(source.cols) || source.rows < 1 || source.cols < 1 || source.items.length !== source.rows * source.cols) {
    throw new Error("Paper dimensions must match its items.");
  }
  return { rows: source.rows, cols: source.cols, stacks: source.items.map(({ id }) => [id]) };
}

export function foldPaper(state: PaperState, direction: FoldDirection): PaperState {
  if (!FOLD_DIRECTIONS.includes(direction)) throw new Error(`Unknown fold direction: ${direction}.`);
  const dimension = state[axis(direction)];
  if (dimension < 2 || dimension % 2 !== 0) throw new Error(`Cannot fold ${direction} from ${state.rows}×${state.cols}.`);
  if (state.stacks.length !== state.rows * state.cols || state.stacks.some((stack) => stack.length === 0)) throw new Error("Paper cells must contain nonempty stacks.");
  const rows = axis(direction) === "rows" ? state.rows / 2 : state.rows;
  const cols = axis(direction) === "cols" ? state.cols / 2 : state.cols;
  const stacks: number[][] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const keptRow = direction === "down" ? row + rows : row;
      const keptCol = direction === "right" ? col + cols : col;
      const movingRow = axis(direction) === "rows" ? state.rows - 1 - keptRow : keptRow;
      const movingCol = axis(direction) === "cols" ? state.cols - 1 - keptCol : keptCol;
      const kept = state.stacks[keptRow * state.cols + keptCol];
      const moving = state.stacks[movingRow * state.cols + movingCol];
      // Folding a half underneath reverses every layer in the moving stack.
      stacks.push([...kept, ...[...moving].reverse()]);
    }
  }
  return { rows, cols, stacks };
}

export function foldSteps(source: Source, folds: readonly FoldDirection[]): readonly FoldStep[] {
  let state = initialPaper(source);
  return folds.map((direction, index) => {
    const before = state;
    state = foldPaper(state, direction);
    return { index, direction, before, after: state };
  });
}

export function targetStack(round: Pick<Round, "source" | "folds" | "targetId">): ItemSet {
  const steps = foldSteps(round.source, round.folds);
  const state = steps.length ? steps[steps.length - 1].after : initialPaper(round.source);
  const stack = state.stacks.find((items) => items.includes(round.targetId));
  if (!stack) throw new Error("Target item is missing from the folded paper.");
  return stack;
}

export function itemSetKey(items: ItemSet): string {
  return [...items].sort((a, b) => a - b).join(",");
}
export const patternKey = itemSetKey;
export function patternsEqual(first: ItemSet, second: ItemSet): boolean {
  return itemSetKey(first) === itemSetKey(second);
}
export function patternDifference(attempted: ItemSet, expected: ItemSet): Readonly<{ missing: number[]; extra: number[]; total: number }> {
  const missing = expected.filter((id) => !attempted.includes(id));
  const extra = attempted.filter((id) => !expected.includes(id));
  return { missing, extra, total: missing.length + extra.length };
}

export function itemById(round: Pick<Round, "source">, id: number): Item {
  const item = round.source.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown item: ${id}.`);
  return item;
}
export function describeItem(round: Pick<Round, "source">, id: number): string {
  return itemById(round, id).label;
}

function makeItem(id: number, style: ItemStyle, numberOffset: number): Item {
  if (style === "letters") return { id, kind: "letter", label: String.fromCharCode(65 + id) };
  if (style === "numbers") return { id, kind: "number", label: String(numberOffset + id) };
  const petals = ([4, 5, 6, 8] as const)[Math.floor(id / 4)];
  const petalShape = id % 4 < 2 ? "round" : "pointed";
  const center = id % 2 === 0 ? "circle" : "diamond";
  const color = ["#bf493e", "#16836b", "#7767d7", "#b27918"][Math.floor(id / 4)];
  return {
    id, kind: "flower",
    label: `${petals} ${petalShape} petals with a ${center} center`,
    flower: { petals, petalShape, center, color },
  };
}

function appearanceKey(item: Item): string {
  if (item.kind !== "flower") return `${item.kind}:${item.label}`;
  // Flower identity remains distinct when colors cannot be distinguished.
  return item.flower ? `flower:${item.flower.petals}:${item.flower.petalShape}:${item.flower.center}` : "flower:missing";
}

function sorted(items: ItemSet): number[] {
  return [...items].sort((a, b) => a - b);
}

type Candidate = Readonly<{ items: ItemSet; kind: OptionKind }>;

function buildOptions(round: Omit<Round, "options" | "optionKinds" | "correctIndex">, correctIndex: number, salt: number): Readonly<{ options: readonly ItemSet[]; optionKinds: readonly OptionKind[] }> {
  const correct = round.correctItems;
  const candidates: Candidate[] = [];
  const add = (items: ItemSet, kind: OptionKind) => {
    const normalized = sorted(items);
    if (normalized.length !== correct.length || normalized.includes(round.targetId) || new Set(normalized).size !== normalized.length || patternsEqual(normalized, correct) || candidates.some((candidate) => patternsEqual(candidate.items, normalized))) return;
    candidates.push({ items: normalized, kind });
  };

  const advanced = round.difficulty === "Hard" || round.difficulty === "Wizard";
  const ids = round.source.items.map(({ id }) => id);
  const outside = ids.filter((id) => id !== round.targetId && !correct.includes(id));
  const position = (id: number) => round.source.items.findIndex((item) => item.id === id);
  const distance = (a: number, b: number) => {
    const first = position(a);
    const second = position(b);
    return Math.abs(Math.floor(first / round.source.cols) - Math.floor(second / round.source.cols)) + Math.abs(first % round.source.cols - second % round.source.cols);
  };

  if (advanced) {
    // Every advanced trap preserves two real overlaps and replaces just one
    // with an item from a nearby source cell. Vary the missing component.
    for (let offset = 0; offset < correct.length; offset += 1) {
      const missingIndex = (offset + salt) % correct.length;
      const missingId = correct[missingIndex];
      const replacements = [...outside].sort((a, b) => distance(a, missingId) - distance(b, missingId) || ((a + salt) % ids.length) - ((b + salt) % ids.length));
      for (const replacement of replacements) add(correct.map((id, index) => index === missingIndex ? replacement : id), "one-item-off");
    }
  } else {
    // Evaluate actual mistaken fold axes, never an opposite-direction trap
    // that is answer-equivalent for an unordered set.
    for (const first of FOLD_DIRECTIONS) {
      for (const second of round.folds.length === 1 ? [null] : FOLD_DIRECTIONS) {
        try {
          const mistakenFolds = second === null ? [first] : [first, second];
          const group = targetStack({ ...round, folds: mistakenFolds });
          add(group.filter((id) => id !== round.targetId), "wrong-axis");
        } catch { /* A shortened dimension may not support a second fold. */ }
      }
    }
    const finalState = round.foldSteps[round.foldSteps.length - 1].after;
    for (const stack of finalState.stacks) add(stack.slice(1), "neighbor-stack");
    if (correct.length === 1) {
      for (const id of [...outside].sort((a, b) => distance(a, correct[0]) - distance(b, correct[0]) || a - b)) add([id], "neighbor-stack");
    } else {
      for (let kept = 0; kept < correct.length; kept += 1) {
        for (let first = 0; first < outside.length; first += 1) {
          for (let second = first + 1; second < outside.length; second += 1) add([correct[kept], outside[first], outside[second]], "two-items-off");
        }
      }
    }
  }

  const chosen: Candidate[] = [];
  const minimumDifference = round.difficulty === "Medium" ? 4 : 2;
  // Prefer one near miss from each different missing component in Expert.
  const ordered = advanced
    ? correct.flatMap((_, index) => candidates.filter((candidate) => !candidate.items.includes(correct[(index + salt) % correct.length])).slice(0, 1)).concat(candidates)
    : candidates.slice(salt % Math.max(1, Math.min(candidates.length, 3))).concat(candidates);
  for (const candidate of ordered) {
    if ([correct, ...chosen.map(({ items }) => items)].every((items) => patternDifference(candidate.items, items).total >= minimumDifference)) chosen.push(candidate);
    if (chosen.length === 3) break;
  }
  if (chosen.length !== 3) throw new Error("Cannot build three distinct meaningful item sets.");
  const options: ItemSet[] = [];
  const optionKinds: OptionKind[] = [];
  for (let index = 0; index < 4; index += 1) {
    const candidate = index === correctIndex ? { items: correct, kind: "correct" as const } : chosen.shift()!;
    options.push(candidate.items);
    optionKinds.push(candidate.kind);
  }
  return { options, optionKinds };
}

export function matchingFirstFolds(round: Pick<Round, "source" | "folds" | "overlapClue">): readonly FoldDirection[] {
  if (!round.overlapClue) return [];
  const clue = round.overlapClue;
  return FOLD_DIRECTIONS.filter((direction) => {
    try {
      const after = foldPaper(initialPaper(round.source), direction);
      if (!after.stacks.some((stack) => stack[0] === clue.aboveId && stack[1] === clue.belowId)) return false;
      // Every candidate comes from the complete visible catalogue and must
      // also permit the shown second fold.
      if (round.folds[1]) foldPaper(after, round.folds[1]);
      return true;
    } catch { return false; }
  });
}

export function buildAuthoredFoldedItemsRound(spec: AuthoredFoldedItemsRoundSpec): Round {
  if (!DIFFICULTIES.includes(spec.difficulty)) throw new Error(`Unknown difficulty: ${spec.difficulty}.`);
  if (!Number.isInteger(spec.correctIndex) || spec.correctIndex < 0 || spec.correctIndex > 3) throw new Error("Answer position must be from 0 to 3.");
  if (!Number.isInteger(spec.distractorSalt) || spec.distractorSalt < 0) throw new Error("Distractor salt must be a nonnegative integer.");
  const count = spec.rows * spec.cols;
  if (spec.itemOrder.length !== count || new Set(spec.itemOrder).size !== count || spec.itemOrder.some((id) => !Number.isInteger(id) || id < 0 || id >= count)) throw new Error("Item order must be a complete unique permutation.");
  const source: Source = { rows: spec.rows, cols: spec.cols, items: spec.itemOrder.map((id) => makeItem(id, spec.itemStyle, spec.numberOffset ?? 1)) };
  const steps = foldSteps(source, spec.folds);
  const final = steps[steps.length - 1]?.after;
  if (!final || !Number.isInteger(spec.targetCell) || spec.targetCell < 0 || spec.targetCell >= final.stacks.length) throw new Error("Target must name a cell on the final folded paper.");
  const targetId = final.stacks[spec.targetCell][0];
  const targetItems = final.stacks[spec.targetCell];
  let overlapClue: OverlapClue | null = null;
  if (spec.difficulty === "Wizard") {
    const possibleCells = steps[0].after.stacks.flatMap((stack, index) => stack.some((id) => targetItems.includes(id)) ? [] : [index]);
    const clueCell = spec.overlapCell ?? possibleCells[spec.distractorSalt % possibleCells.length];
    const clueStack = steps[0].after.stacks[clueCell];
    if (!clueStack || clueStack.some((id) => targetItems.includes(id))) throw new Error("Wizard evidence must describe a different item pair from the target stack.");
    overlapClue = { aboveId: clueStack[0], belowId: clueStack[1] };
  }
  const core = {
    difficulty: spec.difficulty, source, folds: [...spec.folds], foldSteps: steps,
    hiddenFoldIndex: spec.difficulty === "Wizard" ? 0 as const : null,
    overlapClue, targetId, correctItems: sorted(final.stacks[spec.targetCell].slice(1)),
  };
  const round: Round = { ...core, ...buildOptions(core, spec.correctIndex, spec.distractorSalt), correctIndex: spec.correctIndex };
  const errors = validateRound(round);
  if (errors.length) throw new Error(`Invalid folded-items round: ${errors.join("; ")}`);
  return round;
}

export function validateRound(round: Round): string[] {
  const errors: string[] = [];
  if (!DIFFICULTIES.includes(round.difficulty)) errors.push("Unknown difficulty.");
  const sourceCount = round.source.rows * round.source.cols;
  if (round.source.items.length !== sourceCount || new Set(round.source.items.map(({ id }) => id)).size !== sourceCount || new Set(round.source.items.map(appearanceKey)).size !== sourceCount) errors.push("Source items must have distinct identities and appearances.");
  for (const item of round.source.items) {
    if (!Number.isInteger(item.id) || item.id < 0 || !["letter", "number", "flower"].includes(item.kind)) errors.push("Source item identity is invalid.");
    if (item.kind === "letter" && !/^[A-Z]$/.test(item.label)) errors.push("Letters must have an unambiguous single-letter label.");
    if (item.kind === "number" && (!/^\d+$/.test(item.label) || Number(item.label) < 1)) errors.push("Numbers must have an unambiguous positive label.");
    if (item.kind === "flower") {
      const flower = item.flower;
      if (!flower || ![4, 5, 6, 8].includes(flower.petals) || !["round", "pointed"].includes(flower.petalShape) || !["circle", "diamond"].includes(flower.center) || item.label !== `${flower.petals} ${flower.petalShape} petals with a ${flower.center} center`) errors.push("Flowers require legible geometric identities and matching descriptions.");
    }
  }
  if (round.difficulty === "Easy") {
    if (!((round.source.rows === 2 && round.source.cols === 4) || (round.source.rows === 4 && round.source.cols === 2)) || round.folds.length !== 1) errors.push("Starter requires eight items and one fold.");
    if (round.source.items.some(({ kind }) => kind === "flower")) errors.push("Starter uses generous letter or number identities before flower details.");
  } else if (round.source.rows !== 4 || round.source.cols !== 4 || round.folds.length !== 2) errors.push("Later levels require sixteen items and two folds.");
  if (round.difficulty === "Medium" && axis(round.folds[0]) === axis(round.folds[1])) errors.push("Junior uses two perpendicular folds.");
  let expected: number[] = [];
  try {
    const steps = foldSteps(round.source, round.folds);
    if (JSON.stringify(steps) !== JSON.stringify(round.foldSteps)) errors.push("Fold stages must be calculated from the source paper.");
    const stack = targetStack(round);
    if (stack[0] !== round.targetId) errors.push("The target must stay on the visible top.");
    expected = sorted(stack.slice(1));
    if (!patternsEqual(round.correctItems, expected)) errors.push("The correct items must be calculated from the target stack.");
  } catch (error) { errors.push(error instanceof Error ? error.message : "Invalid paper state."); }
  if (round.options.length !== 4 || round.optionKinds.length !== 4) errors.push("Exactly four options and labels are required.");
  if (!Number.isInteger(round.correctIndex) || round.correctIndex < 0 || round.correctIndex > 3) errors.push("Invalid correct answer position.");
  const exactIndexes = round.options.flatMap((option, index) => patternsEqual(option, expected) ? [index] : []);
  if (exactIndexes.length !== 1 || exactIndexes[0] !== round.correctIndex) errors.push("Exactly one option must equal the calculated answer.");
  if (new Set(round.options.map(itemSetKey)).size !== 4) errors.push("All four options must be distinct.");
  const sourceIds = new Set(round.source.items.map(({ id }) => id));
  for (const [index, option] of round.options.entries()) {
    if (option.length !== expected.length || new Set(option).size !== option.length || option.some((id) => !sourceIds.has(id) || id === round.targetId)) errors.push(`Option ${index + 1} must contain distinct source items beneath the target.`);
    if ((round.optionKinds[index] === "correct") !== (index === round.correctIndex)) errors.push("Option-kind labels must identify the calculated answer.");
    if (index !== round.correctIndex && (round.difficulty === "Hard" || round.difficulty === "Wizard") && patternDifference(option, expected).total !== 2) errors.push("Advanced distractors must replace exactly one underlying item.");
    for (let other = 0; other < index; other += 1) {
      if (patternDifference(option, round.options[other]).total < (round.difficulty === "Medium" ? 4 : 2)) errors.push("Option sets must differ clearly at this difficulty.");
    }
  }
  if (round.difficulty === "Wizard") {
    if (round.hiddenFoldIndex !== 0 || !round.overlapClue) errors.push("Wizard hides the first fold and supplies ordered overlap evidence.");
    if (round.overlapClue && [round.targetId, ...expected].some((id) => id === round.overlapClue!.aboveId || id === round.overlapClue!.belowId)) errors.push("Wizard evidence must not expose a target overlap.");
    const matches = matchingFirstFolds(round);
    if (matches.length !== 1 || matches[0] !== round.folds[0]) errors.push("Wizard evidence must identify exactly one legal first fold.");
  } else if (round.hiddenFoldIndex !== null || round.overlapClue !== null) errors.push("Shown-fold levels must not contain hidden-fold evidence.");
  return errors;
}

function itemIdentity(item: Item): string {
  if (item.kind !== "flower") return `${item.kind === "letter" ? "l" : "n"}:${item.label}`;
  const flower = item.flower!;
  return `f:${flower.petals}:${flower.petalShape === "round" ? "r" : "p"}:${flower.center === "circle" ? "c" : "d"}`;
}

export function roundFingerprint(round: Round): string {
  // Source identities, overlap equivalence classes and the target normalize
  // arbitrary IDs, option order and answer-equivalent perpendicular fold order.
  const identity = (id: number) => itemIdentity(itemById(round, id));
  const final = round.foldSteps[round.foldSteps.length - 1].after;
  return JSON.stringify({
    dimensions: [round.source.rows, round.source.cols],
    source: round.source.items.map(itemIdentity),
    target: identity(round.targetId),
    effect: final.stacks.map((stack) => [identity(stack[0]), stack.map(identity).sort()]),
    hidden: round.hiddenFoldIndex,
    evidence: round.overlapClue ? [identity(round.overlapClue.aboveId), identity(round.overlapClue.belowId)] : null,
  });
}

export function buildAuthoredFoldedItemsRounds(specs: readonly AuthoredFoldedItemsRoundSpec[], label = "Folded Items"): readonly Round[] {
  const fingerprints = new Set<string>();
  return Object.freeze(specs.map((spec, index) => {
    const round = buildAuthoredFoldedItemsRound(spec);
    const fingerprint = roundFingerprint(round);
    if (fingerprints.has(fingerprint)) throw new Error(`${label} round ${index + 1} repeats content.`);
    fingerprints.add(fingerprint);
    return Object.freeze(round);
  }));
}

export function buildRounds(): readonly Round[] {
  return buildAuthoredFoldedItemsRounds(CAMPAIGN_ROUND_SPECS, "Folded Items Campaign");
}

function randomInteger(random: RandomSource, maximum: number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Random source must return a finite number from 0 inclusive to 1 exclusive.");
  return Math.floor(value * maximum);
}

export function generateInfiniteRound(difficulty: Difficulty, random: RandomSource = Math.random, seenFingerprints: ReadonlySet<string> = new Set()): Round {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}.`);
  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const [rows, cols] = difficulty === "Easy" ? (randomInteger(random, 2) === 0 ? [2, 4] : [4, 2]) : [4, 4];
    const itemOrder = Array.from({ length: rows * cols }, (_, index) => index);
    for (let index = itemOrder.length - 1; index > 0; index -= 1) {
      const other = randomInteger(random, index + 1);
      [itemOrder[index], itemOrder[other]] = [itemOrder[other], itemOrder[index]];
    }
    const styles: readonly ItemStyle[] = difficulty === "Easy" ? ["letters", "numbers"] : ["letters", "numbers", "flowers"];
    const itemStyle = styles[randomInteger(random, styles.length)];
    const first = FOLD_DIRECTIONS[randomInteger(random, 4)];
    const secondChoices = difficulty === "Medium" ? FOLD_DIRECTIONS.filter((direction) => axis(direction) !== axis(first)) : FOLD_DIRECTIONS;
    const folds = difficulty === "Easy" ? [first] : [first, secondChoices[randomInteger(random, secondChoices.length)]];
    const spec: AuthoredFoldedItemsRoundSpec = {
      difficulty, rows, cols, itemStyle, itemOrder, folds,
      targetCell: randomInteger(random, 4), correctIndex: randomInteger(random, 4),
      distractorSalt: randomInteger(random, 10000), numberOffset: 1 + randomInteger(random, 24),
    };
    const round = buildAuthoredFoldedItemsRound(spec);
    if (!seenFingerprints.has(roundFingerprint(round))) return round;
  }
  throw new Error(`Could not generate a new Folded Items round after ${GENERATOR_MAX_ATTEMPTS} attempts.`);
}

export const ROUNDS = buildRounds();
export const TUTORIAL: Round = buildAuthoredFoldedItemsRound({
  difficulty: "Medium", rows: 4, cols: 4, itemStyle: "letters",
  itemOrder: Array.from({ length: 16 }, (_, index) => index),
  folds: ["up", "left"], targetCell: 1, correctIndex: 0, distractorSalt: 0,
});
