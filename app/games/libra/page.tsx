"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import { ProgressionGameHud } from "@/components/progression/ProgressionGameHud";
import {
  ProgressionRecoveryPanel,
  ProgressionRedemptionIntro,
} from "@/components/progression/ProgressionSessionPanels";
import {
  progressionOptionIndexFromAnswerToken,
  useProgressionGameSession,
} from "@/components/progression/useProgressionGameSession";
import { resolveProgressionQuestion } from "@/lib/progression/game-adapter";
import {
  AnswerLoad,
  BalanceScale,
  ExampleVisual,
  PuzzleVisual,
  StrategyLessonVisual,
  buildRoundAccentMap,
} from "./balance-visual";
import {
  CREATURE_NAMES,
  ROUNDS,
  describeExpression,
  generateInfiniteRound,
  optionFeedback,
  roundFingerprint,
  solutionStrategyFeedback,
  type Difficulty,
  type Round,
} from "./game-engine";
import { libraGame } from "./game-info";
import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
} from "./infinite-progression";
import {
  STRATEGY_CATALOGUE,
  STRATEGY_CATALOGUE_BY_ID,
  STRATEGY_SECTIONS,
  canOpenHistoricalReview,
  discoveredStrategyIdsAfterLesson,
  orderedStrategyIdsForRound,
  preRoundStrategyIds,
  unseenStrategyIds,
  type StrategyId,
} from "./strategy-curriculum";
import { progressionAdapter } from "./progression-adapter";
import styles from "./libra.module.css";

type GamePhase = "idle" | "animating" | "wrong-review" | "answered";
type SessionMode = "campaign" | "infinite" | "redemption";
type CampaignLevelId = "starter" | "junior" | "expert" | "wizard";
type CampaignMarker = "correct" | "incorrect";

type SessionRound = {
  id: string;
  ordinal: number;
  round: Round;
  campaign?: {
    levelId: CampaignLevelId;
    levelLabel: Difficulty;
    problemIndex: number;
  };
};

type MistakeRecord = {
  sessionRound: SessionRound;
  chosenIndex: number;
};

type CampaignProblemProgress = {
  solved: boolean;
  firstAttempt: CampaignMarker;
};

type CampaignProgress = Readonly<
  Record<string, CampaignProblemProgress | undefined>
>;

type CampaignCursors = Record<CampaignLevelId, number>;
type CustomProperties = CSSProperties & Record<`--${string}`, string>;
type StrategyLesson = {
  strategyId: StrategyId;
  focusTarget: "answers" | "next";
};
type CampaignReviewSelection = {
  levelId: CampaignLevelId;
  problemIndex: number;
};

const CORRECT_FEEDBACK_MS = 900;
const WRONG_APPROACH_MS = 540;
const HIDDEN_WRONG_APPROACH_MS = 160;
const WRONG_REVIEW_MS = 2200;
const REDUCED_FEEDBACK_MS = 140;
const REDUCED_WRONG_REVIEW_MS = 1300;
const CAMPAIGN_PROBLEMS_PER_LEVEL = 12;

const CAMPAIGN_LEVELS: ReadonlyArray<{
  id: CampaignLevelId;
  label: Difficulty;
}> = [
  { id: "starter", label: "Starter" },
  { id: "junior", label: "Junior" },
  { id: "expert", label: "Expert" },
  { id: "wizard", label: "Wizard" },
];

function progressionTargetHref(
  target: Readonly<{
    pathname: string;
    query?: Readonly<Record<string, string>>;
  }>,
): string {
  const query = new URLSearchParams(target.query).toString();
  return query ? `${target.pathname}?${query}` : target.pathname;
}

function progressionLevelLabel(level: string): string {
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}

function initialCampaignCursors(): CampaignCursors {
  return {
    starter: 0,
    junior: 0,
    expert: 0,
    wizard: 0,
  };
}

function campaignLevel(levelId: CampaignLevelId) {
  return (
    CAMPAIGN_LEVELS.find(({ id }) => id === levelId) ?? CAMPAIGN_LEVELS[0]
  );
}

function campaignRounds(levelId: CampaignLevelId): readonly Round[] {
  return ROUNDS.filter(
    (round) => round.difficulty === campaignLevel(levelId).label,
  );
}

function campaignRoundId(
  levelId: CampaignLevelId,
  problemIndex: number,
): string {
  return `campaign-${levelId}-${problemIndex}`;
}

function buildCampaignSessionRound(
  levelId: CampaignLevelId,
  problemIndex: number,
): SessionRound | null {
  const levelIndex = CAMPAIGN_LEVELS.findIndex(({ id }) => id === levelId);
  const round = campaignRounds(levelId)[problemIndex];
  if (!round) return null;

  return {
    id: campaignRoundId(levelId, problemIndex),
    ordinal: levelIndex * CAMPAIGN_PROBLEMS_PER_LEVEL + problemIndex + 1,
    round,
    campaign: {
      levelId,
      levelLabel: campaignLevel(levelId).label,
      problemIndex,
    },
  };
}

function isCampaignLevelComplete(
  progress: CampaignProgress,
  levelId: CampaignLevelId,
): boolean {
  return Array.from({ length: CAMPAIGN_PROBLEMS_PER_LEVEL }, (_, index) =>
    progress[campaignRoundId(levelId, index)]?.solved,
  ).every(Boolean);
}

function nextIncompleteCampaignLevel(
  progress: CampaignProgress,
  currentLevelId: CampaignLevelId,
): CampaignLevelId | null {
  const currentIndex = CAMPAIGN_LEVELS.findIndex(
    ({ id }) => id === currentLevelId,
  );

  for (let offset = 1; offset <= CAMPAIGN_LEVELS.length; offset += 1) {
    const candidate =
      CAMPAIGN_LEVELS[(currentIndex + offset) % CAMPAIGN_LEVELS.length].id;
    if (!isCampaignLevelComplete(progress, candidate)) return candidate;
  }

  return null;
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

function tryBuildInfiniteSessionRound(
  ordinal: number,
  seenFingerprints: ReadonlySet<string>,
  difficulty: Difficulty,
): { sessionRound: SessionRound; fingerprint: string } | null {
  try {
    const round = generateInfiniteRound(
      difficulty,
      Math.random,
      seenFingerprints,
    );
    const fingerprint = roundFingerprint(round);
    if (seenFingerprints.has(fingerprint)) return null;
    return {
      sessionRound: {
        id: `infinite-${ordinal}-${fingerprint}`,
        ordinal,
        round,
      },
      fingerprint,
    };
  } catch {
    return null;
  }
}

export default function LibraPage() {
  const router = useRouter();
  const progression = useProgressionGameSession(progressionAdapter);
  const [started, setStarted] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>("campaign");
  const [roundQueue, setRoundQueue] = useState<readonly SessionRound[]>([]);
  const [roundCursor, setRoundCursor] = useState(0);
  const [activeCampaignLevel, setActiveCampaignLevel] =
    useState<CampaignLevelId>("starter");
  const [campaignCursors, setCampaignCursors] = useState<CampaignCursors>(
    initialCampaignCursors,
  );
  const [campaignProgress, setCampaignProgress] = useState<CampaignProgress>(
    {},
  );
  const [infiniteAdaptive, setInfiniteAdaptive] = useState(
    initialInfiniteAdaptiveState,
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [complete, setComplete] = useState(false);
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [mistakes, setMistakes] = useState<readonly MistakeRecord[]>([]);
  const [retryReady, setRetryReady] = useState(false);
  const [redemptionTotal, setRedemptionTotal] = useState(0);
  const [reviewLevelId, setReviewLevelId] =
    useState<CampaignLevelId | null>(null);
  const [redeemedMistakeIds, setRedeemedMistakeIds] = useState<
    readonly string[]
  >([]);
  const [redemptionMistakeIds, setRedemptionMistakeIds] = useState<
    readonly string[]
  >([]);
  const [generationError, setGenerationError] = useState(false);
  const [discoveredStrategyIds, setDiscoveredStrategyIds] = useState<
    readonly StrategyId[]
  >([]);
  const [pendingLessons, setPendingLessons] = useState<
    readonly StrategyLesson[]
  >([]);
  const [replayStrategyId, setReplayStrategyId] =
    useState<StrategyId | null>(null);
  const [lessonReplayKey, setLessonReplayKey] = useState(0);
  const [proofReplayKey, setProofReplayKey] = useState(0);
  const [proofReplaying, setProofReplaying] = useState(false);
  const [catalogueExpanded, setCatalogueExpanded] = useState(false);
  const [campaignReviewSelection, setCampaignReviewSelection] =
    useState<CampaignReviewSelection | null>(null);

  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const levelCompleteButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const generationRetryRef = useRef<HTMLButtonElement>(null);
  const lessonDialogRef = useRef<HTMLDialogElement>(null);
  const lessonPrimaryButtonRef = useRef<HTMLButtonElement>(null);
  const historicalReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const campaignMarkerRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
  const catalogueButtonRefs = useRef<
    Partial<Record<StrategyId, HTMLButtonElement | null>>
  >({});
  const reviewOriginIdRef = useRef<string | null>(null);
  const replayOriginIdRef = useRef<StrategyId | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const proofReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const animationTokenRef = useRef(0);
  const inputLockedRef = useRef(false);
  const shouldFocusFirstOption = useRef(false);
  const retryFocusIndexRef = useRef<number | null>(null);
  const infiniteFingerprintsRef = useRef(new Set<string>());
  const infiniteAdaptiveRef = useRef(initialInfiniteAdaptiveState());
  const hydratedProgressionPlayIdRef = useRef<string | null>(null);

  const controlledSession =
    progression.mode === "controlled" ? progression : null;
  const progressionBooting = progression.mode === "booting";
  const hasStarted = controlledSession !== null || started;
  const isCampaign =
    controlledSession === null && sessionMode === "campaign";
  const isInfinite =
    controlledSession === null && sessionMode === "infinite";
  const isRedemption =
    controlledSession?.isRedemption ??
    (sessionMode === "redemption");
  const campaignProblemIndex = campaignCursors[activeCampaignLevel];
  const campaignSessionRound = buildCampaignSessionRound(
    activeCampaignLevel,
    campaignProblemIndex,
  );
  const controlledSessionRound: SessionRound | null =
    controlledSession?.current
      ? {
          id: controlledSession.current.playId,
          ordinal: controlledSession.currentQuestionNumber,
          round: controlledSession.current.round,
        }
      : null;
  const activeSessionRound = controlledSession
    ? controlledSessionRound
    : isCampaign
      ? campaignSessionRound
      : (roundQueue[roundCursor] ?? null);
  const round = activeSessionRound?.round ?? null;
  const activeLesson = pendingLessons[0] ?? null;
  const activeLessonStrategyId =
    replayStrategyId ?? activeLesson?.strategyId ?? null;
  const activeLessonStrategy = activeLessonStrategyId
    ? STRATEGY_CATALOGUE_BY_ID[activeLessonStrategyId]
    : null;
  const discoveredStrategyIdSet = new Set(discoveredStrategyIds);
  const historicalSessionRound = campaignReviewSelection
    ? buildCampaignSessionRound(
        campaignReviewSelection.levelId,
        campaignReviewSelection.problemIndex,
      )
    : null;
  const historicalProgress = historicalSessionRound
    ? campaignProgress[historicalSessionRound.id]
    : undefined;
  const historicalMistake = historicalSessionRound
    ? mistakes.find(
        ({ sessionRound }) =>
          sessionRound.id === historicalSessionRound.id,
      )
    : undefined;
  const sessionLength = roundQueue.length;
  const selectedCorrect =
    selectedIndex !== null &&
    round !== null &&
    selectedIndex === round.correctIndex;
  const selectedOption =
    selectedIndex !== null && round ? round.options[selectedIndex] : undefined;
  const progress = roundCursor + (phase === "answered" ? 1 : 0);
  const isLastRedemptionRound =
    isRedemption && roundCursor === sessionLength - 1;
  const campaignFirstTryScore = Object.values(campaignProgress).filter(
    (problem) => problem?.firstAttempt === "correct",
  ).length;
  const activeCampaignLevelComplete = isCampaignLevelComplete(
    campaignProgress,
    activeCampaignLevel,
  );
  const showCampaignLevelComplete =
    isCampaign &&
    activeCampaignLevelComplete &&
    phase === "idle" &&
    campaignReviewSelection === null;
  const nextCampaignLevel = nextIncompleteCampaignLevel(
    campaignProgress,
    activeCampaignLevel,
  );
  const redeemedMistakeIdSet = new Set(redeemedMistakeIds);
  const outstandingMistakes = mistakes.filter(
    ({ sessionRound }) => !redeemedMistakeIdSet.has(sessionRound.id),
  );
  const activeLevelMistakes = outstandingMistakes.filter(
    ({ sessionRound }) =>
      sessionRound.campaign?.levelId === activeCampaignLevel,
  );
  const visibleMistakes = reviewLevelId
    ? outstandingMistakes.filter(
        ({ sessionRound }) =>
          sessionRound.campaign?.levelId === reviewLevelId,
      )
    : outstandingMistakes;
  const reviewLevelFirstTryScore = reviewLevelId
    ? Array.from(
        { length: CAMPAIGN_PROBLEMS_PER_LEVEL },
        (_, problemIndex) =>
          campaignProgress[campaignRoundId(reviewLevelId, problemIndex)]
            ?.firstAttempt === "correct",
      ).filter(Boolean).length
    : 0;
  const infiniteEnergy = comboEnergyPercent(infiniteAdaptive.combo);
  const infiniteSupercharged =
    infiniteAdaptive.combo >= MAX_ENERGY_COMBO;

  const clearAttemptTimers = useCallback(() => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    if (reviewTimerRef.current) {
      clearTimeout(reviewTimerRef.current);
      reviewTimerRef.current = null;
    }
  }, []);

  const resetAttemptState = useCallback(() => {
    animationTokenRef.current += 1;
    clearAttemptTimers();
    if (proofReplayTimerRef.current) {
      clearTimeout(proofReplayTimerRef.current);
      proofReplayTimerRef.current = null;
    }
    inputLockedRef.current = false;
    retryFocusIndexRef.current = null;
    setSelectedIndex(null);
    setRetryReady(false);
    setProofReplaying(false);
    setPhase("idle");
  }, [clearAttemptTimers]);

  const queueStrategyLessons = useCallback(
    (
      strategyIds: readonly StrategyId[],
      focusTarget: StrategyLesson["focusTarget"],
    ) => {
      setPendingLessons((current) => {
        const additions = unseenStrategyIds(
          discoveredStrategyIds,
          current.map(({ strategyId }) => strategyId),
          strategyIds,
        ).map((strategyId) => ({ strategyId, focusTarget }));
        return additions.length > 0 ? [...current, ...additions] : current;
      });
    },
    [discoveredStrategyIds],
  );

  const closeActiveLesson = useCallback(() => {
    if (replayStrategyId) {
      const originId = replayOriginIdRef.current;
      setReplayStrategyId(null);
      window.requestAnimationFrame(() => {
        if (originId) catalogueButtonRefs.current[originId]?.focus();
      });
      return;
    }

    if (!activeLesson) return;
    setDiscoveredStrategyIds((current) =>
      discoveredStrategyIdsAfterLesson(current, activeLesson.strategyId),
    );
    setPendingLessons((current) => current.slice(1));
  }, [activeLesson, replayStrategyId]);

  const replayStrategyLesson = useCallback((strategyId: StrategyId) => {
    if (
      phase === "animating" ||
      phase === "wrong-review" ||
      pendingLessons.length > 0
    ) {
      return;
    }
    replayOriginIdRef.current = strategyId;
    setLessonReplayKey((current) => current + 1);
    setReplayStrategyId(strategyId);
  }, [pendingLessons.length, phase]);

  const openCampaignReview = useCallback(
    (levelId: CampaignLevelId, problemIndex: number) => {
      const id = campaignRoundId(levelId, problemIndex);
      if (
        !canOpenHistoricalReview({
          isIdle: phase === "idle",
          isSolved: Boolean(campaignProgress[id]?.solved),
          hasPendingLessons: pendingLessons.length > 0,
          isReplayingLesson: replayStrategyId !== null,
        })
      ) {
        return;
      }
      reviewOriginIdRef.current = id;
      setCampaignReviewSelection({ levelId, problemIndex });
      setProofReplayKey((current) => current + 1);
    },
    [
      campaignProgress,
      pendingLessons.length,
      phase,
      replayStrategyId,
    ],
  );

  const closeCampaignReview = useCallback(() => {
    const originId = reviewOriginIdRef.current;
    setCampaignReviewSelection(null);
    window.requestAnimationFrame(() => {
      if (originId) campaignMarkerRefs.current[originId]?.focus();
    });
  }, []);

  const replayProof = useCallback(() => {
    if (proofReplayTimerRef.current) {
      clearTimeout(proofReplayTimerRef.current);
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setProofReplayKey((current) => current + 1);
    setProofReplaying(true);
    proofReplayTimerRef.current = setTimeout(
      () => {
        setProofReplaying(false);
        proofReplayTimerRef.current = null;
      },
      reducedMotion ? REDUCED_FEEDBACK_MS : 1500,
    );
  }, []);

  const ensureAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;

    const AudioContextClass =
      window.AudioContext ??
      (
        window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }
      ).webkitAudioContext;

    if (!AudioContextClass) return null;
    if (
      audioContextRef.current === null ||
      audioContextRef.current.state === "closed"
    ) {
      try {
        audioContextRef.current = new AudioContextClass();
      } catch {
        return null;
      }
    }
    return audioContextRef.current;
  }, []);

  const resumeAudio = useCallback(() => {
    const context = ensureAudioContext();
    if (!context || context.state !== "suspended") return;
    void context.resume().catch(() => undefined);
  }, [ensureAudioContext]);

  const playFeedbackSound = useCallback(
    (correct: boolean) => {
      if (!soundEnabled) return;
      const context = ensureAudioContext();
      if (!context) return;

      if (context.state === "suspended") {
        void context
          .resume()
          .then(() => playFeedbackEarcon(context, correct))
          .catch(() => undefined);
        return;
      }

      if (context.state === "running") playFeedbackEarcon(context, correct);
    },
    [ensureAudioContext, soundEnabled],
  );

  const chooseOption = useCallback(
    (optionIndex: number) => {
      if (
        inputLockedRef.current ||
        phase !== "idle" ||
        complete ||
        !hasStarted ||
        generationError ||
        !round ||
        !activeSessionRound ||
        activeLessonStrategyId !== null ||
        campaignReviewSelection !== null ||
        (isCampaign && activeCampaignLevelComplete)
      ) {
        return;
      }

      const option = round.options[optionIndex];
      if (!option) return;

      inputLockedRef.current = true;
      setRetryReady(false);
      const isCorrect = optionIndex === round.correctIndex;
      controlledSession?.answer({
        correct: isCorrect,
        answerToken: `option-${optionIndex}`,
      });
      setSelectedIndex(optionIndex);
      setPhase("animating");
      const wasMissed = mistakes.some(
        ({ sessionRound }) => sessionRound.id === activeSessionRound.id,
      );
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      playFeedbackSound(isCorrect);

      if (isCampaign) {
        setCampaignProgress((current) => {
          const existing = current[activeSessionRound.id];
          return {
            ...current,
            [activeSessionRound.id]: {
              solved: Boolean(existing?.solved || isCorrect),
              firstAttempt:
                existing?.firstAttempt ??
                (isCorrect ? "correct" : "incorrect"),
            },
          };
        });
      }

      if (isInfinite) {
        const nextAdaptive = recordInfiniteFirstAttempt(
          infiniteAdaptiveRef.current,
          {
            roundId: activeSessionRound.id,
            difficulty: round.difficulty,
            firstTryCorrect: isCorrect,
          },
        );
        if (nextAdaptive !== infiniteAdaptiveRef.current) {
          infiniteAdaptiveRef.current = nextAdaptive;
          setInfiniteAdaptive(nextAdaptive);
        }
      }

      if (!controlledSession) {
        if (isCorrect) {
          if (!isRedemption && !wasMissed) {
            setScore((current) => current + 1);
          }
          setCompletedCount((current) => current + 1);
        } else if (!isRedemption) {
          setMistakes((current) =>
            current.some(
              ({ sessionRound }) => sessionRound.id === activeSessionRound.id,
            )
              ? current
              : [
                  ...current,
                  { sessionRound: activeSessionRound, chosenIndex: optionIndex },
                ],
          );
        }
      }

      const token = animationTokenRef.current + 1;
      animationTokenRef.current = token;
      clearAttemptTimers();
      const approachDuration = reducedMotion
        ? REDUCED_FEEDBACK_MS
        : isCorrect
          ? CORRECT_FEEDBACK_MS
          : round.feedbackPolicy === "preserve-inference"
            ? HIDDEN_WRONG_APPROACH_MS
            : WRONG_APPROACH_MS;

      feedbackTimerRef.current = setTimeout(() => {
        if (animationTokenRef.current !== token) return;

        if (isCorrect) {
          setPhase("answered");
          queueStrategyLessons(
            orderedStrategyIdsForRound(round),
            "next",
          );
          return;
        }

        setPhase("wrong-review");
        reviewTimerRef.current = setTimeout(
          () => {
            if (animationTokenRef.current !== token) return;
            retryFocusIndexRef.current = optionIndex;
            inputLockedRef.current = false;
            setSelectedIndex(null);
            setRetryReady(true);
            setPhase("idle");
            controlledSession?.retry();
          },
          reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
        );
      }, approachDuration);
    },
    [
      activeCampaignLevelComplete,
      activeLessonStrategyId,
      activeSessionRound,
      campaignReviewSelection,
      clearAttemptTimers,
      complete,
      controlledSession,
      generationError,
      isCampaign,
      isInfinite,
      isRedemption,
      mistakes,
      phase,
      playFeedbackSound,
      queueStrategyLessons,
      round,
      hasStarted,
    ],
  );

  const startCampaign = useCallback(() => {
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    const initialRound = buildCampaignSessionRound("starter", 0)?.round;
    infiniteAdaptiveRef.current = initialAdaptive;
    setSessionMode("campaign");
    setRoundQueue([]);
    setRoundCursor(0);
    setActiveCampaignLevel("starter");
    setCampaignCursors(initialCampaignCursors());
    setCampaignProgress({});
    setInfiniteAdaptive(initialAdaptive);
    setScore(0);
    setCompletedCount(0);
    setMistakes([]);
    setRedemptionTotal(0);
    setReviewLevelId(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setGenerationError(false);
    setDiscoveredStrategyIds([]);
    setPendingLessons(
      initialRound
        ? preRoundStrategyIds(initialRound).map((strategyId) => ({
            strategyId,
            focusTarget: "answers" as const,
          }))
        : [],
    );
    setReplayStrategyId(null);
    setCatalogueExpanded(false);
    setCampaignReviewSelection(null);
    setStarted(true);
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, resumeAudio]);

  const startInfinite = useCallback(() => {
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    infiniteAdaptiveRef.current = initialAdaptive;
    const generated = tryBuildInfiniteSessionRound(
      1,
      infiniteFingerprintsRef.current,
      initialAdaptive.targetDifficulty,
    );
    if (generated) {
      infiniteFingerprintsRef.current.add(generated.fingerprint);
    }
    setSessionMode("infinite");
    setRoundQueue(generated ? [generated.sessionRound] : []);
    setRoundCursor(0);
    setInfiniteAdaptive(initialAdaptive);
    setScore(0);
    setCompletedCount(0);
    setMistakes([]);
    setRedemptionTotal(0);
    setReviewLevelId(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setGenerationError(!generated);
    setDiscoveredStrategyIds([]);
    setPendingLessons(
      generated
        ? preRoundStrategyIds(generated.sessionRound.round).map(
            (strategyId) => ({
              strategyId,
              focusTarget: "answers" as const,
            }),
          )
        : [],
    );
    setReplayStrategyId(null);
    setCatalogueExpanded(false);
    setCampaignReviewSelection(null);
    setStarted(true);
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = Boolean(generated);
  }, [resetAttemptState, resumeAudio]);

  const selectCampaignLevel = useCallback(
    (levelId: CampaignLevelId) => {
      if (
        !isCampaign ||
        phase !== "idle" ||
        levelId === activeCampaignLevel ||
        activeLessonStrategyId !== null ||
        campaignReviewSelection !== null
      ) {
        return;
      }

      resetAttemptState();
      setActiveCampaignLevel(levelId);
      const levelIsComplete = isCampaignLevelComplete(
        campaignProgress,
        levelId,
      );
      if (!levelIsComplete) {
        const nextRound = buildCampaignSessionRound(
          levelId,
          campaignCursors[levelId],
        );
        if (nextRound) {
          queueStrategyLessons(
            preRoundStrategyIds(nextRound.round),
            "answers",
          );
        }
      }
      shouldFocusFirstOption.current = !levelIsComplete;
    },
    [
      activeLessonStrategyId,
      activeCampaignLevel,
      campaignCursors,
      campaignProgress,
      campaignReviewSelection,
      isCampaign,
      phase,
      queueStrategyLessons,
      resetAttemptState,
    ],
  );

  const startRedemption = useCallback(() => {
    if (visibleMistakes.length === 0) return;
    const redemptionQueue = visibleMistakes.map(({ sessionRound }, index) => ({
      ...sessionRound,
      id: `redemption-${index}-${sessionRound.id}`,
      ordinal: index + 1,
    }));
    setRedemptionMistakeIds(
      visibleMistakes.map(({ sessionRound }) => sessionRound.id),
    );
    setSessionMode("redemption");
    setRoundQueue(redemptionQueue);
    setRoundCursor(0);
    setCompletedCount(0);
    setRedemptionTotal(redemptionQueue.length);
    setGenerationError(false);
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, visibleMistakes]);

  const goNext = useCallback(() => {
    if (
      phase !== "answered" ||
      activeLessonStrategyId !== null ||
      campaignReviewSelection !== null
    ) {
      return;
    }

    if (controlledSession) {
      resetAttemptState();
      controlledSession.advance();
      shouldFocusFirstOption.current = true;
      return;
    }

    if (isCampaign) {
      resetAttemptState();
      if (campaignProblemIndex < CAMPAIGN_PROBLEMS_PER_LEVEL - 1) {
        const nextProblemIndex = campaignProblemIndex + 1;
        const nextRound = buildCampaignSessionRound(
          activeCampaignLevel,
          nextProblemIndex,
        );
        if (nextRound) {
          queueStrategyLessons(
            preRoundStrategyIds(nextRound.round),
            "answers",
          );
        }
        shouldFocusFirstOption.current = true;
        setCampaignCursors((current) => ({
          ...current,
          [activeCampaignLevel]: nextProblemIndex,
        }));
      } else {
        shouldFocusFirstOption.current = false;
      }
      return;
    }

    if (isInfinite) {
      const nextOrdinal = (activeSessionRound?.ordinal ?? roundQueue.length) + 1;
      const generated = tryBuildInfiniteSessionRound(
        nextOrdinal,
        infiniteFingerprintsRef.current,
        infiniteAdaptiveRef.current.targetDifficulty,
      );
      if (!generated) {
        inputLockedRef.current = false;
        setGenerationError(true);
        setPhase("idle");
        return;
      }
      infiniteFingerprintsRef.current.add(generated.fingerprint);
      queueStrategyLessons(
        preRoundStrategyIds(generated.sessionRound.round),
        "answers",
      );
      shouldFocusFirstOption.current = true;
      resetAttemptState();
      setRoundQueue((current) => [...current, generated.sessionRound]);
      setRoundCursor((current) => current + 1);
      return;
    }

    if (isLastRedemptionRound) {
      resetAttemptState();
      if (reviewLevelId) {
        const redeemedLevelId = reviewLevelId;
        setRedeemedMistakeIds((current) => [
          ...new Set([...current, ...redemptionMistakeIds]),
        ]);
        setRedemptionMistakeIds([]);
        setReviewLevelId(null);
        setSessionMode("campaign");
        setRoundQueue([]);
        setRoundCursor(0);
        setRedemptionTotal(0);
        setActiveCampaignLevel(redeemedLevelId);
        setComplete(false);
        shouldFocusFirstOption.current = false;
        return;
      }

      setRedemptionMistakeIds([]);
      setComplete(true);
      return;
    }

    shouldFocusFirstOption.current = true;
    resetAttemptState();
    setRoundCursor((current) => current + 1);
  }, [
    activeCampaignLevel,
    activeLessonStrategyId,
    activeSessionRound?.ordinal,
    campaignReviewSelection,
    campaignProblemIndex,
    controlledSession,
    isCampaign,
    isInfinite,
    isLastRedemptionRound,
    phase,
    redemptionMistakeIds,
    reviewLevelId,
    queueStrategyLessons,
    resetAttemptState,
    roundQueue.length,
  ]);

  const retryInfiniteGeneration = useCallback(() => {
    const ordinal = roundQueue.length + 1;
    const generated = tryBuildInfiniteSessionRound(
      ordinal,
      infiniteFingerprintsRef.current,
      infiniteAdaptiveRef.current.targetDifficulty,
    );
    if (!generated) return;

    infiniteFingerprintsRef.current.add(generated.fingerprint);
    queueStrategyLessons(
      preRoundStrategyIds(generated.sessionRound.round),
      "answers",
    );
    setGenerationError(false);
    resetAttemptState();
    if (roundQueue.length === 0) {
      setRoundQueue([generated.sessionRound]);
      setRoundCursor(0);
    } else {
      setRoundQueue((current) => [...current, generated.sessionRound]);
      setRoundCursor((current) => current + 1);
    }
    shouldFocusFirstOption.current = true;
  }, [queueStrategyLessons, resetAttemptState, roundQueue.length]);

  const endInfinite = useCallback(() => {
    if (
      !isInfinite ||
      completedCount === 0 ||
      phase === "animating" ||
      phase === "wrong-review" ||
      activeLessonStrategyId !== null
    ) {
      return;
    }
    resetAttemptState();
    setGenerationError(false);
    setComplete(true);
  }, [
    activeLessonStrategyId,
    completedCount,
    isInfinite,
    phase,
    resetAttemptState,
  ]);

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeSoundPreference(next);
    if (next) resumeAudio();
  }, [resumeAudio, soundEnabled]);

  useEffect(() => {
    const storedPreference = readSoundPreference(["rotation-match-sound"]);
    if (storedPreference) return;
    const timer = window.setTimeout(() => setSoundEnabled(false), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (progression.mode !== "redirect") return;
    router.replace(progressionTargetHref(progression.navigationTarget));
  }, [progression, router]);

  useEffect(() => {
    if (!controlledSession) {
      hydratedProgressionPlayIdRef.current = null;
      return;
    }
    if (!controlledSession.current) {
      hydratedProgressionPlayIdRef.current = null;
      if (controlledSession.interactionState !== "blocked") {
        controlledSession.setInteractionState("blocked");
      }
      return;
    }
    const hydrationKey = `${controlledSession.attemptId}:${
      controlledSession.isRedemption ? "redemption" : "main"
    }:${controlledSession.current.playId}`;
    if (hydratedProgressionPlayIdRef.current === hydrationKey) return;
    const currentAttemptRound =
      controlledSession.attempt.currentRoundIndex === null
        ? undefined
        : controlledSession.attempt.rounds[
            controlledSession.attempt.currentRoundIndex
          ];
    const savedOptionIndex = progressionOptionIndexFromAnswerToken(
      controlledSession.lastAnswerToken,
    );
    const reconstructedStrategies = new Set<StrategyId>();
    for (const [
      attemptRoundIndex,
      attemptRound,
    ] of controlledSession.attempt.rounds.entries()) {
      if (
        attemptRound.question.gameSlug !== progressionAdapter.gameSlug ||
        attemptRound.phase !== "solved" ||
        (!controlledSession.isRedemption &&
          controlledSession.roundPhase === "solved" &&
          attemptRoundIndex ===
            controlledSession.attempt.currentRoundIndex)
      ) {
        continue;
      }
      try {
        const resolved = resolveProgressionQuestion(
          progressionAdapter,
          attemptRound.question,
        );
        for (const strategyId of orderedStrategyIdsForRound(resolved.round)) {
          reconstructedStrategies.add(strategyId);
        }
      } catch {
        // Stale-content recovery remains owned by the shared session.
      }
    }
    if (
      !controlledSession.isRedemption &&
      currentAttemptRound &&
      currentAttemptRound.attemptCount > 0
    ) {
      for (const strategyId of preRoundStrategyIds(
        controlledSession.current.round,
      )) {
        reconstructedStrategies.add(strategyId);
      }
    }
    const reconstructed = [...reconstructedStrategies];
    const currentRound = controlledSession.current.round;
    const hydrateTimer = window.setTimeout(() => {
      hydratedProgressionPlayIdRef.current = hydrationKey;
      resetAttemptState();
      setGenerationError(false);
      setCampaignReviewSelection(null);
      setReplayStrategyId(null);
      setDiscoveredStrategyIds(reconstructed);
      if (controlledSession.roundPhase === "solved") {
        setPendingLessons(
          controlledSession.isRedemption
            ? []
            : unseenStrategyIds(
                reconstructed,
                [],
                orderedStrategyIdsForRound(currentRound),
              ).map((strategyId) => ({
                strategyId,
                focusTarget: "next" as const,
              })),
        );
        inputLockedRef.current = true;
        setSelectedIndex(currentRound.correctIndex);
        setPhase("answered");
        return;
      }

      setPendingLessons(
        unseenStrategyIds(
          reconstructed,
          [],
          preRoundStrategyIds(currentRound),
        ).map((strategyId) => ({
          strategyId,
          focusTarget: "answers" as const,
        })),
      );
      if (
        controlledSession.roundPhase === "feedback" &&
        savedOptionIndex !== null &&
        savedOptionIndex < currentRound.options.length
      ) {
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        const animationToken = animationTokenRef.current;
        inputLockedRef.current = true;
        setSelectedIndex(savedOptionIndex);
        setRetryReady(false);
        setPhase("wrong-review");
        reviewTimerRef.current = setTimeout(
          () => {
            if (animationTokenRef.current !== animationToken) return;
            retryFocusIndexRef.current = savedOptionIndex;
            inputLockedRef.current = false;
            setSelectedIndex(null);
            setRetryReady(true);
            setPhase("idle");
            controlledSession.retry();
          },
          reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
        );
        return;
      }
      if (controlledSession.roundPhase === "feedback") {
        controlledSession.retry();
      }
      shouldFocusFirstOption.current = true;
      setRetryReady(controlledSession.currentAttemptCount > 0);
    }, 0);
    return () => window.clearTimeout(hydrateTimer);
  }, [
    controlledSession,
    resetAttemptState,
  ]);

  useEffect(() => {
    if (!controlledSession) return;
    if (
      !controlledSession.current ||
      activeLessonStrategyId !== null ||
      campaignReviewSelection !== null ||
      generationError
    ) {
      if (controlledSession.interactionState !== "blocked") {
        controlledSession.setInteractionState("blocked");
      }
      return;
    }
    const hydrationKey = `${controlledSession.attemptId}:${
      controlledSession.isRedemption ? "redemption" : "main"
    }:${controlledSession.current.playId}`;
    if (hydratedProgressionPlayIdRef.current !== hydrationKey) return;
    const nextInteractionState =
      controlledSession.roundPhase === "solved"
        ? "blocked"
        : controlledSession.roundPhase === "feedback"
          ? "mandatory-feedback"
          : phase === "idle" && !inputLockedRef.current
            ? "answering"
            : "mandatory-feedback";
    if (controlledSession.interactionState !== nextInteractionState) {
      controlledSession.setInteractionState(nextInteractionState);
    }
  }, [
    activeLessonStrategyId,
    campaignReviewSelection,
    controlledSession,
    generationError,
    phase,
  ]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        !hasStarted ||
        complete ||
        phase !== "idle" ||
        activeLessonStrategyId !== null ||
        campaignReviewSelection !== null ||
        isEditableShortcutTarget(event.target) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      const optionIndex = Number(event.key) - 1;
      if (optionIndex >= 0 && optionIndex < 4) {
        event.preventDefault();
        chooseOption(optionIndex);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeLessonStrategyId,
    campaignReviewSelection,
    chooseOption,
    complete,
    phase,
    hasStarted,
  ]);

  useEffect(() => {
    if (phase === "answered" && activeLessonStrategyId === null) {
      const frame = window.requestAnimationFrame(() => {
        nextButtonRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [activeLessonStrategyId, phase]);

  useEffect(() => {
    if (
      shouldFocusFirstOption.current &&
      hasStarted &&
      !complete &&
      !generationError &&
      activeLessonStrategyId === null &&
      campaignReviewSelection === null
    ) {
      const frame = window.requestAnimationFrame(() => {
        optionButtonRefs.current[0]?.focus();
        shouldFocusFirstOption.current = false;
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [
    activeCampaignLevel,
    activeLessonStrategyId,
    campaignReviewSelection,
    campaignProblemIndex,
    complete,
    generationError,
    roundCursor,
    sessionMode,
    hasStarted,
  ]);

  useEffect(() => {
    if (
      phase === "idle" &&
      retryReady &&
      retryFocusIndexRef.current !== null &&
      activeLessonStrategyId === null
    ) {
      optionButtonRefs.current[retryFocusIndexRef.current]?.focus();
      retryFocusIndexRef.current = null;
    }
  }, [activeLessonStrategyId, phase, retryReady]);

  useEffect(() => {
    if (complete) resultHeadingRef.current?.focus();
  }, [complete]);

  useEffect(() => {
    if (
      showCampaignLevelComplete &&
      activeLessonStrategyId === null
    ) {
      levelCompleteButtonRef.current?.focus();
    }
  }, [activeLessonStrategyId, showCampaignLevelComplete]);

  useEffect(() => {
    if (generationError) generationRetryRef.current?.focus();
  }, [generationError]);

  useEffect(() => {
    const dialog = lessonDialogRef.current;
    if (!dialog) return;

    if (activeLessonStrategyId && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
      const frame = window.requestAnimationFrame(() => {
        lessonPrimaryButtonRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    } else if (!activeLessonStrategyId && dialog.open) {
      dialog.close();
    }
  }, [activeLessonStrategyId]);

  useEffect(() => {
    if (campaignReviewSelection) {
      historicalReviewHeadingRef.current?.focus();
    }
  }, [campaignReviewSelection]);

  useEffect(() => {
    function finishFeedback() {
      if (!inputLockedRef.current) return;

      if (phase === "animating") {
        animationTokenRef.current += 1;
        clearAttemptTimers();
        if (selectedCorrect) {
          setPhase("answered");
          if (round) {
            queueStrategyLessons(
              orderedStrategyIdsForRound(round),
              "next",
            );
          }
        } else {
          retryFocusIndexRef.current = selectedIndex;
          inputLockedRef.current = false;
          setSelectedIndex(null);
          setRetryReady(true);
          setPhase("idle");
          controlledSession?.retry();
        }
      } else if (phase === "wrong-review") {
        animationTokenRef.current += 1;
        clearAttemptTimers();
        retryFocusIndexRef.current = selectedIndex;
        inputLockedRef.current = false;
        setSelectedIndex(null);
        setRetryReady(true);
        setPhase("idle");
        controlledSession?.retry();
      }
    }

    window.addEventListener("resize", finishFeedback);
    window.addEventListener("scroll", finishFeedback, true);
    return () => {
      window.removeEventListener("resize", finishFeedback);
      window.removeEventListener("scroll", finishFeedback, true);
    };
  }, [
    clearAttemptTimers,
    controlledSession,
    phase,
    queueStrategyLessons,
    round,
    selectedCorrect,
    selectedIndex,
  ]);

  useEffect(() => {
    return () => {
      animationTokenRef.current += 1;
      clearAttemptTimers();
      if (proofReplayTimerRef.current) {
        clearTimeout(proofReplayTimerRef.current);
      }
      const context = audioContextRef.current;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };
  }, [clearAttemptTimers]);

  const infiniteFirstTryScore = infiniteAdaptive.attempts.filter(
    ({ firstTryCorrect }) => firstTryCorrect,
  ).length;
  const firstTryScore = isCampaign
    ? campaignFirstTryScore
    : isInfinite
      ? infiniteFirstTryScore
      : score;
  const resultMessage = useMemo(() => {
    const denominator = isInfinite
      ? Math.max(infiniteAdaptive.attempts.length, 1)
      : ROUNDS.length;
    const accuracy = firstTryScore / denominator;
    if (accuracy === 1) return "Perfect set.";
    if (accuracy >= 0.7) return "Sharp work.";
    return "Good practice.";
  }, [firstTryScore, infiniteAdaptive.attempts.length, isInfinite]);

  const showRedemptionOffer =
    !isRedemption && visibleMistakes.length > 0;
  const resultTitle = isRedemption
    ? "Redemption complete."
    : showRedemptionOffer
      ? "Here’s your chance at redemption."
      : resultMessage;
  const displayedResultFirstTryScore = reviewLevelId
    ? reviewLevelFirstTryScore
    : firstTryScore;
  const resultDenominator = reviewLevelId
    ? CAMPAIGN_PROBLEMS_PER_LEVEL
    : isInfinite
      ? infiniteAdaptive.attempts.length
      : ROUNDS.length;
  const answerOutcome =
    phase === "answered"
      ? "correct"
      : (phase === "animating" || phase === "wrong-review") &&
          selectedIndex !== null &&
          !selectedCorrect
        ? round?.feedbackPolicy === "preserve-inference"
          ? undefined
          : "wrong"
        : selectedCorrect
          ? "correct"
          : undefined;
  const candidateOnGoal =
    selectedOption &&
    (selectedCorrect || round?.feedbackPolicy !== "preserve-inference")
      ? selectedOption
      : undefined;
  const wrongFeedback =
    round && selectedIndex !== null && !selectedCorrect
      ? optionFeedback(round, selectedIndex)
      : "";
  const activeStrategyIds = round
    ? orderedStrategyIdsForRound(round)
    : [];
  const activeRoundWasMissed = activeSessionRound
    ? mistakes.some(
        ({ sessionRound }) => sessionRound.id === activeSessionRound.id,
      )
    : false;
  const visibleActiveStrategyIds =
    round &&
    (round.difficulty === "Starter" ||
      round.difficulty === "Junior" ||
      (round.difficulty === "Expert" && activeRoundWasMissed))
      ? activeStrategyIds
      : [];

  const soundButton = (
    <button
      className={styles.soundButton}
      type="button"
      onClick={toggleSound}
      aria-pressed={soundEnabled}
      aria-label="Sound"
    >
      <span aria-hidden="true">♪</span>
      <small aria-hidden="true">{soundEnabled ? "On" : "Off"}</small>
    </button>
  );

  return (
    <div className={styles.pageShell}>
      <header className={styles.topbar}>
        <Link
          className={styles.backLink}
          href={controlledSession ? "/journey/" : "/"}
          aria-label={controlledSession ? "Journey map" : "All games"}
        >
          <span aria-hidden="true">←</span>
          <span>{controlledSession ? "Journey" : "Games"}</span>
        </Link>
        <span className={styles.gameTitle}>{libraGame.title}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {progression.mode === "recovery" ? (
          <ProgressionRecoveryPanel message={progression.message} />
        ) : progression.mode === "redirect" ? (
          <ProgressionRecoveryPanel message={progression.message} />
        ) : controlledSession?.stage === "redemption-ready" ? (
          <ProgressionRedemptionIntro
            attempt={controlledSession.attempt}
            onBegin={controlledSession.beginRedemption}
          />
        ) : !hasStarted ? (
          <section className={styles.tutorial} aria-labelledby="tutorial-title">
            <p className={styles.kicker}>Example</p>
            <h1 id="tutorial-title">Follow the balances.</h1>
            <div
              className={styles.exampleFrame}
              role="img"
              aria-label="One rabbit balances two chicks. Two rabbits correctly balance four chicks; three chicks are not enough."
            >
              <ExampleVisual />
            </div>
            <div className={styles.modeActions} aria-label="Choose a game mode">
              <button
                className={styles.primaryButton}
                type="button"
                onClick={startCampaign}
                disabled={progressionBooting}
              >
                Campaign
                <span aria-hidden="true">→</span>
              </button>
              <button
                className={styles.modeButton}
                type="button"
                onClick={startInfinite}
                disabled={progressionBooting}
              >
                <span aria-hidden="true">∞</span>
                Infinite
              </button>
            </div>
          </section>
        ) : !complete ? (
          <>
            {controlledSession ? (
              <ProgressionGameHud
                mode={controlledSession.runKind}
                levelLabel={progressionLevelLabel(controlledSession.level)}
                current={controlledSession.currentQuestionNumber}
                total={controlledSession.totalQuestions}
                remainingMs={
                  controlledSession.turboRemainingMs ?? undefined
                }
                paused={
                  controlledSession.interactionState !== "answering"
                }
                redemption={controlledSession.isRedemption}
              />
            ) : (
              <div
              className={`${styles.gameStatus} ${
                isCampaign ? styles.campaignStatus : ""
              }`}
              >
              {isCampaign ? (
                <nav
                  className={styles.campaignNavigator}
                  aria-label="Campaign progress"
                >
                  <div
                    className={styles.campaignLevels}
                    aria-label="Campaign levels"
                  >
                    {CAMPAIGN_LEVELS.map((level) => {
                      const levelComplete = isCampaignLevelComplete(
                        campaignProgress,
                        level.id,
                      );
                      const hasIncorrect = Array.from(
                        { length: CAMPAIGN_PROBLEMS_PER_LEVEL },
                        (_, index) =>
                          campaignProgress[campaignRoundId(level.id, index)]
                            ?.firstAttempt === "incorrect",
                      ).some(Boolean);
                      const levelState = hasIncorrect
                        ? "incorrect"
                        : levelComplete
                          ? "correct"
                          : "not done";

                      return (
                        <button
                          className={`${styles.campaignLevel} ${
                            levelState === "correct"
                              ? styles.campaignLevelCorrect
                              : levelState === "incorrect"
                                ? styles.campaignLevelIncorrect
                                : styles.campaignLevelNotDone
                          } ${
                            activeCampaignLevel === level.id
                              ? styles.campaignLevelActive
                              : ""
                          }`}
                          type="button"
                          aria-pressed={activeCampaignLevel === level.id}
                          aria-controls="libra-play-area"
                          aria-label={`${level.label}, ${levelState}`}
                          disabled={
                            phase !== "idle" ||
                            activeLessonStrategyId !== null ||
                            campaignReviewSelection !== null
                          }
                          onClick={() => selectCampaignLevel(level.id)}
                          key={level.id}
                        >
                          {level.label}
                        </button>
                      );
                    })}
                  </div>
                  <div
                    className={styles.campaignProblems}
                    role="group"
                    aria-label={`${campaignLevel(activeCampaignLevel).label} problems`}
                  >
                    {Array.from(
                      { length: CAMPAIGN_PROBLEMS_PER_LEVEL },
                      (_, problemIndex) => {
                        const problem =
                          campaignProgress[
                            campaignRoundId(
                              activeCampaignLevel,
                              problemIndex,
                            )
                          ];
                        const marker = problem?.firstAttempt ?? "not-done";
                        const isCurrent =
                          !activeCampaignLevelComplete &&
                          problemIndex === campaignProblemIndex;
                        const problemId = campaignRoundId(
                          activeCampaignLevel,
                          problemIndex,
                        );
                        const isReviewing =
                          campaignReviewSelection?.levelId ===
                            activeCampaignLevel &&
                          campaignReviewSelection.problemIndex ===
                            problemIndex;

                        return (
                          <button
                            className={`${styles.campaignProblem} ${
                              marker === "correct"
                                ? styles.campaignProblemCorrect
                                : marker === "incorrect"
                                  ? styles.campaignProblemIncorrect
                                  : styles.campaignProblemNotDone
                            } ${
                              isCurrent ? styles.campaignProblemCurrent : ""
                            }`}
                            type="button"
                            aria-label={`${campaignLevel(activeCampaignLevel).label} problem ${
                              problemIndex + 1
                            }: ${
                              marker === "not-done"
                                ? "not done"
                                : problem?.solved
                                  ? `${marker}; review completed problem`
                                  : `${marker}; finish problem before review`
                            }`}
                            aria-current={isCurrent ? "step" : undefined}
                            aria-pressed={isReviewing}
                            disabled={
                              !problem?.solved ||
                              phase !== "idle" ||
                              activeLessonStrategyId !== null
                            }
                            onClick={() =>
                              openCampaignReview(
                                activeCampaignLevel,
                                problemIndex,
                              )
                            }
                            ref={(node) => {
                              campaignMarkerRefs.current[problemId] = node;
                            }}
                            key={problemIndex}
                          />
                        );
                      },
                    )}
                  </div>
                </nav>
              ) : isInfinite ? (
                <div
                  className={`${styles.infiniteHud} ${
                    infiniteSupercharged ? styles.infiniteSupercharged : ""
                  }`}
                  role="group"
                  aria-label="Infinite combo energy"
                >
                  <span
                    className={styles.srStatus}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    Combo {infiniteAdaptive.combo}. Energy{" "}
                    {Math.round(infiniteEnergy)} percent.
                    {infiniteSupercharged ? " Maximum energy." : ""}
                  </span>
                  <div className={styles.infiniteHudLabels}>
                    <span>Combo {infiniteAdaptive.combo}</span>
                    <span>{infiniteSupercharged ? "Max" : "Energy"}</span>
                  </div>
                  <div
                    className={styles.energyTrack}
                    role="progressbar"
                    aria-label="Combo energy"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(infiniteEnergy)}
                  >
                    <span
                      className={styles.energyFill}
                      style={
                        {
                          "--energy-fill": `${infiniteEnergy}%`,
                        } as CustomProperties
                      }
                    />
                  </div>
                </div>
              ) : (
                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-label="Redemption progress"
                  aria-valuemin={0}
                  aria-valuemax={sessionLength}
                  aria-valuenow={progress}
                  style={{ gridTemplateColumns: `repeat(${sessionLength}, 1fr)` }}
                >
                  {roundQueue.map(({ id }, index) => (
                    <span
                      className={
                        index < progress ? styles.progressDone : undefined
                      }
                      key={id}
                    />
                  ))}
                </div>
              )}
              <span className={styles.roundCount}>
                {isCampaign
                  ? `${campaignProblemIndex + 1} / ${CAMPAIGN_PROBLEMS_PER_LEVEL}`
                  : `${activeSessionRound?.ordinal ?? roundCursor + 1} / ${
                      isInfinite ? "∞" : sessionLength
                    }`}
              </span>
              {!isCampaign && round ? (
                <span className={styles.difficulty}>{round.difficulty}</span>
              ) : null}
              <span
                className={styles.score}
                aria-label={
                  isRedemption
                    ? "Redemption mode"
                    : `First try score ${firstTryScore}`
                }
              >
                {isRedemption ? "Retry" : `${firstTryScore} ✓`}
              </span>
              {isInfinite ? (
                <button
                  className={styles.endButton}
                  type="button"
                  onClick={endInfinite}
                  disabled={
                    completedCount === 0 ||
                    phase === "animating" ||
                    phase === "wrong-review" ||
                    activeLessonStrategyId !== null
                  }
                >
                  End
                </button>
              ) : null}
              </div>
            )}

            <div className={styles.playWithToolbox}>
              <aside
                className={`${styles.strategyCatalogue} ${
                  catalogueExpanded
                    ? styles.strategyCatalogueExpanded
                    : ""
                }`}
                aria-label="Discovered solution strategy toolbox"
              >
                <button
                  className={styles.catalogueToggle}
                  type="button"
                  aria-expanded={catalogueExpanded}
                  aria-controls="libra-strategy-catalogue"
                  disabled={activeLessonStrategyId !== null}
                  onClick={() =>
                    setCatalogueExpanded((current) => !current)
                  }
                >
                  <span aria-hidden="true">⌘</span>
                  <strong>Tools</strong>
                  <small>
                    {discoveredStrategyIds.length}/{STRATEGY_CATALOGUE.length}
                  </small>
                </button>
                <div
                  className={styles.catalogueContents}
                  id="libra-strategy-catalogue"
                  aria-hidden={!catalogueExpanded}
                >
                  {STRATEGY_SECTIONS.map((section) => {
                    const discovered = STRATEGY_CATALOGUE.filter(
                      (strategy) =>
                        strategy.section === section.id &&
                        discoveredStrategyIdSet.has(strategy.id),
                    );

                    return (
                      <section
                        className={styles.catalogueSection}
                        key={section.id}
                      >
                        <h2>{section.name}</h2>
                        <p>{section.description}</p>
                        {discovered.length > 0 ? (
                          <ul className={styles.catalogueList}>
                            {discovered.map((strategy) => (
                              <li key={strategy.id}>
                                <button
                                  className={styles.catalogueCard}
                                  type="button"
                                  tabIndex={catalogueExpanded ? 0 : -1}
                                  disabled={
                                    phase === "animating" ||
                                    phase === "wrong-review" ||
                                    pendingLessons.length > 0 ||
                                    campaignReviewSelection !== null
                                  }
                                  aria-label={`Replay ${strategy.name} lesson`}
                                  onClick={() =>
                                    replayStrategyLesson(strategy.id)
                                  }
                                  ref={(node) => {
                                    catalogueButtonRefs.current[strategy.id] =
                                      node;
                                  }}
                                >
                                  <span aria-hidden="true">
                                    {strategy.symbol}
                                  </span>
                                  <strong>{strategy.shortName}</strong>
                                  <small>Replay</small>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={styles.catalogueEmpty}>
                            Solve a new kind of balance to add a tool.
                          </p>
                        )}
                      </section>
                    );
                  })}
                </div>
              </aside>

              <div className={styles.playSurface}>
            {generationError ? (
              <section
                className={styles.recoveryCard}
                aria-labelledby="generation-error-title"
              >
                <p className={styles.kicker}>Infinite paused</p>
                <h2 id="generation-error-title">The next scale needs a redraw.</h2>
                <p>No invalid puzzle was served. Try a fresh arrangement.</p>
                <div className={styles.recoveryActions}>
                  <button
                    className={styles.primaryButton}
                    type="button"
                    onClick={retryInfiniteGeneration}
                    ref={generationRetryRef}
                  >
                    Try again
                  </button>
                  {completedCount > 0 ? (
                    <button
                      className={styles.modeButton}
                      type="button"
                      onClick={endInfinite}
                    >
                      End run
                    </button>
                  ) : null}
                </div>
              </section>
            ) : showCampaignLevelComplete ? (
              <section
                className={styles.levelCompleteCard}
                id="libra-play-area"
                aria-labelledby="level-complete-title"
              >
                <p className={styles.kicker}>
                  {campaignLevel(activeCampaignLevel).label} · 12 / 12
                </p>
                <h2 id="level-complete-title">Level complete</h2>
                <button
                  className={styles.primaryButton}
                  type="button"
                  ref={levelCompleteButtonRef}
                  onClick={() => {
                    if (activeLevelMistakes.length > 0) {
                      setReviewLevelId(activeCampaignLevel);
                      setComplete(true);
                    } else if (nextCampaignLevel) {
                      selectCampaignLevel(nextCampaignLevel);
                    } else {
                      setReviewLevelId(null);
                      setComplete(true);
                    }
                  }}
                >
                  {activeLevelMistakes.length > 0
                    ? "Review Mistakes"
                    : nextCampaignLevel
                      ? campaignLevel(nextCampaignLevel).label
                      : "Results"}
                  <span aria-hidden="true">→</span>
                </button>
              </section>
            ) : historicalSessionRound && historicalProgress ? (
              <section
                className={styles.historicalReview}
                id="libra-play-area"
                aria-labelledby="historical-review-title"
              >
                <div className={styles.historicalReviewHeader}>
                  <div>
                    <p className={styles.kicker}>Completed problem</p>
                    <h2
                      id="historical-review-title"
                      ref={historicalReviewHeadingRef}
                      tabIndex={-1}
                    >
                      {historicalSessionRound.campaign?.levelLabel} · Problem{" "}
                      {(historicalSessionRound.campaign?.problemIndex ?? 0) + 1}
                    </h2>
                    <p className={styles.historicalOutcome}>
                      {historicalProgress.firstAttempt === "correct"
                        ? "✓ Correct on the first try"
                        : "× Missed on the first try, then solved"}
                    </p>
                  </div>
                  <button
                    className={styles.modeButton}
                    type="button"
                    onClick={closeCampaignReview}
                  >
                    Back to current problem
                  </button>
                </div>

                <div className={styles.historicalReviewBody}>
                  <div className={styles.historicalPuzzle}>
                    <PuzzleVisual
                      round={historicalSessionRound.round}
                      candidate={
                        historicalSessionRound.round.options[
                          historicalSessionRound.round.correctIndex
                        ]
                      }
                      outcome="correct"
                      proofState={
                        proofReplaying ? "animating" : "settled"
                      }
                      key={`historical-proof-${proofReplayKey}`}
                    />
                  </div>
                  <div className={styles.historicalProofCopy}>
                    <p>
                      {solutionStrategyFeedback(
                        historicalSessionRound.round,
                      )}
                    </p>
                    <button
                      className={styles.replayButton}
                      type="button"
                      onClick={replayProof}
                    >
                      <span aria-hidden="true">↻</span>
                      Replay proof
                    </button>
                  </div>
                  {historicalMistake ? (
                    <div className={styles.historicalWrongAnswer}>
                      <span>Your first answer</span>
                      <AnswerLoad
                        option={
                          historicalSessionRound.round.options[
                            historicalMistake.chosenIndex
                          ]
                        }
                        expectedCount={historicalSessionRound.round.answer}
                        revealDifferences={
                          historicalSessionRound.round.feedbackPolicy !==
                          "preserve-inference"
                        }
                        accentMap={buildRoundAccentMap(
                          historicalSessionRound.round,
                        )}
                      />
                      <strong aria-hidden="true">×</strong>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : round ? (
              <>
                <div
                  className={styles.gameBoard}
                  id="libra-play-area"
                  aria-busy={
                    phase === "animating" ||
                    phase === "wrong-review" ||
                    proofReplaying
                  }
                >
                  <section
                    className={styles.cluePanel}
                    aria-label="Balance puzzle"
                  >
                    {visibleActiveStrategyIds.length > 0 ? (
                      <div
                        className={styles.activeTools}
                        aria-label="Helpful tools for this puzzle"
                      >
                        <span>Try</span>
                        {visibleActiveStrategyIds.map((strategyId) => {
                          const strategy =
                            STRATEGY_CATALOGUE_BY_ID[strategyId];
                          return (
                            <button
                              className={styles.activeTool}
                              type="button"
                              disabled={
                                !discoveredStrategyIdSet.has(strategyId) ||
                                phase === "animating" ||
                                phase === "wrong-review"
                              }
                              onClick={() =>
                                replayStrategyLesson(strategyId)
                              }
                              aria-label={`Review ${strategy.name}`}
                              key={strategyId}
                            >
                              <span aria-hidden="true">
                                {strategy.symbol}
                              </span>
                              {strategy.shortName}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    <PuzzleVisual
                      round={round}
                      candidate={candidateOnGoal}
                      outcome={answerOutcome}
                      proofState={
                        selectedCorrect &&
                        (phase === "animating" ||
                          phase === "answered")
                          ? phase === "animating" || proofReplaying
                            ? "animating"
                            : "settled"
                          : "hidden"
                      }
                      revealDifferences={phase === "wrong-review"}
                      key={`live-proof-${proofReplayKey}`}
                    />
                  </section>
                  <section
                    className={styles.answerPanel}
                    aria-label="Answer choices"
                  >
                    <div
                      className={styles.optionGrid}
                      role="group"
                      aria-label="Answer choices"
                    >
                      {round.options.map((option, optionIndex) => {
                        const isCorrect = optionIndex === round.correctIndex;
                        const isSelected = selectedIndex === optionIndex;
                        const showCorrect =
                          phase === "answered" && isCorrect;
                        const showWrong =
                          phase === "wrong-review" &&
                          isSelected &&
                          !isCorrect;
                        const muted =
                          (phase === "answered" && !isCorrect) ||
                          (phase === "wrong-review" && !isSelected);
                        const revealDifferences =
                          showWrong &&
                          round.feedbackPolicy !== "preserve-inference";
                        const creatureName = CREATURE_NAMES[option.creature];
                        const answerState = showCorrect
                          ? ", correct answer"
                          : showWrong
                            ? ", your answer, not balanced"
                            : "";

                        return (
                          <button
                            className={`${styles.optionButton} ${
                              showCorrect ? styles.correctOption : ""
                            } ${showWrong ? styles.wrongOption : ""} ${
                              muted ? styles.mutedOption : ""
                            } ${
                              phase === "animating" && isSelected
                                ? styles.activeOption
                                : ""
                            }`}
                            type="button"
                            onClick={() => chooseOption(optionIndex)}
                            disabled={
                              phase !== "idle" ||
                              activeLessonStrategyId !== null
                            }
                            aria-label={`Option ${optionIndex + 1}: ${
                              option.count
                            } ${creatureName}${
                              option.count === 1 ? "" : "s"
                            }${answerState}`}
                            aria-keyshortcuts={`${optionIndex + 1}`}
                            ref={(node) => {
                              optionButtonRefs.current[optionIndex] = node;
                            }}
                            key={`${optionIndex}-${option.count}-${option.kind}`}
                          >
                            <span
                              className={styles.optionNumber}
                              aria-hidden="true"
                            >
                              {optionIndex + 1}
                            </span>
                            <AnswerLoad
                              option={option}
                              expectedCount={round.answer}
                              revealDifferences={revealDifferences}
                              accentMap={buildRoundAccentMap(round)}
                            />
                            {showCorrect ? (
                              <span
                                className={styles.choiceMark}
                                aria-hidden="true"
                              >
                                ✓
                              </span>
                            ) : null}
                            {showWrong ? (
                              <span
                                className={styles.choiceMark}
                                aria-hidden="true"
                              >
                                ×
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </div>

                <div
                  className={styles.feedbackBar}
                  aria-live="polite"
                  role="status"
                >
                  {phase === "wrong-review" ? (
                    <strong className={styles.wrongText}>
                      Not balanced · {wrongFeedback}
                    </strong>
                  ) : phase === "answered" ? (
                    <>
                      <span className={styles.feedbackCopy}>
                        <strong className={styles.correctText}>
                          Correct · {optionFeedback(round, round.correctIndex)}
                        </strong>
                        <span className={styles.strategyFeedback}>
                          {solutionStrategyFeedback(round)}
                        </span>
                      </span>
                      <button
                        className={styles.replayButton}
                        type="button"
                        onClick={replayProof}
                      >
                        <span aria-hidden="true">↻</span>
                        Replay proof
                      </button>
                      <button
                        className={styles.nextButton}
                        type="button"
                        onClick={goNext}
                        ref={nextButtonRef}
                      >
                        {isLastRedemptionRound
                          ? reviewLevelId
                            ? "Finish review"
                            : "Results"
                          : isCampaign &&
                              campaignProblemIndex ===
                                CAMPAIGN_PROBLEMS_PER_LEVEL - 1
                            ? "Finish level"
                            : "Next"}
                        <span aria-hidden="true">→</span>
                      </button>
                    </>
                  ) : retryReady ? (
                    <strong className={styles.retryText}>Try again</strong>
                  ) : null}
                </div>
                <p className={styles.keyboardHint}>Keys 1–4</p>
              </>
            ) : (
              <section className={styles.recoveryCard}>
                <h2>That puzzle is unavailable.</h2>
                <Link className={styles.secondaryLink} href="/">
                  All games
                </Link>
              </section>
            )}
              </div>
            </div>
          </>
        ) : (
          <section
            className={`${styles.results} ${
              showRedemptionOffer ? styles.resultsWithReview : ""
            }`}
            aria-labelledby="results-title"
          >
            <p className={styles.kicker}>
              {isRedemption
                ? "Redeemed"
                : reviewLevelId
                  ? `${campaignLevel(reviewLevelId).label} complete`
                  : "Complete"}
            </p>
            <h1 id="results-title" ref={resultHeadingRef} tabIndex={-1}>
              {resultTitle}
            </h1>
            <p className={styles.resultScore}>
              <strong>
                {isRedemption
                  ? redemptionTotal
                  : displayedResultFirstTryScore}
              </strong>
              <span>
                {isRedemption
                  ? `of ${redemptionTotal} cleared`
                  : `/ ${resultDenominator} first try`}
              </span>
            </p>

            {showRedemptionOffer ? (
              <div className={styles.reviewGrid} aria-label="Puzzles to retry">
                {visibleMistakes.map(
                  ({ sessionRound: missed, chosenIndex }) => {
                    const missedRound = missed.round;
                    const wrongOption = missedRound.options[chosenIndex];
                    return (
                      <article className={styles.reviewCard} key={missed.id}>
                        <span className={styles.reviewRound}>
                          {missed.campaign
                            ? `${missed.campaign.levelLabel} · Puzzle ${
                                missed.campaign.problemIndex + 1
                              }`
                            : `Puzzle ${missed.ordinal} · ${missedRound.difficulty}`}
                        </span>
                        <div className={styles.reviewVisual}>
                          {missedRound.feedbackPolicy ===
                          "preserve-inference" ? (
                            <>
                              <BalanceScale
                                left={missedRound.question.target}
                                right={[]}
                                goal
                                accentMap={buildRoundAccentMap(missedRound)}
                              />
                              <span className={styles.reviewWrongLoad}>
                                <AnswerLoad
                                  option={wrongOption}
                                  expectedCount={missedRound.answer}
                                  revealDifferences={false}
                                  accentMap={buildRoundAccentMap(missedRound)}
                                />
                                <span aria-hidden="true">×</span>
                              </span>
                            </>
                          ) : (
                            <BalanceScale
                              left={missedRound.question.target}
                              right={[]}
                              goal
                              candidate={wrongOption}
                              expectedCount={missedRound.answer}
                              outcome="wrong"
                              revealDifferences
                              accentMap={buildRoundAccentMap(missedRound)}
                            />
                          )}
                        </div>
                        <span className={styles.reviewDescription}>
                          {describeExpression(missedRound.question.target)} ·
                          your load: {wrongOption.count}{" "}
                          {CREATURE_NAMES[wrongOption.creature]}
                          {wrongOption.count === 1 ? "" : "s"} · not balanced
                        </span>
                      </article>
                    );
                  },
                )}
              </div>
            ) : null}

            <div className={styles.resultActions}>
              {showRedemptionOffer ? (
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={startRedemption}
                >
                  Retry missed
                </button>
              ) : (
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={startCampaign}
                >
                  Play again
                </button>
              )}
              <Link className={styles.secondaryLink} href="/">
                All games
              </Link>
            </div>
          </section>
        )}
      </main>

      <dialog
        className={styles.strategyLessonDialog}
        ref={lessonDialogRef}
        aria-labelledby="strategy-lesson-title"
        aria-describedby="strategy-lesson-description"
        onCancel={(event) => {
          event.preventDefault();
          closeActiveLesson();
        }}
      >
        {activeLessonStrategy && activeLessonStrategyId ? (
          <div className={styles.strategyLessonCard}>
            <div className={styles.lessonHeading}>
              <span
                className={styles.lessonSymbol}
                aria-hidden="true"
              >
                {activeLessonStrategy.symbol}
              </span>
              <div>
                <p className={styles.kicker}>
                  {replayStrategyId
                    ? "Toolbox replay"
                    : "New balance tool"}
                </p>
                <h2 id="strategy-lesson-title">
                  {activeLessonStrategy.name}
                </h2>
                <p id="strategy-lesson-description">
                  {activeLessonStrategy.description}
                </p>
              </div>
            </div>
            <StrategyLessonVisual
              strategy={activeLessonStrategyId}
              replayKey={lessonReplayKey}
            />
            <div className={styles.lessonActions}>
              <button
                className={styles.replayButton}
                type="button"
                onClick={() =>
                  setLessonReplayKey((current) => current + 1)
                }
              >
                <span aria-hidden="true">↻</span>
                Replay
              </button>
              <button
                className={styles.primaryButton}
                type="button"
                autoFocus
                ref={lessonPrimaryButtonRef}
                onClick={closeActiveLesson}
              >
                {replayStrategyId
                  ? "Back to puzzle"
                  : pendingLessons.length > 1
                    ? "Next tool"
                    : "Try it"}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
