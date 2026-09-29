/** Ink geometry stays independent of the prompt and the expected arithmetic result. */
export const WIDTH = 360, HEIGHT = 420, ANSWER_TOP = 282, ANSWER_BOTTOM = 384, COLUMN_WIDTH = 84;
export type Point = { x: number; y: number };
export interface Stroke { points: Point[]; region: number; }
export function columnCenter(column: number, digits: number): number { return WIDTH / 2 + (column - (digits - 1) / 2) * COLUMN_WIDTH; }
export function inkRegion(p: Point, digits: number): number {
  if (p.y < ANSWER_TOP || p.y > ANSWER_BOTTOM) return -1;
  for (let i = 0; i < digits; i++) if (Math.abs(p.x - columnCenter(i, digits)) <= COLUMN_WIDTH / 2) return i;
  return -1;
}
export function answerSlots(strokes: readonly Stroke[], digits: number): number[] | null {
  const occupied = Array.from({ length: digits }, (_, i) => strokes.some(s => s.region === i));
  const start = occupied.indexOf(true);
  if (start < 0 || !occupied.slice(start).every(Boolean)) return null;
  return Array.from({ length: digits - start }, (_, i) => start + i);
}
export const READ_DELAY_MS = 560;
/** Wait for a complete written answer, including during right-to-left working.
 * Only completion uses its length; recognition never sees the expected digits. */
export function readyToRead(strokes: readonly Stroke[], digits: number, answerDigits: number): boolean {
  const slots = answerSlots(strokes, digits);
  return slots !== null && slots.length >= answerDigits;
}
export function drawStrokes(context: CanvasRenderingContext2D, strokes: readonly Stroke[], color = "#17213d"): void {
  context.lineWidth = 5; context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = color; context.fillStyle = color;
  for (const stroke of strokes) {
    const first = stroke.points[0];
    if (!first) continue;
    context.beginPath(); context.arc(first.x, first.y, 2.5, 0, Math.PI * 2); context.fill();
    context.beginPath(); context.moveTo(first.x, first.y);
    for (const p of stroke.points.slice(1)) context.lineTo(p.x, p.y);
    context.stroke();
  }
}
