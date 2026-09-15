"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AdaptiveHandwritingInput,
  type AdaptiveNumericAnswerSubmission,
  type AdaptiveRejectedRecognition,
} from "./adaptive-handwriting";
import { AdaptiveParentReport } from "./adaptive-parent-report";
import { AdaptiveProblemCard } from "./adaptive-problem-card";
import { createBorrowFlashProfileStorage } from "./borrow-flash-profiles";
import {
  DEVICE_LEARNER_ID,
  appendAttemptEvent,
  appendCompletedSessionSummary,
  appendRecognitionEvent,
  createEmptyAdaptiveSubtractionProgress,
  loadAdaptiveSubtractionProgressDiagnostic,
  replaceSkillStateCache,
  setActiveAdaptiveSession,
  updateAdaptiveSettings,
  upsertReviewScheduleEntry,
  writeAdaptiveSubtractionProgress,
  type AdaptiveSubtractionLoadStatus,
  type AdaptiveSubtractionProgress,
} from "./adaptive-storage";
import {
  attemptWasEventuallyCorrect,
  createAttemptEvent,
  createRecognitionEvent,
} from "./adaptive/attempts";
import { deriveLearnerSkillStates } from "./adaptive/mastery";
import {
  buildAdaptiveSessionPlan,
  buildEasyCloseCard,
  classifyAdaptiveError,
  detectSessionFatigue,
  replanAfterAttempt,
} from "./adaptive/planner";
import { diagnosticSessionNumber } from "./adaptive/progression";
import { evaluateProblemAnswer } from "./adaptive/problems";
import {
  benchmarkRecentExclusions,
  classifyReviewOutcome,
  completeReviewSchedule,
  createReviewScheduleEntry,
  dueSkillIds,
  isReviewDue,
} from "./adaptive/scheduling";
import {
  adaptiveSessionCompletedAsPlanned,
  advanceAdaptiveSession,
  backgroundAdaptiveSession,
  createAdaptiveSession,
  finishAdaptiveSession,
  foregroundAdaptiveSession,
  pauseAdaptiveSession,
  pendingAttemptForSession,
  resumeAdaptiveSession,
  shortenAdaptiveSessionForFatigue,
  startAdaptiveSession,
  type AdaptiveSessionRuntime,
} from "./adaptive/session";
import { SKILL_DEFINITIONS } from "./adaptive/skills";
import type {
  AdaptiveSession,
  AdaptiveSessionPlan,
  AdaptiveSettings,
  AttemptEvent,
  CompletedSessionSummary,
  SessionKind,
} from "./adaptive/types";
import styles from "./adaptive-curriculum.module.css";

type AdaptiveView = "home" | "session" | "summary";
type NumericInputMode = "type" | "draw";

type AnswerEvidence = Readonly<{
  rawAnswer: unknown;
  rawValue: string | null;
  submittedAt: number;
  firstInkAt: number | null;
  recognitionConfidence: number | null;
  recognitionMargin: number | null;
  recognitionConfirmedByChild: boolean;
  recognizerCorrection: boolean;
  correctionCount: number;
}>;

type FeedbackState = Readonly<{
  correct: boolean;
  message: string;
  event: AttemptEvent;
}>;

type Props = Readonly<{
  profileId: string;
  soundEnabled: boolean;
  onFeedback(correct: boolean): void;
  onExit(): void;
}>;

function terminal(session: AdaptiveSessionRuntime): boolean {
  return (
    session.phase === "complete" ||
    session.phase === "ended_early_for_fatigue"
  );
}

function runtimePlan(session: AdaptiveSessionRuntime): AdaptiveSessionPlan {
  return {
    id: session.id,
    learnerId: session.learnerId,
    kind: session.kind,
    seed: session.seed,
    createdAt: session.createdAt,
    targetCardCount: session.targetCardCount,
    maxActiveDurationMs: session.maxActiveDurationMs,
    focusSkillId: session.focusSkillId,
    cards: session.cards,
  };
}

function hasRuntimeFields(
  session: AdaptiveSubtractionProgress["activeSession"],
): session is AdaptiveSessionRuntime {
  if (!session) return false;
  const value = session as Partial<AdaptiveSessionRuntime>;
  return (
    (value.activeSince === null || typeof value.activeSince === "number") &&
    Array.isArray(value.pauseReasons) &&
    (value.phaseBeforePause === null ||
      typeof value.phaseBeforePause === "string") &&
    (value.backgroundedAt === null ||
      typeof value.backgroundedAt === "number")
  );
}

function hydrateStoredSession(
  progress: AdaptiveSubtractionProgress,
): AdaptiveSessionRuntime | null {
  const stored = progress.activeSession;
  if (!stored) return null;
  const baseSession: AdaptiveSession = stored;
  const runtime: AdaptiveSessionRuntime = hasRuntimeFields(stored)
    ? stored
    : {
        ...baseSession,
        activeSince: null,
        pauseReasons: [],
        phaseBeforePause: null,
        backgroundedAt: null,
      };
  if (terminal(runtime)) return null;
  if (runtime.pauseReasons.includes("background")) return runtime;
  return backgroundAdaptiveSession(
    runtime,
    Math.max(progress.updatedAt, runtime.activeSince ?? 0),
  );
}

function recentFatigueCount(progress: AdaptiveSubtractionProgress): number {
  return progress.completedSessions
    .slice(-2)
    .filter(({ endedEarlyForFatigue }) => endedEarlyForFatigue).length;
}

function laneName(
  kind: SessionKind,
  lane: AdaptiveSessionRuntime["cards"][number]["lane"],
): string {
  if (kind === "benchmark") return "Short practice";
  switch (lane) {
    case "diagnostic":
      return "Finding your next step";
    case "warmup":
      return "Warm-up";
    case "focus":
      return "One useful step";
    case "integration":
      return "Whole problem";
    case "review":
      return "Quick review";
    case "transfer":
      return "Challenge";
    case "easy_close":
      return "Finish strong";
  }
}

function feedbackMessage(
  event: AttemptEvent,
  sessionKind?: SessionKind,
): string {
  if (event.firstAttemptCorrect) {
    if (event.skillId === "R01") {
      return "You noticed whether a trade was needed.";
    }
    if (event.skillId === "R02" || event.skillId === "R04") {
      return "You kept track of the traded ten.";
    }
    return "Ready for the next one.";
  }
  if (sessionKind === "benchmark") {
    return "That answer needs another look. Keep going with the set.";
  }
  if (
    event.errorCode === "fact_retrieval_error" ||
    event.errorCode === "ones_digit_error"
  ) {
    return "Let’s check one small part next.";
  }
  if (
    event.errorCode === "regrouped_state_lost" ||
    event.errorCode === "forgot_to_decrement_tens" ||
    event.errorCode === "tens_digit_error"
  ) {
    return "Let’s look at the trade step.";
  }
  return "That answer needs another look. We’ll check one part next.";
}

function pendingFeedbackForSession(
  progress: AdaptiveSubtractionProgress,
  session: AdaptiveSessionRuntime,
): FeedbackState | null {
  const problemId = session.currentProblem?.id;
  if (!problemId) return null;
  const event = pendingAttemptForSession(session, progress.attemptEvents);
  return event
    ? {
        correct: event.firstAttemptCorrect,
        message: feedbackMessage(event, session.kind),
        event,
      }
    : null;
}

function sessionSummary(
  session: AdaptiveSessionRuntime,
  attempts: readonly AttemptEvent[],
  completedAsPlanned = true,
): CompletedSessionSummary {
  const sessionAttempts = attempts.filter(
    ({ sessionId }) => sessionId === session.id,
  );
  const answeredAttempts = sessionAttempts.filter(({ skipped }) => !skipped);
  return {
    sessionId: session.id,
    learnerId: session.learnerId,
    kind: session.kind,
    startedAt: session.startedAt ?? session.createdAt,
    completedAt: session.completedAt ?? Date.now(),
    activeDurationMs: session.activeElapsedMs,
    attemptedProblemCount: answeredAttempts.length,
    independentlyCorrectCount: answeredAttempts.filter(
      ({ independent, firstAttemptCorrect }) =>
        independent && firstAttemptCorrect,
    ).length,
    eventuallyCorrectCount: answeredAttempts.filter(
      (attempt) =>
        attemptWasEventuallyCorrect(attempt, sessionAttempts),
    ).length,
    focusSkillId: session.focusSkillId,
    endedEarlyForFatigue:
      session.phase === "ended_early_for_fatigue" || session.fatigueFlag,
    completedAsPlanned,
  };
}

export function AdaptiveSubtractionCurriculum({
  profileId,
  soundEnabled,
  onFeedback,
  onExit,
}: Props) {
  const profileStorage = useMemo(
    () => createBorrowFlashProfileStorage(profileId),
    [profileId],
  );
  const [progress, setProgress] =
    useState<AdaptiveSubtractionProgress | null>(null);
  const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] =
    useState<AdaptiveSubtractionLoadStatus>("empty");
  const [storageWritable, setStorageWritable] = useState(true);
  const [view, setView] = useState<AdaptiveView>("home");
  const [session, setSession] = useState<AdaptiveSessionRuntime | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [completedSummary, setCompletedSummary] =
    useState<CompletedSessionSummary | null>(null);
  const [inputMode, setInputMode] = useState<NumericInputMode>("type");
  const [typedValue, setTypedValue] = useState("");
  const [hintLevel, setHintLevel] = useState<0 | 1 | 2 | 3 | 4>(0);

  const progressRef = useRef<AdaptiveSubtractionProgress | null>(null);
  const sessionRef = useRef<AdaptiveSessionRuntime | null>(null);
  const storageWriteBlockedRef = useRef(false);
  const typedFirstInputAtRef = useRef<number | null>(null);
  const typedCorrectionCountRef = useRef(0);
  const rejectedRecognitionRef = useRef(false);
  const roundBackgroundedRef = useRef(false);
  const roundPauseUsedRef = useRef(false);
  const roundInterruptionMsRef = useRef(0);
  const roundBackgroundStartedAtRef = useRef<number | null>(null);
  const continueButtonRef = useRef<HTMLButtonElement | null>(null);
  const typedInputRef = useRef<HTMLInputElement | null>(null);
  const firstChoiceRef = useRef<HTMLButtonElement | null>(null);
  const resumeButtonRef = useRef<HTMLButtonElement | null>(null);
  const summaryHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const commitProgress = useCallback(
    (next: AdaptiveSubtractionProgress) => {
      progressRef.current = next;
      setProgress(next);
      if (storageWriteBlockedRef.current) return;
      if (!writeAdaptiveSubtractionProgress(next, profileStorage)) {
        setStorageWritable(false);
      }
    },
    [profileStorage],
  );

  const commitSession = useCallback(
    (
      nextSession: AdaptiveSessionRuntime | null,
      source = progressRef.current,
    ) => {
      sessionRef.current = nextSession;
      setSession(nextSession);
      if (!source) return;
      commitProgress(
        setActiveAdaptiveSession(source, nextSession, Date.now()),
      );
    },
    [commitProgress],
  );

  const resetRoundState = useCallback(() => {
    setInputMode("type");
    setTypedValue("");
    setHintLevel(0);
    setFeedback(null);
    typedFirstInputAtRef.current = null;
    typedCorrectionCountRef.current = 0;
    rejectedRecognitionRef.current = false;
    roundBackgroundedRef.current = false;
    roundPauseUsedRef.current = false;
    roundInterruptionMsRef.current = 0;
    roundBackgroundStartedAtRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    progressRef.current = null;
    sessionRef.current = null;
    storageWriteBlockedRef.current = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      setView("home");
      setCompletedSummary(null);
      resetRoundState();
      const loaded = loadAdaptiveSubtractionProgressDiagnostic(profileStorage);
      let next = loaded.progress;
      const states = deriveLearnerSkillStates(
        SKILL_DEFINITIONS,
        next.attemptEvents,
        next.skillStates,
      );
      next = replaceSkillStateCache(next, states, Date.now());
      storageWriteBlockedRef.current = loaded.status === "unsupported";
      progressRef.current = next;
      setProgress(next);
      setLoadedProfileId(profileId);
      setLoadStatus(loaded.status);
      setStorageWritable(
        loaded.status !== "unavailable" && loaded.status !== "unsupported",
      );
      const restored = hydrateStoredSession(next);
      sessionRef.current = restored;
      setSession(restored);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [profileId, profileStorage, resetRoundState]);

  useEffect(() => {
    const problemId = session?.currentProblem?.id;
    const answerKind = session?.currentProblem?.answerSpec.kind;
    if (
      view !== "session" ||
      session?.phase === "paused" ||
      feedback ||
      !problemId
    ) return;
    const frame = requestAnimationFrame(() => {
      if (answerKind === "numeric" && inputMode === "type") {
        typedInputRef.current?.focus();
      } else {
        firstChoiceRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [
    session?.currentProblem?.answerSpec.kind,
    session?.currentProblem?.id,
    session?.phase,
    feedback,
    inputMode,
    view,
  ]);

  useEffect(() => {
    if (!feedback) return;
    const frame = requestAnimationFrame(() => {
      continueButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [feedback]);

  useEffect(() => {
    if (session?.phase !== "paused") return;
    const frame = requestAnimationFrame(() => resumeButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [session?.phase]);

  useEffect(() => {
    if (view !== "summary" || !completedSummary) return;
    const frame = requestAnimationFrame(() => summaryHeadingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [completedSummary, view]);

  useEffect(() => {
    const transitionVisibility = (hidden: boolean) => {
      const active = sessionRef.current;
      if (!active || terminal(active) || active.phase === "not_started") return;
      const now = Date.now();
      if (hidden) {
        if (roundBackgroundStartedAtRef.current === null) {
          roundBackgroundStartedAtRef.current = now;
          roundBackgroundedRef.current = true;
        }
        commitSession(backgroundAdaptiveSession(active, now));
        return;
      }
      if (roundBackgroundStartedAtRef.current !== null) {
        roundInterruptionMsRef.current += Math.max(
          0,
          now - roundBackgroundStartedAtRef.current,
        );
        roundBackgroundStartedAtRef.current = null;
      }
      commitSession(foregroundAdaptiveSession(active, now));
    };
    const handleVisibility = () => transitionVisibility(document.hidden);
    const handlePageHide = () => transitionVisibility(true);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [commitSession]);

  const startSession = useCallback(
    (length: "short" | "standard", requestedKind?: "benchmark") => {
      const current = progressRef.current;
      if (!current) return;
      const now = Date.now();
      const diagnostic = requestedKind
        ? undefined
        : diagnosticSessionNumber(current);
      const kind: SessionKind = requestedKind
        ? "benchmark"
        : diagnostic
          ? "diagnostic"
          : "practice";
      const recentExclusions =
        kind === "benchmark"
          ? benchmarkRecentExclusions(current.attemptEvents, now).fingerprints
          : new Set(
              current.attemptEvents
                .slice(-48)
                .map(({ problemFingerprint }) => problemFingerprint),
            );
      const seed = [
        "adaptive-subtraction",
        current.learnerId,
        kind,
        current.completedSessions.length,
        current.attemptEvents.length,
      ].join(":");
      const plan = buildAdaptiveSessionPlan({
        learnerId: current.learnerId,
        seed,
        createdAt: now,
        skillStates: current.skillStates,
        attemptEvents: current.attemptEvents,
        recentFingerprints: [...recentExclusions],
        dueReviewSkillIds: dueSkillIds(current.reviewSchedule, now),
        sessionLength: length,
        ...(diagnostic ? { diagnosticSessionNumber: diagnostic } : {}),
        sessionKind: kind,
        optionalChallengeEnabled: current.settings.optionalChallengeEnabled,
        maxActiveDurationMs:
          length === "short"
            ? Math.min(current.settings.maxActiveDurationMs, 8 * 60 * 1_000)
            : current.settings.maxActiveDurationMs,
        recentFatigueSessionCount: recentFatigueCount(current),
      });
      const started = startAdaptiveSession(createAdaptiveSession(plan), now);
      const nextProgress = updateAdaptiveSettings(current, {
        targetCardCount: plan.targetCardCount,
        soundEnabled,
      });
      progressRef.current = nextProgress;
      setCompletedSummary(null);
      resetRoundState();
      setView("session");
      commitSession(started, nextProgress);
    },
    [commitSession, resetRoundState, soundEnabled],
  );

  const resumeStoredSession = useCallback(() => {
    let restored = sessionRef.current;
    const current = progressRef.current;
    if (!restored || !current) return;
    const now = Date.now();
    resetRoundState();
    if (restored.pauseReasons.includes("background")) {
      roundBackgroundedRef.current = true;
      const began = restored.backgroundedAt ?? now;
      roundInterruptionMsRef.current += Math.max(0, now - began);
      restored = foregroundAdaptiveSession(restored, now);
    }
    if (restored.pauseReasons.includes("explicit")) {
      roundPauseUsedRef.current = true;
      restored = resumeAdaptiveSession(restored, "explicit", now);
    }
    if (restored.activeSince === null && restored.phase !== "paused") {
      restored = { ...restored, activeSince: now };
    }
    setFeedback(pendingFeedbackForSession(current, restored));
    setView("session");
    commitSession(restored);
  }, [commitSession, resetRoundState]);

  const finishAndSummarize = useCallback(
    (
      finished: AdaptiveSessionRuntime,
      source = progressRef.current,
    ) => {
      if (!source) return;
      const completedAsPlanned = adaptiveSessionCompletedAsPlanned(finished);
      const summary = sessionSummary(
        finished,
        source.attemptEvents,
        completedAsPlanned,
      );
      let next = appendCompletedSessionSummary(source, summary);
      next = setActiveAdaptiveSession(next, null, summary.completedAt);
      commitProgress(next);
      sessionRef.current = finished;
      setSession(finished);
      setCompletedSummary(summary);
      setFeedback(null);
      setView("summary");
    },
    [commitProgress],
  );

  const recordReview = useCallback(
    (
      source: AdaptiveSubtractionProgress,
      event: AttemptEvent,
      lane: AdaptiveSessionRuntime["cards"][number]["lane"],
    ): AdaptiveSubtractionProgress => {
      if (lane !== "review") return source;
      const entry = source.reviewSchedule
        .filter(
          (candidate) =>
            candidate.skillId === event.skillId &&
            isReviewDue(candidate, event.submittedAt),
        )
        .sort((left, right) => left.dueAt - right.dueAt)[0];
      if (!entry) return source;
      const outcome = classifyReviewOutcome(
        event,
        source.attemptEvents,
      );
      const completed = completeReviewSchedule(
        entry,
        outcome,
        event.submittedAt,
        `${entry.id}:next:${event.submittedAt}`,
      );
      return upsertReviewScheduleEntry(
        upsertReviewScheduleEntry(source, completed.completed),
        completed.next,
      );
    },
    [],
  );

  const scheduleNewMasteryReviews = useCallback(
    (
      source: AdaptiveSubtractionProgress,
      previousStates: AdaptiveSubtractionProgress["skillStates"],
      event: AttemptEvent,
    ): AdaptiveSubtractionProgress => {
      let next = source;
      for (const skill of SKILL_DEFINITIONS) {
        const previous = previousStates[skill.id];
        const current = source.skillStates[skill.id];
        if (
          previous?.conceptStatus === "mastered" ||
          current?.conceptStatus !== "mastered" ||
          source.reviewSchedule.some(
            (entry) =>
              entry.skillId === skill.id && entry.status !== "completed",
          )
        ) {
          continue;
        }
        next = upsertReviewScheduleEntry(
          next,
          createReviewScheduleEntry({
            id: `${source.learnerId}:${skill.id}:review:${event.sessionId}`,
            learnerId: source.learnerId,
            skillId: skill.id,
            masteredAt: event.submittedAt,
            sourceSessionId: event.sessionId,
            sourceProblemId: event.problemId,
          }),
        );
      }
      return next;
    },
    [],
  );

  const submitEvidence = useCallback(
    (evidence: AnswerEvidence) => {
      const active = sessionRef.current;
      const currentProgress = progressRef.current;
      if (
        !active ||
        !currentProgress ||
        !active.currentProblem ||
        active.shownAt === null ||
        feedback
      ) {
        return;
      }
      const problem = active.currentProblem;
      const evaluation = evaluateProblemAnswer(problem, evidence.rawAnswer);
      if (evaluation.normalizedAnswer === null) return;
      const card = active.cards[active.currentCardIndex];
      if (!card) return;
      const errorCode = evaluation.correct
        ? null
        : classifyAdaptiveError({
            problem,
            answer: evaluation.normalizedAnswer,
            rawAnswerText: evidence.rawValue,
            recognitionConfirmedByChild:
              evidence.recognitionConfirmedByChild,
          });
      const currentHint = problem.hints.find(
        ({ level }) => level === hintLevel,
      );
      const remediationProbeCount = card.remediationForProblemId
        ? active.cards.filter(
            (candidate) =>
              candidate.remediationForProblemId ===
              card.remediationForProblemId,
          ).length
        : 0;
      const createdEvent = createAttemptEvent({
        learnerId: active.learnerId,
        sessionId: active.id,
        sessionPosition: active.currentCardIndex,
        sessionLane: card.lane,
        relatedProblemId:
          card.remediationForProblemId ?? card.delayedRetryForProblemId,
        relatedProblemRelation: card.remediationForProblemId
          ? "remediation_probe"
          : card.delayedRetryForProblemId
            ? "delayed_retry"
            : null,
        problem,
        shownAt: active.shownAt,
        firstInkAt: evidence.firstInkAt,
        submittedAt: evidence.submittedAt,
        answer: evaluation.normalizedAnswer,
        rawRecognizedValue: evidence.rawValue,
        recognitionConfidence: evidence.recognitionConfidence,
        recognitionMargin: evidence.recognitionMargin,
        recognitionConfirmedByChild:
          evidence.recognitionConfirmedByChild,
        recognizerCorrection: evidence.recognizerCorrection,
        firstAttemptCorrect: evaluation.correct,
        hintLevelUsed: hintLevel,
        correctionCount: evidence.correctionCount,
        pauseUsed: roundPauseUsedRef.current,
        workedAnswerVisible: currentHint?.answerRevealing ?? false,
        appWasBackgrounded: roundBackgroundedRef.current,
        interruptionDurationMs: roundInterruptionMsRef.current,
        errorCode,
        diagnosticProbeResult: card.remediationForProblemId
          ? {
              probeId: card.remediationForProblemId,
              outcome: evaluation.correct ? "pass" : "fail",
              expectedProbeCount: Math.max(1, remediationProbeCount),
            }
          : card.lane === "diagnostic"
            ? {
                probeId: problem.id,
                outcome: evaluation.correct ? "pass" : "fail",
                expectedProbeCount: 1,
              }
            : null,
      });

      const fatigue = detectSessionFatigue([
        ...currentProgress.attemptEvents.filter(
          ({ sessionId }) => sessionId === active.id,
        ),
        createdEvent,
      ]);
      const event: AttemptEvent =
        fatigue.fatigued && !createdEvent.firstAttemptCorrect
          ? {
              ...createdEvent,
              errorCode: "fatigue_related_error",
              diagnosticProbeResult: null,
            }
          : createdEvent;

      const previousStates = currentProgress.skillStates;
      let nextProgress = appendAttemptEvent(currentProgress, event);
      const nextStates = deriveLearnerSkillStates(
        SKILL_DEFINITIONS,
        nextProgress.attemptEvents,
        previousStates,
      );
      nextProgress = replaceSkillStateCache(
        nextProgress,
        nextStates,
        event.submittedAt,
      );
      nextProgress = recordReview(nextProgress, event, card.lane);
      nextProgress = scheduleNewMasteryReviews(
        nextProgress,
        previousStates,
        event,
      );

      let nextSession = active;
      if (
        !event.firstAttemptCorrect &&
        active.kind !== "benchmark" &&
        !fatigue.fatigued &&
        card.lane !== "easy_close"
      ) {
        const replanned = replanAfterAttempt({
          plan: runtimePlan(active),
          cardIndex: active.currentCardIndex,
          attempt: event,
          recentComparableAttempts: currentProgress.attemptEvents
            .filter(({ skillId }) => skillId === event.skillId)
            .slice(-5),
          recentFingerprints: currentProgress.attemptEvents
            .slice(-48)
            .map(({ problemFingerprint }) => problemFingerprint),
        });
        nextSession = {
          ...nextSession,
          cards: replanned.cards,
          targetCardCount: replanned.targetCardCount,
        };
      }

      if (fatigue.fatigued && card.lane !== "easy_close") {
        const easyClose = buildEasyCloseCard({
          learnerId: active.learnerId,
          seed: `${active.seed}:fatigue:${event.id}`,
          skillStates: nextProgress.skillStates,
          excludedFingerprints: nextSession.cards.map(
            ({ problem: plannedProblem }) => plannedProblem.fingerprint,
          ),
          cardIndex: active.currentCardIndex + 1,
        });
        nextSession = shortenAdaptiveSessionForFatigue(
          nextSession,
          easyClose,
        );
      }

      progressRef.current = nextProgress;
      setFeedback({
        correct: event.firstAttemptCorrect,
        message: feedbackMessage(event, active.kind),
        event,
      });
      onFeedback(event.firstAttemptCorrect);
      commitSession(nextSession, nextProgress);
    },
    [
      commitSession,
      feedback,
      hintLevel,
      onFeedback,
      recordReview,
      scheduleNewMasteryReviews,
    ],
  );

  const submitTypedAnswer = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!typedValue.trim()) return;
    submitEvidence({
      rawAnswer: typedValue,
      rawValue: typedValue,
      submittedAt: Date.now(),
      firstInkAt: typedFirstInputAtRef.current,
      recognitionConfidence: null,
      recognitionMargin: null,
      recognitionConfirmedByChild: false,
      recognizerCorrection: rejectedRecognitionRef.current,
      correctionCount: typedCorrectionCountRef.current,
    });
  };

  const submitHandwriting = useCallback(
    (answer: AdaptiveNumericAnswerSubmission) => {
      const current = progressRef.current;
      const active = sessionRef.current;
      if (!current || !active?.currentProblem) return;
      let next = current;
      const lowConfidence = answer.digitResults.some(
        ({ reliable }) => !reliable,
      );
      if (lowConfidence) {
        next = appendRecognitionEvent(
          next,
          createRecognitionEvent({
            kind: "recognition_confirmed",
            learnerId: active.learnerId,
            sessionId: active.id,
            problemId: active.currentProblem.id,
            occurredAt: answer.submittedAt,
            rawRecognizedValue: answer.rawValue,
            normalizedRecognizedValue: answer.value,
            recognitionConfidence: answer.recognitionConfidence,
            recognitionMargin: answer.recognitionMargin,
            confirmedByChild: true,
          }),
        );
        progressRef.current = next;
        setProgress(next);
      }
      submitEvidence({
        rawAnswer: answer.value,
        rawValue: answer.rawValue,
        submittedAt: answer.submittedAt,
        firstInkAt: answer.firstInkAt,
        recognitionConfidence: answer.recognitionConfidence,
        recognitionMargin: answer.recognitionMargin,
        recognitionConfirmedByChild:
          answer.recognitionConfirmedByChild ?? false,
        recognizerCorrection:
          rejectedRecognitionRef.current || answer.correctionCount > 0,
        correctionCount: answer.correctionCount,
      });
    },
    [submitEvidence],
  );

  const rejectRecognition = useCallback(
    (rejected: AdaptiveRejectedRecognition) => {
      const current = progressRef.current;
      const active = sessionRef.current;
      if (!current || !active?.currentProblem) return;
      rejectedRecognitionRef.current = true;
      const minimumConfidence = Math.min(
        ...rejected.digitResults.map(({ confidence }) => confidence),
      );
      const minimumMargin = Math.min(
        ...rejected.digitResults.map(({ margin }) => margin),
      );
      const next = appendRecognitionEvent(
        current,
        createRecognitionEvent({
          kind: "recognition_corrected",
          learnerId: active.learnerId,
          sessionId: active.id,
          problemId: active.currentProblem.id,
          occurredAt: rejected.rejectedAt,
          rawRecognizedValue: rejected.rawValue,
          normalizedRecognizedValue: rejected.value,
          recognitionConfidence: minimumConfidence,
          recognitionMargin: minimumMargin,
          confirmedByChild: false,
        }),
      );
      commitProgress(next);
    },
    [commitProgress],
  );

  const continueSession = useCallback(() => {
    const active = sessionRef.current;
    if (!active || !feedback) return;
    const advanced = advanceAdaptiveSession(active, Date.now());
    if (terminal(advanced)) {
      finishAndSummarize(advanced);
      return;
    }
    resetRoundState();
    commitSession(advanced);
  }, [commitSession, feedback, finishAndSummarize, resetRoundState]);

  const pauseSession = useCallback(() => {
    const active = sessionRef.current;
    if (!active) return;
    roundPauseUsedRef.current = true;
    commitSession(pauseAdaptiveSession(active, "explicit", Date.now()));
  }, [commitSession]);

  const resumeSession = useCallback(() => {
    const active = sessionRef.current;
    if (!active) return;
    commitSession(resumeAdaptiveSession(active, "explicit", Date.now()));
  }, [commitSession]);

  const endForNow = useCallback(() => {
    const active = sessionRef.current;
    let current = progressRef.current;
    if (!active || !current) return;
    const now = Date.now();
    if (
      active.currentProblem &&
      active.shownAt !== null &&
      pendingFeedbackForSession(current, active) === null
    ) {
      current = appendAttemptEvent(
        current,
        createAttemptEvent({
          learnerId: active.learnerId,
          sessionId: active.id,
          sessionPosition: active.currentCardIndex,
          sessionLane:
            active.cards[active.currentCardIndex]?.lane ?? "easy_close",
          relatedProblemId:
            active.cards[active.currentCardIndex]?.remediationForProblemId ??
            active.cards[active.currentCardIndex]?.delayedRetryForProblemId ??
            null,
          relatedProblemRelation: active.cards[active.currentCardIndex]
            ?.remediationForProblemId
            ? "remediation_probe"
            : active.cards[active.currentCardIndex]?.delayedRetryForProblemId
              ? "delayed_retry"
              : null,
          problem: active.currentProblem,
          shownAt: active.shownAt,
          firstInkAt: typedFirstInputAtRef.current,
          submittedAt: now,
          answer: null,
          rawRecognizedValue: null,
          recognitionConfidence: null,
          recognitionMargin: null,
          recognitionConfirmedByChild: false,
          recognizerCorrection: false,
          firstAttemptCorrect: false,
          eventuallyCorrect: false,
          hintLevelUsed: hintLevel,
          correctionCount: typedCorrectionCountRef.current,
          skipped: true,
          pauseUsed: true,
          workedAnswerVisible: false,
          appWasBackgrounded: roundBackgroundedRef.current,
          interruptionDurationMs: roundInterruptionMsRef.current,
          errorCode: null,
          diagnosticProbeResult: null,
        }),
      );
    }
    const finished = finishAdaptiveSession(active, now);
    finishAndSummarize(finished, current);
  }, [finishAndSummarize, hintLevel]);

  const changeSettings = useCallback(
    (changes: Partial<AdaptiveSettings>) => {
      const current = progressRef.current;
      if (!current) return;
      commitProgress(updateAdaptiveSettings(current, changes));
    },
    [commitProgress],
  );

  const currentCard = session?.cards[session.currentCardIndex] ?? null;
  const problem = session?.currentProblem ?? null;
  const currentHint = problem?.hints.find(({ level }) => level === hintLevel);
  const drawAvailable = problem?.answerSpec.kind === "numeric";
  const completedCards = session?.cards.filter(
    ({ status }) => status === "completed",
  ).length ?? 0;
  const progressValue = feedback ? completedCards + 1 : completedCards;

  const activeSessionAttempts = useMemo(() => {
    if (!progress || !completedSummary) return [];
    return progress.attemptEvents.filter(
      ({ sessionId }) => sessionId === completedSummary.sessionId,
    );
  }, [completedSummary, progress]);

  if (!progress || loadedProfileId !== profileId) {
    return (
      <section className={styles.loading} aria-live="polite">
        <p>Preparing a short practice…</p>
      </section>
    );
  }

  if (view === "home") {
    const nextDiagnostic = diagnosticSessionNumber(progress);
    return (
      <section className={styles.chooser} aria-labelledby="adaptive-heading">
        <header className={styles.chooserHeader}>
          <span className={styles.kicker}>
            {nextDiagnostic ? "A gentle starting check" : "Adaptive practice"}
          </span>
          <h2 id="adaptive-heading">
            {nextDiagnostic ? "Find the next useful step" : "A short plan for today"}
          </h2>
          <p>
            The cards change when one small step needs attention. The session
            is finite, and there is no countdown.
          </p>
        </header>

        <div className={styles.choiceGrid}>
          {session && !terminal(session) ? (
            <button
              className={styles.choiceCard}
              data-primary="true"
              type="button"
              onClick={resumeStoredSession}
            >
              <strong>Continue this session</strong>
              <span>
                Resume card {session.currentCardIndex + 1} of{" "}
                {session.targetCardCount}
              </span>
            </button>
          ) : (
            <button
              className={styles.choiceCard}
              data-primary="true"
              type="button"
              onClick={() => startSession("standard")}
            >
              <strong>Standard session</strong>
              <span>About 10 varied cards with a clear finish</span>
            </button>
          )}
          <button
            className={styles.choiceCard}
            type="button"
            disabled={Boolean(session && !terminal(session))}
            onClick={() => startSession("short")}
          >
            <strong>Short session</strong>
            <span>Eight cards, with the same adaptive plan</span>
          </button>
        </div>

        <AdaptiveParentReport
          progress={progress}
          sessionActive={Boolean(session && !terminal(session))}
          onStartBenchmark={() => startSession("short", "benchmark")}
          onSettingsChange={changeSettings}
        />

        {!storageWritable ||
        loadStatus === "corrupt" ||
        loadStatus === "unsupported" ? (
          <p className={styles.parentNote} role="status">
            {loadStatus === "unsupported"
              ? "Saved practice comes from a newer version and has been left unchanged. This tab can still run a fresh session."
              : loadStatus === "corrupt"
              ? "Saved practice could not be restored, so this starts fresh."
              : "Practice works in this tab, but this browser is not saving progress."}
          </p>
        ) : null}

        <button className={styles.secondaryButton} type="button" onClick={onExit}>
          Back to Borrow Flash runs
        </button>
      </section>
    );
  }

  if (view === "summary" && completedSummary) {
    const correct = activeSessionAttempts.filter(
      ({ firstAttemptCorrect }) => firstAttemptCorrect,
    ).length;
    const regroupingSolved = activeSessionAttempts.filter(
      (attempt) =>
        attempt.firstAttemptCorrect && attempt.metadata.requiresRegrouping,
    ).length;
    const hints = activeSessionAttempts.filter(
      ({ hintLevelUsed }) => hintLevelUsed > 0,
    ).length;
    return (
      <section className={styles.summary} aria-labelledby="adaptive-summary-heading">
        <header className={styles.summaryHeader}>
          <span className={styles.kicker}>
            {completedSummary.completedAsPlanned
              ? "Session complete"
              : "Stopped for now"}
          </span>
          <h2
            ref={summaryHeadingRef}
            id="adaptive-summary-heading"
            tabIndex={-1}
          >
            {completedSummary.completedAsPlanned
              ? "You reached today’s finish."
              : "You stopped at a good point."}
          </h2>
          <p>
            {!completedSummary.completedAsPlanned
              ? "There is no penalty and nothing is added to a backlog."
              : completedSummary.endedEarlyForFatigue
              ? "You finished at a good stopping point."
              : regroupingSolved > 0
                ? `You solved ${regroupingSolved} problem${regroupingSolved === 1 ? "" : "s"} that needed a trade.`
                : "You kept the subtraction steps organized through the session."}
          </p>
        </header>
        <dl className={styles.summaryStats}>
          <div>
            <dt>Cards practiced</dt>
            <dd>{completedSummary.attemptedProblemCount}</dd>
          </div>
          <div>
            <dt>Solved</dt>
            <dd>{correct}</dd>
          </div>
          <div>
            <dt>Hints used</dt>
            <dd>{hints}</dd>
          </div>
        </dl>
        <ul className={styles.summaryList}>
          {activeSessionAttempts.some(
            ({ skillId, firstAttemptCorrect }) =>
              skillId === "R01" && firstAttemptCorrect,
          ) ? (
            <li>You noticed when a trade was needed.</li>
          ) : null}
          {activeSessionAttempts.some(
            ({ skillId, firstAttemptCorrect }) =>
              (skillId === "R02" || skillId === "R04") &&
              firstAttemptCorrect,
          ) ? (
            <li>You kept track of the renamed tens and ones.</li>
          ) : null}
          <li>
            {completedSummary.completedAsPlanned
              ? "This session is finished. There is no extra backlog."
              : "This partial session is saved as finished, with no extra backlog."}
          </li>
        </ul>
        <div className={styles.summaryActions}>
          <button
            className={styles.primaryButton}
            type="button"
            onClick={() => {
              sessionRef.current = null;
              setSession(null);
              setCompletedSummary(null);
              setView("home");
            }}
          >
            Done
          </button>
          <button className={styles.secondaryButton} type="button" onClick={onExit}>
            Borrow Flash runs
          </button>
        </div>
        <AdaptiveParentReport
          progress={progress}
          sessionActive={false}
          onStartBenchmark={() => startSession("short", "benchmark")}
          onSettingsChange={changeSettings}
        />
      </section>
    );
  }

  if (!session || !problem || !currentCard) {
    return (
      <section className={styles.loading}>
        <p>Preparing the next card…</p>
      </section>
    );
  }

  if (session.phase === "paused") {
    return (
      <section className={styles.pauseOverlay} aria-labelledby="pause-heading">
        <span className={styles.kicker}>Paused</span>
        <h2 id="pause-heading">Take your time.</h2>
        <p>The card will be here when you’re ready.</p>
        <button
          ref={resumeButtonRef}
          className={styles.primaryButton}
          type="button"
          onClick={resumeSession}
        >
          Resume
        </button>
        <button className={styles.secondaryButton} type="button" onClick={endForNow}>
          End for now
        </button>
      </section>
    );
  }

  return (
    <section className={styles.session} aria-labelledby="adaptive-live-heading">
      <h2 className={styles.visuallyHidden} id="adaptive-live-heading">
        Adaptive subtraction practice
      </h2>
      <header className={styles.hud}>
        <div className={styles.progressBlock}>
          <div className={styles.progressText}>
            <strong>
              Card {Math.min(session.currentCardIndex + 1, session.targetCardCount)} of{" "}
              {session.targetCardCount}
            </strong>
            <span>{laneName(session.kind, currentCard.lane)}</span>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label="Adaptive session progress"
            aria-valuemin={0}
            aria-valuemax={session.targetCardCount}
            aria-valuenow={Math.min(progressValue, session.targetCardCount)}
          >
            <div
              className={styles.progressFill}
              style={{
                width: `${Math.min(
                  100,
                  (progressValue / session.targetCardCount) * 100,
                )}%`,
              }}
            />
          </div>
        </div>
        <div className={styles.hudActions}>
          <button
            className={styles.smallButton}
            type="button"
            disabled={Boolean(feedback) || hintLevel >= 4}
            onClick={() =>
              setHintLevel((level) =>
                Math.min(4, level + 1) as 1 | 2 | 3 | 4,
              )
            }
          >
            I need a hint
          </button>
          <button className={styles.smallButton} type="button" onClick={pauseSession}>
            Pause
          </button>
        </div>
      </header>

      <div className={styles.cardArea}>
        <span className={styles.laneLabel}>
          {laneName(session.kind, currentCard.lane)}
        </span>
        <AdaptiveProblemCard problem={problem} />
        {currentHint ? (
          <div className={styles.hintPanel} role="status">
            <strong>Hint {currentHint.level}</strong>
            <span>{currentHint.text}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.answerArea}>
        {feedback ? (
          <div
            className={styles.feedback}
            data-correct={feedback.correct}
            role="status"
            aria-live="polite"
          >
            <span className={styles.feedbackSymbol} aria-hidden="true">
              {feedback.correct ? "✓" : "!"}
            </span>
            <div className={styles.feedbackText}>
              <strong>{feedback.correct ? "Correct." : "Let’s check one part."}</strong>
              <span>{feedback.message}</span>
            </div>
            <button
              ref={continueButtonRef}
              className={styles.primaryButton}
              type="button"
              onClick={continueSession}
            >
              {session.currentCardIndex + 1 >= session.targetCardCount
                ? "Finish"
                : "Next"}
            </button>
          </div>
        ) : problem.answerSpec.kind === "two-choice" ? (
          <div className={styles.answerChoices}>
            {problem.promptSpec.kind === "two-choice"
              ? problem.promptSpec.choices.map((choice, index) => (
                  <button
                    ref={index === 0 ? firstChoiceRef : undefined}
                    className={styles.choiceAnswer}
                    type="button"
                    key={choice.value}
                    onClick={() =>
                      submitEvidence({
                        rawAnswer: choice.value,
                        rawValue: choice.value,
                        submittedAt: Date.now(),
                        firstInkAt: null,
                        recognitionConfidence: null,
                        recognitionMargin: null,
                        recognitionConfirmedByChild: false,
                        recognizerCorrection: false,
                        correctionCount: 0,
                      })
                    }
                  >
                    {choice.label}
                  </button>
                ))
              : null}
          </div>
        ) : (
          <>
            {drawAvailable ? (
              <nav className={styles.answerModes} aria-label="Answer input">
                <button
                  className={styles.modeButton}
                  type="button"
                  aria-pressed={inputMode === "type"}
                  onClick={() => setInputMode("type")}
                >
                  Type
                </button>
                <button
                  className={styles.modeButton}
                  type="button"
                  aria-pressed={inputMode === "draw"}
                  onClick={() => setInputMode("draw")}
                >
                  Draw
                </button>
              </nav>
            ) : null}
            {inputMode === "draw" && drawAvailable ? (
              <AdaptiveHandwritingInput
                key={problem.id}
                roundId={problem.id}
                autoFocus
                onAnswer={submitHandwriting}
                onRejectedRecognition={rejectRecognition}
                onFirstInk={(timestamp) => {
                  typedFirstInputAtRef.current = timestamp;
                }}
              />
            ) : (
              <form className={styles.numericForm} onSubmit={submitTypedAnswer}>
                <label className={styles.visuallyHidden} htmlFor="adaptive-number-answer">
                  Write the answer
                </label>
                <input
                  ref={typedInputRef}
                  className={styles.numericInput}
                  id="adaptive-number-answer"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  maxLength={3}
                  value={typedValue}
                  onChange={(event) => {
                    const next = event.currentTarget.value
                      .replace(/\D+/g, "")
                      .slice(0, 3);
                    if (next && typedFirstInputAtRef.current === null) {
                      typedFirstInputAtRef.current = Date.now();
                    }
                    if (
                      typedValue &&
                      next !== typedValue &&
                      (next.length <= typedValue.length ||
                        !next.startsWith(typedValue))
                    ) {
                      typedCorrectionCountRef.current += 1;
                    }
                    setTypedValue(next);
                  }}
                  aria-label="Numeric answer"
                />
                <button
                  className={styles.primaryButton}
                  type="submit"
                  disabled={!typedValue}
                >
                  Check answer
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export const ADAPTIVE_DEFAULT_LEARNER_ID = DEVICE_LEARNER_ID;
export const createUnsavedAdaptiveProgress =
  createEmptyAdaptiveSubtractionProgress;
