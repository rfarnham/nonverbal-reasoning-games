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

import {
  ROUNDS,
  TUTORIAL,
  analyzeWrongAttempt,
  generateInfiniteRound,
  resolvedCorrectPattern,
  roundFingerprint,
  type Bead,
  type BeadColor,
  type Bracelet,
  type BraceletRound,
  type Difficulty,
  type SegmentOccurrence,
  type SegmentPattern,
} from "./game-engine";
import { braceletSearchGame } from "./game-info";
import { progressionAdapter } from "./progression-adapter";
import styles from "./bracelet-search.module.css";

type GamePhase = "idle" | "animating" | "wrong-review" | "answered";
type SessionMode = "campaign" | "infinite" | "redemption";
type CampaignLevelId = "starter" | "junior" | "expert" | "wizard";
type CampaignMarker = "correct" | "incorrect";

type SessionRound = {
  id: string;
  ordinal: number;
  round: BraceletRound;
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
  firstChosenIndex: number;
};

type CampaignProgress = Readonly<
  Record<string, CampaignProblemProgress | undefined>
>;

type CampaignCursors = Record<CampaignLevelId, number>;

type TraceState = {
  indexes: readonly number[];
  optionMismatchIndexes: readonly number[];
  braceletMismatchIndexes: readonly number[];
  wrong: boolean;
};

type HistoricalReview = {
  sessionRound: SessionRound;
  progress: CampaignProblemProgress;
};

type CustomProperties = CSSProperties & Record<`--${string}`, string>;

const TRACE_MS = 930;
const REDUCED_TRACE_MS = 140;
const WIZARD_WRONG_PAUSE_MS = 180;
const WRONG_REVIEW_MS = 2200;
const REDUCED_WRONG_REVIEW_MS = 1300;
const CAMPAIGN_PROBLEMS_PER_LEVEL = 12;
const CAMPAIGN_TOTAL = 48;

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

const COLOR_CLASSES: Readonly<Record<BeadColor, string>> = {
  coral: styles.beadCoral,
  gold: styles.beadGold,
  teal: styles.beadTeal,
  violet: styles.beadViolet,
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

function campaignRounds(levelId: CampaignLevelId): readonly BraceletRound[] {
  const { difficulty } = campaignLevel(levelId);
  return ROUNDS.filter((round) => round.difficulty === difficulty);
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
  const round = campaignRounds(levelId)[problemIndex] ?? ROUNDS[0];

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

function occurrenceIndexesInStripOrder(
  occurrence: SegmentOccurrence,
): readonly number[] {
  return occurrence.alignment === "reverse"
    ? [...occurrence.clockwiseIndexes].reverse()
    : occurrence.clockwiseIndexes;
}

function makeInfiniteSessionRound(
  ordinal: number,
  seenFingerprints: ReadonlySet<string>,
  difficulty: Difficulty,
): SessionRound | null {
  try {
    const round = generateInfiniteRound(
      difficulty,
      Math.random,
      seenFingerprints,
    );
    const fingerprint = roundFingerprint(round);
    return {
      id: `infinite-${ordinal}-${fingerprint}`,
      ordinal,
      round,
    };
  } catch {
    const fallback = ROUNDS.find(
      (round) =>
        round.difficulty === difficulty &&
        !seenFingerprints.has(roundFingerprint(round)),
    );
    if (!fallback) return null;
    const fingerprint = roundFingerprint(fallback);
    return {
      id: `infinite-${ordinal}-${fingerprint}`,
      ordinal,
      round: fallback,
    };
  }
}

function BeadMark({ bead }: { bead: Bead }) {
  return (
    <span
      className={`${styles.beadMark} ${
        bead.mark === "dot" ? styles.markDot : styles.markNone
      }`}
      aria-hidden="true"
    />
  );
}

function SegmentStrip({
  pattern,
  revealPattern,
  differenceIndexes = [],
  label,
}: {
  pattern: SegmentPattern;
  revealPattern?: SegmentPattern;
  differenceIndexes?: readonly number[];
  label: string;
}) {
  const differenceSet = new Set(differenceIndexes);

  return (
    <span className={styles.beadStrip} role="img" aria-label={label}>
      {pattern.map((token, index) => {
        const revealedToken = revealPattern?.[index];
        const displayed =
          token.kind === "hidden" && revealedToken?.kind === "bead"
            ? revealedToken
            : token;

        if (displayed.kind === "hidden") {
          return (
            <span
              className={`${styles.bead} ${styles.stripBead} ${
                styles.wildcardBead
              } ${differenceSet.has(index) ? styles.stripDifference : ""}`}
              aria-hidden="true"
              key={`hidden-${index}`}
            >
              ?
            </span>
          );
        }

        return (
          <span
            className={`${styles.bead} ${styles.stripBead} ${
              COLOR_CLASSES[displayed.bead.color]
            } ${differenceSet.has(index) ? styles.stripDifference : ""} ${
              token.kind === "hidden" ? styles.revealedWildcard : ""
            }`}
            aria-hidden="true"
            key={`${index}-${displayed.bead.color}-${displayed.bead.mark}`}
          >
            <BeadMark bead={displayed.bead} />
          </span>
        );
      })}
    </span>
  );
}

function BraceletVisual({
  bracelet,
  trace,
  size = "live",
  label,
}: {
  bracelet: Bracelet;
  trace?: TraceState | null;
  size?: "live" | "tutorial" | "review";
  label: string;
}) {
  const activeSet = new Set(trace?.indexes ?? []);
  const mismatchSet = new Set(trace?.braceletMismatchIndexes ?? []);
  const traceSteps = new Map(
    (trace?.indexes ?? []).map((braceletIndex, step) => [
      braceletIndex,
      step,
    ]),
  );
  const endpoint = trace?.indexes.at(-1);
  const first = trace?.indexes[0];
  const second = trace?.indexes[1];
  const clockwise =
    first !== undefined &&
    second !== undefined &&
    (first + 1) % bracelet.length === second;
  const sizeClass =
    size === "tutorial"
      ? styles.tutorialBracelet
      : size === "review"
        ? styles.reviewBracelet
        : "";

  return (
    <div
      className={`${styles.bracelet} ${sizeClass}`}
      role="img"
      aria-label={label}
    >
      {bracelet.map((bead, index) => {
        const step = traceSteps.get(index);
        const beadStyle = {
          "--bead-angle": `${(index / bracelet.length) * 360}deg`,
          "--trace-delay": `${(step ?? 0) * 70}ms`,
        } as CustomProperties;

        return (
          <span
            className={`${styles.ringBead} ${COLOR_CLASSES[bead.color]} ${
              activeSet.has(index) ? styles.ringBeadActive : ""
            } ${mismatchSet.has(index) ? styles.ringBeadWrong : ""} ${
              step !== undefined && size === "live"
                ? styles.ringBeadTrace
                : ""
            }`}
            style={beadStyle}
            aria-hidden="true"
            key={`${index}-${bead.color}-${bead.mark}`}
          >
            <BeadMark bead={bead} />
          </span>
        );
      })}
      {endpoint !== undefined ? (
        <span
          className={`${styles.traceArrow} ${
            trace?.wrong ? styles.traceArrowWrong : ""
          }`}
          style={
            {
              "--bead-angle": `${(endpoint / bracelet.length) * 360}deg`,
            } as CustomProperties
          }
          aria-hidden="true"
        >
          {clockwise ? "↻" : "↺"}
        </span>
      ) : null}
    </div>
  );
}

function visualStripLabel(pattern: SegmentPattern, optionNumber?: number) {
  const hiddenCount = pattern.filter(({ kind }) => kind === "hidden").length;
  const prefix =
    optionNumber === undefined ? "A bead strip" : `Option ${optionNumber}`;
  return `${prefix} with ${pattern.length} beads${
    hiddenCount === 1 ? " and a hidden center bead" : ""
  }. Inspect the visual order.`;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.matches("input, textarea, select") ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

export default function BraceletSearchPage() {
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
  const [trace, setTrace] = useState<TraceState | null>(null);
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
  const [historicalReview, setHistoricalReview] =
    useState<HistoricalReview | null>(null);

  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const levelCompleteButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const historicalHeadingRef = useRef<HTMLHeadingElement>(null);
  const historicalOriginRef = useRef<HTMLButtonElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const traceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptTokenRef = useRef(0);
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
  const round = activeSessionRound?.round ?? ROUNDS[0];
  const sessionLength = roundQueue.length;
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

  const wrongAnalysis = useMemo(() => {
    if (
      selectedIndex === null ||
      selectedIndex === round.correctIndex ||
      phase !== "wrong-review"
    ) {
      return null;
    }
    return analyzeWrongAttempt(round, selectedIndex);
  }, [phase, round, selectedIndex]);

  const wrongFeedback = useMemo(() => {
    if (selectedIndex === null || selectedIndex === round.correctIndex) return "";
    const option = round.options[selectedIndex];
    const analysis = analyzeWrongAttempt(round, selectedIndex);
    if (analysis.kind === "visible-conflict") {
      return analysis.visibleMismatchCount === 1
        ? "One visible bead conflicts"
        : `${analysis.visibleMismatchCount} visible beads conflict`;
    }
    switch (option.kind) {
      case "one-color-off":
        return analysis.visibleMismatchCount === 1
          ? "One bead differs"
          : `${analysis.visibleMismatchCount} beads differ`;
      case "two-color-off":
        return analysis.visibleMismatchCount === 1
          ? "One bead differs"
          : `${analysis.visibleMismatchCount} beads differ`;
      case "one-mark-off":
        return "One bead mark differs";
      case "adjacent-swap":
        return "Two neighbors are reversed";
      case "skipped-bead":
        return "These beads do not stay together";
      case "correct":
        return "";
    }
  }, [round, selectedIndex]);

  const clearAttemptTimers = useCallback(() => {
    if (traceTimerRef.current) {
      clearTimeout(traceTimerRef.current);
      traceTimerRef.current = null;
    }
    if (reviewTimerRef.current) {
      clearTimeout(reviewTimerRef.current);
      reviewTimerRef.current = null;
    }
  }, []);

  const resetAttemptState = useCallback(() => {
    attemptTokenRef.current += 1;
    clearAttemptTimers();
    inputLockedRef.current = false;
    retryFocusIndexRef.current = null;
    setSelectedIndex(null);
    setTrace(null);
    setRetryReady(false);
    setGenerationError(null);
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
        !gameplayStarted ||
        historicalReview ||
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
      const alreadyAttempted = isCampaign
        ? Boolean(campaignProgress[activeSessionRound.id]?.firstAttempt)
        : mistakes.some(
            ({ sessionRound }) => sessionRound.id === activeSessionRound.id,
          );
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
      setPhase("animating");

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
              firstChosenIndex: existing?.firstChosenIndex ?? optionIndex,
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
        if (!isRedemption && !alreadyAttempted) {
          setScore((current) => current + 1);
        }
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

      let nextTrace: TraceState | null = null;
      if (isCorrect) {
        nextTrace = {
          indexes: occurrenceIndexesInStripOrder(round.occurrence),
          optionMismatchIndexes: [],
          braceletMismatchIndexes: [],
          wrong: false,
        };
      } else {
        const analysis = analyzeWrongAttempt(round, optionIndex);
        if (analysis.kind === "comparison") {
          nextTrace = {
            indexes: occurrenceIndexesInStripOrder(analysis.occurrence),
            optionMismatchIndexes: analysis.optionIndexes,
            braceletMismatchIndexes: analysis.braceletIndexes,
            wrong: true,
          };
        }
      }
      setTrace(nextTrace);

      const attemptToken = attemptTokenRef.current + 1;
      attemptTokenRef.current = attemptToken;
      clearAttemptTimers();
      traceTimerRef.current = setTimeout(
        () => {
          if (attemptTokenRef.current !== attemptToken) return;

          if (isCorrect) {
            setPhase("answered");
            return;
          }

          setPhase("wrong-review");
          reviewTimerRef.current = setTimeout(
            () => {
              if (attemptTokenRef.current !== attemptToken) return;
              if (progressionControlled) progression.retry();
              retryFocusIndexRef.current = optionIndex;
              inputLockedRef.current = false;
              setTrace(null);
              setSelectedIndex(null);
              setRetryReady(true);
              setPhase("idle");
            },
            reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
          );
        },
        round.difficulty === "Wizard" && !isCorrect
          ? WIZARD_WRONG_PAUSE_MS
          : reducedMotion
            ? REDUCED_TRACE_MS
            : TRACE_MS,
      );
    },
    [
      activeCampaignLevelComplete,
      activeSessionRound,
      campaignProgress,
      clearAttemptTimers,
      complete,
      historicalReview,
      isCampaign,
      isInfinite,
      isRedemption,
      mistakes,
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
    if (ROUNDS.length < CAMPAIGN_TOTAL) {
      setGenerationError("Campaign is still being prepared. Try again.");
      return;
    }
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
    setStarted(true);
    setComplete(false);
    setHistoricalReview(null);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, resumeAudio]);

  const startInfinite = useCallback(() => {
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    const firstRound = makeInfiniteSessionRound(
      1,
      infiniteFingerprintsRef.current,
      initialAdaptive.targetDifficulty,
    );
    if (!firstRound) {
      setGenerationError(
        "Couldn’t prepare a fresh bracelet. Try Infinite again.",
      );
      return;
    }
    infiniteFingerprintsRef.current.add(roundFingerprint(firstRound.round));
    infiniteAdaptiveRef.current = initialAdaptive;
    setSessionMode("infinite");
    setRoundQueue([firstRound]);
    setRoundCursor(0);
    setInfiniteAdaptive(initialAdaptive);
    setScore(0);
    setCompletedCount(0);
    setMistakes([]);
    setRedemptionTotal(0);
    setReviewLevelId(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setStarted(true);
    setComplete(false);
    setHistoricalReview(null);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, resumeAudio]);

  const selectCampaignLevel = useCallback(
    (levelId: CampaignLevelId) => {
      if (
        !isCampaign ||
        phase !== "idle" ||
        historicalReview ||
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
      historicalReview,
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
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, visibleMistakes]);

  const goNext = useCallback(() => {
    if (phase !== "answered") return;

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
      const nextRound = makeInfiniteSessionRound(
        nextOrdinal,
        infiniteFingerprintsRef.current,
        infiniteAdaptiveRef.current.targetDifficulty,
      );
      if (!nextRound) {
        setGenerationError(
          "Couldn’t make a fresh bracelet. Choose Next to retry.",
        );
        return;
      }
      infiniteFingerprintsRef.current.add(roundFingerprint(nextRound.round));
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

      if (reviewLevelId) {
        const redeemedLevelId = reviewLevelId;
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
      phase === "animating" ||
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

  const openHistoricalReview = useCallback(
    (
      levelId: CampaignLevelId,
      problemIndex: number,
      origin: HTMLButtonElement,
    ) => {
      const progress =
        campaignProgress[campaignRoundId(levelId, problemIndex)];
      if (
        !progress?.solved ||
        historicalReview ||
        phase !== "idle" ||
        complete
      ) {
        return;
      }
      historicalOriginRef.current = origin;
      setHistoricalReview({
        sessionRound: buildCampaignSessionRound(levelId, problemIndex),
        progress,
      });
    },
    [campaignProgress, complete, historicalReview, phase],
  );

  const closeHistoricalReview = useCallback(() => {
    if (!historicalReview) return;
    setHistoricalReview(null);
    window.setTimeout(() => historicalOriginRef.current?.focus(), 0);
  }, [historicalReview]);

  useEffect(() => {
    const enabled = readSoundPreference(["bracelet-search-sound"]);
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
    attemptTokenRef.current += 1;
    clearAttemptTimers();
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
        setTrace({
          indexes: occurrenceIndexesInStripOrder(
            controlled.current.round.occurrence,
          ),
          optionMismatchIndexes: [],
          braceletMismatchIndexes: [],
          wrong: false,
        });
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
        const selectedRound = controlled.current.round;
        const analysis = analyzeWrongAttempt(selectedRound, savedOptionIndex);
        inputLockedRef.current = true;
        setSelectedIndex(savedOptionIndex);
        setTrace(
          analysis.kind === "comparison"
            ? {
                indexes: occurrenceIndexesInStripOrder(analysis.occurrence),
                optionMismatchIndexes: analysis.optionIndexes,
                braceletMismatchIndexes: analysis.braceletIndexes,
                wrong: true,
              }
            : null,
        );
        setRetryReady(false);
        setPhase("wrong-review");
        shouldFocusFirstOption.current = false;
        const hydrationToken = attemptTokenRef.current;
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        reviewTimerRef.current = setTimeout(
          () => {
            if (attemptTokenRef.current !== hydrationToken) return;
            controlled.retry();
            retryFocusIndexRef.current = savedOptionIndex;
            inputLockedRef.current = false;
            setTrace(null);
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
        setTrace(null);
        setRetryReady(controlled.currentAttemptCount > 0);
        setPhase("idle");
        shouldFocusFirstOption.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    clearAttemptTimers,
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

  useEffect(
    () => () => {
      const context = audioContextRef.current;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
      attemptTokenRef.current += 1;
      clearAttemptTimers();
    },
    [clearAttemptTimers],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (historicalReview) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeHistoricalReview();
        } else if (event.key === "Tab") {
          event.preventDefault();
          historicalHeadingRef.current
            ?.closest<HTMLElement>(`[role="dialog"]`)
            ?.querySelector<HTMLButtonElement>("button")
            ?.focus();
        }
        return;
      }

      if (
        event.defaultPrevented ||
        isEditableTarget(event.target) ||
        !gameplayStarted ||
        complete ||
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
    chooseOption,
    closeHistoricalReview,
    complete,
    gameplayStarted,
    historicalReview,
    phase,
  ]);

  useEffect(() => {
    if (phase === "answered") nextButtonRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (shouldFocusFirstOption.current && gameplayStarted && !complete) {
      optionButtonRefs.current[0]?.focus();
      shouldFocusFirstOption.current = false;
    }
  }, [
    activeCampaignLevel,
    campaignProblemIndex,
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
    if (historicalReview) historicalHeadingRef.current?.focus();
  }, [historicalReview]);

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
      : CAMPAIGN_TOTAL;
    const accuracy = firstTryScore / denominator;
    if (accuracy === 1) return "Perfect set.";
    if (accuracy >= 0.7) return "Sharp work.";
    return "Good practice.";
  }, [firstTryScore, infiniteAdaptive.attempts.length, isInfinite]);

  const showRedemptionOffer = !isRedemption && visibleMistakes.length > 0;
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
      : CAMPAIGN_TOTAL;
  const revealedCorrectPattern = resolvedCorrectPattern(round);
  const optionMismatchIndexes =
    phase === "wrong-review" && wrongAnalysis?.kind === "comparison"
      ? wrongAnalysis.optionIndexes
      : [];

  const soundButton = (
    <button
      className={styles.soundButton}
      type="button"
      onClick={toggleSound}
      aria-pressed={soundEnabled}
      aria-label={`Sound ${soundEnabled ? "on" : "off"}`}
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
        <span className={styles.gameTitle}>{braceletSearchGame.title}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {progression.mode === "recovery" ? (
          <ProgressionRecoveryPanel message={progression.message} />
        ) : progression.mode === "redirect" ? null : !gameplayStarted ? (
          <section className={styles.tutorial} aria-labelledby="tutorial-title">
            <p className={styles.kicker}>Example</p>
            <h1 id="tutorial-title">Find the hidden run.</h1>
            <p className={styles.exampleRule}>Follow the bracelet either way.</p>

            <div className={styles.exampleFlow}>
              <div className={styles.exampleBracelet}>
                <BraceletVisual
                  bracelet={TUTORIAL.bracelet}
                  trace={{
                    indexes: occurrenceIndexesInStripOrder(
                      TUTORIAL.occurrence,
                    ),
                    optionMismatchIndexes: [],
                    braceletMismatchIndexes: [],
                    wrong: false,
                  }}
                  size="tutorial"
                  label="Example bracelet with one three-bead run highlighted in the reverse direction."
                />
              </div>
              <span className={styles.exampleArrow} aria-hidden="true">
                →
              </span>
              <div className={styles.exampleChoices}>
                <div
                  className={`${styles.exampleChoice} ${styles.exampleChoiceCorrect}`}
                >
                  <SegmentStrip
                    pattern={TUTORIAL.answer}
                    label="The highlighted three-bead run, correct."
                  />
                  <span className={styles.exampleMark} aria-label="Correct">
                    ✓
                  </span>
                </div>
                <div
                  className={`${styles.exampleChoice} ${styles.exampleChoiceWrong}`}
                >
                  <SegmentStrip
                    pattern={TUTORIAL.nearMiss}
                    label="A near-match with two beads changed."
                  />
                  <span className={styles.exampleMark} aria-label="Not a match">
                    ×
                  </span>
                </div>
              </div>
            </div>

            {progressionControlled && progression.sectionIntro ? (
              <ProgressionCulminationSectionIntro
                gameTitle={braceletSearchGame.title}
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
            {generationError ? (
              <p className={styles.setupError} role="status">
                {generationError}
              </p>
            ) : null}
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
                          disabled={phase !== "idle" || Boolean(historicalReview)}
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
                        const markerClass = `${
                          marker === "correct"
                            ? styles.campaignProblemCorrect
                            : marker === "incorrect"
                              ? styles.campaignProblemIncorrect
                              : styles.campaignProblemNotDone
                        } ${
                          isCurrent ? styles.campaignProblemCurrent : ""
                        }`;
                        const markerLabel = `${campaignLevel(activeCampaignLevel).label} problem ${
                          problemIndex + 1
                        }: ${marker === "not-done" ? "not attempted" : marker}`;

                        return problem?.solved ? (
                          <span
                            className={styles.campaignProblemItem}
                            role="listitem"
                            key={problemIndex}
                          >
                            <button
                              className={`${styles.campaignProblem} ${styles.campaignProblemButton} ${markerClass}`}
                              type="button"
                              aria-label={`${markerLabel}. Open review.`}
                              aria-current={isCurrent ? "step" : undefined}
                              disabled={
                                phase !== "idle" ||
                                complete ||
                                Boolean(historicalReview)
                              }
                              onClick={(event) =>
                                openHistoricalReview(
                                  activeCampaignLevel,
                                  problemIndex,
                                  event.currentTarget,
                                )
                              }
                            />
                          </span>
                        ) : (
                          <span
                            className={`${styles.campaignProblem} ${markerClass}`}
                            role="listitem"
                            aria-label={markerLabel}
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
                  aria-label="Review progress"
                  aria-valuemin={0}
                  aria-valuemax={sessionLength}
                  aria-valuenow={progress}
                  style={{ gridTemplateColumns: `repeat(${sessionLength}, 1fr)` }}
                >
                  {roundQueue.map(({ id }, index) => (
                    <span
                      className={index < progress ? styles.progressDone : ""}
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
            )}

            {progressionControlled &&
            progression.stage === "redemption-ready" ? (
              <ProgressionRedemptionIntro
                attempt={progression.attempt}
                onBegin={progression.beginRedemption}
              />
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
                <div className={styles.gameBoard} id="campaign-play-area">
                  <section
                    className={styles.braceletPanel}
                    aria-label="Bracelet to search"
                  >
                    <div className={styles.braceletStage}>
                      {round.difficulty === "Wizard" ? (
                        <div
                          className={styles.scanCue}
                          role="img"
                          aria-label="The center bead in every answer is hidden."
                        >
                          <span className={styles.wizardCue} aria-hidden="true">
                            ?
                          </span>
                          <span aria-hidden="true">Hidden center</span>
                        </div>
                      ) : (
                        <div
                          className={styles.scanCue}
                          role="img"
                          aria-label="Search around the bracelet in either direction."
                        >
                          <span
                            className={styles.scanCueIcon}
                            aria-hidden="true"
                          />
                          <span aria-hidden="true">Either way</span>
                        </div>
                      )}
                      <BraceletVisual
                        bracelet={round.bracelet}
                        trace={trace}
                        label={`A circular bracelet with ${round.bracelet.length} colored beads. Inspect the visual sequence in either direction.`}
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
                        const differences = showWrong
                          ? optionMismatchIndexes
                          : [];
                        const answerState = showCorrect
                          ? ", correct answer"
                          : showWrong
                            ? ", your answer; the highlighted visible beads conflict"
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
                            aria-label={`${visualStripLabel(
                              option.pattern,
                              optionIndex + 1,
                            )}${answerState}`}
                            aria-keyshortcuts={`${optionIndex + 1}`}
                            ref={(node) => {
                              optionButtonRefs.current[optionIndex] = node;
                            }}
                            key={`${round.id}-${optionIndex}`}
                          >
                            <span
                              className={styles.optionNumber}
                              aria-hidden="true"
                            >
                              {optionIndex + 1}
                            </span>
                            <SegmentStrip
                              pattern={option.pattern}
                              revealPattern={
                                showCorrect && round.difficulty === "Wizard"
                                  ? revealedCorrectPattern
                                  : undefined
                              }
                              differenceIndexes={differences}
                              label={visualStripLabel(
                                option.pattern,
                                optionIndex + 1,
                              )}
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
                  className={`${styles.feedbackBar} ${
                    phase === "wrong-review" ||
                    phase === "answered" ||
                    retryReady ||
                    generationError
                      ? styles.feedbackBarActive
                      : ""
                  }`}
                  aria-live="polite"
                  role="status"
                >
                  {phase === "wrong-review" ? (
                    <>
                      <strong className={styles.wrongText}>Not quite</strong>
                      <span className={styles.feedbackDetail}>
                        {wrongFeedback}
                      </span>
                    </>
                  ) : phase === "answered" ? (
                    <>
                      <strong className={styles.correctText}>Correct</strong>
                      <span className={styles.feedbackDetail}>
                        {round.occurrence.alignment === "reverse"
                          ? "Found in the other direction"
                          : "That run stays together"}
                      </span>
                      <button
                        className={styles.nextButton}
                        type="button"
                        onClick={goNext}
                        ref={nextButtonRef}
                      >
                        {generationError
                          ? "Try fresh round"
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
                  ) : generationError ? (
                    <strong className={styles.retryText}>
                      {generationError}
                    </strong>
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
                    const wrongPattern =
                      missedRound.options[chosenIndex].pattern;
                    const analysis = analyzeWrongAttempt(
                      missedRound,
                      chosenIndex,
                    );
                    const differences =
                      analysis.kind === "comparison"
                        ? analysis.optionIndexes
                        : [];

                    return (
                      <article className={styles.reviewCard} key={missed.id}>
                        <span className={styles.reviewRound}>
                          {missed.campaign
                            ? `${missed.campaign.levelLabel} · Puzzle ${
                                missed.campaign.problemIndex + 1
                              }`
                            : `Puzzle ${missed.ordinal} · ${infiniteLevelLabel(
                                missedRound.difficulty,
                              )}`}
                        </span>
                        <div className={styles.reviewVisual}>
                          <BraceletVisual
                            bracelet={missedRound.bracelet}
                            size="review"
                            label={`Bracelet from puzzle ${missed.ordinal}.`}
                          />
                          <span className={styles.reviewArrow} aria-hidden="true">
                            →
                          </span>
                          <div className={styles.reviewWrong}>
                            <SegmentStrip
                              pattern={wrongPattern}
                              differenceIndexes={differences}
                              label={`Your first choice for puzzle ${missed.ordinal}.`}
                            />
                            <span
                              className={styles.choiceMark}
                              aria-hidden="true"
                            >
                              ×
                            </span>
                          </div>
                        </div>
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

      {historicalReview ? (
        <div className={styles.historyBackdrop}>
          <section
            className={styles.historyDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-title"
          >
            <button
              className={styles.historyClose}
              type="button"
              onClick={closeHistoricalReview}
              aria-label="Close problem review"
            >
              ×
            </button>
            <p className={styles.kicker}>Problem history</p>
            <h2 id="history-title" ref={historicalHeadingRef} tabIndex={-1}>
              {historicalReview.sessionRound.campaign?.levelLabel} · Puzzle{" "}
              {(historicalReview.sessionRound.campaign?.problemIndex ?? 0) + 1}
            </h2>
            <p
              className={
                historicalReview.progress.firstAttempt === "correct"
                  ? styles.historyCorrect
                  : styles.historyIncorrect
              }
            >
              {historicalReview.progress.firstAttempt === "correct"
                ? "✓ Correct on the first try"
                : "× Missed on the first try"}
            </p>
            <div className={styles.historyVisual}>
              <BraceletVisual
                bracelet={historicalReview.sessionRound.round.bracelet}
                trace={{
                  indexes: occurrenceIndexesInStripOrder(
                    historicalReview.sessionRound.round.occurrence,
                  ),
                  optionMismatchIndexes: [],
                  braceletMismatchIndexes: [],
                  wrong: false,
                }}
                label="Completed bracelet with the matching run highlighted."
              />
              <div className={styles.historyAnswers}>
                {historicalReview.progress.firstAttempt === "incorrect" ? (
                  <div
                    className={`${styles.historyAnswer} ${styles.historyAnswerWrong}`}
                  >
                    <span>Your first choice · ×</span>
                    <SegmentStrip
                      pattern={
                        historicalReview.sessionRound.round.options[
                          historicalReview.progress.firstChosenIndex
                        ].pattern
                      }
                      label="The incorrect strip chosen on the first attempt."
                    />
                  </div>
                ) : null}
                <div className={styles.historyAnswer}>
                  <span>The matching run · ✓</span>
                  <SegmentStrip
                    pattern={
                      historicalReview.sessionRound.round.options[
                        historicalReview.sessionRound.round.correctIndex
                      ].pattern
                    }
                    revealPattern={resolvedCorrectPattern(
                      historicalReview.sessionRound.round,
                    )}
                    label="The correct bead run for this completed problem."
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
