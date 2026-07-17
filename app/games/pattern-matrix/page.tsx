"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

import {
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  infiniteLevelLabel,
  recordInfiniteFirstAttempt,
} from "@/lib/infinite-progression";

import { CAMPAIGN_ROUNDS } from "./campaign-data";
import {
  canOpenHistoricalReview,
  discoveredPartIdsAfterLesson,
  hintRoundIdsAfterMiss,
  unseenLessonPartIds,
} from "./learning-state";
import {
  RULE_CATALOGUE,
  differingDotIndexes,
  effectiveCueMode,
  generateInfiniteRound,
  incorrectFeedback,
  patternKey,
  roundFingerprint,
  rulePartIds,
  ruleLabel,
  type Difficulty,
  type MatrixRule,
  type Pattern,
  type Round,
  type RulePartId,
} from "./rule-engine";
import { patternMatrixGame } from "./game-info";
import {
  MatrixBoard,
  PatternTile,
  RuleCue,
} from "./pattern-visuals";
import styles from "./pattern-matrix.module.css";

type GamePhase = "idle" | "animating" | "wrong-review" | "answered";
type SessionMode = "campaign" | "infinite" | "redemption";
type OriginMode = "campaign" | "infinite";
type CampaignLevelId = "starter" | "junior" | "expert" | "wizard";
type CampaignMarker = "correct" | "incorrect";
type GenerationRecovery = "start" | "next";
type CampaignReviewSelection = {
  levelId: CampaignLevelId;
  problemIndex: number;
};
type RuleLesson = {
  partId: RulePartId;
  rule: MatrixRule;
};

type SessionRound = {
  id: string;
  ordinal: number;
  round: Round;
  campaign?: {
    levelId: CampaignLevelId;
    levelLabel: string;
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

type GhostState = {
  pattern: Pattern;
  left: number;
  top: number;
  width: number;
  height: number;
  deltaX: number;
  deltaY: number;
  scale: number;
  reducedMotion: boolean;
};

type CustomProperties = CSSProperties & Record<`--${string}`, string>;

const GHOST_ANIMATION_MS = 900;
const GHOST_SETTLE_MS = 930;
const REDUCED_GHOST_MS = 140;
const WRONG_REVIEW_MS = 2200;
const REDUCED_WRONG_REVIEW_MS = 1300;
const CAMPAIGN_PROBLEMS_PER_LEVEL = 12;

const CAMPAIGN_LEVELS: ReadonlyArray<{
  id: CampaignLevelId;
  label: string;
  difficulty: Difficulty;
}> = [
  { id: "starter", label: "Starter", difficulty: "Easy" },
  { id: "junior", label: "Junior", difficulty: "Medium" },
  { id: "expert", label: "Expert", difficulty: "Hard" },
  { id: "wizard", label: "Wizard", difficulty: "Wizard" },
];

const TUTORIAL_ROUND = CAMPAIGN_ROUNDS[0];
const TUTORIAL = {
  matrix: TUTORIAL_ROUND.matrix,
  rule: TUTORIAL_ROUND.rule,
  cueMode: "full-rule" as const,
  answer: TUTORIAL_ROUND.correctPattern,
  nearMiss:
    TUTORIAL_ROUND.options.find(
      (_, index) => index !== TUTORIAL_ROUND.correctIndex,
    ) ?? TUTORIAL_ROUND.options[(TUTORIAL_ROUND.correctIndex + 1) % 4],
};

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
  const { difficulty } = campaignLevel(levelId);
  return CAMPAIGN_ROUNDS.filter((round) => round.difficulty === difficulty);
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
): SessionRound {
  const level = campaignLevel(levelId);
  const levelIndex = CAMPAIGN_LEVELS.findIndex(({ id }) => id === levelId);
  const round = campaignRounds(levelId)[problemIndex] ?? CAMPAIGN_ROUNDS[0];

  return {
    id: campaignRoundId(levelId, problemIndex),
    ordinal: levelIndex * CAMPAIGN_PROBLEMS_PER_LEVEL + problemIndex + 1,
    round,
    campaign: {
      levelId,
      levelLabel: level.label,
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

function buildInfiniteSessionRound(
  ordinal: number,
  seenFingerprints: Set<string>,
  difficulty: Difficulty,
): SessionRound {
  const round = generateInfiniteRound(
    difficulty,
    Math.random,
    seenFingerprints,
  );
  const fingerprint = roundFingerprint(round);

  if (seenFingerprints.has(fingerprint)) {
    throw new Error("Infinite generation returned a repeated puzzle.");
  }

  seenFingerprints.add(fingerprint);
  return {
    id: `infinite-${ordinal}-${fingerprint}`,
    ordinal,
    round,
  };
}

export default function PatternMatrixPage() {
  const [started, setStarted] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>("campaign");
  const [originMode, setOriginMode] = useState<OriginMode>("campaign");
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
  const [completedCount, setCompletedCount] = useState(0);
  const [complete, setComplete] = useState(false);
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [ghost, setGhost] = useState<GhostState | null>(null);
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
  const [generationRecovery, setGenerationRecovery] =
    useState<GenerationRecovery>("start");
  const [hintUnlockedRoundIds, setHintUnlockedRoundIds] = useState<
    readonly string[]
  >([]);
  const [discoveredRulePartIds, setDiscoveredRulePartIds] = useState<
    readonly RulePartId[]
  >([]);
  const [pendingLessons, setPendingLessons] = useState<
    readonly RuleLesson[]
  >([]);
  const [catalogueExpanded, setCatalogueExpanded] = useState(false);
  const [campaignReviewSelection, setCampaignReviewSelection] =
    useState<CampaignReviewSelection | null>(null);

  const missingCellRef = useRef<HTMLDivElement>(null);
  const optionTileRefs = useRef<Array<HTMLDivElement | null>>([]);
  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const levelCompleteButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const generationRetryButtonRef = useRef<HTMLButtonElement>(null);
  const lessonDialogRef = useRef<HTMLDialogElement>(null);
  const historicalReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const campaignMarkerRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
  const reviewOriginIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const flightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTokenRef = useRef(0);
  const inputLockedRef = useRef(false);
  const shouldFocusFirstOption = useRef(false);
  const retryFocusIndexRef = useRef<number | null>(null);
  const attemptScrollRef = useRef({ x: 0, y: 0 });
  const infiniteFingerprintsRef = useRef(new Set<string>());
  const infiniteAdaptiveRef = useRef(initialInfiniteAdaptiveState());

  const isCampaign = sessionMode === "campaign";
  const isInfinite = sessionMode === "infinite";
  const isRedemption = sessionMode === "redemption";
  const campaignProblemIndex = campaignCursors[activeCampaignLevel];
  const campaignSessionRound = buildCampaignSessionRound(
    activeCampaignLevel,
    campaignProblemIndex,
  );
  const activeSessionRound = isCampaign
    ? campaignSessionRound
    : (roundQueue[roundCursor] ?? roundQueue[0]);
  const round = activeSessionRound?.round ?? CAMPAIGN_ROUNDS[0];
  const activeCueMode = effectiveCueMode(
    round.hintPolicy,
    activeSessionRound
      ? hintUnlockedRoundIds.includes(activeSessionRound.id)
      : false,
  );
  const activeLesson = pendingLessons[0] ?? null;
  const activeLessonPart = activeLesson
    ? RULE_CATALOGUE.find(({ id }) => id === activeLesson.partId)
    : undefined;
  const discoveredPartIdSet = new Set(discoveredRulePartIds);
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
  const selectedCorrect = selectedIndex === round.correctIndex;
  const activeIncorrectFeedback =
    selectedIndex !== null && !selectedCorrect
      ? incorrectFeedback(round, selectedIndex)
      : null;
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
    campaignReviewSelection === null &&
    !generationError;
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
  const infiniteFirstTryScore = infiniteAdaptive.attempts.filter(
    ({ firstTryCorrect }) => firstTryCorrect,
  ).length;
  const firstTryScore =
    originMode === "campaign"
      ? campaignFirstTryScore
      : infiniteFirstTryScore;

  const clearAttemptTimers = useCallback(() => {
    if (flightTimerRef.current) {
      clearTimeout(flightTimerRef.current);
      flightTimerRef.current = null;
    }
    if (reviewTimerRef.current) {
      clearTimeout(reviewTimerRef.current);
      reviewTimerRef.current = null;
    }
  }, []);

  const resetAttemptState = useCallback(() => {
    animationTokenRef.current += 1;
    clearAttemptTimers();
    inputLockedRef.current = false;
    retryFocusIndexRef.current = null;
    setSelectedIndex(null);
    setGhost(null);
    setRetryReady(false);
    setPhase("idle");
  }, [clearAttemptTimers]);

  const queueRuleLessons = useCallback(
    (lessonRule: MatrixRule) => {
      const partIds = rulePartIds(lessonRule);
      setPendingLessons((current) => {
        const additions = unseenLessonPartIds(
          discoveredRulePartIds,
          current.map(({ partId }) => partId),
          partIds,
        )
          .map((partId) => ({ partId, rule: lessonRule }));
        return additions.length > 0 ? [...current, ...additions] : current;
      });
    },
    [discoveredRulePartIds],
  );

  const closeActiveLesson = useCallback(() => {
    if (!activeLesson) return;
    setDiscoveredRulePartIds((current) =>
      discoveredPartIdsAfterLesson(current, activeLesson.partId),
    );
    setPendingLessons((current) => current.slice(1));
  }, [activeLesson]);

  const openCampaignReview = useCallback(
    (levelId: CampaignLevelId, problemIndex: number) => {
      const id = campaignRoundId(levelId, problemIndex);
      if (
        !canOpenHistoricalReview({
          isIdle: phase === "idle",
          isSolved: Boolean(campaignProgress[id]?.solved),
          hasPendingLessons: pendingLessons.length > 0,
        })
      ) {
        return;
      }
      reviewOriginIdRef.current = id;
      setCampaignReviewSelection({ levelId, problemIndex });
    },
    [campaignProgress, pendingLessons.length, phase],
  );

  const closeCampaignReview = useCallback(() => {
    const originId = reviewOriginIdRef.current;
    setCampaignReviewSelection(null);
    window.requestAnimationFrame(() => {
      if (originId) campaignMarkerRefs.current[originId]?.focus();
    });
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

      const play = () => {
        try {
          playFeedbackEarcon(context, correct);
        } catch {
          // Visual feedback remains complete when Web Audio is unavailable.
        }
      };

      if (context.state === "suspended") {
        void context.resume().then(play).catch(() => undefined);
        return;
      }

      if (context.state === "running") play();
    },
    [ensureAudioContext, soundEnabled],
  );

  const chooseOption = useCallback(
    (optionIndex: number) => {
      if (
        inputLockedRef.current ||
        phase !== "idle" ||
        complete ||
        generationError ||
        !started ||
        (isCampaign && activeCampaignLevelComplete) ||
        campaignReviewSelection !== null ||
        pendingLessons.length > 0 ||
        !activeSessionRound
      ) {
        return;
      }

      inputLockedRef.current = true;
      setRetryReady(false);
      const isCorrect = optionIndex === round.correctIndex;
      const sourceRect =
        optionTileRefs.current[optionIndex]?.getBoundingClientRect();
      const targetRect = missingCellRef.current?.getBoundingClientRect();
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      attemptScrollRef.current = {
        x: window.scrollX,
        y: window.scrollY,
      };

      playFeedbackSound(isCorrect);
      setSelectedIndex(optionIndex);
      setPhase("animating");

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

      if (isCorrect) {
        setCompletedCount((current) => current + 1);
      } else if (!isRedemption) {
        setMistakes((current) =>
          current.some(
            ({ sessionRound }) => sessionRound.id === activeSessionRound.id,
          )
            ? current
            : [
                ...current,
                {
                  sessionRound: activeSessionRound,
                  chosenIndex: optionIndex,
                },
            ],
        );
      }

      if (!isCorrect && round.hintPolicy === "after-miss") {
        setHintUnlockedRoundIds((current) =>
          hintRoundIdsAfterMiss(
            current,
            activeSessionRound.id,
            round.hintPolicy,
          ),
        );
      }

      if (sourceRect && targetRect) {
        setGhost({
          pattern: round.options[optionIndex],
          left: sourceRect.left,
          top: sourceRect.top,
          width: sourceRect.width,
          height: sourceRect.height,
          deltaX: targetRect.left - sourceRect.left,
          deltaY: targetRect.top - sourceRect.top,
          scale: targetRect.width / sourceRect.width,
          reducedMotion,
        });
      }

      const animationToken = animationTokenRef.current + 1;
      animationTokenRef.current = animationToken;
      clearAttemptTimers();
      flightTimerRef.current = setTimeout(
        () => {
          if (animationTokenRef.current !== animationToken) return;

          if (isCorrect) {
            setGhost(null);
            setPhase("answered");
            queueRuleLessons(round.rule);
            return;
          }

          setPhase("wrong-review");
          reviewTimerRef.current = setTimeout(
            () => {
              if (animationTokenRef.current !== animationToken) return;
              retryFocusIndexRef.current = optionIndex;
              inputLockedRef.current = false;
              setGhost(null);
              setSelectedIndex(null);
              setRetryReady(true);
              setPhase("idle");
            },
            reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
          );
        },
        reducedMotion ? REDUCED_GHOST_MS : GHOST_SETTLE_MS,
      );
    },
    [
      activeCampaignLevelComplete,
      activeSessionRound,
      campaignReviewSelection,
      clearAttemptTimers,
      complete,
      generationError,
      isCampaign,
      isInfinite,
      isRedemption,
      pendingLessons.length,
      phase,
      playFeedbackSound,
      queueRuleLessons,
      round,
      started,
    ],
  );

  const startCampaign = useCallback(() => {
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    infiniteAdaptiveRef.current = initialAdaptive;
    setSessionMode("campaign");
    setOriginMode("campaign");
    setRoundQueue([]);
    setRoundCursor(0);
    setActiveCampaignLevel("starter");
    setCampaignCursors(initialCampaignCursors());
    setCampaignProgress({});
    setInfiniteAdaptive(initialAdaptive);
    setCompletedCount(0);
    setMistakes([]);
    setRedemptionTotal(0);
    setReviewLevelId(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setGenerationError(false);
    setGenerationRecovery("start");
    setHintUnlockedRoundIds([]);
    setDiscoveredRulePartIds([]);
    setPendingLessons([]);
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
    let firstRound: SessionRound | null = null;

    try {
      firstRound = buildInfiniteSessionRound(
        1,
        infiniteFingerprintsRef.current,
        initialAdaptive.targetDifficulty,
      );
    } catch {
      // A recoverable state is rendered below instead of serving a bad round.
    }

    setSessionMode("infinite");
    setOriginMode("infinite");
    setRoundQueue(firstRound ? [firstRound] : []);
    setRoundCursor(0);
    setCampaignProgress({});
    setInfiniteAdaptive(initialAdaptive);
    setCompletedCount(0);
    setMistakes([]);
    setRedemptionTotal(0);
    setReviewLevelId(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setGenerationError(firstRound === null);
    setGenerationRecovery("start");
    setHintUnlockedRoundIds([]);
    setDiscoveredRulePartIds([]);
    setPendingLessons([]);
    setCatalogueExpanded(false);
    setCampaignReviewSelection(null);
    setStarted(true);
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = firstRound !== null;
  }, [resetAttemptState, resumeAudio]);

  const selectCampaignLevel = useCallback(
    (levelId: CampaignLevelId) => {
      if (
        !isCampaign ||
        phase !== "idle" ||
        generationError ||
        campaignReviewSelection !== null ||
        levelId === activeCampaignLevel
      ) {
        return;
      }

      resetAttemptState();
      setActiveCampaignLevel(levelId);
      shouldFocusFirstOption.current = !isCampaignLevelComplete(
        campaignProgress,
        levelId,
      );
    },
    [
      activeCampaignLevel,
      campaignReviewSelection,
      campaignProgress,
      generationError,
      isCampaign,
      phase,
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
      pendingLessons.length > 0 ||
      campaignReviewSelection !== null
    ) {
      return;
    }

    if (isCampaign) {
      resetAttemptState();

      if (campaignProblemIndex < CAMPAIGN_PROBLEMS_PER_LEVEL - 1) {
        shouldFocusFirstOption.current = true;
        setCampaignCursors((current) => ({
          ...current,
          [activeCampaignLevel]: campaignProblemIndex + 1,
        }));
        return;
      }

      shouldFocusFirstOption.current = false;
      return;
    }

    if (isInfinite) {
      const nextOrdinal = (activeSessionRound?.ordinal ?? roundCursor + 1) + 1;
      let nextRound: SessionRound;

      try {
        nextRound = buildInfiniteSessionRound(
          nextOrdinal,
          infiniteFingerprintsRef.current,
          infiniteAdaptiveRef.current.targetDifficulty,
        );
      } catch {
        setGenerationRecovery("next");
        setGenerationError(true);
        return;
      }

      shouldFocusFirstOption.current = true;
      resetAttemptState();
      setRoundQueue((current) => [...current, nextRound]);
      setRoundCursor((current) => current + 1);
      return;
    }

    if (isLastRedemptionRound) {
      resetAttemptState();
      setRedeemedMistakeIds((current) => [
        ...new Set([...current, ...redemptionMistakeIds]),
      ]);
      setRedemptionMistakeIds([]);

      if (reviewLevelId) {
        const redeemedLevelId = reviewLevelId;
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

      setComplete(true);
      return;
    }

    shouldFocusFirstOption.current = true;
    resetAttemptState();
    setRoundCursor((current) => current + 1);
  }, [
    activeCampaignLevel,
    activeSessionRound?.ordinal,
    campaignReviewSelection,
    campaignProblemIndex,
    isCampaign,
    isInfinite,
    isLastRedemptionRound,
    phase,
    pendingLessons.length,
    redemptionMistakeIds,
    reviewLevelId,
    resetAttemptState,
    roundCursor,
  ]);

  const retryGeneration = useCallback(() => {
    if (!isInfinite) return;

    const isStarting = generationRecovery === "start";
    const nextOrdinal = isStarting
      ? 1
      : (activeSessionRound?.ordinal ?? roundCursor + 1) + 1;
    let recoveredRound: SessionRound;

    try {
      recoveredRound = buildInfiniteSessionRound(
        nextOrdinal,
        infiniteFingerprintsRef.current,
        infiniteAdaptiveRef.current.targetDifficulty,
      );
    } catch {
      setGenerationError(true);
      return;
    }

    setGenerationError(false);
    resetAttemptState();
    if (isStarting) {
      setRoundQueue([recoveredRound]);
      setRoundCursor(0);
    } else {
      setRoundQueue((current) => [...current, recoveredRound]);
      setRoundCursor((current) => current + 1);
    }
    shouldFocusFirstOption.current = true;
  }, [
    activeSessionRound?.ordinal,
    generationRecovery,
    isInfinite,
    resetAttemptState,
    roundCursor,
  ]);

  const endInfinite = useCallback(() => {
    if (
      !isInfinite ||
      completedCount === 0 ||
      phase === "animating" ||
      phase === "wrong-review"
    ) {
      return;
    }
    setGenerationError(false);
    resetAttemptState();
    setComplete(true);
  }, [completedCount, isInfinite, phase, resetAttemptState]);

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeSoundPreference(next);
    if (next) resumeAudio();
  }, [resumeAudio, soundEnabled]);

  useEffect(() => {
    const enabled = readSoundPreference();
    if (enabled) return;
    const timer = window.setTimeout(() => setSoundEnabled(enabled), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isEditable =
        target instanceof Element &&
        (target.closest("input, textarea, select, [contenteditable]") !== null ||
          (target instanceof HTMLElement && target.isContentEditable));

      if (
        event.defaultPrevented ||
        isEditable ||
        !started ||
        complete ||
        generationError ||
        campaignReviewSelection !== null ||
        pendingLessons.length > 0 ||
        phase !== "idle" ||
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
    campaignReviewSelection,
    chooseOption,
    complete,
    generationError,
    pendingLessons.length,
    phase,
    started,
  ]);

  useEffect(() => {
    if (phase === "answered" && pendingLessons.length === 0) {
      nextButtonRef.current?.focus();
    }
  }, [pendingLessons.length, phase]);

  useEffect(() => {
    if (
      shouldFocusFirstOption.current &&
      started &&
      !complete &&
      !generationError &&
      campaignReviewSelection === null &&
      pendingLessons.length === 0
    ) {
      optionButtonRefs.current[0]?.focus();
      shouldFocusFirstOption.current = false;
    }
  }, [
    activeCampaignLevel,
    campaignReviewSelection,
    campaignProblemIndex,
    complete,
    generationError,
    roundCursor,
    sessionMode,
    started,
    pendingLessons.length,
  ]);

  useEffect(() => {
    if (
      phase === "idle" &&
      retryReady &&
      retryFocusIndexRef.current !== null &&
      pendingLessons.length === 0
    ) {
      optionButtonRefs.current[retryFocusIndexRef.current]?.focus();
      retryFocusIndexRef.current = null;
    }
  }, [pendingLessons.length, phase, retryReady]);

  useEffect(() => {
    if (complete) resultHeadingRef.current?.focus();
  }, [complete]);

  useEffect(() => {
    if (showCampaignLevelComplete) levelCompleteButtonRef.current?.focus();
  }, [activeCampaignLevel, showCampaignLevelComplete]);

  useEffect(() => {
    if (generationError) generationRetryButtonRef.current?.focus();
  }, [generationError]);

  useEffect(() => {
    const dialog = lessonDialogRef.current;
    if (!dialog) return;
    if (activeLesson && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    } else if (!activeLesson && dialog.open) {
      dialog.close();
    }
  }, [activeLesson]);

  useEffect(() => {
    if (campaignReviewSelection) {
      historicalReviewHeadingRef.current?.focus();
    }
  }, [campaignReviewSelection]);

  useEffect(() => {
    function finishMovingGhost(event: Event) {
      if (!inputLockedRef.current) return;
      if (event.type === "scroll") {
        const scrollDelta = Math.max(
          Math.abs(window.scrollX - attemptScrollRef.current.x),
          Math.abs(window.scrollY - attemptScrollRef.current.y),
        );
        if (scrollDelta <= 8) return;
      }

      if (phase === "animating") {
        animationTokenRef.current += 1;
        clearAttemptTimers();
        setGhost(null);
        if (selectedCorrect) {
          setPhase("answered");
          queueRuleLessons(round.rule);
        } else {
          const optionIndex = selectedIndex;
          const animationToken = animationTokenRef.current;
          const reducedMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          setPhase("wrong-review");
          reviewTimerRef.current = setTimeout(
            () => {
              if (animationTokenRef.current !== animationToken) return;
              retryFocusIndexRef.current = optionIndex;
              inputLockedRef.current = false;
              setSelectedIndex(null);
              setRetryReady(true);
              setPhase("idle");
            },
            reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
          );
        }
      } else if (phase === "wrong-review") {
        // The fixed-position teaching copy is no longer trustworthy after a
        // layout move, but the explanatory review should remain available.
        setGhost(null);
      }
    }

    window.addEventListener("resize", finishMovingGhost);
    window.addEventListener("scroll", finishMovingGhost, true);
    return () => {
      window.removeEventListener("resize", finishMovingGhost);
      window.removeEventListener("scroll", finishMovingGhost, true);
    };
  }, [
    clearAttemptTimers,
    phase,
    queueRuleLessons,
    round.rule,
    selectedCorrect,
    selectedIndex,
  ]);

  useEffect(() => {
    return () => {
      animationTokenRef.current += 1;
      clearAttemptTimers();
      const context = audioContextRef.current;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    };
  }, [clearAttemptTimers]);

  const resultMessage = useMemo(() => {
    const denominator =
      originMode === "infinite"
        ? Math.max(infiniteAdaptive.attempts.length, 1)
        : CAMPAIGN_ROUNDS.length;
    const accuracy = firstTryScore / denominator;
    if (accuracy === 1) return "Perfect set.";
    if (accuracy >= 0.7) return "Sharp work.";
    return "Good practice.";
  }, [
    firstTryScore,
    infiniteAdaptive.attempts.length,
    originMode,
  ]);

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
    : originMode === "infinite"
      ? infiniteAdaptive.attempts.length
      : CAMPAIGN_ROUNDS.length;

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

  const ghostPortal =
    ghost &&
    createPortal(
      <div
        className={`${styles.ghostFlight} ${
          ghost.reducedMotion ? styles.ghostReduced : ""
        } ${phase === "wrong-review" ? styles.ghostLanded : ""}`}
        style={
          {
            left: `${ghost.left}px`,
            top: `${ghost.top}px`,
            width: `${ghost.width}px`,
            height: `${ghost.height}px`,
            "--ghost-x": `${ghost.deltaX}px`,
            "--ghost-y": `${ghost.deltaY}px`,
            "--ghost-scale": `${ghost.scale}`,
            "--ghost-duration": `${GHOST_ANIMATION_MS}ms`,
          } as CustomProperties
        }
        aria-hidden="true"
      >
        <PatternTile pattern={ghost.pattern} size="ghostTile" hidden />
      </div>,
      document.body,
    );

  return (
    <div className={styles.pageShell}>
      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/" aria-label="All games">
          <span aria-hidden="true">←</span>
          <span>Games</span>
        </Link>
        <span className={styles.gameTitle}>{patternMatrixGame.title}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {!started ? (
          <section className={styles.tutorial} aria-labelledby="tutorial-title">
            <p className={styles.kicker}>Example</p>
            <h1 id="tutorial-title">Find the rule. Fill the gap.</h1>

            <div className={styles.exampleFlow}>
              <MatrixBoard
                matrix={TUTORIAL.matrix}
                size="tutorialMatrix"
                label="Example three by three visual matrix with its final tile missing"
              />
              <RuleCue rule={TUTORIAL.rule} cueMode={TUTORIAL.cueMode} />
              <div className={styles.exampleAnswer}>
                <PatternTile
                  pattern={TUTORIAL.answer}
                  size="tutorialTile"
                  label="Correct tile for the example"
                />
                <span className={styles.exampleMark} aria-label="Correct">
                  ✓
                </span>
              </div>
            </div>

            <div className={styles.nearMissExample}>
              <span className={styles.nearMissLabel}>Near match</span>
              <PatternTile
                pattern={TUTORIAL.nearMiss}
                size="tutorialTile"
                label="Near match that does not complete the example"
              />
              <span className={styles.nearMissMark} aria-label="Not a match">
                ×
              </span>
            </div>

            <div
              className={styles.modeActions}
              role="group"
              aria-label="Choose a game mode"
            >
              <button
                className={styles.primaryButton}
                type="button"
                onClick={startCampaign}
              >
                Campaign
                <span aria-hidden="true">→</span>
              </button>
              <button
                className={styles.modeButton}
                type="button"
                onClick={startInfinite}
              >
                <span aria-hidden="true">∞</span>
                Infinite
              </button>
            </div>
          </section>
        ) : !complete ? (
          <>
            <h1 className={styles.srOnly}>{patternMatrixGame.title}</h1>
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
                    role="group"
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
                          campaignProgress[
                            campaignRoundId(level.id, index)
                          ]?.firstAttempt === "incorrect",
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
                          aria-controls="campaign-play-area"
                          aria-label={`${level.label}, ${levelState}`}
                          disabled={
                            phase !== "idle" ||
                            campaignReviewSelection !== null ||
                            pendingLessons.length > 0
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
                                : `${marker}; review problem`
                            }`}
                            aria-current={isCurrent ? "step" : undefined}
                            aria-pressed={isReviewing}
                            disabled={
                              !problem?.solved ||
                              phase !== "idle" ||
                              pendingLessons.length > 0
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
                    className={styles.comboAnnouncement}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    Combo {infiniteAdaptive.combo}. Energy{" "}
                    {Math.round(infiniteEnergy)} percent.
                    {infiniteSupercharged ? " Maximum energy." : ""}
                  </span>
                  <div className={styles.infiniteHudLabels}>
                    <span className={styles.comboCount}>
                      Combo {infiniteAdaptive.combo}
                    </span>
                    <span className={styles.energyState}>
                      {infiniteSupercharged ? "Max" : "Energy"}
                    </span>
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
              {!isCampaign ? (
                <span className={styles.difficulty}>
                  {infiniteLevelLabel(round.difficulty)}
                </span>
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
                    phase === "wrong-review"
                  }
                >
                  End
                </button>
              ) : null}
            </div>

            {showCampaignLevelComplete ? (
              <section
                className={styles.levelCompleteCard}
                id="campaign-play-area"
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
            ) : generationError ? (
              <section
                className={styles.generationCard}
                id="campaign-play-area"
                role="alert"
                aria-labelledby="generation-title"
              >
                <p className={styles.kicker}>Infinite paused</p>
                <h2 id="generation-title">Let’s make a fresh puzzle.</h2>
                <p>
                  This one could not be built safely. Try again for another
                  validated matrix.
                </p>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={retryGeneration}
                  ref={generationRetryButtonRef}
                >
                  Try another
                  <span aria-hidden="true">↻</span>
                </button>
              </section>
            ) : historicalSessionRound && historicalProgress ? (
              <section
                className={styles.historicalReview}
                id="campaign-play-area"
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
                  <MatrixBoard
                    matrix={historicalSessionRound.round.matrix}
                    answer={historicalSessionRound.round.correctPattern}
                    size="clueMatrix"
                    label="Completed historical pattern matrix with its correct answer filled in"
                    showSolvedMark
                  />
                  <RuleCue
                    rule={historicalSessionRound.round.rule}
                    cueMode="full-rule"
                  />
                  <div className={styles.historicalAnswers}>
                    <div>
                      <span>Correct answer</span>
                      <PatternTile
                        pattern={historicalSessionRound.round.correctPattern}
                        size="reviewTile"
                        label="Correct answer"
                      />
                    </div>
                    {historicalMistake ? (
                      <div className={styles.historicalWrongAnswer}>
                        <span>Your first answer</span>
                        <PatternTile
                          pattern={
                            historicalSessionRound.round.options[
                              historicalMistake.chosenIndex
                            ]
                          }
                          size="reviewTile"
                          label="Your first incorrect answer"
                        />
                        <strong aria-hidden="true">×</strong>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : (
              <div className={styles.playWithCatalogue}>
                <aside
                  className={`${styles.ruleCatalogue} ${
                    catalogueExpanded ? styles.ruleCatalogueExpanded : ""
                  }`}
                  aria-label="Discovered rule catalogue"
                >
                  <button
                    className={styles.catalogueToggle}
                    type="button"
                    aria-expanded={catalogueExpanded}
                    onClick={() =>
                      setCatalogueExpanded((current) => !current)
                    }
                  >
                    <span aria-hidden="true">⌘</span>
                    <strong>Rules</strong>
                    <small>{discoveredRulePartIds.length}</small>
                  </button>
                  <div
                    className={styles.catalogueContents}
                    aria-hidden={!catalogueExpanded}
                  >
                    {(["combine", "change"] as const).map((section) => {
                      const discovered = RULE_CATALOGUE.filter(
                        (part) =>
                          part.section === section &&
                          discoveredPartIdSet.has(part.id),
                      );
                      return (
                        <section key={section}>
                          <h2>
                            {section === "combine"
                              ? "Combine & compare"
                              : "Change & arrange"}
                          </h2>
                          {discovered.length > 0 ? (
                            <ul>
                              {discovered.map((part) => (
                                <li title={part.name} key={part.id}>
                                  <span aria-hidden="true">
                                    {section === "combine" ? "◆" : "↻"}
                                  </span>
                                  <strong>{part.shortName}</strong>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p>Discover a rule to add it here.</p>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </aside>

                <div className={styles.playSurface}>
                  <div className={styles.gameBoard} id="campaign-play-area">
                  <section
                    className={styles.cluePanel}
                    aria-label="Pattern matrix and rule cue"
                  >
                    <div
                      className={`${styles.matrixStage} ${
                        phase === "animating" ||
                        phase === "wrong-review"
                          ? styles.matrixAnimating
                          : ""
                      }`}
                    >
                      <MatrixBoard
                        matrix={round.matrix}
                        answer={
                          phase === "answered"
                            ? round.correctPattern
                            : undefined
                        }
                        size="clueMatrix"
                        label={`${
                          phase === "answered"
                            ? "Completed three by three visual matrix."
                            : "Three by three visual matrix with the final tile missing."
                        } ${
                          activeCueMode === "hidden"
                            ? "Infer the complete rule."
                            : ruleLabel(round.rule)
                        }`}
                        missingRef={missingCellRef}
                        highlightFinalRow={phase === "wrong-review"}
                      />
                      <RuleCue
                        rule={round.rule}
                        cueMode={activeCueMode}
                      />
                    </div>
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
                        const isCorrect =
                          optionIndex === round.correctIndex;
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
                        const differences =
                          showWrong &&
                          activeIncorrectFeedback?.revealDifferences
                            ? differingDotIndexes(
                                option,
                                round.correctPattern,
                              )
                            : [];
                        const answerState = showCorrect
                          ? ", correct answer"
                          : showWrong
                            ? `, your answer; ${activeIncorrectFeedback?.message ?? "does not complete the matrix"}`
                            : "";

                        return (
                          <button
                            className={`${styles.optionButton} ${
                              showCorrect ? styles.correctOption : ""
                            } ${showWrong ? styles.wrongOption : ""} ${
                              muted ? styles.mutedOption : ""
                            }`}
                            type="button"
                            onClick={() => chooseOption(optionIndex)}
                            disabled={phase !== "idle"}
                            aria-label={`Option ${
                              optionIndex + 1
                            }, visual pattern tile${answerState}`}
                            aria-keyshortcuts={`${optionIndex + 1}`}
                            ref={(node) => {
                              optionButtonRefs.current[optionIndex] = node;
                            }}
                            key={`${optionIndex}-${patternKey(option)}`}
                          >
                            <span
                              className={styles.optionNumber}
                              aria-hidden="true"
                            >
                              {optionIndex + 1}
                            </span>
                            <PatternTile
                              pattern={option}
                              size="optionTile"
                              hidden
                              differenceIndexes={differences}
                              tileRef={(node) => {
                                optionTileRefs.current[optionIndex] = node;
                              }}
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
                  {phase === "wrong-review" &&
                  activeIncorrectFeedback ? (
                    <>
                      <strong className={styles.wrongText}>
                        × {activeIncorrectFeedback.heading}
                      </strong>
                      <span>{activeIncorrectFeedback.message}</span>
                    </>
                  ) : phase === "answered" ? (
                    <>
                      <span className={styles.correctMessage}>
                        <strong className={styles.correctText}>✓ Correct</strong>
                        <RuleCue
                          rule={round.rule}
                          cueMode="full-rule"
                          compact
                        />
                      </span>
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
                </div>
              </div>
            )}
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
              <div
                className={styles.reviewGrid}
                role="list"
                aria-label="Puzzles to retry"
              >
                {visibleMistakes.map(
                  ({ sessionRound: missed, chosenIndex }) => {
                    const missedRound = missed.round;
                    const wrongPattern = missedRound.options[chosenIndex];
                    const feedback = incorrectFeedback(
                      missedRound,
                      chosenIndex,
                    );
                    const differences = feedback.revealDifferences
                      ? differingDotIndexes(
                          wrongPattern,
                          missedRound.correctPattern,
                        )
                      : [];

                    return (
                      <article
                        className={styles.reviewCard}
                        role="listitem"
                        key={missed.id}
                      >
                        <span className={styles.reviewRound}>
                          {missed.campaign
                            ? `${missed.campaign.levelLabel} · Puzzle ${
                                missed.campaign.problemIndex + 1
                              }`
                            : `Puzzle ${
                                missed.ordinal
                              } · ${infiniteLevelLabel(
                                missedRound.difficulty,
                              )}`}
                        </span>
                        <div className={styles.reviewVisual}>
                          <MatrixBoard
                            matrix={missedRound.matrix}
                            size="reviewMatrix"
                            label={`Puzzle ${missed.ordinal} visual matrix with its final tile missing`}
                          />
                          <RuleCue
                            rule={missedRound.rule}
                            cueMode="full-rule"
                            compact
                          />
                          <div className={styles.reviewWrong}>
                            <PatternTile
                              pattern={wrongPattern}
                              size="reviewTile"
                              differenceIndexes={differences}
                              label={`Your answer. ${feedback.message}`}
                            />
                            <span aria-hidden="true">×</span>
                          </div>
                        </div>
                        <p className={styles.reviewExplanation}>
                          {feedback.message}
                        </p>
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
                  onClick={
                    originMode === "infinite"
                      ? startInfinite
                      : startCampaign
                  }
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
        className={styles.ruleLessonDialog}
        ref={lessonDialogRef}
        aria-labelledby="rule-lesson-title"
        onCancel={(event) => {
          event.preventDefault();
          closeActiveLesson();
        }}
      >
        {activeLesson && activeLessonPart ? (
          <div className={styles.ruleLessonCard}>
            <p className={styles.kicker}>New rule discovered</p>
            <h2 id="rule-lesson-title">{activeLessonPart.name}</h2>
            <p>{activeLessonPart.description}</p>
            <RuleCue
              rule={activeLesson.rule}
              cueMode="full-rule"
            />
            <button
              className={styles.primaryButton}
              type="button"
              onClick={closeActiveLesson}
            >
              {pendingLessons.length > 1 ? "Next rule" : "Got it"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        ) : null}
      </dialog>

      {ghostPortal}
    </div>
  );
}
