import type { StorageLike } from "../../lib/progression/types.ts";
import { BOSS_CHALLENGES, bossById } from "./boss-challenges.ts";

export type BossAttempt = Readonly<{
  /** Original workbook A–E choices, stored as zero-based indices. */
  answers: readonly (number | null)[];
  submittedAt?: string;
}>;

export type BossProgress = Readonly<{
  version: 1;
  profileId: string;
  qa: boolean;
  attempts: Readonly<Record<string, BossAttempt>>;
}>;

export const BOSS_STORAGE_PREFIX = "spatial-gym-math-world-boss-v1";
export function bossStorageKey(profileId: string, qa = false): string {
  return `${BOSS_STORAGE_PREFIX}:${qa ? "qa" : "play"}:${encodeURIComponent(profileId)}`;
}

export function createBossProgress(profileId: string, qa = false): BossProgress {
  return { version: 1, profileId, qa, attempts: {} };
}

const validAnswer = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 5;
const validTime = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

export function bossAttempt(state: BossProgress, id: string): BossAttempt {
  return state.attempts[id] ?? { answers: Array(bossById(id)?.questionCount ?? 24).fill(null) };
}

/** A timestamp alone can never clear a storm. Printing does not create one. */
export function hasSubmittedBoss(state: BossProgress, id: string): boolean {
  const challenge = bossById(id);
  const attempt = state.attempts[id];
  return Boolean(challenge && attempt && validTime(attempt.submittedAt)
    && attempt.answers.length === challenge.questionCount
    && Array.from(attempt.answers).every(validAnswer));
}

export function submittedBossIds(state: BossProgress): readonly string[] {
  return BOSS_CHALLENGES.filter(challenge => hasSubmittedBoss(state, challenge.id)).map(challenge => challenge.id);
}

/** Reconcile another tab's durable work before an edit. Submitted records are
 * immutable; current durable draft choices win conflicts, while unsaved local
 * choices and other storm drafts survive missing or blocked storage. */
export function mergeBossProgress(local: BossProgress, durable: BossProgress): BossProgress {
  if (local.profileId !== durable.profileId || local.qa !== durable.qa) return local;
  let changed = false;
  const attempts = { ...local.attempts };
  for (const challenge of BOSS_CHALLENGES) {
    const saved = durable.attempts[challenge.id];
    const current = local.attempts[challenge.id];
    if (!saved) continue;
    const merged: BossAttempt = hasSubmittedBoss(durable, challenge.id) ? saved
      : hasSubmittedBoss(local, challenge.id) ? current
      : { answers: Array.from({ length: challenge.questionCount }, (_, index) =>
        saved.answers[index] ?? current?.answers[index] ?? null) };
    if (current && current.submittedAt === merged.submittedAt
      && current.answers.every((answer, index) => answer === merged.answers[index])) continue;
    attempts[challenge.id] = merged;
    changed = true;
  }
  return changed ? { ...local, attempts } : local;
}

/** Drafts stay editable until the deliberate, complete submission. */
export function setBossAnswer(state: BossProgress, id: string, questionIndex: number, answer: number): BossProgress {
  const challenge = bossById(id);
  if (!challenge || !Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= challenge.questionCount
    || !validAnswer(answer) || hasSubmittedBoss(state, id)) return state;
  const attempt = bossAttempt(state, id);
  if (attempt.answers[questionIndex] === answer) return state;
  const answers = Array.from({ length: challenge.questionCount }, (_, index) => validAnswer(attempt.answers[index]) ? attempt.answers[index] : null);
  answers[questionIndex] = answer;
  return { ...state, attempts: { ...state.attempts, [id]: { answers } } };
}

/** Submission records the child's workbook choices; it does not invent a grade. */
export function submitBossAnswers(state: BossProgress, id: string, now = new Date().toISOString()): BossProgress {
  const challenge = bossById(id);
  const attempt = state.attempts[id];
  if (!challenge || !attempt || hasSubmittedBoss(state, id) || !validTime(now)
    || attempt.answers.length !== challenge.questionCount || !Array.from(attempt.answers).every(validAnswer)) return state;
  return { ...state, attempts: { ...state.attempts, [id]: { answers: [...attempt.answers], submittedAt: now } } };
}

function browserStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function readBossProgress(profileId: string, qa = false, storage?: StorageLike | null): BossProgress {
  const empty = createBossProgress(profileId, qa);
  try {
    const text = browserStorage(storage)?.getItem(bossStorageKey(profileId, qa));
    if (!text) return empty;
    const raw: unknown = JSON.parse(text);
    if (!object(raw) || raw.version !== 1 || raw.profileId !== profileId || raw.qa !== qa || !object(raw.attempts)) return empty;
    const attempts: Record<string, BossAttempt> = {};
    for (const challenge of BOSS_CHALLENGES) {
      const saved = raw.attempts[challenge.id];
      if (!object(saved) || !Array.isArray(saved.answers) || saved.answers.length !== challenge.questionCount) continue;
      const answers = Array.from(saved.answers, answer => validAnswer(answer) ? answer : null);
      const submittedAt = answers.every(validAnswer) && validTime(saved.submittedAt) ? saved.submittedAt : undefined;
      attempts[challenge.id] = { answers, ...(submittedAt ? { submittedAt } : {}) };
    }
    return { ...empty, attempts };
  } catch { return empty; }
}

/** False means the UI must explain that the current answers are held in memory. */
export function writeBossProgress(state: BossProgress, storage?: StorageLike | null): boolean {
  try {
    const target = browserStorage(storage);
    if (!target) return false;
    target.setItem(bossStorageKey(state.profileId, state.qa), JSON.stringify(state));
    return true;
  } catch { return false; }
}
