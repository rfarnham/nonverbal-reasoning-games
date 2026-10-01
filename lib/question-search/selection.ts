import type { SearchQuestion } from "./types.ts";

export const MAX_WORKSHEET_QUESTIONS = 50;

export function worksheetLimit(value: string | number): number | null {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= MAX_WORKSHEET_QUESTIONS ? count : null;
}

/** Preserve selection order across pages, without duplicate questions or unbounded image loads. */
export function addWorksheetQuestions(selected: SearchQuestion[], questions: SearchQuestion[]): SearchQuestion[] {
  const unique = new Map(selected.map((question) => [question.id, question]));
  for (const question of questions) {
    if (unique.size >= MAX_WORKSHEET_QUESTIONS) break;
    if (!unique.has(question.id)) unique.set(question.id, question);
  }
  return [...unique.values()].slice(0, MAX_WORKSHEET_QUESTIONS);
}

export function removeWorksheetQuestions(selected: SearchQuestion[], ids: string[]): SearchQuestion[] {
  const removed = new Set(ids);
  return selected.filter((question) => !removed.has(question.id));
}
