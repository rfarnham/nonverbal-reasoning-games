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
  createGameAudioContext,
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import {
  ROUNDS,
  TUTORIAL,
  applyProgram,
  generateInfiniteRound,
  optionFeedback,
  roundFingerprint,
  type Difficulty,
  type ProcessingDirection,
  type StripRound,
  type TraceStep,
} from "./game-engine";
import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
} from "./infinite-progression";
import { progressionAdapter } from "./progression-adapter";
import {
  RulePipeline,
  StripDiagram,
  TraceStoryboard,
  stateDifferenceIndexes,
} from "./transition-visual";
import styles from "./changing-strips.module.css";

type GamePhase = "idle" | "animating" | "wrong-review" | "answered";
type SessionMode = "campaign" | "infinite" | "redemption";
type CampaignLevelId = "starter" | "junior" | "expert" | "wizard";
type CampaignMarker = "correct" | "incorrect";

type SessionRound = Readonly<{
  id: string;
  ordinal: number;
  round: StripRound;
  campaign?: Readonly<{
    levelId: CampaignLevelId;
    levelLabel: Difficulty;
    problemIndex: number;
  }>;
}>;

type MistakeRecord = Readonly<{
  sessionRound: SessionRound;
  chosenIndex: number;
}>;

type CampaignProblemProgress = Readonly<{
  solved: boolean;
  firstAttempt: CampaignMarker;
}>;

type CampaignProgress = Readonly<
  Record<string, CampaignProblemProgress | undefined>
>;

type CampaignCursors = Record<CampaignLevelId, number>;

type CampaignReviewSelection = Readonly<{
  levelId: CampaignLevelId;
  problemIndex: number;
}>;

type CustomProperties = CSSProperties & Record<`--${string}`, string | number>;

const GAME_TITLE = "Changing Strips";
const CAMPAIGN_PROBLEMS_PER_LEVEL = 12;
const TRACE_STEP_MS = 850;
const REDUCED_TRACE_MS = 140;
const WRONG_REVIEW_MS = 2200;
const REDUCED_WRONG_REVIEW_MS = 1300;

const CAMPAIGN_LEVELS: ReadonlyArray<
  Readonly<{
    id: CampaignLevelId;
    label: Difficulty;
  }>
> = [
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

function campaignRounds(levelId: CampaignLevelId): readonly StripRound[] {
  return ROUNDS.filter(
    ({ difficulty }) => difficulty === campaignLevel(levelId).label,
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
  const round = campaignRounds(levelId)[problemIndex];
  if (!round) return null;
  const levelIndex = CAMPAIGN_LEVELS.findIndex(({ id }) => id === levelId);
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
    const level =
      CAMPAIGN_LEVELS[(currentIndex + offset) % CAMPAIGN_LEVELS.length];
    if (!isCampaignLevelComplete(progress, level.id)) return level.id;
  }
  return null;
}

function oppositeDirection(
  direction: ProcessingDirection,
): ProcessingDirection {
  return direction === "ltr" ? "rtl" : "ltr";
}

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

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

function tryBuildInfiniteSessionRound(
  ordinal: number,
  difficulty: Difficulty,
  seenFingerprints: ReadonlySet<string>,
): { sessionRound: SessionRound; fingerprint: string } | null {
  try {
    const round = generateInfiniteRound(
      difficulty,
      Math.random,
      seenFingerprints,
    );
    const fingerprint = roundFingerprint(round);
    return {
      sessionRound: {
        id: `infinite-${ordinal}-${fingerprint}`,
        ordinal,
        round,
      },
      fingerprint,
    };
  } catch {
    // Generation owns a fixed attempt budget and fails without serving a round.
    return null;
  }
}

function TutorialExample() {
  const trace = applyProgram(
    TUTORIAL.input,
    TUTORIAL.rules,
    TUTORIAL.processingDirection,
  );
  const wrongDirection = oppositeDirection(TUTORIAL.processingDirection);
  const nearMiss = applyProgram(
    TUTORIAL.input,
    TUTORIAL.rules,
    wrongDirection,
  ).output;

  return (
    <div className={styles.example}>
      <div className={styles.examplePrompt}>
        <span className={styles.exampleLabel}>Start strip</span>
        <StripDiagram
          cells={TUTORIAL.input}
          variant="example"
          label="Example starting strip with nine solid, open, and striped tiles"
        />
      </div>
      <RulePipeline
        rules={TUTORIAL.rules}
        processingDirection={TUTORIAL.processingDirection}
        trace={trace.steps}
        sourceStrip={TUTORIAL.input}
      />
      <div className={styles.exampleProof}>
        <TraceStoryboard input={TUTORIAL.input} steps={trace.steps} />
      </div>
      <div className={styles.nearMiss} aria-label="Common mistake">
        <span className={styles.nearMissMark} aria-hidden="true">
          ×
        </span>
        <div>
          <strong>Wrong end</strong>
          <span className={styles.miniDirection} aria-hidden="true">
            {wrongDirection === "ltr" ? "START →" : "← START"}
          </span>
        </div>
        <StripDiagram
          cells={nearMiss}
          variant="review"
          label="Near-match made by starting from the wrong end"
        />
      </div>
    </div>
  );
}

export default function ChangingStripsPage() {
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
  const [traceStepIndex, setTraceStepIndex] = useState<number | null>(null);
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
  const [campaignReviewSelection, setCampaignReviewSelection] =
    useState<CampaignReviewSelection | null>(null);

  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const levelCompleteButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const generationRetryRef = useRef<HTMLButtonElement>(null);
  const historicalReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const historicalReviewOriginRef = useRef<HTMLButtonElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const traceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTokenRef = useRef(0);
  const inputLockedRef = useRef(false);
  const shouldFocusFirstOption = useRef(false);
  const retryFocusIndexRef = useRef<number | null>(null);
  const infiniteFingerprintsRef = useRef(new Set<string>());
  const infiniteAdaptiveRef = useRef(initialInfiniteAdaptiveState());
  const hydratedProgressionPlayIdRef = useRef<string | null>(null);

  const controlledSession =
    progression.mode === "controlled" ? progression : null;
  const hasStarted = controlledSession
    ? controlledSession.sectionIntro === null
    : started;
  const isCampaign =
    controlledSession === null && sessionMode === "campaign";
  const isInfinite =
    controlledSession === null && sessionMode === "infinite";
  const isRedemption =
    controlledSession?.isRedemption ?? sessionMode === "redemption";
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
  const trace = useMemo(
    () =>
      round
        ? applyProgram(round.input, round.rules, round.processingDirection)
        : null,
    [round],
  );
  const sessionLength = roundQueue.length;
  const selectedOption =
    selectedIndex !== null && round ? round.options[selectedIndex] : null;
  const selectedCorrect =
    selectedIndex !== null &&
    round !== null &&
    selectedIndex === round.correctIndex;
  const selectedDifferences =
    selectedOption && round
      ? stateDifferenceIndexes(round.answer, selectedOption.strip)
      : [];
  const activeTraceRuleIndex =
    phase === "animating" &&
    traceStepIndex !== null &&
    trace?.steps[traceStepIndex]
      ? trace.steps[traceStepIndex].ruleIndex
      : null;
  const progress = roundCursor + (phase === "answered" ? 1 : 0);
  const isLastRedemptionRound =
    isRedemption &&
    (controlledSession
      ? controlledSession.totalQuestions !== null &&
        controlledSession.currentQuestionNumber ===
          controlledSession.totalQuestions
      : roundCursor === sessionLength - 1);
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
    if (traceIntervalRef.current) {
      clearInterval(traceIntervalRef.current);
      traceIntervalRef.current = null;
    }
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
    setTraceStepIndex(null);
    setRetryReady(false);
    setPhase("idle");
  }, [clearAttemptTimers]);

  const ensureAudioContext = useCallback(() => {
    if (
      audioContextRef.current === null ||
      audioContextRef.current.state === "closed"
    ) {
      audioContextRef.current = createGameAudioContext();
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
      if (context.state === "running") {
        playFeedbackEarcon(context, correct);
      }
    },
    [ensureAudioContext, soundEnabled],
  );

  const startTracePlayback = useCallback(
    (steps: readonly TraceStep[]) => {
      clearAttemptTimers();
      const token = animationTokenRef.current + 1;
      animationTokenRef.current = token;
      inputLockedRef.current = true;
      setRetryReady(false);
      setPhase("animating");

      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (reducedMotion || steps.length === 0) {
        setTraceStepIndex(Math.max(steps.length - 1, 0));
        feedbackTimerRef.current = setTimeout(() => {
          if (animationTokenRef.current !== token) return;
          setTraceStepIndex(null);
          setPhase("answered");
        }, REDUCED_TRACE_MS);
        return;
      }

      let stepIndex = 0;
      setTraceStepIndex(stepIndex);
      traceIntervalRef.current = setInterval(() => {
        if (animationTokenRef.current !== token) return;
        stepIndex += 1;
        if (stepIndex >= steps.length) {
          if (traceIntervalRef.current) {
            clearInterval(traceIntervalRef.current);
            traceIntervalRef.current = null;
          }
          setTraceStepIndex(null);
          setPhase("answered");
          return;
        }
        setTraceStepIndex(stepIndex);
      }, TRACE_STEP_MS);
    },
    [clearAttemptTimers],
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
        !trace ||
        !activeSessionRound ||
        campaignReviewSelection !== null ||
        (isCampaign && activeCampaignLevelComplete)
      ) {
        return;
      }

      const option = round.options[optionIndex];
      if (!option) return;
      const isCorrect = optionIndex === round.correctIndex;
      const wasMissed = mistakes.some(
        ({ sessionRound }) => sessionRound.id === activeSessionRound.id,
      );
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      inputLockedRef.current = true;
      setRetryReady(false);
      setSelectedIndex(optionIndex);
      setTraceStepIndex(null);
      playFeedbackSound(isCorrect);
      controlledSession?.answer({
        correct: isCorrect,
        answerToken: `option-${optionIndex}`,
      });

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

      if (isCorrect) {
        startTracePlayback(trace.steps);
        return;
      }

      clearAttemptTimers();
      const token = animationTokenRef.current + 1;
      animationTokenRef.current = token;
      setPhase("wrong-review");
      setTraceStepIndex(null);
      reviewTimerRef.current = setTimeout(
        () => {
          if (animationTokenRef.current !== token) return;
          controlledSession?.retry();
          retryFocusIndexRef.current = optionIndex;
          inputLockedRef.current = false;
          setRetryReady(true);
          setPhase("idle");
        },
        reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
      );
    },
    [
      activeCampaignLevelComplete,
      activeSessionRound,
      campaignReviewSelection,
      clearAttemptTimers,
      complete,
      controlledSession,
      generationError,
      hasStarted,
      isCampaign,
      isInfinite,
      isRedemption,
      mistakes,
      phase,
      playFeedbackSound,
      round,
      startTracePlayback,
      trace,
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
    setCampaignReviewSelection(null);
    historicalReviewOriginRef.current = null;
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
      initialAdaptive.targetDifficulty,
      infiniteFingerprintsRef.current,
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
    setCampaignReviewSelection(null);
    historicalReviewOriginRef.current = null;
    setStarted(true);
    setComplete(false);
    resetAttemptState();
    setGenerationError(!generated);
    shouldFocusFirstOption.current = Boolean(generated);
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
      setActiveCampaignLevel(levelId);
      shouldFocusFirstOption.current = !isCampaignLevelComplete(
        campaignProgress,
        levelId,
      );
    },
    [
      activeCampaignLevel,
      campaignProgress,
      campaignReviewSelection,
      isCampaign,
      phase,
      resetAttemptState,
    ],
  );

  const openCampaignReview = useCallback(
    (
      levelId: CampaignLevelId,
      problemIndex: number,
      origin: HTMLButtonElement,
    ) => {
      const problem = campaignProgress[campaignRoundId(levelId, problemIndex)];
      if (
        !isCampaign ||
        phase !== "idle" ||
        !problem?.solved ||
        campaignReviewSelection !== null
      ) {
        return;
      }
      historicalReviewOriginRef.current = origin;
      setCampaignReviewSelection({ levelId, problemIndex });
    },
    [campaignProgress, campaignReviewSelection, isCampaign, phase],
  );

  const closeCampaignReview = useCallback(() => {
    const origin = historicalReviewOriginRef.current;
    setCampaignReviewSelection(null);
    window.requestAnimationFrame(() => origin?.focus());
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
    setGenerationError(false);
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, visibleMistakes]);

  const goNext = useCallback(() => {
    if (phase !== "answered") return;

    if (controlledSession) {
      controlledSession.setInteractionState("blocked");
      resetAttemptState();
      controlledSession.advance();
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
      } else {
        shouldFocusFirstOption.current = false;
      }
      return;
    }

    if (isInfinite) {
      const nextOrdinal = (activeSessionRound?.ordinal ?? roundQueue.length) + 1;
      const generated = tryBuildInfiniteSessionRound(
        nextOrdinal,
        infiniteAdaptiveRef.current.targetDifficulty,
        infiniteFingerprintsRef.current,
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
    campaignProblemIndex,
    controlledSession,
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
    const generated = tryBuildInfiniteSessionRound(
      roundQueue.length + 1,
      infiniteAdaptiveRef.current.targetDifficulty,
      infiniteFingerprintsRef.current,
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

  const replayTrace = useCallback(() => {
    if (!trace || phase !== "answered") return;
    startTracePlayback(trace.steps);
  }, [phase, startTracePlayback, trace]);

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeSoundPreference(next);
    if (next) resumeAudio();
  }, [resumeAudio, soundEnabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSoundEnabled(readSoundPreference(["changing-strips-sound"]));
    }, 0);
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
    const savedOptionIndex = progressionOptionIndexFromAnswerToken(
      controlledSession.lastAnswerToken,
    );
    const currentRound = controlledSession.current.round;
    const currentTrace = applyProgram(
      currentRound.input,
      currentRound.rules,
      currentRound.processingDirection,
    );
    const hydrationTimer = window.setTimeout(() => {
      hydratedProgressionPlayIdRef.current = hydrationKey;
      resetAttemptState();
      setGenerationError(false);
      setCampaignReviewSelection(null);

      if (controlledSession.roundPhase === "solved") {
        inputLockedRef.current = true;
        setSelectedIndex(currentRound.correctIndex);
        setTraceStepIndex(null);
        setRetryReady(false);
        setPhase("answered");
        shouldFocusFirstOption.current = false;
        return;
      }

      if (
        controlledSession.roundPhase === "feedback" &&
        savedOptionIndex !== null &&
        savedOptionIndex < currentRound.options.length &&
        savedOptionIndex !== currentRound.correctIndex
      ) {
        const token = animationTokenRef.current;
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        inputLockedRef.current = true;
        setSelectedIndex(savedOptionIndex);
        setTraceStepIndex(Math.max(currentTrace.steps.length - 1, 0));
        setRetryReady(false);
        setPhase("wrong-review");
        shouldFocusFirstOption.current = false;
        reviewTimerRef.current = setTimeout(
          () => {
            if (animationTokenRef.current !== token) return;
            controlledSession.retry();
            retryFocusIndexRef.current = savedOptionIndex;
            inputLockedRef.current = false;
            setTraceStepIndex(null);
            setRetryReady(true);
            setPhase("idle");
          },
          reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
        );
        return;
      }

      if (controlledSession.roundPhase === "feedback") {
        controlledSession.retry();
      }
      inputLockedRef.current = false;
      setSelectedIndex(null);
      setTraceStepIndex(null);
      setRetryReady(controlledSession.currentAttemptCount > 0);
      setPhase("idle");
      shouldFocusFirstOption.current = true;
    }, 0);
    return () => window.clearTimeout(hydrationTimer);
  }, [controlledSession, resetAttemptState]);

  useEffect(() => {
    if (!controlledSession) return;
    if (!controlledSession.current || generationError) {
      controlledSession.setTurboClockPaused(true);
      if (controlledSession.interactionState !== "blocked") {
        controlledSession.setInteractionState("blocked");
      }
      return;
    }
    const hydrationKey = `${controlledSession.attemptId}:${
      controlledSession.isRedemption ? "redemption" : "main"
    }:${controlledSession.current.playId}`;
    if (hydratedProgressionPlayIdRef.current !== hydrationKey) return;
    controlledSession.setTurboClockPaused(false);
    const nextInteractionState =
      controlledSession.roundPhase === "solved" || phase === "answered"
        ? "blocked"
        : controlledSession.roundPhase === "feedback"
          ? "mandatory-feedback"
          : phase === "idle" && !inputLockedRef.current
            ? "answering"
            : "mandatory-feedback";
    if (controlledSession.interactionState !== nextInteractionState) {
      controlledSession.setInteractionState(nextInteractionState);
    }
  }, [controlledSession, generationError, phase]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        !hasStarted ||
        complete ||
        phase !== "idle" ||
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
    campaignReviewSelection,
    chooseOption,
    complete,
    hasStarted,
    phase,
  ]);

  useEffect(() => {
    if (phase === "answered") {
      const frame = window.requestAnimationFrame(() => {
        nextButtonRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [phase]);

  useEffect(() => {
    if (
      shouldFocusFirstOption.current &&
      hasStarted &&
      !complete &&
      !generationError &&
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
    campaignProblemIndex,
    campaignReviewSelection,
    complete,
    generationError,
    hasStarted,
    roundCursor,
    sessionMode,
  ]);

  useEffect(() => {
    if (
      phase === "idle" &&
      retryReady &&
      retryFocusIndexRef.current !== null
    ) {
      optionButtonRefs.current[retryFocusIndexRef.current]?.focus();
      retryFocusIndexRef.current = null;
    }
  }, [phase, retryReady]);

  useEffect(() => {
    if (showCampaignLevelComplete) {
      levelCompleteButtonRef.current?.focus();
    }
  }, [showCampaignLevelComplete]);

  useEffect(() => {
    if (campaignReviewSelection) {
      historicalReviewHeadingRef.current?.focus();
    }
  }, [campaignReviewSelection]);

  useEffect(() => {
    if (complete) resultHeadingRef.current?.focus();
  }, [complete]);

  useEffect(() => {
    if (generationError) generationRetryRef.current?.focus();
  }, [generationError]);

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
  const resultDenominator = reviewLevelId
    ? CAMPAIGN_PROBLEMS_PER_LEVEL
    : isInfinite
      ? infiniteAdaptive.attempts.length
      : ROUNDS.length;
  const displayedResultFirstTryScore = reviewLevelId
    ? reviewLevelFirstTryScore
    : firstTryScore;
  const showRedemptionOffer =
    !isRedemption && visibleMistakes.length > 0;
  const resultTitle = isRedemption
    ? "Redemption complete."
    : showRedemptionOffer
      ? "Here’s your chance at redemption."
      : displayedResultFirstTryScore === resultDenominator
        ? "Perfect set."
        : "Strong practice.";
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
        <span className={styles.gameTitle}>{GAME_TITLE}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {progression.mode === "recovery" ? (
          <ProgressionRecoveryPanel message={progression.message} />
        ) : progression.mode === "redirect" ? null : controlledSession?.stage ===
          "redemption-ready" ? (
          <ProgressionRedemptionIntro
            attempt={controlledSession.attempt}
            onBegin={controlledSession.beginRedemption}
          />
        ) : !hasStarted ? (
          <section className={styles.tutorial} aria-labelledby="tutorial-title">
            <p className={styles.kicker}>Example</p>
            <h1 id="tutorial-title">Follow the arrows.</h1>
            <TutorialExample />
            {controlledSession?.sectionIntro ? (
              <ProgressionCulminationSectionIntro
                gameTitle={GAME_TITLE}
                section={controlledSession.sectionIntro}
                onBegin={controlledSession.beginSection}
              />
            ) : (
              <div className={styles.modeActions} aria-label="Choose a game mode">
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={startCampaign}
                  disabled={progression.mode === "booting"}
                >
                  Campaign <span aria-hidden="true">→</span>
                </button>
                <button
                  className={styles.modeButton}
                  type="button"
                  onClick={startInfinite}
                  disabled={progression.mode === "booting"}
                >
                  <span aria-hidden="true">∞</span> Infinite
                </button>
              </div>
            )}
          </section>
        ) : !complete ? (
          <>
            {controlledSession ? (
              <ProgressionGameHud
                mode={controlledSession.runKind}
                levelLabel={progressionLevelLabel(controlledSession.level)}
                current={controlledSession.currentQuestionNumber}
                total={controlledSession.totalQuestions}
                remainingMs={controlledSession.turboRemainingMs ?? undefined}
                paused={controlledSession.turboClockPaused}
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
                        const state = hasIncorrect
                          ? "incorrect"
                          : levelComplete
                            ? "correct"
                            : "not done";
                        return (
                          <button
                            className={`${styles.campaignLevel} ${
                              state === "correct"
                                ? styles.campaignLevelCorrect
                                : state === "incorrect"
                                  ? styles.campaignLevelIncorrect
                                  : ""
                            } ${
                              activeCampaignLevel === level.id
                                ? styles.campaignLevelActive
                                : ""
                            }`}
                            type="button"
                            aria-pressed={activeCampaignLevel === level.id}
                            aria-controls="changing-strips-play-area"
                            aria-label={`${level.label}, ${state}`}
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
                                    : ""
                              } ${
                                isCurrent ? styles.campaignProblemCurrent : ""
                              }`}
                              type="button"
                              aria-label={`${campaignLevel(activeCampaignLevel).label} problem ${
                                problemIndex + 1
                              }: ${
                                marker === "not-done"
                                  ? "not attempted"
                                  : problem?.solved
                                    ? `${marker}; review completed problem`
                                    : `${marker}; finish problem before review`
                              }`}
                              aria-current={isCurrent ? "step" : undefined}
                              aria-pressed={isReviewing}
                              disabled={
                                !problem?.solved || phase !== "idle"
                              }
                              onClick={(event) =>
                                openCampaignReview(
                                  activeCampaignLevel,
                                  problemIndex,
                                  event.currentTarget,
                                )
                              }
                              key={problemIndex}
                            >
                              <span className={styles.markerNumber}>
                                {problemIndex + 1}
                              </span>
                              <span
                                className={styles.markerSymbol}
                                aria-hidden="true"
                              >
                                {marker === "correct"
                                  ? "✓"
                                  : marker === "incorrect"
                                    ? "×"
                                    : ""}
                              </span>
                            </button>
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
                      className={styles.srOnly}
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
                    style={
                      {
                        "--progress-count": sessionLength,
                      } as CustomProperties
                    }
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
            )}

            {generationError ? (
              <section
                className={styles.recoveryCard}
                aria-labelledby="generation-error-title"
              >
                <p className={styles.kicker}>Infinite paused</p>
                <h2 id="generation-error-title">
                  The next strip needs a redraw.
                </h2>
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
                id="changing-strips-play-area"
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
                id="changing-strips-play-area"
                aria-labelledby="historical-review-title"
              >
                <div className={styles.historicalHeader}>
                  <div>
                    <p className={styles.kicker}>Completed puzzle</p>
                    <h2
                      id="historical-review-title"
                      ref={historicalReviewHeadingRef}
                      tabIndex={-1}
                    >
                      {historicalSessionRound.campaign?.levelLabel} · Puzzle{" "}
                      {(historicalSessionRound.campaign?.problemIndex ?? 0) + 1}
                    </h2>
                  </div>
                  <span
                    className={
                      historicalProgress.firstAttempt === "correct"
                        ? styles.historyCorrect
                        : styles.historyIncorrect
                    }
                  >
                    {historicalProgress.firstAttempt === "correct" ? "✓" : "×"}{" "}
                    First try
                  </span>
                  <button
                    className={styles.closeReviewButton}
                    type="button"
                    onClick={closeCampaignReview}
                  >
                    Close review
                  </button>
                </div>
                <div className={styles.historicalPuzzle}>
                  <StripDiagram
                    cells={historicalSessionRound.round.input}
                    variant="clue"
                    label="Historical puzzle starting strip"
                  />
                  <RulePipeline
                    rules={historicalSessionRound.round.rules}
                    processingDirection={
                      historicalSessionRound.round.processingDirection
                    }
                    trace={
                      applyProgram(
                        historicalSessionRound.round.input,
                        historicalSessionRound.round.rules,
                        historicalSessionRound.round.processingDirection,
                      ).steps
                    }
                    sourceStrip={historicalSessionRound.round.input}
                    compact
                  />
                  <TraceStoryboard
                    input={historicalSessionRound.round.input}
                    steps={
                      applyProgram(
                        historicalSessionRound.round.input,
                        historicalSessionRound.round.rules,
                        historicalSessionRound.round.processingDirection,
                      ).steps
                    }
                  />
                </div>
                <div className={styles.historicalActions}>
                  {historicalMistake ? (
                    <div className={styles.historicalWrong}>
                      <span>Your first answer</span>
                      <StripDiagram
                        cells={
                          historicalSessionRound.round.options[
                            historicalMistake.chosenIndex
                          ].strip
                        }
                        variant="review"
                        differenceIndexes={stateDifferenceIndexes(
                          historicalSessionRound.round.answer,
                          historicalSessionRound.round.options[
                            historicalMistake.chosenIndex
                          ].strip,
                        )}
                        label="First attempted answer with differences marked"
                      />
                      <strong aria-hidden="true">×</strong>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : round && trace ? (
              <section
                className={styles.playArea}
                id="changing-strips-play-area"
                aria-label="Changing Strips puzzle"
              >
                <div
                  className={styles.gameBoard}
                  aria-busy={phase === "animating" || phase === "wrong-review"}
                >
                  <section
                    className={styles.cluePanel}
                    aria-labelledby="puzzle-prompt"
                  >
                    <div className={styles.promptHeading}>
                      <p className={styles.kicker} id="puzzle-prompt">
                        Start strip
                      </p>
                      <span className={styles.directionBadge}>
                        {round.processingDirection === "ltr" ? "→" : "←"}{" "}
                        {round.processingDirection === "ltr"
                          ? "Left start"
                          : "Right start"}
                      </span>
                    </div>
                    <StripDiagram
                      cells={round.input}
                      variant="clue"
                      label="Starting strip for this puzzle"
                    />
                    <RulePipeline
                      rules={round.rules}
                      processingDirection={round.processingDirection}
                      trace={trace.steps}
                      activeRuleIndex={activeTraceRuleIndex}
                      showStepNumbers={round.difficulty !== "Wizard"}
                      sourceStrip={round.input}
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
                          isCorrect &&
                          selectedCorrect &&
                          (phase === "animating" || phase === "answered");
                        const showWrong =
                          isSelected &&
                          !isCorrect &&
                          (phase === "wrong-review" || retryReady);
                        const muted =
                          (selectedCorrect && !isCorrect) ||
                          (phase === "wrong-review" && !isSelected);
                        const differences = showWrong
                          ? stateDifferenceIndexes(round.answer, option.strip)
                          : [];
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
                            aria-label={`Option ${optionIndex + 1}, a ${
                              option.strip.length
                            }-tile strip${
                              showCorrect
                                ? ", correct"
                                : showWrong
                                  ? `, your answer, ${differences.length} ${
                                      differences.length === 1
                                        ? "tile differs"
                                        : "tiles differ"
                                    }`
                                  : ""
                            }`}
                            aria-keyshortcuts={`${optionIndex + 1}`}
                            ref={(node) => {
                              optionButtonRefs.current[optionIndex] = node;
                            }}
                            key={`${optionIndex}-${option.kind}`}
                          >
                            <span
                              className={styles.optionNumber}
                              aria-hidden="true"
                            >
                              {optionIndex + 1}
                            </span>
                            <StripDiagram
                              cells={option.strip}
                              variant="option"
                              differenceIndexes={differences}
                              label={`Visual pattern for option ${optionIndex + 1}`}
                            />
                            {showCorrect || showWrong ? (
                              <span
                                className={styles.choiceMark}
                                aria-hidden="true"
                              >
                                {showCorrect ? "✓" : "×"}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    <p className={styles.keyboardHint}>Keys 1–4</p>
                  </section>
                </div>

                <div
                  className={`${styles.feedbackPanel} ${
                    phase === "wrong-review" ||
                    (retryReady && selectedIndex !== null)
                      ? styles.feedbackWrong
                      : phase === "animating" || phase === "answered"
                        ? styles.feedbackCorrect
                        : ""
                  }`}
                  aria-live="polite"
                  role="status"
                >
                  {(phase === "wrong-review" ||
                    (retryReady && selectedIndex !== null)) &&
                  selectedIndex !== null ? (
                    <>
                      <div className={styles.feedbackHeading}>
                        <strong>
                          <span aria-hidden="true">×</span> Try again
                        </strong>
                        <span>{optionFeedback(round, selectedIndex).message}</span>
                      </div>
                      <p className={styles.feedbackSubcopy}>
                        {selectedDifferences.length}{" "}
                        {selectedDifferences.length === 1
                          ? "square is"
                          : "squares are"}{" "}
                        different. Watch the steps, then try again.
                      </p>
                      <TraceStoryboard input={round.input} steps={trace.steps} />
                    </>
                  ) : phase === "animating" && selectedCorrect ? (
                    <>
                      <div className={styles.feedbackHeading}>
                        <strong>
                          <span aria-hidden="true">✓</span> Correct
                        </strong>
                        <span>Watch each step.</span>
                      </div>
                      <TraceStoryboard
                        input={round.input}
                        steps={trace.steps}
                        activeStep={traceStepIndex}
                      />
                    </>
                  ) : phase === "answered" ? (
                    <>
                      <div className={styles.feedbackHeading}>
                        <strong>
                          <span aria-hidden="true">✓</span> Correct
                        </strong>
                        <span>Every step matches.</span>
                      </div>
                      <TraceStoryboard input={round.input} steps={trace.steps} />
                      <div className={styles.feedbackActions}>
                        <button
                          className={styles.replayButton}
                          type="button"
                          onClick={replayTrace}
                        >
                          <span aria-hidden="true">↻</span> Replay
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
                      </div>
                    </>
                  ) : (
                    <span className={styles.feedbackPlaceholder}>
                      Choose the strip after every arrow.
                    </span>
                  )}
                </div>
              </section>
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
                {isRedemption ? redemptionTotal : displayedResultFirstTryScore}
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
                    const wrong = missed.round.options[chosenIndex];
                    const differences = stateDifferenceIndexes(
                      missed.round.answer,
                      wrong.strip,
                    );
                    return (
                      <article className={styles.reviewCard} key={missed.id}>
                        <span className={styles.reviewRound}>
                          {missed.campaign
                            ? `${missed.campaign.levelLabel} · Puzzle ${
                                missed.campaign.problemIndex + 1
                              }`
                            : `Puzzle ${missed.ordinal} · ${missed.round.difficulty}`}
                        </span>
                        <StripDiagram
                          cells={wrong.strip}
                          variant="review"
                          differenceIndexes={differences}
                          label={`First answer with ${differences.length} differences marked`}
                        />
                        <span className={styles.reviewDescription}>
                          <strong aria-hidden="true">×</strong>{" "}
                          {optionFeedback(missed.round, chosenIndex).message}
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
