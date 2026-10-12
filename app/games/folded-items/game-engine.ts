import { CAMPAIGN_ROUND_SPECS } from "./campaign-data.ts";

export type Difficulty = "Easy" | "Medium" | "Hard" | "Wizard";
export type FoldDirection = "up" | "down" | "left" | "right";
export type FoldSense = "over" | "under";
export type FoldInstruction = Readonly<{ direction: FoldDirection; sense: FoldSense; /** Between-cell boundary in the current paper. */ crease: number }>;
export type ItemStyle = "letters" | "numbers" | "shapes";
export type Shape = Readonly<{ outline: "circle" | "square" | "triangle" | "diamond" | "hexagon"; mark: "none" | "dot" | "plus" | "bars" | "cross" }>;
export type Item = Readonly<{ id: number; kind: "letter" | "number" | "shape"; label: string; shape?: Shape }>;
export type Source = Readonly<{ rows: number; cols: number; items: readonly Item[] }>;
export type ItemOrientation = Readonly<{ flipX: boolean; flipY: boolean }>;
export type PaperState = Readonly<{
  rows: number; cols: number;
  /** Row-major cells; each stack is ordered from top to bottom. */
  stacks: readonly (readonly number[])[];
  orientations: Readonly<Record<number, ItemOrientation>>;
}>;
export type FoldStep = Readonly<{ index: number; instruction: FoldInstruction; direction: FoldDirection; sense: FoldSense; crease: number; before: PaperState; after: PaperState }>;
export type OverlapClue = Readonly<{ aboveId: number; belowId: number; stationaryId: number }>;
export type ItemSet = readonly number[];
export type AnswerMode = "group" | "ordered";
export type OptionKind = "correct" | "opposite-sense" | "reverse-stack" | "layer-not-reversed" | "wrong-axis" | "wrong-crease" | "neighbor-stack" | "one-item-off" | "adjacent-layers" | "orientation";
export type Round = Readonly<{
  difficulty: Difficulty; answerMode: AnswerMode; orientationMatters: boolean; source: Source;
  folds: readonly FoldInstruction[]; foldSteps: readonly FoldStep[];
  hiddenFoldIndex: null | 0; overlapClue: OverlapClue | null;
  targetId: number; correctItems: ItemSet; options: readonly ItemSet[];
  correctOrientations: readonly ItemOrientation[]; optionOrientations: readonly (readonly ItemOrientation[])[];
  optionKinds: readonly OptionKind[]; correctIndex: number;
}>;
export type AuthoredFoldedItemsRoundSpec = Readonly<{
  difficulty: Difficulty; rows: number; cols: number; itemStyle: ItemStyle;
  itemOrder: readonly number[]; folds: readonly FoldInstruction[];
  targetCell: number; targetDepth?: number; correctIndex: number; distractorSalt: number;
  overlapCell?: number; numberOffset?: number;
}>;
export type RandomSource = () => number;
export const GENERATOR_MAX_ATTEMPTS = 64;
export const FOLD_DIRECTIONS: readonly FoldDirection[] = ["up", "down", "left", "right"];
export const FOLD_SENSES: readonly FoldSense[] = ["over", "under"];
export const DIFFICULTIES: readonly Difficulty[] = ["Easy", "Medium", "Hard", "Wizard"];
export const SHAPE_OUTLINES: readonly Shape["outline"][] = ["circle", "square", "triangle", "diamond", "hexagon"];
export const SHAPE_MARKS: readonly Shape["mark"][] = ["none", "dot", "plus", "bars", "cross"];

export function foldAxis(direction: FoldDirection): "rows" | "cols" {
  return direction === "up" || direction === "down" ? "rows" : "cols";
}
export function foldInstructionKey(fold: FoldInstruction): string { return `${fold.direction}:${fold.sense}:${fold.crease}`; }
export function foldDirectionLabel(fold: FoldInstruction | FoldDirection): string {
  const instruction = typeof fold === "string" ? { direction: fold, sense: "over" } : fold;
  const side: Record<FoldDirection, string> = { up: "bottom", down: "top", left: "right", right: "left" };
  return `Fold the ${side[instruction.direction]} part ${instruction.sense}`;
}
export function initialPaper(source: Source): PaperState {
  if (!Number.isInteger(source.rows) || !Number.isInteger(source.cols) || source.rows < 1 || source.cols < 1 || source.items.length !== source.rows * source.cols) throw new Error("Paper dimensions must match its items.");
  if (new Set(source.items.map(({ id }) => id)).size !== source.items.length) throw new Error("Paper identities must be unique.");
  return { rows: source.rows, cols: source.cols, stacks: source.items.map(({ id }) => [id]), orientations: Object.fromEntries(source.items.map(({ id }) => [id, { flipX: false, flipY: false }])) };
}
/** Every cell-boundary crease, either moving side, and both senses form the complete legal catalogue. */
export function legalFolds(state: Pick<PaperState, "rows" | "cols">): readonly FoldInstruction[] {
  return FOLD_DIRECTIONS.flatMap((direction) => Array.from({ length: state[foldAxis(direction)] - 1 }, (_, index) => FOLD_SENSES.map((sense) => ({ direction, sense, crease: index + 1 }))).flat());
}
export function isMovingCell(row: number, col: number, fold: FoldInstruction): boolean {
  const position = foldAxis(fold.direction) === "rows" ? row : col;
  return fold.direction === "up" || fold.direction === "left" ? position >= fold.crease : position < fold.crease;
}
function applyFold(state: PaperState, instruction: FoldInstruction, reverseMoving = true): PaperState {
  const { direction, sense, crease } = instruction;
  if (!FOLD_DIRECTIONS.includes(direction) || !FOLD_SENSES.includes(sense)) throw new Error("Unknown fold direction or sense.");
  const dimension = state[foldAxis(direction)];
  if (!Number.isInteger(crease) || crease <= 0 || crease >= dimension) throw new Error(`Cannot fold ${direction} at crease ${crease} from ${state.rows}×${state.cols}.`);
  if (state.stacks.length !== state.rows * state.cols || state.stacks.some((stack) => stack.length === 0) || new Set(state.stacks.flat()).size !== state.stacks.flat().length) throw new Error("Paper cells must contain unique, nonempty stacks.");
  const towardLow = direction === "up" || direction === "left";
  const offset = towardLow ? Math.min(0, 2 * crease - dimension) : crease;
  const foldedDimension = Math.max(crease, dimension - crease);
  const rows = foldAxis(direction) === "rows" ? foldedDimension : state.rows;
  const cols = foldAxis(direction) === "cols" ? foldedDimension : state.cols;
  const kept: number[][] = Array.from({ length: rows * cols }, () => []);
  const moving: number[][] = Array.from({ length: rows * cols }, () => []);
  const orientations: Record<number, ItemOrientation> = { ...state.orientations };
  for (let row = 0; row < state.rows; row += 1) for (let col = 0; col < state.cols; col += 1) {
    const moves = isMovingCell(row, col, instruction);
    const oldPosition = foldAxis(direction) === "rows" ? row : col;
    const newPosition = (moves ? 2 * crease - 1 - oldPosition : oldPosition) - offset;
    const newRow = foldAxis(direction) === "rows" ? newPosition : row;
    const newCol = foldAxis(direction) === "cols" ? newPosition : col;
    const stack = state.stacks[row * state.cols + col];
    (moves ? moving : kept)[newRow * cols + newCol] = moves && reverseMoving ? [...stack].reverse() : [...stack];
    if (moves) for (const id of stack) {
      const previous = state.orientations[id] ?? { flipX: false, flipY: false };
      orientations[id] = { flipX: foldAxis(direction) === "cols" ? !previous.flipX : previous.flipX, flipY: foldAxis(direction) === "rows" ? !previous.flipY : previous.flipY };
    }
  }
  return { rows, cols, orientations, stacks: kept.map((stack, index) => sense === "over" ? [...moving[index], ...stack] : [...stack, ...moving[index]]) };
}
export function foldPaper(state: PaperState, instruction: FoldInstruction): PaperState { return applyFold(state, instruction); }
export function foldSteps(source: Source, folds: readonly FoldInstruction[]): readonly FoldStep[] {
  let state = initialPaper(source);
  return folds.map((instruction, index) => {
    const before = state;
    state = foldPaper(state, instruction);
    return { index, instruction, ...instruction, before, after: state };
  });
}
export function targetStack(round: Pick<Round, "source" | "folds" | "targetId">): ItemSet {
  const steps = foldSteps(round.source, round.folds);
  const state = steps.at(-1)?.after ?? initialPaper(round.source);
  const stack = state.stacks.find((items) => items.includes(round.targetId));
  if (!stack) throw new Error("Target item is missing from the folded paper.");
  return stack;
}
export function itemSetKey(items: ItemSet): string { return [...items].sort((a, b) => a - b).join(","); }
export function answerKey(items: ItemSet, mode: AnswerMode = "ordered"): string { return mode === "group" ? itemSetKey(items) : items.join(","); }
export const patternKey = answerKey;
export function patternsEqual(first: ItemSet, second: ItemSet, mode: AnswerMode = "ordered"): boolean { return answerKey(first, mode) === answerKey(second, mode); }
export function patternDifference(attempted: ItemSet, expected: ItemSet, mode: AnswerMode = "group"): Readonly<{ missing: number[]; extra: number[]; misplaced: number[]; total: number }> {
  const missing = expected.filter((id) => !attempted.includes(id));
  const extra = attempted.filter((id) => !expected.includes(id));
  const misplaced = attempted.flatMap((id, index) => expected.includes(id) && expected[index] !== id ? [id] : []);
  return { missing, extra, misplaced, total: mode === "ordered" ? Array.from({ length: Math.max(attempted.length, expected.length) }, (_, index) => attempted[index] !== expected[index]).filter(Boolean).length : missing.length + extra.length };
}
export function itemById(round: Pick<Round, "source">, id: number): Item {
  const item = round.source.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown item: ${id}.`);
  return item;
}
export function describeItem(round: Pick<Round, "source">, id: number): string { return itemById(round, id).label; }
export const UPRIGHT: ItemOrientation = Object.freeze({ flipX: false, flipY: false });
export const ITEM_ORIENTATIONS: readonly ItemOrientation[] = [UPRIGHT, { flipX: true, flipY: false }, { flipX: false, flipY: true }, { flipX: true, flipY: true }];

// Conservative equivalence classes for unmarked upright sans-serif glyphs.
// Small font differences never justify a trap: visually symmetric reflections
// collapse, as do the conventional M/W and turned 6/9 identity ambiguities.
// Q tails and the vertical asymmetry of G are too small to serve as traps.
// A horizontal reflection also reverses the order of a multi-digit label.
function glyphVisualKey(glyph: string, orientation: ItemOrientation): string {
  let x = orientation.flipX, y = orientation.flipY;
  let root = glyph;
  if (root === "W") { root = "M"; y = !y; }
  if (root === "9") { root = "6"; x = !x; y = !y; }
  if ("HIOXQ018".includes(root)) { x = false; y = false; }
  else if ("AMTUVY".includes(root)) x = false;
  else if ("BCDEKG3".includes(root)) y = false;
  else if ("NSZ".includes(root)) { x = x !== y; y = false; }
  return `${root}:${Number(x)}${Number(y)}`;
}
export function visualItemKey(item: Item, orientation: ItemOrientation = UPRIGHT): string {
  if (item.kind === "shape") {
    const shape = item.shape;
    return `shape:${shape?.outline}:${shape?.mark}:${shape?.outline === "triangle" && orientation.flipY ? "down" : "up"}`;
  }
  const glyphs = [...item.label];
  if (orientation.flipX) glyphs.reverse();
  return `${item.kind}:${glyphs.map((glyph) => glyphVisualKey(glyph, orientation)).join("/")}`;
}
export function visualAnswerKey(round: Pick<Round, "source" | "answerMode" | "orientationMatters">, items: ItemSet, orientations: readonly ItemOrientation[] = []): string {
  const tokens = items.map((id, index) => visualItemKey(itemById(round, id), round.orientationMatters ? orientations[index] ?? UPRIGHT : UPRIGHT));
  return JSON.stringify(round.answerMode === "group" ? tokens.sort() : tokens);
}
export function describeOrientedItem(round: Pick<Round, "source">, id: number, orientation: ItemOrientation = UPRIGHT): string {
  const item = itemById(round, id);
  const key = visualItemKey(item, orientation);
  const visible = ITEM_ORIENTATIONS.find((candidate) => visualItemKey(item, candidate) === key)!;
  const change = visible.flipX && visible.flipY ? "turned 180 degrees" : visible.flipX ? "mirrored left to right" : visible.flipY ? "flipped top to bottom" : "";
  return change ? `${item.label} (${change})` : item.label;
}
export function describeAnswer(round: Pick<Round, "source" | "orientationMatters">, items: ItemSet, orientations: readonly ItemOrientation[] = []): string {
  return items.map((id, index) => describeOrientedItem(round, id, round.orientationMatters ? orientations[index] ?? UPRIGHT : UPRIGHT)).join(", ");
}
function orientationChanged(item: Item, orientation: ItemOrientation): boolean { return visualItemKey(item, orientation) !== visualItemKey(item, UPRIGHT); }

function makeItem(id: number, style: ItemStyle, numberOffset: number): Item {
  if (style === "letters") return { id, kind: "letter", label: String.fromCharCode(65 + id) };
  if (style === "numbers") return { id, kind: "number", label: String(numberOffset + id) };
  const shape = { outline: SHAPE_OUTLINES[id % 5], mark: SHAPE_MARKS[Math.floor(id / 5)] };
  return { id, kind: "shape", shape, label: shape.mark === "none" ? `plain ${shape.outline}` : `${shape.outline} with ${shape.mark}` };
}
function appearanceKey(item: Item): string { return item.kind === "shape" ? `shape:${item.shape?.outline}:${item.shape?.mark}` : `${item.kind}:${item.label}`; }
function answerFromStack(stack: ItemSet, targetId: number, answerMode: AnswerMode): ItemSet { return answerMode === "ordered" ? [...stack] : stack.filter((id) => id !== targetId).sort((a, b) => a - b); }
type CoreRound = Omit<Round, "options" | "optionKinds" | "optionOrientations" | "correctIndex">;
type Candidate = Readonly<{ items: ItemSet; orientations: readonly ItemOrientation[]; kind: OptionKind }>;
/** Traps are executable misconception programs or a single explicit local error. */
function misconceptionCandidates(round: CoreRound): Candidate[] {
  const result: Candidate[] = [];
  const finalOrientations = round.foldSteps.at(-1)!.after.orientations;
  const add = (stack: ItemSet, kind: OptionKind, isAnswer = false, paperOrientations = finalOrientations, explicitOrientations?: readonly ItemOrientation[]) => {
    const items = isAnswer ? [...stack] : answerFromStack(stack, round.targetId, round.answerMode);
    const orientations = explicitOrientations ?? items.map((id) => round.orientationMatters ? paperOrientations[id] : UPRIGHT);
    const key = visualAnswerKey(round, items, orientations);
    if (items.length !== round.correctItems.length || new Set(items).size !== items.length || (round.answerMode === "ordered" ? !items.includes(round.targetId) : items.includes(round.targetId)) || key === visualAnswerKey(round, round.correctItems, round.correctOrientations) || result.some((candidate) => visualAnswerKey(round, candidate.items, candidate.orientations) === key)) return;
    result.push({ items, orientations, kind });
  };
  const fromProgram = (folds: readonly FoldInstruction[], kind: OptionKind, unturnedStep = -1) => {
    try {
      let state = initialPaper(round.source);
      for (const [index, fold] of folds.entries()) state = applyFold(state, fold, index !== unturnedStep);
      const stack = state.stacks.find((items) => items.includes(round.targetId));
      if (stack) add(stack, kind, false, state.orientations);
    } catch { /* A mistaken crease may be outside the newly folded paper. */ }
  };
  if (round.orientationMatters) {
    for (const [index, id] of round.correctItems.entries()) {
      const actual = round.correctOrientations[index];
      // Forget a visible turn of one actual layer. Do not penalize no-op
      // reflections or distinguish symbols solely by their hidden identity.
      if (!orientationChanged(itemById(round, id), actual)) continue;
      const orientations = round.correctOrientations.map((orientation, slot) => slot === index ? UPRIGHT : orientation);
      add(round.correctItems, "orientation", true, finalOrientations, orientations);
    }
  }
  if (round.answerMode === "ordered") {
    for (let index = round.folds.length - 1; index >= 0; index -= 1) fromProgram(round.folds.map((fold, other) => other === index ? { ...fold, sense: fold.sense === "over" ? "under" : "over" } : fold), "opposite-sense");
    for (let index = 1; index < round.folds.length; index += 1) fromProgram(round.folds, "layer-not-reversed", index);
  }
  for (const [index, step] of round.foldSteps.entries()) for (const mistaken of legalFolds(step.before)) {
    const differentAxis = foldAxis(mistaken.direction) !== foldAxis(step.direction);
    const differentCrease = mistaken.direction === step.direction && mistaken.crease !== step.crease;
    if (!differentAxis && !differentCrease) continue;
    fromProgram(round.folds.map((fold, other) => other === index ? mistaken : fold), differentAxis ? "wrong-axis" : "wrong-crease");
  }
  if (round.answerMode === "ordered") {
    add([...round.correctItems].reverse(), "reverse-stack", true);
    for (let index = 0; index < round.correctItems.length - 1; index += 1) {
      const swapped = [...round.correctItems];
      [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
      add(swapped, "adjacent-layers", true);
    }
  }
  const ids = round.source.items.map(({ id }) => id);
  const position = (id: number) => ids.indexOf(id);
  for (const [index, id] of round.correctItems.entries()) {
    if (id === round.targetId) continue;
    const neighbors = ids.filter((candidate) => candidate !== round.targetId && !round.correctItems.includes(candidate)).sort((a, b) => {
      const distance = (candidate: number) => Math.abs(Math.floor(position(candidate) / round.source.cols) - Math.floor(position(id) / round.source.cols)) + Math.abs(position(candidate) % round.source.cols - position(id) % round.source.cols);
      return distance(a) - distance(b) || a - b;
    });
    for (const neighbor of neighbors.slice(0, round.answerMode === "group" ? 6 : 2)) add(round.correctItems.map((value, slot) => slot === index ? neighbor : value), round.answerMode === "group" ? "neighbor-stack" : "one-item-off", true);
  }
  return result;
}
function buildOptions(round: CoreRound, correctIndex: number, salt: number): Pick<Round, "options" | "optionKinds" | "optionOrientations"> {
  const candidates = misconceptionCandidates(round);
  const chosen: Candidate[] = [];
  const minimum = round.answerMode === "group" || round.difficulty === "Medium" ? 2 : 1;
  const add = (candidate: Candidate | undefined) => {
    if (!candidate || chosen.includes(candidate)) return;
    if (round.orientationMatters) {
      if ([{ items: round.correctItems, orientations: round.correctOrientations }, ...chosen].some((other) => visualAnswerKey(round, candidate.items, candidate.orientations) === visualAnswerKey(round, other.items, other.orientations))) return;
    } else if (![round.correctItems, ...chosen.map(({ items }) => items)].every((items) => patternDifference(candidate.items, items, round.answerMode).total >= minimum)) return;
    chosen.push(candidate);
  };
  if (round.orientationMatters) add(candidates.find(({ kind }) => kind === "orientation"));
  if (round.answerMode === "ordered") {
    add(candidates.find(({ kind }) => kind === "opposite-sense"));
    add(candidates.find(({ kind }) => kind === "layer-not-reversed"));
    // Later levels include the near local error; Junior emphasizes actual folding/order errors.
    const preferred = round.difficulty === "Medium" ? ["wrong-axis", "wrong-crease", "reverse-stack"] : ["wrong-crease", "wrong-axis", "adjacent-layers"];
    for (const kind of preferred) { if (chosen.length < 3) add(candidates.find((candidate) => candidate.kind === kind)); }
  }
  for (const candidate of candidates.slice(salt % Math.max(1, Math.min(3, candidates.length))).concat(candidates)) { if (chosen.length === 3) break; add(candidate); }
  if (chosen.length !== 3) throw new Error("Cannot build three distinct meaningful fold misconceptions.");
  const options: ItemSet[] = []; const optionKinds: OptionKind[] = []; const optionOrientations: ItemOrientation[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const candidate = index === correctIndex ? { items: round.correctItems, orientations: round.correctOrientations, kind: "correct" as const } : chosen.shift()!;
    options.push(candidate.items); optionKinds.push(candidate.kind); optionOrientations.push([...candidate.orientations]);
  }
  return { options, optionKinds, optionOrientations };
}
export function matchingFirstFolds(round: Pick<Round, "source" | "folds" | "overlapClue">): readonly FoldInstruction[] {
  if (!round.overlapClue) return [];
  const { aboveId, belowId, stationaryId } = round.overlapClue;
  return legalFolds(initialPaper(round.source)).filter((fold) => {
    try {
      const stationaryCell = round.source.items.findIndex(({ id }) => id === stationaryId);
      if (stationaryCell < 0 || ![aboveId, belowId].includes(stationaryId) || isMovingCell(Math.floor(stationaryCell / round.source.cols), stationaryCell % round.source.cols, fold)) return false;
      let after = foldPaper(initialPaper(round.source), fold);
      if (!after.stacks.some((stack) => stack.length === 2 && stack[0] === aboveId && stack[1] === belowId)) return false;
      for (const next of round.folds.slice(1)) after = foldPaper(after, next);
      return true;
    } catch { return false; }
  });
}
export function buildAuthoredFoldedItemsRound(spec: AuthoredFoldedItemsRoundSpec): Round {
  if (!DIFFICULTIES.includes(spec.difficulty)) throw new Error(`Unknown difficulty: ${spec.difficulty}.`);
  if (!Number.isInteger(spec.correctIndex) || spec.correctIndex < 0 || spec.correctIndex > 3) throw new Error("Answer position must be from 0 to 3.");
  if (!Number.isInteger(spec.distractorSalt) || spec.distractorSalt < 0) throw new Error("Distractor salt must be a nonnegative integer.");
  if (!["letters", "numbers", "shapes"].includes(spec.itemStyle)) throw new Error("Unknown item style.");
  const count = spec.rows * spec.cols;
  if (spec.itemOrder.length !== count || new Set(spec.itemOrder).size !== count || spec.itemOrder.some((id) => !Number.isInteger(id) || id < 0 || id >= count)) throw new Error("Item order must be a complete unique permutation.");
  const source: Source = { rows: spec.rows, cols: spec.cols, items: spec.itemOrder.map((id) => makeItem(id, spec.itemStyle, spec.numberOffset ?? 1)) };
  const steps = foldSteps(source, spec.folds);
  const final = steps.at(-1)?.after;
  if (!final || !Number.isInteger(spec.targetCell) || !final.stacks[spec.targetCell]) throw new Error("Target must name a cell on the final folded paper.");
  const targetItems = final.stacks[spec.targetCell];
  const depth = spec.targetDepth ?? spec.distractorSalt % targetItems.length;
  const targetId = targetItems[depth];
  if (targetId === undefined) throw new Error("Target depth is outside its stack.");
  const answerMode = spec.difficulty === "Easy" ? "group" : "ordered";
  let overlapClue: OverlapClue | null = null;
  if (spec.difficulty === "Wizard") {
    const possibleCells = steps[0].after.stacks.flatMap((stack, index) => stack.length === 2 && !stack.some((id) => targetItems.includes(id)) ? [index] : []);
    const clueCell = spec.overlapCell ?? possibleCells[spec.distractorSalt % possibleCells.length];
    const clueStack = steps[0].after.stacks[clueCell];
    if (!clueStack || clueStack.length !== 2 || clueStack.some((id) => targetItems.includes(id))) throw new Error("Wizard evidence must describe a different item pair from the target stack.");
    const stationaryId = clueStack.find((id) => {
      const cell = source.items.findIndex((item) => item.id === id);
      return !isMovingCell(Math.floor(cell / source.cols), cell % source.cols, spec.folds[0]);
    });
    if (stationaryId === undefined) throw new Error("Wizard evidence requires a stationary item.");
    overlapClue = { aboveId: clueStack[0], belowId: clueStack[1], stationaryId };
  }
  const orientationMatters = spec.difficulty === "Wizard";
  const correctItems = answerFromStack(targetItems, targetId, answerMode);
  const correctOrientations = correctItems.map((id) => orientationMatters ? final.orientations[id] : UPRIGHT);
  if (orientationMatters && !correctItems.some((id, index) => orientationChanged(itemById({ source }, id), correctOrientations[index]))) throw new Error("Wizard requires a visibly transformed answer item.");
  const core: CoreRound = { difficulty: spec.difficulty, answerMode, orientationMatters, correctOrientations, source, folds: spec.folds.map((fold) => ({ ...fold })), foldSteps: steps, hiddenFoldIndex: spec.difficulty === "Wizard" ? 0 : null, overlapClue, targetId, correctItems };
  const round: Round = { ...core, ...buildOptions(core, spec.correctIndex, spec.distractorSalt), correctIndex: spec.correctIndex };
  const errors = validateRound(round);
  if (errors.length) throw new Error(`Invalid folded-items round: ${errors.join("; ")}`);
  return round;
}
export function validateRound(round: Round): string[] {
  const errors: string[] = [];
  if (!DIFFICULTIES.includes(round.difficulty)) errors.push("Unknown difficulty.");
  const count = round.source.rows * round.source.cols;
  if (round.source.items.length !== count || new Set(round.source.items.map(({ id }) => id)).size !== count || new Set(round.source.items.map(appearanceKey)).size !== count) errors.push("Source items must have distinct identities and appearances.");
  for (const item of round.source.items) {
    if (!Number.isInteger(item.id) || item.id < 0 || !["letter", "number", "shape"].includes(item.kind)) errors.push("Source item identity is invalid.");
    if (item.kind === "letter" && !/^[A-Z]$/.test(item.label)) errors.push("Letters must have an unambiguous single-letter label.");
    if (item.kind === "number" && (!/^\d+$/.test(item.label) || Number(item.label) < 1)) errors.push("Numbers must have an unambiguous positive label.");
    if (item.kind === "shape" && (!item.shape || !SHAPE_OUTLINES.includes(item.shape.outline) || !SHAPE_MARKS.includes(item.shape.mark) || item.label !== (item.shape.mark === "none" ? `plain ${item.shape.outline}` : `${item.shape.outline} with ${item.shape.mark}`))) errors.push("Shapes require clear geometric identities and matching descriptions.");
  }
  if (round.difficulty === "Easy") {
    if (!((round.source.rows === 2 && round.source.cols === 4) || (round.source.rows === 4 && round.source.cols === 2)) || round.folds.length !== 1 || round.answerMode !== "group") errors.push("Starter requires eight items, one fold and an unordered partner.");
  } else {
    const dimension = round.difficulty === "Medium" ? 4 : 5;
    if (round.source.rows !== dimension || round.source.cols !== dimension || round.folds.length !== 2 || round.answerMode !== "ordered") errors.push("Junior requires 4×4 and Expert/Wizard require 5×5 paper with two ordered folds.");
    if (round.difficulty === "Medium" && round.folds.length === 2 && (foldAxis(round.folds[0].direction) === foldAxis(round.folds[1].direction) || round.folds.some(({ crease }) => crease !== 2))) errors.push("Junior uses two centered perpendicular folds.");
  }
  if (round.orientationMatters !== (round.difficulty === "Wizard")) errors.push("Only Wizard answers use folded orientations.");
  let expected: ItemSet = [];
  let expectedOrientations: readonly ItemOrientation[] = [];
  const validOrientation = (value: ItemOrientation | undefined) => value && typeof value.flipX === "boolean" && typeof value.flipY === "boolean";
  try {
    const steps = foldSteps(round.source, round.folds);
    if (JSON.stringify(steps) !== JSON.stringify(round.foldSteps)) errors.push("Fold stages must be calculated from the source paper.");
    const stack = targetStack(round);
    if (stack.length !== (round.difficulty === "Easy" ? 2 : 4)) errors.push("Target must form a two-item Starter pair or a four-layer ordered stack.");
    expected = answerFromStack(stack, round.targetId, round.answerMode);
    expectedOrientations = expected.map((id) => round.orientationMatters ? steps.at(-1)!.after.orientations[id] : UPRIGHT);
    if (JSON.stringify(round.correctOrientations) !== JSON.stringify(expectedOrientations)) errors.push("Correct orientations must be calculated from the folded paper.");
    if (!patternsEqual(round.correctItems, expected, round.answerMode)) errors.push("The correct items must be calculated from the target stack in the required order.");
  } catch (error) { errors.push(error instanceof Error ? error.message : "Invalid paper state."); }
  if (round.options.length !== 4 || round.optionKinds.length !== 4 || (!Array.isArray(round.optionOrientations) || round.optionOrientations.length !== 4)) errors.push("Exactly four options and labels are required.");
  if (!Number.isInteger(round.correctIndex) || round.correctIndex < 0 || round.correctIndex > 3) errors.push("Invalid correct answer position.");
  const key = (items: ItemSet, orientations: readonly ItemOrientation[] = []) => {
    try { return visualAnswerKey(round, items, orientations); } catch { return "invalid"; }
  };
  const exact = round.options.flatMap((option, index) => key(option, round.optionOrientations?.[index]) === key(expected, expectedOrientations) ? [index] : []);
  if (exact.length !== 1 || exact[0] !== round.correctIndex) errors.push("Exactly one option must equal the calculated answer.");
  if (new Set(round.options.map((option, index) => key(option, round.optionOrientations?.[index]))).size !== 4) errors.push("All four options must be distinct.");
  const sourceIds = new Set(round.source.items.map(({ id }) => id));
  let candidates: Candidate[] = [];
  try { candidates = misconceptionCandidates(round); } catch { errors.push("Cannot verify misconception programs."); }
  for (const [index, option] of round.options.entries()) {
    if (option.length !== expected.length || new Set(option).size !== option.length || option.some((id) => !sourceIds.has(id)) || (round.answerMode === "ordered" ? !option.includes(round.targetId) : option.includes(round.targetId))) errors.push(`Option ${index + 1} must contain distinct source items in the required answer mode.`);
    const rawOrientations = round.optionOrientations?.[index];
    const orientations = Array.isArray(rawOrientations) ? rawOrientations : [];
    if (!Array.isArray(rawOrientations) || orientations.length !== option.length || !Array.from(orientations).every(validOrientation)) errors.push("Every option needs one valid orientation per item.");
    if (!round.orientationMatters && orientations.some((orientation) => validOrientation(orientation) && (orientation.flipX || orientation.flipY))) errors.push("Starter, Junior and Expert choices stay upright.");
    if ((round.optionKinds[index] === "correct") !== (index === round.correctIndex)) errors.push("Option-kind labels must identify the calculated answer.");
    if (index !== round.correctIndex && !candidates.some((candidate) => candidate.kind === round.optionKinds[index] && key(candidate.items, candidate.orientations) === key(option, orientations))) errors.push("Distractors must follow an executable fold misconception or local error.");
    for (let other = 0; !round.orientationMatters && other < index; other += 1) if (patternDifference(option, round.options[other], round.answerMode).total < (round.answerMode === "group" || round.difficulty === "Medium" ? 2 : 1)) errors.push("Option positions must differ clearly at this difficulty.");
  }
  if (round.answerMode === "ordered" && !round.optionKinds.includes("opposite-sense")) errors.push("Ordered rounds must test an opposite over/under sense.");
  if (round.difficulty === "Wizard") {
    if (!expected.some((id, index) => orientationChanged(itemById(round, id), expectedOrientations[index] ?? UPRIGHT))) errors.push("Wizard requires a visibly transformed answer item.");
    const orientationTrap = round.options.some((option, index) => round.optionKinds[index] === "orientation" && patternsEqual(option, expected) && key(option, round.optionOrientations?.[index]) !== key(expected, expectedOrientations));
    if (!orientationTrap) errors.push("Wizard requires a visible orientation-only misconception with the same items and layer order.");
    if (round.hiddenFoldIndex !== 0 || !round.overlapClue) errors.push("Wizard hides the first fold and supplies ordered and stationary evidence.");
    if (round.overlapClue && expected.some((id) => id === round.overlapClue!.aboveId || id === round.overlapClue!.belowId)) errors.push("Wizard evidence must not expose a target overlap.");
    const matches = matchingFirstFolds(round);
    if (matches.length !== 1 || foldInstructionKey(matches[0]) !== foldInstructionKey(round.folds[0])) errors.push("Wizard evidence must identify exactly one legal first fold.");
  } else if (round.hiddenFoldIndex !== null || round.overlapClue !== null) errors.push("Shown-fold levels must not contain hidden-fold evidence.");
  return errors;
}
export function roundFingerprint(round: Round): string {
  const identity = (id: number) => appearanceKey(itemById(round, id));
  const final = round.foldSteps.at(-1)!.after;
  return JSON.stringify({ dimensions: [round.source.rows, round.source.cols], source: round.source.items.map(appearanceKey), target: identity(round.targetId), mode: round.answerMode, orientationMatters: round.orientationMatters, orientations: round.orientationMatters ? final.stacks.map((stack) => stack.map((id) => visualItemKey(itemById(round, id), final.orientations[id]))) : undefined, effect: final.stacks.map((stack) => round.answerMode === "group" ? stack.map(identity).sort() : stack.map(identity)), hidden: round.hiddenFoldIndex, evidence: round.overlapClue ? [identity(round.overlapClue.aboveId), identity(round.overlapClue.belowId), identity(round.overlapClue.stationaryId)] : null });
}
export function buildAuthoredFoldedItemsRounds(specs: readonly AuthoredFoldedItemsRoundSpec[], label = "Folded Items"): readonly Round[] {
  const fingerprints = new Set<string>();
  return Object.freeze(specs.map((spec, index) => {
    const round = buildAuthoredFoldedItemsRound(spec); const fingerprint = roundFingerprint(round);
    if (fingerprints.has(fingerprint)) throw new Error(`${label} round ${index + 1} repeats content.`);
    fingerprints.add(fingerprint); return Object.freeze(round);
  }));
}
export function buildRounds(): readonly Round[] { return buildAuthoredFoldedItemsRounds(CAMPAIGN_ROUND_SPECS, "Folded Items Campaign"); }
function randomInteger(random: RandomSource, maximum: number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Random source must return a finite number from 0 inclusive to 1 exclusive.");
  return Math.floor(value * maximum);
}
export function generateInfiniteRound(difficulty: Difficulty, random: RandomSource = Math.random, seenFingerprints: ReadonlySet<string> = new Set()): Round {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}.`);
  const pool = CAMPAIGN_ROUND_SPECS.filter((spec) => spec.difficulty === difficulty);
  for (let attempt = 0; attempt < GENERATOR_MAX_ATTEMPTS; attempt += 1) {
    const program = pool[randomInteger(random, pool.length)];
    const itemOrder = Array.from({ length: program.rows * program.cols }, (_, index) => index);
    for (let index = itemOrder.length - 1; index > 0; index -= 1) { const other = randomInteger(random, index + 1); [itemOrder[index], itemOrder[other]] = [itemOrder[other], itemOrder[index]]; }
    const styles: readonly ItemStyle[] = ["letters", "numbers", "shapes"];
    const itemStyle = styles[randomInteger(random, styles.length)];
    const dummySource = { rows: program.rows, cols: program.cols, items: itemOrder.map((id) => makeItem(id, itemStyle, 1)) };
    const final = foldSteps(dummySource, program.folds).at(-1)!.after;
    const targetCells = final.stacks.flatMap((stack, index) => stack.length === (difficulty === "Easy" ? 2 : 4) ? [index] : []);
    const spec = { ...program, itemStyle, itemOrder, targetCell: targetCells[randomInteger(random, targetCells.length)], targetDepth: randomInteger(random, difficulty === "Easy" ? 2 : 4), correctIndex: randomInteger(random, 4), distractorSalt: randomInteger(random, 10000), numberOffset: 1 + randomInteger(random, 24) };
    if (difficulty === "Wizard") {
      const target = final.stacks[spec.targetCell];
      const visibleTurn = target.some((id) => orientationChanged(makeItem(id, itemStyle, spec.numberOffset), final.orientations[id]));
      if (!visibleTurn) {
        // Construct a perceptible challenge even with constant/randomly hostile
        // input: place an asymmetric identity on an actually turning layer.
        const position = target.find((id) => itemOrder.some((candidate) => !target.includes(candidate) && orientationChanged(makeItem(candidate, itemStyle, spec.numberOffset), final.orientations[id])))!;
        const replacement = itemOrder.find((id) => !target.includes(id) && orientationChanged(makeItem(id, itemStyle, spec.numberOffset), final.orientations[position]));
        if (replacement !== undefined) {
          const first = itemOrder.indexOf(position), second = itemOrder.indexOf(replacement);
          [itemOrder[first], itemOrder[second]] = [itemOrder[second], itemOrder[first]];
        }
      }
    }
    // Random-source validation happens above this boundary. Candidate rejection
    // stays bounded and must never release an invalid or repeated round.
    try {
      const round = buildAuthoredFoldedItemsRound(spec);
      if (!seenFingerprints.has(roundFingerprint(round))) return round;
    } catch { /* Try another valid curriculum program/source arrangement. */ }
  }
  throw new Error(`Could not generate a new Folded Items round after ${GENERATOR_MAX_ATTEMPTS} attempts.`);
}
export const ROUNDS = buildRounds();
export const TUTORIAL = buildAuthoredFoldedItemsRound({ difficulty: "Easy", rows: 2, cols: 4, itemStyle: "letters", itemOrder: [0, 1, 2, 3, 4, 5, 6, 7], folds: [{ direction: "up", sense: "over", crease: 1 }], targetCell: 1, targetDepth: 1, correctIndex: 0, distractorSalt: 0 });
