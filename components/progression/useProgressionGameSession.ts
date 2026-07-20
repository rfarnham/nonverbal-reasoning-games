"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  addActiveTimeBrowserSession,
  advanceProgressionBrowserSession,
  answerProgressionBrowserSession,
  beginRedemptionBrowserSession,
  currentBrowserAttemptRound,
  loadProgressionBrowserSession,
  retryProgressionBrowserSession,
  type BrowserProgressionSession,
  type BrowserSessionControlled,
  type ProgressionRouteTarget,
} from "../../lib/progression/browser-session.ts";
import type {
  ProgressionGameAdapter,
  ResolvedProgressionQuestion,
} from "../../lib/progression/game-adapter.ts";
import { PROGRESSION_STORAGE_KEY } from "../../lib/progression/persistence.ts";
import type {
  AttemptPhase,
  AttemptRoundPhase,
  PlayerProfile,
  ProgressionAttempt,
  ProgressionLevel,
  ProgressionState,
} from "../../lib/progression/types.ts";

export type ProgressionInteractionState =
  | "answering"
  | "mandatory-feedback"
  | "blocked";

export type UseProgressionGameSessionOptions = Readonly<{
  storageKey?: string;
}>;

type SessionActions = Readonly<{
  answer(result: { correct: boolean; answerToken?: string }): void;
  retry(): void;
  advance(): void;
  beginRedemption(): void;
  setInteractionState(state: ProgressionInteractionState): void;
  refresh(): void;
}>;

export type ProgressionControlledGameSession<Round> = SessionActions &
  Readonly<{
    mode: "controlled";
    state: ProgressionState;
    profile: PlayerProfile;
    attempt: ProgressionAttempt;
    attemptId: string;
    current: ResolvedProgressionQuestion<Round> | null;
    stage: AttemptPhase;
    roundPhase: AttemptRoundPhase | null;
    runKind: ProgressionAttempt["kind"];
    level: ProgressionLevel;
    isRedemption: boolean;
    currentAttemptCount: number;
    lastAnswerToken: string | null;
    interactionState: ProgressionInteractionState;
    completedQuestions: number;
    currentQuestionNumber: number;
    totalQuestions: number | null;
    turboRemainingMs: number | null;
    navigationTarget: null;
    exitTarget: ProgressionRouteTarget;
  }>;

export type ProgressionGameSession<Round> =
  | Readonly<{ mode: "booting" }>
  | Readonly<{ mode: "standalone" }>
  | Readonly<{
      mode: "recovery" | "redirect";
      message: string;
      navigationTarget: ProgressionRouteTarget;
    }>
  | ProgressionControlledGameSession<Round>;

const EXIT_TARGET: ProgressionRouteTarget = {
  pathname: "/journey/",
};

function activeRoundPhase(
  session: BrowserSessionControlled<unknown>,
): AttemptRoundPhase | null {
  if (session.attempt.phase === "redemption") {
    return session.attempt.redemption?.phase ?? null;
  }
  return currentBrowserAttemptRound(session.attempt)?.phase ?? null;
}

function activeAttemptMetadata(attempt: ProgressionAttempt): {
  attemptCount: number;
  lastAnswerToken: string | null;
} {
  if (attempt.phase === "redemption") {
    return {
      attemptCount: attempt.redemption?.attemptCount ?? 0,
      lastAnswerToken: attempt.redemption?.lastAnswerToken ?? null,
    };
  }
  const round = currentBrowserAttemptRound(attempt);
  return {
    attemptCount: round?.attemptCount ?? 0,
    lastAnswerToken: round?.lastAnswerToken ?? null,
  };
}

/**
 * Current discrete-choice games historically stored either "2" or
 * "option-2". Accept both so a resumed Journey can restore the attempted
 * choice while routes converge on the explicit token.
 */
export function progressionOptionIndexFromAnswerToken(
  answerToken: string | null | undefined,
): number | null {
  const match = /^(?:option-)?([0-9]+)$/.exec(answerToken?.trim() ?? "");
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

function canPracticeClockRun(
  session: BrowserProgressionSession<unknown> | null,
  visible: boolean,
): session is BrowserSessionControlled<unknown> {
  return (
    visible &&
    session?.mode === "controlled" &&
    (session.attempt.phase === "playing" ||
      session.attempt.phase === "redemption")
  );
}

function countsTowardTurbo(
  session: BrowserProgressionSession<unknown> | null,
  interactionState: ProgressionInteractionState,
) {
  return (
    session?.mode === "controlled" &&
    session.attempt.kind === "turbo" &&
    session.attempt.phase === "playing" &&
    session.current !== null &&
    interactionState === "answering" &&
    activeRoundPhase(session) === "answering"
  );
}

function completedQuestionCount(attempt: ProgressionAttempt): number {
  return attempt.rounds.filter(({ phase }) => phase === "solved").length;
}

function currentQuestionNumber(attempt: ProgressionAttempt): number {
  if (attempt.phase === "redemption") {
    return Math.min(
      (attempt.redemption?.currentIndex ?? 0) + 1,
      attempt.redemption?.queue.length ?? 1,
    );
  }
  return attempt.currentRoundIndex === null
    ? attempt.rounds.length
    : attempt.currentRoundIndex + 1;
}

export function useProgressionGameSession<
  Round,
  EngineDifficulty extends string,
>(
  adapter: ProgressionGameAdapter<Round, EngineDifficulty>,
  options: UseProgressionGameSessionOptions = {},
): ProgressionGameSession<Round> {
  const storageKey = options.storageKey ?? PROGRESSION_STORAGE_KEY;
  const [search, setSearch] = useState<string | null>(null);
  const [session, setSession] =
    useState<BrowserProgressionSession<Round> | null>(null);
  const [interactionState, setInteractionStateValue] =
    useState<ProgressionInteractionState>("blocked");
  const [visible, setVisible] = useState(false);
  const mountedRef = useRef(false);
  const sessionRef = useRef<BrowserProgressionSession<Round> | null>(null);
  const interactionStateRef =
    useRef<ProgressionInteractionState>("blocked");
  const practiceClockStartedAtRef = useRef<number | null>(null);

  const applySession = useCallback(
    (next: BrowserProgressionSession<Round>) => {
      sessionRef.current = next;
      if (mountedRef.current) setSession(next);
      return next;
    },
    [],
  );

  const refresh = useCallback(() => {
    if (search === null) return;
    applySession(
      loadProgressionBrowserSession(adapter, {
        search,
        storageKey,
      }),
    );
  }, [adapter, applySession, search, storageKey]);

  const flushClock = useCallback(
    (updateReactState: boolean) => {
      const startedAt = practiceClockStartedAtRef.current;
      const current = sessionRef.current;
      if (
        startedAt === null ||
        current?.mode !== "controlled"
      ) {
        return current;
      }
      const now = Date.now();
      practiceClockStartedAtRef.current = now;
      const elapsedMs = Math.max(0, now - startedAt);
      if (elapsedMs < 1) return current;
      const next = addActiveTimeBrowserSession(
        adapter,
        current.attempt.id,
        elapsedMs,
        now,
        { storageKey },
        {
          countTowardTurbo: countsTowardTurbo(
            current,
            interactionStateRef.current,
          ),
        },
      );
      sessionRef.current = next;
      if (updateReactState && mountedRef.current) setSession(next);
      return next;
    },
    [adapter, storageKey],
  );

  const runAction = useCallback(
    (
      action: (
        attemptId: string,
      ) => BrowserProgressionSession<Round>,
    ) => {
      const beforeFlush = sessionRef.current;
      if (beforeFlush?.mode !== "controlled") return;
      const flushed = flushClock(false);
      const active = flushed?.mode === "controlled"
        ? flushed
        : beforeFlush;
      applySession(action(active.attempt.id));
    },
    [applySession, flushClock],
  );

  const answer = useCallback(
    (result: { correct: boolean; answerToken?: string }) => {
      runAction((attemptId) =>
        answerProgressionBrowserSession(
          adapter,
          attemptId,
          {
            ...result,
            nowMs: Date.now(),
          },
          { storageKey },
        ),
      );
    },
    [adapter, runAction, storageKey],
  );

  const retry = useCallback(() => {
    runAction((attemptId) =>
      retryProgressionBrowserSession(
        adapter,
        attemptId,
        Date.now(),
        { storageKey },
      ),
    );
  }, [adapter, runAction, storageKey]);

  const advance = useCallback(() => {
    runAction((attemptId) =>
      advanceProgressionBrowserSession(
        adapter,
        attemptId,
        Date.now(),
        { storageKey },
      ),
    );
  }, [adapter, runAction, storageKey]);

  const beginRedemption = useCallback(() => {
    runAction((attemptId) =>
      beginRedemptionBrowserSession(
        adapter,
        attemptId,
        Date.now(),
        { storageKey },
      ),
    );
  }, [adapter, runAction, storageKey]);

  const setInteractionState = useCallback(
    (nextState: ProgressionInteractionState) => {
      flushClock(true);
      interactionStateRef.current = nextState;
      setInteractionStateValue(nextState);
    },
    [flushClock],
  );

  useEffect(() => {
    mountedRef.current = true;
    const initialTimer = window.setTimeout(() => {
      setSearch(window.location.search);
      setVisible(document.visibilityState === "visible");
    }, 0);
    return () => {
      window.clearTimeout(initialTimer);
      flushClock(false);
      mountedRef.current = false;
    };
  }, [flushClock]);

  useEffect(() => {
    if (search === null) return;
    refresh();
  }, [refresh, search]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) refresh();
    };
    const handlePopState = () => {
      setSearch(window.location.search);
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [refresh, storageKey]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibility = () => {
      const nextVisible = document.visibilityState === "visible";
      if (!nextVisible) flushClock(true);
      setVisible(nextVisible);
    };
    const handlePageHide = () => {
      flushClock(false);
      practiceClockStartedAtRef.current = null;
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [flushClock]);

  const shouldRunClock = canPracticeClockRun(session, visible);
  const activeAttemptId =
    session?.mode === "controlled" ? session.attempt.id : null;
  const activePlayId =
    session?.mode === "controlled" ? session.current?.playId ?? null : null;

  useEffect(() => {
    if (!shouldRunClock) {
      flushClock(true);
      practiceClockStartedAtRef.current = null;
      return;
    }
    if (practiceClockStartedAtRef.current === null) {
      practiceClockStartedAtRef.current = Date.now();
    }
    const heartbeat = window.setInterval(() => {
      flushClock(true);
    }, 1_000);
    return () => {
      window.clearInterval(heartbeat);
      flushClock(false);
      practiceClockStartedAtRef.current = null;
    };
  }, [
    activeAttemptId,
    activePlayId,
    flushClock,
    shouldRunClock,
  ]);

  return useMemo((): ProgressionGameSession<Round> => {
    if (search === null || session === null) return { mode: "booting" };
    if (session.mode !== "controlled") return session;

    const roundPhase = activeRoundPhase(session);
    const attemptMetadata = activeAttemptMetadata(session.attempt);
    const totalQuestions =
      session.attempt.phase === "redemption"
        ? (session.attempt.redemption?.queue.length ?? 0)
        : session.attempt.kind === "turbo"
          ? null
          : session.attempt.rounds.length;
    return {
      ...session,
      attemptId: session.attempt.id,
      stage: session.attempt.phase,
      roundPhase,
      runKind: session.attempt.kind,
      level: session.attempt.level,
      interactionState,
      currentAttemptCount: attemptMetadata.attemptCount,
      lastAnswerToken: attemptMetadata.lastAnswerToken,
      completedQuestions: completedQuestionCount(session.attempt),
      currentQuestionNumber: currentQuestionNumber(session.attempt),
      totalQuestions,
      turboRemainingMs:
        session.attempt.turboRemainingMs ?? null,
      exitTarget: EXIT_TARGET,
      answer,
      retry,
      advance,
      beginRedemption,
      setInteractionState,
      refresh,
    };
  }, [
    advance,
    answer,
    beginRedemption,
    interactionState,
    refresh,
    retry,
    search,
    session,
    setInteractionState,
  ]);
}
