import { loadProgressionState } from "../../lib/progression/persistence.ts";
import { isJourneyTestProfile } from "../../lib/progression/test-mode.ts";
import type { StorageLike } from "../../lib/progression/types.ts";
import type { WorldProgress } from "./engine.ts";
import { WORLD_COMPATIBLE_CONTENT_VERSIONS, WORLD_CONTENT_VERSION } from "./world-data.ts";
import { dangerQuestion } from "./danger-candidates.ts";
import { createDangerState, importLegacyDangerMisses, recordDangerMiss, type DangerPacket, type DangerReview, type DangerState } from "./danger-engine.ts";

export const DANGER_STORAGE_PREFIX = "spatial-gym-math-world-danger-v1";
export const DANGER_GUEST_PROFILE_ID = "device-guest";
export function dangerStorageKey(profileId: string, qa: boolean): string {
  return `${DANGER_STORAGE_PREFIX}:${qa ? "qa" : "play"}:${encodeURIComponent(profileId)}`;
}
function browserStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}
export function readDangerIdentity(storage?: StorageLike | null): Readonly<{ profileId: string; qa: boolean }> {
  const progress = loadProgressionState(browserStorage(storage));
  const profile = progress.profiles.find(candidate => candidate.id === progress.activeProfileId);
  return { profileId: profile?.id ?? DANGER_GUEST_PROFILE_ID, qa: profile ? isJourneyTestProfile(profile) : false };
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
const time = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === "string" && dangerQuestion(id)) && new Set(value).size === value.length;

function cleanPacket(value: unknown, key: string): DangerPacket | null {
  if (!object(value) || value.id !== key || !nonnegative(value.afterWorldNumber) || value.afterWorldNumber < 2 || value.afterWorldNumber > 32 || value.afterWorldNumber % 2
    || key !== `danger-${String(value.afterWorldNumber).padStart(2, "0")}`
    || !time(value.createdAt) || typeof value.candidateIndexVersion !== "string" || !nonnegative(value.groupSize) || value.groupSize < 1 || value.groupSize > 24
    || !ids(value.questionIds) || value.questionIds.length > 24 || !Array.isArray(value.groups)
    || typeof value.briefingRead !== "boolean" || (value.startedAt !== null && !time(value.startedAt)) || (value.completedAt !== null && !time(value.completedAt)) || !object(value.attempt)) return null;
  const packet = value as unknown as DangerPacket;
  const flattened: string[] = [];
  const types = new Set<string>();
  for (const group of packet.groups) {
    if (!object(group) || typeof group.questionType !== "string" || types.has(group.questionType) || typeof group.latestMissEventId !== "string"
      || !ids(group.questionIds) || group.questionIds.length === 0 || group.questionIds[0] !== group.originalQuestionId) return null;
    flattened.push(...group.questionIds); types.add(group.questionType);
  }
  if (JSON.stringify(flattened) !== JSON.stringify(packet.questionIds)) return null;
  const attempt = packet.attempt;
  const current = dangerQuestion(packet.questionIds[attempt.questionIndex]);
  if (!nonnegative(attempt.questionIndex) || attempt.questionIndex >= Math.max(1, packet.questionIds.length)
    || !["answering", "wrong-review", "retry", "correct"].includes(attempt.phase)
    || !object(attempt.firstTryCorrect) || !ids(attempt.solvedQuestionIds)
    || Object.entries(attempt.firstTryCorrect).some(([id, correct]) => !packet.questionIds.includes(id) || typeof correct !== "boolean")
    || attempt.solvedQuestionIds.some(id => !packet.questionIds.includes(id))) return null;
  if (attempt.phase === "answering" ? attempt.selectedIndex !== null : !current || !nonnegative(attempt.selectedIndex)
    || attempt.selectedIndex >= current.choices.length || (attempt.phase === "correct") !== (attempt.selectedIndex === current.correctIndex)) return null;
  const solvedPrefix = packet.questionIds.slice(0, attempt.questionIndex + (attempt.phase === "correct" ? 1 : 0));
  const answeredIds = [...new Set([...solvedPrefix, ...(attempt.phase !== "answering" && current ? [current.id] : [])])];
  if (JSON.stringify(solvedPrefix) !== JSON.stringify(attempt.solvedQuestionIds)
    || answeredIds.length !== Object.keys(attempt.firstTryCorrect).length
    || answeredIds.some(id => !Object.hasOwn(attempt.firstTryCorrect, id))
    || ((attempt.phase === "wrong-review" || attempt.phase === "retry") && current && attempt.firstTryCorrect[current.id] !== false)) return null;
  if ((packet.startedAt && !packet.briefingRead)
    || (!packet.startedAt && (attempt.questionIndex !== 0 || attempt.phase !== "answering" || answeredIds.length > 0))) return null;
  if (packet.completedAt && (!packet.startedAt || packet.questionIds.some(id => !attempt.solvedQuestionIds.includes(id)))) return null;
  return packet;
}

export function readDangerState(profileId: string, qa = false, storage?: StorageLike | null): DangerState {
  const empty = createDangerState(profileId, qa);
  try {
    const text = browserStorage(storage)?.getItem(dangerStorageKey(profileId, qa));
    if (!text) return empty;
    const raw: unknown = JSON.parse(text);
    if (!object(raw) || raw.schemaVersion !== 1 || raw.profileId !== profileId || raw.qa !== qa
      || typeof raw.contentVersion !== "string" || !WORLD_COMPATIBLE_CONTENT_VERSIONS.has(raw.contentVersion)
      || !Array.isArray(raw.misses)) return empty;
    let state = empty;
    for (const miss of raw.misses) if (object(miss)) state = recordDangerMiss(state, miss as Parameters<typeof recordDangerMiss>[1]);
    const reviews = { ...state.reviews };
    if (object(raw.reviews)) for (const [id, value] of Object.entries(raw.reviews)) {
      if (!object(value) || !reviews[id] || value.questionId !== id || value.latestMissEventId !== reviews[id].latestMissEventId
        || !nonnegative(value.cleanReviews) || value.cleanReviews > 2
        || (value.dueAfterWorld !== null && (!nonnegative(value.dueAfterWorld) || value.dueAfterWorld < 2))
        || (value.lastReviewedAfterWorld !== null && (!nonnegative(value.lastReviewedAfterWorld) || value.lastReviewedAfterWorld < 2 || value.lastReviewedAfterWorld > 32))
        || !ids(value.completedReinforcementIds) || !ids(value.deferredCandidateIds)) continue;
      reviews[id] = { ...reviews[id], cleanReviews: value.cleanReviews, dueAfterWorld: value.dueAfterWorld,
        lastReviewedAfterWorld: value.lastReviewedAfterWorld,
        completedReinforcementIds: value.completedReinforcementIds, deferredCandidateIds: value.deferredCandidateIds } as DangerReview;
    }
    const packets: Record<string, DangerPacket> = {};
    if (object(raw.packets)) for (const [id, value] of Object.entries(raw.packets)) {
      const packet = cleanPacket(value, id);
      if (packet && packet.groups.every(group => state.misses.some(miss => miss.eventId === group.latestMissEventId && miss.questionId === group.originalQuestionId))) packets[id] = packet;
    }
    return { ...state, contentVersion: WORLD_CONTENT_VERSION, reviews, packets };
  } catch { return empty; }
}

/** Returns false when persistence is unavailable so the UI can report that this
 * packet is only held in memory. Never writes into another profile's key. */
export function writeDangerState(state: DangerState, storage?: StorageLike | null): boolean {
  try {
    const target = browserStorage(storage);
    if (!target) return false;
    target.setItem(dangerStorageKey(state.profileId, state.qa), JSON.stringify(state));
    return true;
  } catch { return false; }
}

/** Old Math Worlds progress was device-wide, not attributable to a child.
 * A single durable owner prevents each new profile inheriting the same misses.
 * Do not claim without functioning storage: safety beats guessing ownership. */
export function claimLegacyDangerMisses(state: DangerState, progress: WorldProgress, storage?: StorageLike | null, now = new Date().toISOString()): DangerState {
  try {
    const target = browserStorage(storage);
    if (!target) return state;
    const key = `${DANGER_STORAGE_PREFIX}:legacy-owner:${state.qa ? "qa" : "play"}`;
    let owner = target.getItem(key);
    if (!owner) { target.setItem(key, state.profileId); owner = target.getItem(key); }
    if (owner !== state.profileId) return state;
    return importLegacyDangerMisses(state, progress, now);
  } catch { return state; }
}
