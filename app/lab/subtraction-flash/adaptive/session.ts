import type {
  AdaptiveSession,
  AdaptiveSessionPlan,
  AttemptEvent,
  PlannedCard,
  PlannedCardStatus,
  SessionLifecycle,
} from "./types.ts";

export const ADAPTIVE_SESSION_SHOWS_COUNTDOWN = false;

export type AdaptiveSessionPauseReason = "explicit" | "background";

/**
 * Runtime clock fields kept alongside the persisted AdaptiveSession contract.
 * They are JSON-safe so a paused or backgrounded session can resume exactly.
 */
export type AdaptiveSessionRuntime = AdaptiveSession &
  Readonly<{
    activeSince: number | null;
    pauseReasons: readonly AdaptiveSessionPauseReason[];
    phaseBeforePause: SessionLifecycle | null;
    backgroundedAt: number | null;
  }>;

export function adaptiveSessionCompletedAsPlanned(
  session: AdaptiveSessionRuntime,
): boolean {
  return (
    !session.fatigueFlag &&
    session.cards.length > 0 &&
    session.cards.every(({ status }) => status === "completed")
  );
}

export type CardDisposition = "completed" | "skipped";

/** Restore the answer/feedback boundary without accepting the same card twice. */
export function pendingAttemptForSession(
  session: AdaptiveSessionRuntime,
  attempts: readonly AttemptEvent[],
): AttemptEvent | null {
  const problemId = session.currentProblem?.id;
  if (!problemId) return null;
  return (
    [...attempts]
      .reverse()
      .find(
        (attempt) =>
          attempt.sessionId === session.id &&
          attempt.problemId === problemId &&
          attempt.sessionPosition === session.currentCardIndex,
      ) ?? null
  );
}

function checkedTime(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative timestamp.`);
  }
  return value;
}

function lifecycleForCard(card: PlannedCard): SessionLifecycle {
  switch (card.lane) {
    case "diagnostic":
      return "diagnostic";
    case "focus":
      return "focused_practice";
    case "integration":
      return "integration";
    case "transfer":
      return "transfer";
    case "easy_close":
      return "easy_close";
    case "review":
    case "warmup":
      return "warmup";
  }
}

function withCardStatus(
  cards: readonly PlannedCard[],
  index: number,
  status: PlannedCardStatus,
): readonly PlannedCard[] {
  return cards.map((card, cardIndex) =>
    cardIndex === index ? { ...card, status } : card,
  );
}

function accrueActiveTime(
  session: AdaptiveSessionRuntime,
  at: number,
): AdaptiveSessionRuntime {
  const timestamp = checkedTime(at, "Session transition time");
  if (session.activeSince === null) return session;
  return {
    ...session,
    activeElapsedMs:
      session.activeElapsedMs + Math.max(0, timestamp - session.activeSince),
    activeSince: timestamp,
  };
}

function terminalPhase(session: AdaptiveSessionRuntime): SessionLifecycle {
  return session.fatigueFlag ? "ended_early_for_fatigue" : "complete";
}

function finishAfterActiveCard(
  session: AdaptiveSessionRuntime,
  cards: readonly PlannedCard[],
  at: number,
): AdaptiveSessionRuntime {
  // A terminal snapshot must never retain an active or merely planned card.
  // `advanceAdaptiveSession` has already marked the answered card completed,
  // while a manual finish marks that still-active card skipped.
  const finishedCards = cards.map((card) =>
    card.status === "active" || card.status === "planned"
      ? { ...card, status: "skipped" as const }
      : card,
  );
  return {
    ...session,
    phase: terminalPhase(session),
    cards: finishedCards,
    currentProblem: null,
    shownAt: null,
    activeSince: null,
    completedAt: checkedTime(at, "Session completion time"),
    pausedAt: null,
    pauseReasons: [],
    phaseBeforePause: null,
    backgrounded: false,
    backgroundedAt: null,
  };
}

export function createAdaptiveSession(
  plan: AdaptiveSessionPlan,
): AdaptiveSessionRuntime {
  const cards = plan.cards.map((card) => ({ ...card, status: "planned" as const }));
  return {
    id: plan.id,
    learnerId: plan.learnerId,
    kind: plan.kind,
    seed: plan.seed,
    createdAt: plan.createdAt,
    focusSkillId: plan.focusSkillId,
    targetCardCount: plan.targetCardCount,
    maxActiveDurationMs: plan.maxActiveDurationMs,
    phase: "not_started",
    cards,
    completedProblemIds: [],
    currentProblem: null,
    currentCardIndex: 0,
    shownAt: null,
    activeElapsedMs: 0,
    pausedAt: null,
    explicitPauseUsed: false,
    backgrounded: false,
    interruptionDurationMs: 0,
    remediationQueue: [],
    fatigueFlag: false,
    startedAt: null,
    completedAt: null,
    activeSince: null,
    pauseReasons: [],
    phaseBeforePause: null,
    backgroundedAt: null,
  };
}

export function startAdaptiveSession(
  session: AdaptiveSessionRuntime,
  at: number,
): AdaptiveSessionRuntime {
  const timestamp = checkedTime(at, "Session start time");
  if (session.phase !== "not_started") return session;
  const first = session.cards[0];
  if (!first) {
    return {
      ...session,
      phase: "complete",
      startedAt: timestamp,
      completedAt: timestamp,
    };
  }
  return {
    ...session,
    phase: lifecycleForCard(first),
    cards: withCardStatus(session.cards, 0, "active"),
    currentProblem: first.problem,
    currentCardIndex: 0,
    shownAt: timestamp,
    startedAt: timestamp,
    activeSince: timestamp,
  };
}

export function pauseAdaptiveSession(
  session: AdaptiveSessionRuntime,
  reason: AdaptiveSessionPauseReason,
  at: number,
): AdaptiveSessionRuntime {
  const timestamp = checkedTime(at, "Session pause time");
  if (
    session.phase === "not_started" ||
    session.phase === "complete" ||
    session.phase === "ended_early_for_fatigue" ||
    session.pauseReasons.includes(reason)
  ) {
    return session;
  }

  const firstPause = session.pauseReasons.length === 0;
  const accrued = firstPause ? accrueActiveTime(session, timestamp) : session;
  return {
    ...accrued,
    phase: "paused",
    pausedAt: firstPause ? timestamp : accrued.pausedAt,
    activeSince: null,
    explicitPauseUsed: accrued.explicitPauseUsed || reason === "explicit",
    backgrounded: accrued.backgrounded || reason === "background",
    backgroundedAt:
      reason === "background" && accrued.backgroundedAt === null
        ? timestamp
        : accrued.backgroundedAt,
    pauseReasons: [...accrued.pauseReasons, reason],
    phaseBeforePause: firstPause ? accrued.phase : accrued.phaseBeforePause,
  };
}

export function resumeAdaptiveSession(
  session: AdaptiveSessionRuntime,
  reason: AdaptiveSessionPauseReason,
  at: number,
): AdaptiveSessionRuntime {
  const timestamp = checkedTime(at, "Session resume time");
  if (!session.pauseReasons.includes(reason)) return session;

  const remainingReasons = session.pauseReasons.filter(
    (pauseReason) => pauseReason !== reason,
  );
  const endingBackground = reason === "background";
  const interruptionDurationMs = endingBackground
    ? session.interruptionDurationMs +
      Math.max(0, timestamp - (session.backgroundedAt ?? timestamp))
    : session.interruptionDurationMs;
  const stillPaused = remainingReasons.length > 0;

  return {
    ...session,
    phase: stillPaused
      ? "paused"
      : (session.phaseBeforePause ?? lifecycleForCard(
          session.cards[session.currentCardIndex] ?? session.cards[0]!,
        )),
    pausedAt: stillPaused ? session.pausedAt : null,
    activeSince: stillPaused ? null : timestamp,
    pauseReasons: remainingReasons,
    phaseBeforePause: stillPaused ? session.phaseBeforePause : null,
    backgrounded: endingBackground ? false : session.backgrounded,
    backgroundedAt: endingBackground ? null : session.backgroundedAt,
    interruptionDurationMs,
  };
}

export function backgroundAdaptiveSession(
  session: AdaptiveSessionRuntime,
  at: number,
): AdaptiveSessionRuntime {
  return pauseAdaptiveSession(session, "background", at);
}

export function foregroundAdaptiveSession(
  session: AdaptiveSessionRuntime,
  at: number,
): AdaptiveSessionRuntime {
  return resumeAdaptiveSession(session, "background", at);
}

export function advanceAdaptiveSession(
  session: AdaptiveSessionRuntime,
  at: number,
  disposition: CardDisposition = "completed",
): AdaptiveSessionRuntime {
  const timestamp = checkedTime(at, "Card completion time");
  if (
    session.phase === "not_started" ||
    session.phase === "paused" ||
    session.phase === "complete" ||
    session.phase === "ended_early_for_fatigue" ||
    session.currentProblem === null
  ) {
    return session;
  }

  const accrued = accrueActiveTime(session, timestamp);
  const completedCard = accrued.cards[accrued.currentCardIndex];
  let cards = withCardStatus(
    accrued.cards,
    accrued.currentCardIndex,
    disposition,
  );
  const completedProblemIds =
    disposition === "completed" && completedCard
      ? [...new Set([...accrued.completedProblemIds, completedCard.problem.id])]
      : accrued.completedProblemIds;
  const nextIndex = cards.findIndex(
    (card, index) => index > accrued.currentCardIndex && card.status === "planned",
  );
  const timeCapReached = accrued.activeElapsedMs >= accrued.maxActiveDurationMs;

  if (nextIndex < 0 || timeCapReached) {
    return finishAfterActiveCard(
      { ...accrued, completedProblemIds },
      cards,
      timestamp,
    );
  }

  cards = withCardStatus(cards, nextIndex, "active");
  const nextCard = cards[nextIndex]!;
  return {
    ...accrued,
    phase: lifecycleForCard(nextCard),
    cards,
    completedProblemIds,
    currentProblem: nextCard.problem,
    currentCardIndex: nextIndex,
    shownAt: timestamp,
    activeSince: timestamp,
  };
}

/**
 * Preserve completed/current history, discard future volume, and leave exactly
 * one easy close. Call after fatigue is detected and before advancing the
 * just-finished card.
 */
export function shortenAdaptiveSessionForFatigue(
  session: AdaptiveSessionRuntime,
  easyClose: PlannedCard,
): AdaptiveSessionRuntime {
  if (
    session.phase === "complete" ||
    session.phase === "ended_early_for_fatigue"
  ) {
    return session;
  }
  const prefix = session.cards.slice(0, session.currentCardIndex + 1);
  const currentCard = prefix.at(-1);
  if (currentCard?.lane === "easy_close") {
    return {
      ...session,
      cards: prefix,
      targetCardCount: prefix.length,
      remediationQueue: [],
      fatigueFlag: true,
    };
  }
  const closingCard: PlannedCard = {
    ...easyClose,
    lane: "easy_close",
    status: "planned",
  };
  const cards = [...prefix, closingCard];
  return {
    ...session,
    cards,
    targetCardCount: cards.length,
    remediationQueue: [],
    fatigueFlag: true,
  };
}

export function finishAdaptiveSession(
  session: AdaptiveSessionRuntime,
  at: number,
): AdaptiveSessionRuntime {
  const timestamp = checkedTime(at, "Session completion time");
  if (
    session.phase === "complete" ||
    session.phase === "ended_early_for_fatigue"
  ) {
    return session;
  }
  const accrued = accrueActiveTime(session, timestamp);
  return finishAfterActiveCard(accrued, accrued.cards, timestamp);
}
