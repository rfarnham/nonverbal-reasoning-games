import { WORLD_CONTENT_VERSION, WORLD_DEFINITIONS, type WorldQuestion } from "./world-data.ts";
import type { StopAttempt, WorldProgress } from "./engine.ts";
import { DANGER_CANDIDATE_INDEX, dangerCandidates, dangerQuestion, dangerQuestionType, type DangerCandidateIndex } from "./danger-candidates.ts";

export const DANGER_SCHEMA_VERSION = 1;
export const DANGER_MAX_QUESTIONS = 24;
export type DangerMiss = Readonly<{
  eventId: string;
  questionId: string;
  source: "archipelago" | "danger" | "legacy";
  sourceId: string;
  worldNumber: number;
  attemptOrdinal: number;
  selectedIndex: number | null;
  at: string;
}>;
export type DangerReview = Readonly<{
  questionId: string;
  latestMissEventId: string;
  firstWorldNumber: number;
  latestWorldNumber: number;
  dueAfterWorld: number | null;
  lastReviewedAfterWorld: number | null;
  cleanReviews: number;
  completedReinforcementIds: readonly string[];
  deferredCandidateIds: readonly string[];
}>;
export type DangerGroup = Readonly<{
  questionType: string;
  originalQuestionId: string;
  latestMissEventId: string;
  questionIds: readonly string[];
}>;
export type DangerPacket = Readonly<{
  id: string;
  afterWorldNumber: number;
  createdAt: string;
  candidateIndexVersion: string;
  groupSize: number;
  groups: readonly DangerGroup[];
  questionIds: readonly string[];
  briefingRead: boolean;
  startedAt: string | null;
  completedAt: string | null;
  attempt: StopAttempt;
}>;
export type DangerState = Readonly<{
  schemaVersion: 1;
  contentVersion: string;
  profileId: string;
  qa: boolean;
  misses: readonly DangerMiss[];
  reviews: Readonly<Record<string, DangerReview>>;
  packets: Readonly<Record<string, DangerPacket>>;
}>;

export function createDangerState(profileId: string, qa = false): DangerState {
  if (!profileId.trim()) throw new Error("Danger progress requires an explicit player identity.");
  return { schemaVersion: 1, contentVersion: WORLD_CONTENT_VERSION, profileId, qa, misses: [], reviews: {}, packets: {} };
}

const validTime = (value: string): boolean => typeof value === "string" && Number.isFinite(Date.parse(value));
const validWorld = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= 32;
const nextBoundary = (world: number): number => Math.ceil(world / 2) * 2;

/** Log every accepted wrong response, including retries. Event IDs make a
 * retried persistence callback idempotent without merging distinct mistakes. */
export function recordDangerMiss(state: DangerState, miss: DangerMiss): DangerState {
  const question = dangerQuestion(miss.questionId);
  if (!question || typeof miss.eventId !== "string" || !miss.eventId.trim() || typeof miss.sourceId !== "string" || !miss.sourceId.trim() || !validWorld(miss.worldNumber)
    || !["archipelago", "danger", "legacy"].includes(miss.source) || !validTime(miss.at)
    || !Number.isInteger(miss.attemptOrdinal) || miss.attemptOrdinal < 1
    || (miss.source === "legacy" ? miss.selectedIndex !== null
      : !Number.isInteger(miss.selectedIndex) || Number(miss.selectedIndex) < 0 || Number(miss.selectedIndex) >= question.choices.length || miss.selectedIndex === question.correctIndex)
    || state.misses.some(existing => existing.eventId === miss.eventId)) return state;
  const previous = state.reviews[miss.questionId];
  const dueAfterWorld = miss.source === "danger" ? nextBoundary(miss.worldNumber) + 2 : nextBoundary(miss.worldNumber);
  return {
    ...state,
    misses: [...state.misses, { ...miss }],
    reviews: { ...state.reviews, [miss.questionId]: {
      questionId: miss.questionId, latestMissEventId: miss.eventId,
      firstWorldNumber: previous?.firstWorldNumber ?? miss.worldNumber,
      latestWorldNumber: miss.worldNumber,
      dueAfterWorld: previous?.dueAfterWorld == null ? dueAfterWorld : Math.min(previous.dueAfterWorld, dueAfterWorld),
      lastReviewedAfterWorld: previous?.lastReviewedAfterWorld ?? null,
      cleanReviews: 0,
      completedReinforcementIds: previous?.completedReinforcementIds ?? [],
      deferredCandidateIds: previous?.deferredCandidateIds ?? [],
    } },
  };
}

/** Legacy state knows only that a first attempt was wrong, not the selected
 * answer or the number of retries. Import one honest observation, once. */
export function importLegacyDangerMisses(state: DangerState, progress: WorldProgress, now = new Date().toISOString()): DangerState {
  let next = state;
  for (const [stopId, attempt] of Object.entries(progress.stopAttempts)) {
    for (const [questionId, correct] of Object.entries(attempt.firstTryCorrect)) {
      if (correct !== false) continue;
      const question = dangerQuestion(questionId);
      const world = WORLD_DEFINITIONS.find(candidate => candidate.id === question?.worldId);
      if (!question || question.stopId !== stopId || !world) continue;
      // Already observed live mistakes must not be re-imported on the next load.
      if (next.misses.some(miss => miss.questionId === questionId && miss.sourceId === stopId && miss.source !== "danger")) continue;
      next = recordDangerMiss(next, { eventId: `legacy:${stopId}:${questionId}`, questionId, source: "legacy", sourceId: stopId,
        worldNumber: world.number, attemptOrdinal: 1, selectedIndex: null, at: now });
    }
  }
  return next;
}

export type DangerPacketOptions = Readonly<{
  dangerId: string;
  afterWorldNumber: number;
  now?: string;
  normalGroupSize?: number;
  backlogGroupSize?: number;
}>;

/** Freezes the exact printable/playable deck. Reading, printing, leaving or
 * changing the candidate index cannot replace an existing packet. */
export function ensureDangerPacket(state: DangerState, options: DangerPacketOptions, index: DangerCandidateIndex = DANGER_CANDIDATE_INDEX): DangerState {
  const { dangerId, afterWorldNumber } = options;
  if (Object.hasOwn(state.packets, dangerId) || !validWorld(afterWorldNumber) || afterWorldNumber % 2 !== 0
    || dangerId !== `danger-${String(afterWorldNumber).padStart(2, "0")}`) return state;
  const now = options.now ?? new Date().toISOString();
  if (!validTime(now)) return state;
  const normal = Number.isFinite(options.normalGroupSize) ? Math.max(1, Math.min(24, Math.trunc(options.normalGroupSize!))) : 5;
  const small = Number.isFinite(options.backlogGroupSize) ? Math.max(1, Math.min(normal, Math.trunc(options.backlogGroupSize!))) : Math.min(normal, 3);
  const pending = Object.values(state.reviews).filter(review => review.dueAfterWorld !== null && review.dueAfterWorld <= afterWorldNumber && dangerQuestion(review.questionId));
  // Three unserved danger opportunities promote an old error ahead of new
  // errors. Otherwise recent archipelagos lead, then the oldest review.
  const wait = (review: DangerReview) => afterWorldNumber - (review.lastReviewedAfterWorld ?? review.dueAfterWorld ?? afterWorldNumber);
  pending.sort((a, b) => Number(wait(b) >= 6) - Number(wait(a) >= 6)
    || (wait(a) >= 6 && wait(b) >= 6 ? wait(b) - wait(a) : b.latestWorldNumber - a.latestWorldNumber)
    || (a.lastReviewedAfterWorld ?? -1) - (b.lastReviewedAfterWorld ?? -1) || a.questionId.localeCompare(b.questionId));
  const representedTypes = new Set<string>();
  const representatives = pending.filter(review => {
    const type = dangerQuestionType(review.questionId, index);
    if (representedTypes.has(type)) return false;
    representedTypes.add(type); return true;
  });
  const originals = new Set(representatives.map(review => review.questionId));
  const available = (review: DangerReview) => {
    const safe = dangerCandidates(review.questionId, index);
    const candidates = [...new Set([...review.deferredCandidateIds, ...safe])];
    return candidates.filter(id => safe.includes(id) && !originals.has(id) && !review.completedReinforcementIds.includes(id));
  };
  const projected = representatives.reduce((sum, review) => sum + Math.min(normal, 1 + available(review).length), 0);
  const groupSize = projected > DANGER_MAX_QUESTIONS ? small : normal;
  const groups: DangerGroup[] = [];
  const questionIds: string[] = [];
  const used = new Set<string>();
  const reviews = { ...state.reviews };
  for (const review of representatives) {
    const capacity = DANGER_MAX_QUESTIONS - questionIds.length;
    if (capacity <= 0) break;
    const candidates = available(review).filter(id => !used.has(id));
    const ids = [review.questionId, ...candidates.slice(0, Math.min(groupSize, capacity) - 1)];
    groups.push({ questionType: dangerQuestionType(review.questionId, index), originalQuestionId: review.questionId, latestMissEventId: review.latestMissEventId, questionIds: ids });
    questionIds.push(...ids); ids.forEach(id => used.add(id));
    // Reserve without consuming. The whole backlog survives abandoned packets.
    reviews[review.questionId] = { ...review, deferredCandidateIds: [...new Set([...review.deferredCandidateIds, ...candidates])] };
  }
  const packet: DangerPacket = {
    id: dangerId, afterWorldNumber, createdAt: now, candidateIndexVersion: index.version, groupSize, groups, questionIds,
    briefingRead: false, startedAt: null, completedAt: null,
    attempt: { questionIndex: 0, phase: "answering", selectedIndex: null, firstTryCorrect: {}, solvedQuestionIds: [] },
  };
  return { ...state, reviews, packets: { ...state.packets, [dangerId]: packet } };
}

export function dangerPacketQuestions(packet: DangerPacket): readonly WorldQuestion[] {
  return packet.questionIds.map(id => dangerQuestion(id)).filter((question): question is WorldQuestion => Boolean(question));
}
const updatePacket = (state: DangerState, packet: DangerPacket): DangerState => ({ ...state, packets: { ...state.packets, [packet.id]: packet } });
export function acknowledgeDangerBriefing(state: DangerState, dangerId: string): DangerState {
  const packet = state.packets[dangerId];
  return packet && !packet.briefingRead ? updatePacket(state, { ...packet, briefingRead: true }) : state;
}
export function startDangerPacket(state: DangerState, dangerId: string, now = new Date().toISOString()): DangerState {
  const packet = state.packets[dangerId];
  if (!packet || !packet.briefingRead || packet.startedAt || packet.completedAt || !validTime(now)) return state;
  return updatePacket(state, { ...packet, startedAt: now, completedAt: packet.questionIds.length === 0 ? now : null });
}
export function answerDangerQuestion(state: DangerState, dangerId: string, selectedIndex: number, observation: Readonly<{ eventId: string; at: string }>): DangerState {
  const packet = state.packets[dangerId];
  if (!packet?.startedAt || packet.completedAt || !["answering", "retry"].includes(packet.attempt.phase)
    || !observation.eventId?.trim() || !validTime(observation.at)) return state;
  const question = dangerQuestion(packet.questionIds[packet.attempt.questionIndex]);
  if (!question || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= question.choices.length) return state;
  const correct = question.correctIndex === selectedIndex;
  if (!correct && state.misses.some(miss => miss.eventId === observation.eventId)) return state;
  const attempt = packet.attempt;
  const next = updatePacket(state, { ...packet, attempt: {
    ...attempt, phase: correct ? "correct" : "wrong-review", selectedIndex,
    firstTryCorrect: Object.hasOwn(attempt.firstTryCorrect, question.id) ? attempt.firstTryCorrect : { ...attempt.firstTryCorrect, [question.id]: correct },
    solvedQuestionIds: correct ? [...new Set([...attempt.solvedQuestionIds, question.id])] : attempt.solvedQuestionIds,
  } });
  return correct ? next : recordDangerMiss(next, {
    eventId: observation.eventId, questionId: question.id, source: "danger", sourceId: dangerId,
    worldNumber: packet.afterWorldNumber,
    attemptOrdinal: state.misses.filter(miss => miss.source === "danger" && miss.sourceId === dangerId && miss.questionId === question.id).length + 1,
    selectedIndex, at: observation.at,
  });
}
export function allowDangerRetry(state: DangerState, dangerId: string): DangerState {
  const packet = state.packets[dangerId];
  return packet?.startedAt && !packet.completedAt && packet.attempt.phase === "wrong-review"
    ? updatePacket(state, { ...packet, attempt: { ...packet.attempt, phase: "retry" } }) : state;
}
export function advanceDangerQuestion(state: DangerState, dangerId: string, now = new Date().toISOString()): DangerState {
  const packet = state.packets[dangerId];
  if (!packet?.startedAt || packet.completedAt || packet.attempt.phase !== "correct" || !validTime(now)
    || !packet.attempt.solvedQuestionIds.includes(packet.questionIds[packet.attempt.questionIndex])) return state;
  if (packet.attempt.questionIndex < packet.questionIds.length - 1) return updatePacket(state, { ...packet, attempt: { ...packet.attempt, questionIndex: packet.attempt.questionIndex + 1, phase: "answering", selectedIndex: null } });
  if (!packet.questionIds.every(id => packet.attempt.solvedQuestionIds.includes(id))) return state;
  const reviews = { ...state.reviews };
  for (const group of packet.groups) {
    const review = reviews[group.originalQuestionId];
    if (!review) continue;
    const clean = group.questionIds.every(id => packet.attempt.firstTryCorrect[id] === true);
    const newerMiss = review.latestMissEventId !== group.latestMissEventId;
    const cleanReviews = !newerMiss && clean ? Math.min(2, review.cleanReviews + 1) : 0;
    const completedReinforcementIds = [...new Set([...review.completedReinforcementIds, ...group.questionIds.slice(1)])];
    const deferredCandidateIds = review.deferredCandidateIds.filter(id => !completedReinforcementIds.includes(id));
    reviews[group.originalQuestionId] = { ...review, completedReinforcementIds, deferredCandidateIds,
      lastReviewedAfterWorld: packet.afterWorldNumber, cleanReviews,
      dueAfterWorld: newerMiss || !clean || deferredCandidateIds.length ? packet.afterWorldNumber + 2 : cleanReviews >= 2 ? null : packet.afterWorldNumber + 4 };
  }
  return { ...updatePacket(state, { ...packet, completedAt: now }), reviews };
}
export function dangerPacketAccuracy(packet: DangerPacket): number {
  return packet.questionIds.length ? Math.round(packet.questionIds.filter(id => packet.attempt.firstTryCorrect[id] === true).length / packet.questionIds.length * 100) : 100;
}
