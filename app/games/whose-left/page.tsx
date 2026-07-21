"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import { ProgressionGameHud } from "@/components/progression/ProgressionGameHud";
import {
  ProgressionCulminationSectionIntro,
  ProgressionRecoveryPanel,
  ProgressionRedemptionIntro,
} from "@/components/progression/ProgressionSessionPanels";
import {
  progressionOptionIndexFromAnswerToken,
  useProgressionGameSession,
} from "@/components/progression/useProgressionGameSession";

import {
  CAMPAIGN_ROUNDS,
  EXAMPLE,
  generateInfiniteRound,
  questionForRound,
  routeCrossings,
  roundFingerprint,
  type AnswerSequence,
  type Difficulty,
  type OptionKind,
  type Round,
} from "./game-engine";
import { whoseLeftGame } from "./game-info";
import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
} from "./infinite-progression";
import {
  RouteBoard,
  Sequence,
  sequenceAccessibleLabel,
} from "./route-board";
import { progressionAdapter } from "./progression-adapter";
import styles from "./whose-left.module.css";

type GamePhase = "idle" | "correct-reveal" | "wrong-review" | "answered";
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

type CampaignReviewSelection = {
  levelId: CampaignLevelId;
  problemIndex: number;
};

const CORRECT_REVEAL_MS = 900;
const REDUCED_CORRECT_REVEAL_MS = 140;
const WRONG_REVIEW_MS = 2200;
const REDUCED_WRONG_REVIEW_MS = 1300;
const CAMPAIGN_PROBLEMS_PER_LEVEL = 12;
const LEGACY_SOUND_KEYS = ["whose-left-sound"] as const;

const CAMPAIGN_LEVELS: ReadonlyArray<{
  id: CampaignLevelId;
  label: Difficulty;
}> = [
  { id: "starter", label: "Starter" },
  { id: "junior", label: "Junior" },
  { id: "expert", label: "Expert" },
  { id: "wizard", label: "Wizard" },
];

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
  const { label } = campaignLevel(levelId);
  return CAMPAIGN_ROUNDS.filter((round) => round.difficulty === label);
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

function tryBuildInfiniteSessionRound(
  ordinal: number,
  seenFingerprints: Set<string>,
  difficulty: Difficulty,
): SessionRound | null {
  try {
    const round = generateInfiniteRound(
      difficulty,
      Math.random,
      seenFingerprints,
    );
    const fingerprint = roundFingerprint(round);
    seenFingerprints.add(fingerprint);
    return {
      id: `infinite-${ordinal}-${fingerprint}`,
      ordinal,
      round,
    };
  } catch {
    return null;
  }
}

function sequenceMismatchIndexes(
  selected: AnswerSequence,
  correct: AnswerSequence,
): readonly number[] {
  return Array.from(
    { length: Math.max(selected.length, correct.length) },
    (_, index) => index,
  ).filter((index) => selected[index] !== correct[index]);
}

function feedbackForOption(round: Round, optionKind: OptionKind): string {
  if (round.difficulty === "Wizard") {
    return "That order does not fit from Start to Finish.";
  }

  switch (optionKind) {
    case "opposite-side":
      return `Those people are on your ${
        round.querySide === "left" ? "right" : "left"
      }.`;
    case "reversed-order":
      return "Right people, reverse order. Begin at Start.";
    case "one-person-off":
      return "One stop falls on the other side.";
    case "correct":
      return "Follow the highlighted side from Start to Finish.";
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input, textarea, select, [role='textbox']"))
  );
}

export default function WhoseLeftPage() {
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
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [campaignReviewSelection, setCampaignReviewSelection] =
    useState<CampaignReviewSelection | null>(null);

  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const levelCompleteButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const historicalReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const campaignMarkerRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
  const reviewOriginIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTokenRef = useRef(0);
  const inputLockedRef = useRef(false);
  const shouldFocusFirstOption = useRef(false);
  const retryFocusIndexRef = useRef<number | null>(null);
  const infiniteFingerprintsRef = useRef(new Set<string>());
  const infiniteAdaptiveRef = useRef(initialInfiniteAdaptiveState());

  const progressionControlled = progression.mode === "controlled";
  const progressionRound = progressionControlled && progression.current
    ? {
        id: progression.current.playId,
        ordinal: progression.currentQuestionNumber,
        round: progression.current.round,
      }
    : undefined;
  const gameplayStarted = progressionControlled
    ? progression.sectionIntro === null
    : started;
  const isCampaign =
    !progressionControlled && sessionMode === "campaign";
  const isInfinite =
    !progressionControlled && sessionMode === "infinite";
  const isRedemption =
    progressionControlled
      ? progression.isRedemption
      : sessionMode === "redemption";
  const campaignProblemIndex = campaignCursors[activeCampaignLevel];
  const campaignSessionRound = buildCampaignSessionRound(
    activeCampaignLevel,
    campaignProblemIndex,
  );
  const activeSessionRound = progressionControlled
    ? progressionRound
    : isCampaign
      ? campaignSessionRound
      : (roundQueue[roundCursor] ?? roundQueue[0]);
  const round = activeSessionRound?.round ?? CAMPAIGN_ROUNDS[0];
  const crossingCount = routeCrossings(round.route).length;
  const routeComplexityLabel =
    crossingCount === 0
      ? "No crossings yet"
      : `${crossingCount} ${crossingCount === 1 ? "bridge" : "bridges"}`;
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
  const selectedKind =
    selectedIndex === null ? null : round.optionKinds[selectedIndex];
  const selectedMismatches =
    selectedIndex !== null && !selectedCorrect
      ? sequenceMismatchIndexes(
          round.options[selectedIndex],
          round.correctSequence,
        )
      : [];
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
  const revealSide =
    phase === "correct-reveal" ||
    phase === "answered" ||
    (phase === "wrong-review" && round.difficulty !== "Wizard");
  const animateTrace =
    phase === "correct-reveal" ||
    (phase === "wrong-review" && round.difficulty !== "Wizard");

  const clearFeedbackTimer = useCallback(() => {
    if (!feedbackTimerRef.current) return;
    clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = null;
  }, []);

  const resetAttemptState = useCallback(() => {
    feedbackTokenRef.current += 1;
    clearFeedbackTimer();
    inputLockedRef.current = false;
    retryFocusIndexRef.current = null;
    setSelectedIndex(null);
    setRetryReady(false);
    setPhase("idle");
    setGenerationError(null);
  }, [clearFeedbackTimer]);

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
        !gameplayStarted ||
        campaignReviewSelection !== null ||
        (!progressionControlled &&
          isCampaign &&
          activeCampaignLevelComplete) ||
        !activeSessionRound
      ) {
        return;
      }

      inputLockedRef.current = true;
      setRetryReady(false);
      setGenerationError(null);
      const isCorrect = optionIndex === round.correctIndex;
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      if (progressionControlled) {
        progression.answer({
          correct: isCorrect,
          answerToken: `option-${optionIndex}`,
        });
      }
      playFeedbackSound(isCorrect);
      setSelectedIndex(optionIndex);
      setPhase(isCorrect ? "correct-reveal" : "wrong-review");

      if (!progressionControlled && isCampaign) {
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

      if (!progressionControlled && isInfinite) {
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

      if (!progressionControlled && isCorrect) {
        setCompletedCount((current) => current + 1);
      } else if (
        !progressionControlled &&
        !isCorrect &&
        !isRedemption
      ) {
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

      const feedbackToken = feedbackTokenRef.current + 1;
      feedbackTokenRef.current = feedbackToken;
      clearFeedbackTimer();
      feedbackTimerRef.current = setTimeout(
        () => {
          if (feedbackTokenRef.current !== feedbackToken) return;

          if (isCorrect) {
            setPhase("answered");
            return;
          }

          if (progressionControlled) progression.retry();
          retryFocusIndexRef.current = optionIndex;
          inputLockedRef.current = false;
          setSelectedIndex(null);
          setRetryReady(true);
          setPhase("idle");
        },
        isCorrect
          ? reducedMotion
            ? REDUCED_CORRECT_REVEAL_MS
            : CORRECT_REVEAL_MS
          : reducedMotion
            ? REDUCED_WRONG_REVIEW_MS
            : WRONG_REVIEW_MS,
      );
    },
    [
      activeCampaignLevelComplete,
      activeSessionRound,
      campaignReviewSelection,
      clearFeedbackTimer,
      complete,
      isCampaign,
      isInfinite,
      isRedemption,
      phase,
      playFeedbackSound,
      progression,
      progressionControlled,
      round,
      gameplayStarted,
    ],
  );

  const startCampaign = useCallback(() => {
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    infiniteAdaptiveRef.current = initialAdaptive;
    setSessionMode("campaign");
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
    setCampaignReviewSelection(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setStarted(true);
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, resumeAudio]);

  const startInfinite = useCallback(() => {
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    const firstRound = tryBuildInfiniteSessionRound(
      1,
      infiniteFingerprintsRef.current,
      initialAdaptive.targetDifficulty,
    );
    if (!firstRound) {
      setGenerationError("Could not build a fresh route. Try Infinite again.");
      return;
    }

    infiniteAdaptiveRef.current = initialAdaptive;
    setSessionMode("infinite");
    setRoundQueue([firstRound]);
    setRoundCursor(0);
    setInfiniteAdaptive(initialAdaptive);
    setCompletedCount(0);
    setMistakes([]);
    setRedemptionTotal(0);
    setReviewLevelId(null);
    setCampaignReviewSelection(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setStarted(true);
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, resumeAudio]);

  const selectCampaignLevel = useCallback(
    (levelId: CampaignLevelId) => {
      if (
        !isCampaign ||
        phase !== "idle" ||
        campaignReviewSelection !== null ||
        levelId === activeCampaignLevel
      ) {
        return;
      }

      resetAttemptState();
      setCampaignReviewSelection(null);
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
      isCampaign,
      phase,
      resetAttemptState,
    ],
  );

  const openCampaignReview = useCallback(
    (levelId: CampaignLevelId, problemIndex: number) => {
      const id = campaignRoundId(levelId, problemIndex);
      if (
        !isCampaign ||
        phase !== "idle" ||
        campaignReviewSelection !== null ||
        !campaignProgress[id]?.solved
      ) {
        return;
      }
      reviewOriginIdRef.current = id;
      setCampaignReviewSelection({ levelId, problemIndex });
    },
    [campaignProgress, campaignReviewSelection, isCampaign, phase],
  );

  const closeCampaignReview = useCallback(() => {
    const originId = reviewOriginIdRef.current;
    setCampaignReviewSelection(null);
    window.requestAnimationFrame(() => {
      if (originId) campaignMarkerRefs.current[originId]?.focus();
    });
  }, []);

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
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, visibleMistakes]);

  const goNext = useCallback(() => {
    if (phase !== "answered" || campaignReviewSelection !== null) return;

    if (progressionControlled) {
      progression.setInteractionState("blocked");
      progression.advance();
      resetAttemptState();
      shouldFocusFirstOption.current = true;
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
      const nextRound = tryBuildInfiniteSessionRound(
        nextOrdinal,
        infiniteFingerprintsRef.current,
        infiniteAdaptiveRef.current.targetDifficulty,
      );
      if (!nextRound) {
        setGenerationError(
          "Could not build a fresh route. Try another puzzle.",
        );
        return;
      }

      shouldFocusFirstOption.current = true;
      resetAttemptState();
      setRoundQueue((current) => [...current, nextRound]);
      setRoundCursor((current) => current + 1);
      return;
    }

    if (isLastRedemptionRound) {
      const redeemedIds = redemptionMistakeIds;
      resetAttemptState();
      setRedeemedMistakeIds((current) => [
        ...new Set([...current, ...redeemedIds]),
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
    progression,
    progressionControlled,
    redemptionMistakeIds,
    reviewLevelId,
    resetAttemptState,
    roundCursor,
  ]);

  const endInfinite = useCallback(() => {
    if (
      !isInfinite ||
      completedCount === 0 ||
      phase === "correct-reveal" ||
      phase === "wrong-review"
    ) {
      return;
    }
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
    const enabled = readSoundPreference(LEGACY_SOUND_KEYS);
    if (enabled) return;
    const timer = window.setTimeout(() => setSoundEnabled(enabled), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const progressionPlayId =
    progressionControlled && progression.current
      ? `${progression.attemptId}:${
          progression.isRedemption ? "redemption" : "main"
        }:${
          progression.current.playId
        }`
      : null;
  const hydratedProgressionPlayIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !progressionControlled ||
      !progression.current ||
      !progressionPlayId ||
      hydratedProgressionPlayIdRef.current === progressionPlayId
    ) {
      return;
    }
    feedbackTokenRef.current += 1;
    clearFeedbackTimer();
    retryFocusIndexRef.current = null;
    const controlled = progression;
    const savedOptionIndex = progressionOptionIndexFromAnswerToken(
      controlled.lastAnswerToken,
    );
    const timer = window.setTimeout(() => {
      hydratedProgressionPlayIdRef.current = progressionPlayId;
      setGenerationError(null);
      if (controlled.roundPhase === "solved" && controlled.current) {
        inputLockedRef.current = true;
        setSelectedIndex(controlled.current.round.correctIndex);
        setRetryReady(false);
        setPhase("answered");
        shouldFocusFirstOption.current = false;
      } else if (
        controlled.roundPhase === "feedback" &&
        controlled.current &&
        savedOptionIndex !== null &&
        savedOptionIndex < controlled.current.round.options.length &&
        savedOptionIndex !== controlled.current.round.correctIndex
      ) {
        inputLockedRef.current = true;
        setSelectedIndex(savedOptionIndex);
        setRetryReady(false);
        setPhase("wrong-review");
        shouldFocusFirstOption.current = false;
        const hydrationToken = feedbackTokenRef.current;
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        feedbackTimerRef.current = setTimeout(
          () => {
            if (feedbackTokenRef.current !== hydrationToken) return;
            controlled.retry();
            retryFocusIndexRef.current = savedOptionIndex;
            inputLockedRef.current = false;
            setSelectedIndex(null);
            setRetryReady(true);
            setPhase("idle");
          },
          reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
        );
      } else {
        if (controlled.roundPhase === "feedback") controlled.retry();
        inputLockedRef.current = false;
        setSelectedIndex(null);
        setRetryReady(controlled.currentAttemptCount > 0);
        setPhase("idle");
        shouldFocusFirstOption.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    clearFeedbackTimer,
    progression,
    progressionControlled,
    progressionPlayId,
  ]);

  useEffect(() => {
    if (!progressionControlled) return;
    if (
      progression.current &&
      progressionPlayId &&
      hydratedProgressionPlayIdRef.current !== progressionPlayId
    ) {
      return;
    }
    progression.setTurboClockPaused(!progression.current);
    const desiredState =
      !progression.current ||
      progression.stage === "redemption-ready"
        ? "blocked"
        : progression.roundPhase === "feedback"
          ? "mandatory-feedback"
          : progression.roundPhase === "solved" ||
              phase === "answered"
            ? "blocked"
            : phase === "idle"
              ? "answering"
              : "mandatory-feedback";
    if (progression.interactionState !== desiredState) {
      progression.setInteractionState(desiredState);
    }
  }, [
    phase,
    progression,
    progressionControlled,
    progressionPlayId,
  ]);

  useEffect(() => {
    if (progression.mode !== "redirect") return;
    const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(
      /\/$/,
      "",
    );
    const query = new URLSearchParams(progression.navigationTarget.query);
    const suffix = query.size ? `?${query.toString()}` : "";
    window.location.assign(
      `${basePath}${progression.navigationTarget.pathname}${suffix}`,
    );
  }, [progression]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        !gameplayStarted ||
        complete ||
        campaignReviewSelection !== null ||
        phase !== "idle" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableTarget(event.target)
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
    gameplayStarted,
    phase,
  ]);

  useEffect(() => {
    if (phase === "answered") nextButtonRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (
      shouldFocusFirstOption.current &&
      gameplayStarted &&
      !complete &&
      campaignReviewSelection === null
    ) {
      optionButtonRefs.current[0]?.focus();
      shouldFocusFirstOption.current = false;
    }
  }, [
    activeCampaignLevel,
    campaignProblemIndex,
    campaignReviewSelection,
    complete,
    roundCursor,
    sessionMode,
    gameplayStarted,
  ]);

  useEffect(() => {
    if (phase === "idle" && retryReady && retryFocusIndexRef.current !== null) {
      optionButtonRefs.current[retryFocusIndexRef.current]?.focus();
      retryFocusIndexRef.current = null;
    }
  }, [phase, retryReady]);

  useEffect(() => {
    if (complete) resultHeadingRef.current?.focus();
  }, [complete]);

  useEffect(() => {
    if (showCampaignLevelComplete) levelCompleteButtonRef.current?.focus();
  }, [activeCampaignLevel, showCampaignLevelComplete]);

  useEffect(() => {
    if (campaignReviewSelection) {
      historicalReviewHeadingRef.current?.focus();
    }
  }, [campaignReviewSelection]);

  useEffect(
    () => () => {
      feedbackTokenRef.current += 1;
      clearFeedbackTimer();
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    },
    [clearFeedbackTimer],
  );

  const infiniteFirstTryScore = infiniteAdaptive.attempts.filter(
    ({ firstTryCorrect }) => firstTryCorrect,
  ).length;
  const firstTryScore = isCampaign
    ? campaignFirstTryScore
    : infiniteFirstTryScore;
  const resultMessage = useMemo(() => {
    const denominator = isInfinite
      ? Math.max(infiniteAdaptive.attempts.length, 1)
      : CAMPAIGN_ROUNDS.length;
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

  return (
    <div className={styles.pageShell}>
      <header className={styles.topbar}>
        <Link
          className={styles.backLink}
          href={progressionControlled ? "/journey/" : "/"}
          aria-label={progressionControlled ? "Journey map" : "All games"}
        >
          <span aria-hidden="true">←</span>
          <span>{progressionControlled ? "Journey" : "Games"}</span>
        </Link>
        <span className={styles.gameTitle}>{whoseLeftGame.title}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {progression.mode === "recovery" ? (
          <ProgressionRecoveryPanel message={progression.message} />
        ) : progression.mode === "redirect" ? null : !gameplayStarted ? (
          <section className={styles.tutorial} aria-labelledby="tutorial-title">
            <div className={styles.tutorialCopy}>
              <p className={styles.kicker}>Example</p>
              <h1 id="tutorial-title">Your left turns with you.</h1>
              <p className={styles.tutorialLede}>
                Walk from <b>S</b> to <b>F</b>. Keep your side as the path bends;
                Campaign adds windings and marked bridges step by step.
              </p>
            </div>

            <div className={styles.examplePanel}>
              <RouteBoard round={EXAMPLE.round} revealSide />
              <div className={styles.exampleAnswers}>
                <div className={styles.exampleCorrect}>
                  <span className={styles.exampleLabel}>Passed on the left</span>
                  <Sequence round={EXAMPLE.round} sequence={EXAMPLE.answer} />
                  <span className={styles.exampleMark} aria-label="Correct">
                    ✓
                  </span>
                </div>
                <div className={styles.exampleNearMatch}>
                  <span className={styles.exampleLabel}>Other side</span>
                  <Sequence round={EXAMPLE.round} sequence={EXAMPLE.nearMatch} />
                  <span className={styles.exampleWrongMark} aria-label="Not the left side">
                    ×
                  </span>
                </div>
              </div>
            </div>

            {progressionControlled && progression.sectionIntro ? (
              <ProgressionCulminationSectionIntro
                gameTitle={whoseLeftGame.title}
                section={progression.sectionIntro}
                onBegin={progression.beginSection}
              />
            ) : (
              <div
                className={styles.modeActions}
                aria-label="Choose a game mode"
              >
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={startCampaign}
                  disabled={progression.mode === "booting"}
                >
                  Campaign
                  <span aria-hidden="true">→</span>
                </button>
                <button
                  className={styles.modeButton}
                  type="button"
                  onClick={startInfinite}
                  disabled={progression.mode === "booting"}
                >
                  <span aria-hidden="true">∞</span>
                  Infinite
                </button>
              </div>
            )}
            <p
              className={styles.generationMessage}
              role="status"
              aria-live="polite"
            >
              {generationError}
            </p>
          </section>
        ) : !complete ? (
          <>
            {progressionControlled ? (
              <ProgressionGameHud
                mode={progression.runKind}
                levelLabel={
                  progression.level[0].toUpperCase() +
                  progression.level.slice(1)
                }
                current={progression.currentQuestionNumber}
                total={progression.totalQuestions}
                remainingMs={progression.turboRemainingMs ?? undefined}
                paused={progression.turboClockPaused}
                redemption={progression.isRedemption}
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
                          aria-current={
                            activeCampaignLevel === level.id
                              ? "page"
                              : undefined
                          }
                          aria-controls="campaign-play-area"
                          aria-label={`${level.label}, ${levelState}`}
                          disabled={
                            phase !== "idle" ||
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
                                : `${marker}; review problem`
                            }`}
                            aria-current={isCurrent ? "step" : undefined}
                            aria-pressed={isReviewing}
                            disabled={
                              !problem?.solved ||
                              phase !== "idle" ||
                              campaignReviewSelection !== null
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
                      style={{ width: `${infiniteEnergy}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-label="Review progress"
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
                    phase === "correct-reveal" ||
                    phase === "wrong-review"
                  }
                >
                  End
                </button>
              ) : null}
              </div>
            )}

            {progressionControlled &&
            progression.stage === "redemption-ready" ? (
              <ProgressionRedemptionIntro
                attempt={progression.attempt}
                onBegin={progression.beginRedemption}
              />
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
                  <RouteBoard
                    round={historicalSessionRound.round}
                    revealSide
                    completed
                  />
                  <div className={styles.historicalReviewAnswers}>
                    <p className={styles.kicker}>
                      {questionForRound(historicalSessionRound.round)}
                    </p>
                    <div
                      className={styles.historicalAnswer}
                      aria-label={`Correct answer: ${sequenceAccessibleLabel(
                        historicalSessionRound.round,
                        historicalSessionRound.round.correctSequence,
                      )}`}
                    >
                      <span>Correct answer</span>
                      <Sequence
                        round={historicalSessionRound.round}
                        sequence={
                          historicalSessionRound.round.correctSequence
                        }
                      />
                      <b aria-label="Correct">✓</b>
                    </div>
                    {historicalMistake ? (
                      <div
                        className={`${styles.historicalAnswer} ${styles.historicalWrongAnswer}`}
                        aria-label={`Your first incorrect answer: ${sequenceAccessibleLabel(
                          historicalSessionRound.round,
                          historicalSessionRound.round.options[
                            historicalMistake.chosenIndex
                          ],
                        )}`}
                      >
                        <span>Your first answer</span>
                        <Sequence
                          round={historicalSessionRound.round}
                          sequence={
                            historicalSessionRound.round.options[
                              historicalMistake.chosenIndex
                            ]
                          }
                          mismatchIndexes={sequenceMismatchIndexes(
                            historicalSessionRound.round.options[
                              historicalMistake.chosenIndex
                            ],
                            historicalSessionRound.round.correctSequence,
                          )}
                        />
                        <b aria-label="Incorrect">×</b>
                      </div>
                    ) : null}
                    <p className={styles.historicalExplanation}>
                      Follow the highlighted{" "}
                      {historicalSessionRound.round.querySide} side from Start
                      to Finish.
                      {historicalMistake
                        ? ` ${feedbackForOption(
                            historicalSessionRound.round,
                            historicalSessionRound.round.optionKinds[
                              historicalMistake.chosenIndex
                            ],
                          )}`
                        : ""}
                    </p>
                  </div>
                </div>
              </section>
            ) : showCampaignLevelComplete ? (
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
            ) : (
              <>
                <div className={styles.questionRow}>
                  <p className={styles.kicker}>
                    {round.difficulty === "Wizard"
                      ? `One direction cue · ${routeComplexityLabel}`
                      : `${round.route.segments.length} sections · ${routeComplexityLabel}`}
                  </p>
                  <h1>{questionForRound(round)}</h1>
                </div>

                <div className={styles.gameBoard} id="campaign-play-area">
                  <section
                    className={styles.routePanel}
                    aria-label="Route puzzle"
                  >
                    <RouteBoard
                      round={round}
                      revealSide={revealSide}
                      animateTrace={animateTrace}
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
                          (phase === "correct-reveal" ||
                            phase === "answered") &&
                          isCorrect;
                        const showWrong =
                          phase === "wrong-review" &&
                          isSelected &&
                          !isCorrect;
                        const muted =
                          ((phase === "correct-reveal" ||
                            phase === "answered") &&
                            !isCorrect) ||
                          (phase === "wrong-review" && !isSelected);
                        const mismatchIndexes =
                          showWrong && round.difficulty !== "Wizard"
                            ? selectedMismatches
                            : [];
                        const answerState = showCorrect
                          ? ", correct answer"
                          : showWrong
                            ? `, your answer; ${selectedMismatches.length} positions do not fit`
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
                            }: ${sequenceAccessibleLabel(
                              round,
                              option,
                            )}${answerState}`}
                            aria-keyshortcuts={`${optionIndex + 1}`}
                            ref={(node) => {
                              optionButtonRefs.current[optionIndex] = node;
                            }}
                            key={`${optionIndex}-${option.join("-")}`}
                          >
                            <span
                              className={styles.optionNumber}
                              aria-hidden="true"
                            >
                              {optionIndex + 1}
                            </span>
                            <Sequence
                              round={round}
                              sequence={option}
                              mismatchIndexes={mismatchIndexes}
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
                  {phase === "wrong-review" && selectedKind ? (
                    <strong className={styles.wrongText}>
                      Not quite · {feedbackForOption(round, selectedKind)}
                    </strong>
                  ) : phase === "correct-reveal" ? (
                    <strong className={styles.correctText}>
                      Correct · Follow the highlighted side.
                    </strong>
                  ) : phase === "answered" ? (
                    <>
                      <strong
                        className={
                          generationError
                            ? styles.wrongText
                            : styles.correctText
                        }
                      >
                        {generationError ?? "Correct"}
                      </strong>
                      <button
                        className={styles.nextButton}
                        type="button"
                        onClick={goNext}
                        ref={nextButtonRef}
                      >
                        {generationError
                          ? "Try another route"
                          : isLastRedemptionRound
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
              <div className={styles.reviewGrid} aria-label="Puzzles to retry">
                {visibleMistakes.map(
                  ({ sessionRound: missed, chosenIndex }) => {
                    const missedRound = missed.round;
                    const wrongSequence = missedRound.options[chosenIndex];
                    const optionKind = missedRound.optionKinds[chosenIndex];

                    return (
                      <article className={styles.reviewCard} key={missed.id}>
                        <span className={styles.reviewRound}>
                          {missed.campaign
                            ? `${missed.campaign.levelLabel} · Puzzle ${
                                missed.campaign.problemIndex + 1
                              }`
                            : `Puzzle ${missed.ordinal} · ${missedRound.difficulty}`}
                        </span>
                        <RouteBoard round={missedRound} compact />
                        <div className={styles.reviewAnswer}>
                          <span>Your answer</span>
                          <Sequence
                            round={missedRound}
                            sequence={wrongSequence}
                            compact
                          />
                          <b aria-label="Incorrect">×</b>
                        </div>
                        <p>{feedbackForOption(missedRound, optionKind)}</p>
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
    </div>
  );
}
