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

import {
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import {
  AnswerLoad,
  BalanceScale,
  ExampleVisual,
  PuzzleVisual,
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

  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const levelCompleteButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const generationRetryRef = useRef<HTMLButtonElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTokenRef = useRef(0);
  const inputLockedRef = useRef(false);
  const shouldFocusFirstOption = useRef(false);
  const retryFocusIndexRef = useRef<number | null>(null);
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
    : (roundQueue[roundCursor] ?? null);
  const round = activeSessionRound?.round ?? null;
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
    isCampaign && activeCampaignLevelComplete && phase === "idle";
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
    inputLockedRef.current = false;
    retryFocusIndexRef.current = null;
    setSelectedIndex(null);
    setRetryReady(false);
    setPhase("idle");
  }, [clearAttemptTimers]);

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
        !started ||
        generationError ||
        !round ||
        !activeSessionRound ||
        (isCampaign && activeCampaignLevelComplete)
      ) {
        return;
      }

      const option = round.options[optionIndex];
      if (!option) return;

      inputLockedRef.current = true;
      setRetryReady(false);
      setSelectedIndex(optionIndex);
      setPhase("animating");

      const isCorrect = optionIndex === round.correctIndex;
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
          },
          reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
        );
      }, approachDuration);
    },
    [
      activeCampaignLevelComplete,
      activeSessionRound,
      clearAttemptTimers,
      complete,
      generationError,
      isCampaign,
      isInfinite,
      isRedemption,
      mistakes,
      phase,
      playFeedbackSound,
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
      campaignProgress,
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
    if (phase !== "answered") return;

    if (isCampaign) {
      resetAttemptState();
      if (campaignProblemIndex < CAMPAIGN_PROBLEMS_PER_LEVEL - 1) {
        shouldFocusFirstOption.current = true;
        setCampaignCursors((current) => ({
          ...current,
          [activeCampaignLevel]: campaignProblemIndex + 1,
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
    activeSessionRound?.ordinal,
    campaignProblemIndex,
    isCampaign,
    isInfinite,
    isLastRedemptionRound,
    phase,
    redemptionMistakeIds,
    reviewLevelId,
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
  }, [resetAttemptState, roundQueue.length]);

  const endInfinite = useCallback(() => {
    if (
      !isInfinite ||
      completedCount === 0 ||
      phase === "animating" ||
      phase === "wrong-review"
    ) {
      return;
    }
    resetAttemptState();
    setGenerationError(false);
    setComplete(true);
  }, [completedCount, isInfinite, phase, resetAttemptState]);

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
    function onKeyDown(event: KeyboardEvent) {
      if (
        !started ||
        complete ||
        phase !== "idle" ||
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
  }, [chooseOption, complete, phase, started]);

  useEffect(() => {
    if (phase === "answered") nextButtonRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (
      shouldFocusFirstOption.current &&
      started &&
      !complete &&
      !generationError
    ) {
      optionButtonRefs.current[0]?.focus();
      shouldFocusFirstOption.current = false;
    }
  }, [
    activeCampaignLevel,
    campaignProblemIndex,
    complete,
    generationError,
    roundCursor,
    sessionMode,
    started,
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
  }, [showCampaignLevelComplete]);

  useEffect(() => {
    if (generationError) generationRetryRef.current?.focus();
  }, [generationError]);

  useEffect(() => {
    function finishFeedback() {
      if (!inputLockedRef.current) return;

      if (phase === "animating") {
        animationTokenRef.current += 1;
        clearAttemptTimers();
        if (selectedCorrect) {
          setPhase("answered");
        } else {
          retryFocusIndexRef.current = selectedIndex;
          inputLockedRef.current = false;
          setSelectedIndex(null);
          setRetryReady(true);
          setPhase("idle");
        }
      } else if (phase === "wrong-review") {
        animationTokenRef.current += 1;
        clearAttemptTimers();
        retryFocusIndexRef.current = selectedIndex;
        inputLockedRef.current = false;
        setSelectedIndex(null);
        setRetryReady(true);
        setPhase("idle");
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
    phase,
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
        <Link className={styles.backLink} href="/" aria-label="All games">
          <span aria-hidden="true">←</span>
          <span>Games</span>
        </Link>
        <span className={styles.gameTitle}>{libraGame.title}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {!started ? (
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
                          disabled={phase !== "idle"}
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
                    role="list"
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

                        return (
                          <span
                            className={`${styles.campaignProblem} ${
                              marker === "correct"
                                ? styles.campaignProblemCorrect
                                : marker === "incorrect"
                                  ? styles.campaignProblemIncorrect
                                  : styles.campaignProblemNotDone
                            } ${
                              isCurrent ? styles.campaignProblemCurrent : ""
                            }`}
                            role="listitem"
                            aria-label={`${campaignLevel(activeCampaignLevel).label} problem ${
                              problemIndex + 1
                            }: ${marker === "not-done" ? "not done" : marker}`}
                            aria-current={isCurrent ? "step" : undefined}
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
                    phase === "wrong-review"
                  }
                >
                  End
                </button>
              ) : null}
            </div>

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
            ) : round ? (
              <>
                <div
                  className={styles.gameBoard}
                  id="libra-play-area"
                  aria-busy={
                    phase === "animating" || phase === "wrong-review"
                  }
                >
                  <section
                    className={styles.cluePanel}
                    aria-label="Balance puzzle"
                  >
                    <PuzzleVisual
                      round={round}
                      candidate={candidateOnGoal}
                      outcome={answerOutcome}
                      teaching={selectedCorrect && phase !== "idle"}
                      revealDifferences={phase === "wrong-review"}
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
                            disabled={phase !== "idle"}
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
    </div>
  );
}
