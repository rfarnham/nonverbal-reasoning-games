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
  type Ref,
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
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
  type SuiteDifficulty as AdaptiveDifficulty,
} from "@/lib/infinite-progression";

import {
  BOARD_SIZE,
  ROUNDS,
  TUTORIAL,
  compareHolePatterns,
  describeFoldSequence,
  describePattern,
  generateInfiniteRound,
  patternKey,
  roundFingerprint,
  unfoldStages,
  type Bounds,
  type Cell,
  type Difficulty,
  type FoldDirection,
  type FoldStep,
  type HolePattern,
  type Round,
} from "./game-engine";
import { shapeFoldGame } from "./game-info";
import { canOpenHistoricalReview } from "./historical-review";
import { progressionAdapter } from "./progression-adapter";
import styles from "./shape-fold.module.css";

type GamePhase = "idle" | "animating" | "wrong-review" | "answered";
type SessionMode = "campaign" | "infinite" | "redemption";
type PlayMode = Exclude<SessionMode, "redemption">;
type CampaignMarker = "correct" | "incorrect";
type CampaignLevel = "Starter" | "Junior" | "Expert" | "Wizard";
type CampaignReviewSelection = {
  level: CampaignLevel;
  problemIndex: number;
};
type PaperSize =
  | "sequencePaper"
  | "answerPaper"
  | "tutorialPaper"
  | "reviewPaper";

type SessionRound = {
  id: string;
  ordinal: number;
  round: Round;
  campaign?: {
    level: CampaignLevel;
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
type CampaignCursors = Record<CampaignLevel, number>;
type CustomProperties = CSSProperties & Record<`--${string}`, string>;

const CAMPAIGN_LEVELS: readonly CampaignLevel[] = [
  "Starter",
  "Junior",
  "Expert",
  "Wizard",
];
const CAMPAIGN_PROBLEMS_PER_LEVEL = 12;
const UNFOLD_FLIP_MS = 1300;
const UNFOLD_STAGE_MS = 1450;
const REDUCED_UNFOLD_MS = 140;
const WRONG_REVIEW_MS = 2200;
const REDUCED_WRONG_REVIEW_MS = 1300;
const FULL_BOUNDS: Bounds = {
  x: 0,
  y: 0,
  width: BOARD_SIZE,
  height: BOARD_SIZE,
};

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

const ADAPTIVE_FROM_LEVEL: Record<CampaignLevel, AdaptiveDifficulty> = {
  Starter: "Easy",
  Junior: "Medium",
  Expert: "Hard",
  Wizard: "Wizard",
};
const LEVEL_FROM_ADAPTIVE: Record<AdaptiveDifficulty, CampaignLevel> = {
  Easy: "Starter",
  Medium: "Junior",
  Hard: "Expert",
  Wizard: "Wizard",
};

function initialCampaignCursors(): CampaignCursors {
  return { Starter: 0, Junior: 0, Expert: 0, Wizard: 0 };
}

function campaignRounds(level: CampaignLevel): readonly Round[] {
  const difficulty = ADAPTIVE_FROM_LEVEL[level] as Difficulty;
  return ROUNDS.filter((round) => round.difficulty === difficulty);
}

function campaignRoundId(level: CampaignLevel, problemIndex: number): string {
  return `campaign-${level.toLowerCase()}-${problemIndex}`;
}

function buildCampaignSessionRound(
  level: CampaignLevel,
  problemIndex: number,
): SessionRound {
  const levelIndex = CAMPAIGN_LEVELS.indexOf(level);
  const round = campaignRounds(level)[problemIndex] ?? ROUNDS[0];
  return {
    id: campaignRoundId(level, problemIndex),
    ordinal: levelIndex * CAMPAIGN_PROBLEMS_PER_LEVEL + problemIndex + 1,
    round,
    campaign: { level, problemIndex },
  };
}

function isCampaignLevelComplete(
  progress: CampaignProgress,
  level: CampaignLevel,
): boolean {
  return Array.from({ length: CAMPAIGN_PROBLEMS_PER_LEVEL }, (_, index) =>
    progress[campaignRoundId(level, index)]?.solved,
  ).every(Boolean);
}

function nextIncompleteCampaignLevel(
  progress: CampaignProgress,
  currentLevel: CampaignLevel,
): CampaignLevel | null {
  const currentIndex = CAMPAIGN_LEVELS.indexOf(currentLevel);
  for (let offset = 1; offset <= CAMPAIGN_LEVELS.length; offset += 1) {
    const candidate =
      CAMPAIGN_LEVELS[(currentIndex + offset) % CAMPAIGN_LEVELS.length];
    if (!isCampaignLevelComplete(progress, candidate)) return candidate;
  }
  return null;
}

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function directionArrow(direction: FoldDirection): string {
  return { left: "→", right: "←", up: "↓", down: "↑" }[direction];
}

function directionLabel(direction: FoldDirection): string {
  return {
    left: "Fold the left half right",
    right: "Fold the right half left",
    up: "Fold the top half down",
    down: "Fold the bottom half up",
  }[direction];
}

function boundsForUnfoldStage(round: Round, stageIndex: number): Bounds {
  const steps = round.foldSteps;
  if (steps.length === 0) return FULL_BOUNDS;
  if (stageIndex === 0) {
    return steps[steps.length - 1].after;
  }
  const openedStep = steps[steps.length - stageIndex];
  return openedStep?.before ?? FULL_BOUNDS;
}

function PaperDiagram({
  holes = [],
  bounds = FULL_BOUNDS,
  punches = [],
  missing = [],
  extra = [],
  size,
  label,
  hidden = false,
  paperRef,
}: {
  holes?: HolePattern;
  bounds?: Bounds;
  punches?: HolePattern;
  missing?: readonly Cell[];
  extra?: readonly Cell[];
  size: PaperSize;
  label?: string;
  hidden?: boolean;
  paperRef?: Ref<HTMLDivElement>;
}) {
  const holesSet = new Set(holes.map(cellKey));
  const punchesSet = new Set(punches.map(cellKey));
  const missingSet = new Set(missing.map(cellKey));
  const extraSet = new Set(extra.map(cellKey));

  return (
    <div
      className={`${styles.paperDiagram} ${styles[size]}`}
      role={hidden ? undefined : "img"}
      aria-label={hidden ? undefined : label}
      aria-hidden={hidden || undefined}
      ref={paperRef}
    >
      {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
        const x = index % BOARD_SIZE;
        const y = Math.floor(index / BOARD_SIZE);
        const key = `${x},${y}`;
        const active =
          x >= bounds.x &&
          x < bounds.x + bounds.width &&
          y >= bounds.y &&
          y < bounds.y + bounds.height;
        const isPunch = punchesSet.has(key);
        const hasHole = holesSet.has(key);
        const isMissing = missingSet.has(key);
        const isExtra = extraSet.has(key);

        return (
          <span
            className={`${styles.paperCell} ${
              active ? styles.activeCell : styles.inactiveCell
            }`}
            aria-hidden="true"
            key={key}
          >
            {hasHole ? (
              <span
                className={`${styles.opening} ${
                  isExtra ? styles.extraOpening : ""
                }`}
              >
                {isExtra ? "×" : ""}
              </span>
            ) : null}
            {isMissing ? (
              <span className={styles.missingOpening}>+</span>
            ) : null}
            {isPunch ? <span className={styles.punchMark} /> : null}
          </span>
        );
      })}
    </div>
  );
}

function unfoldDirectionClass(direction: FoldDirection): string {
  switch (direction) {
    case "left":
      return styles.unfoldLeft;
    case "right":
      return styles.unfoldRight;
    case "up":
      return styles.unfoldUp;
    case "down":
      return styles.unfoldDown;
  }
}

function UnfoldLayer({
  holes,
  bounds,
  className,
}: {
  holes: HolePattern;
  bounds: Bounds;
  className: string;
}) {
  const holesSet = new Set(holes.map(cellKey));
  const style: CSSProperties = {
    left: `${(bounds.x / BOARD_SIZE) * 100}%`,
    top: `${(bounds.y / BOARD_SIZE) * 100}%`,
    width: `${(bounds.width / BOARD_SIZE) * 100}%`,
    height: `${(bounds.height / BOARD_SIZE) * 100}%`,
    gridTemplateColumns: `repeat(${bounds.width}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${bounds.height}, minmax(0, 1fr))`,
  };

  return (
    <div
      className={`${styles.unfoldLayer} ${className}`}
      style={style}
      aria-hidden="true"
    >
      {Array.from({ length: bounds.width * bounds.height }, (_, index) => {
        const x = bounds.x + (index % bounds.width);
        const y = bounds.y + Math.floor(index / bounds.width);
        const key = `${x},${y}`;
        return (
          <span
            className={`${styles.paperCell} ${styles.activeCell}`}
            aria-hidden="true"
            key={key}
          >
            {holesSet.has(key) ? <span className={styles.opening} /> : null}
          </span>
        );
      })}
    </div>
  );
}

function UnfoldingPaper({
  round,
  holes,
  stageIndex,
  complete,
}: {
  round: Round;
  holes: HolePattern;
  stageIndex: number;
  complete: boolean;
}) {
  const bounds = boundsForUnfoldStage(round, stageIndex);
  const openingStep = complete
    ? undefined
    : round.foldSteps[round.foldSteps.length - stageIndex - 1];
  const foldNumber = Math.min(stageIndex + 1, round.folds.length);

  return (
    <div
      className={styles.unfoldScene}
      style={
        {
          "--unfold-flip-duration": `${UNFOLD_FLIP_MS}ms`,
        } as CustomProperties
      }
      role="img"
      aria-label={
        complete
          ? `Paper opened: ${describePattern(holes)}`
          : `Opening the paper, fold ${foldNumber} of ${round.folds.length}`
      }
    >
      <UnfoldLayer
        holes={holes}
        bounds={bounds}
        className={styles.unfoldBaseLayer}
      />
      {openingStep ? (
        <UnfoldLayer
          key={`${openingStep.index}-${stageIndex}`}
          holes={holes}
          bounds={bounds}
          className={`${styles.unfoldFlap} ${unfoldDirectionClass(
            openingStep.direction,
          )}`}
        />
      ) : null}
    </div>
  );
}

function FoldCard({
  step,
  index,
  showDirection,
}: {
  step: FoldStep;
  index: number;
  showDirection: boolean;
}) {
  return (
    <div className={styles.foldCard} aria-hidden="true">
      <span className={styles.stepLabel}>Fold {index + 1}</span>
      <PaperDiagram bounds={step.after} size="sequencePaper" hidden />
      {showDirection ? (
        <span
          className={styles.foldDirection}
          aria-label={directionLabel(step.direction)}
        >
          {directionArrow(step.direction)}
        </span>
      ) : null}
    </div>
  );
}

function FoldSequence({
  round,
  compact = false,
}: {
  round: Round;
  compact?: boolean;
}) {
  const firstBounds = round.foldSteps[0]?.before ?? FULL_BOUNDS;
  const finalBounds =
    round.foldSteps[round.foldSteps.length - 1]?.after ??
    FULL_BOUNDS;
  const hideDirections = round.difficulty === "Wizard";
  const punchPositions = round.punches
    .map(
      (punch) =>
        `row ${punch.y + 1}, column ${punch.x + 1}`,
    )
    .join("; ");
  const accessibleLabel = `${describeFoldSequence(
    round.folds,
    hideDirections,
  )}, then make ${round.punches.length} ${
    round.punches.length === 1 ? "punch" : "punches"
  } in the folded paper at ${punchPositions} of the original grid`;

  return (
    <div
      className={`${styles.foldSequence} ${
        compact ? styles.compactSequence : ""
      }`}
      role="img"
      aria-label={accessibleLabel}
    >
      <div className={styles.foldCard} aria-hidden="true">
        <span className={styles.stepLabel}>Start</span>
        <PaperDiagram bounds={firstBounds} size="sequencePaper" hidden />
      </div>
      {round.foldSteps.map((step, index) => (
        <div className={styles.foldStep} key={`${step.direction}-${index}`}>
          <span className={styles.sequenceConnector} aria-hidden="true">
            →
          </span>
          <FoldCard
            step={step}
            index={index}
            showDirection={!hideDirections}
          />
        </div>
      ))}
      <div className={styles.foldStep}>
        <span className={styles.sequenceConnector} aria-hidden="true">
          →
        </span>
        <div className={`${styles.foldCard} ${styles.punchCard}`} aria-hidden="true">
          <span className={styles.stepLabel}>Punch</span>
          <PaperDiagram
            bounds={finalBounds}
            punches={round.punches}
            size="sequencePaper"
            hidden
          />
        </div>
      </div>
    </div>
  );
}

function safeInfiniteRound(
  ordinal: number,
  difficulty: Difficulty,
  seenFingerprints: Set<string>,
): SessionRound | null {
  let round: Round | undefined;
  try {
    round = generateInfiniteRound(difficulty, Math.random, seenFingerprints);
  } catch {
    for (let attempt = 0; attempt < 64 && !round; attempt += 1) {
      try {
        round = generateInfiniteRound(
          difficulty,
          ordinal * 65_537 + attempt * 7_919,
          seenFingerprints,
        );
      } catch {
        // Try another deterministic seed before using authored fallback content.
      }
    }
  }

  round ??= ROUNDS.find(
    (candidate) =>
      candidate.difficulty === difficulty &&
      !seenFingerprints.has(roundFingerprint(candidate)),
  );
  if (!round) return null;
  const fingerprint = roundFingerprint(round);
  seenFingerprints.add(fingerprint);
  return {
    id: `infinite-${ordinal}-${fingerprint}`,
    ordinal,
    round,
  };
}

export default function ShapeFoldPage() {
  const router = useRouter();
  const progression = useProgressionGameSession(progressionAdapter);
  const [started, setStarted] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>("campaign");
  const [playMode, setPlayMode] = useState<PlayMode>("campaign");
  const [roundQueue, setRoundQueue] = useState<readonly SessionRound[]>([]);
  const [roundCursor, setRoundCursor] = useState(0);
  const [activeCampaignLevel, setActiveCampaignLevel] =
    useState<CampaignLevel>("Starter");
  const [campaignCursors, setCampaignCursors] = useState<CampaignCursors>(
    initialCampaignCursors,
  );
  const [campaignProgress, setCampaignProgress] =
    useState<CampaignProgress>({});
  const [infiniteAdaptive, setInfiniteAdaptive] = useState(
    initialInfiniteAdaptiveState,
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [complete, setComplete] = useState(false);
  const [generationExhausted, setGenerationExhausted] = useState(false);
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [revealStage, setRevealStage] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [mistakes, setMistakes] = useState<readonly MistakeRecord[]>([]);
  const [retryReady, setRetryReady] = useState(false);
  const [redemptionTotal, setRedemptionTotal] = useState(0);
  const [reviewLevel, setReviewLevel] = useState<CampaignLevel | null>(null);
  const [redeemedMistakeIds, setRedeemedMistakeIds] = useState<
    readonly string[]
  >([]);
  const [redemptionMistakeIds, setRedemptionMistakeIds] = useState<
    readonly string[]
  >([]);
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
  const attemptTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
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
      : (roundQueue[roundCursor] ?? roundQueue[0]);
  const historicalSessionRound = campaignReviewSelection
    ? buildCampaignSessionRound(
        campaignReviewSelection.level,
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
  const historicalWrongPattern =
    historicalSessionRound && historicalMistake
      ? historicalSessionRound.round.options[historicalMistake.chosenIndex]
      : undefined;
  const round = activeSessionRound?.round ?? ROUNDS[0];
  const selectedCorrect = selectedIndex === round.correctIndex;
  const comparison =
    selectedIndex !== null && !selectedCorrect
      ? compareHolePatterns(round.options[selectedIndex], round.correctPattern)
      : { missing: [] as readonly Cell[], extra: [] as readonly Cell[] };
  const differenceCount = comparison.missing.length + comparison.extra.length;
  const unfoldPatterns = useMemo(
    () => unfoldStages(round.folds, round.punches),
    [round],
  );
  const currentUnfoldPattern =
    unfoldPatterns[Math.min(revealStage, unfoldPatterns.length - 1)] ??
    round.correctPattern;
  const sessionLength = roundQueue.length;
  const progress = roundCursor + (phase === "answered" ? 1 : 0);
  const isLastRedemptionRound =
    isRedemption && roundCursor === sessionLength - 1;
  const campaignFirstTryScore = Object.values(campaignProgress).filter(
    (problem) => problem?.firstAttempt === "correct",
  ).length;
  const infiniteFirstTryScore = infiniteAdaptive.attempts.filter(
    ({ firstTryCorrect }) => firstTryCorrect,
  ).length;
  const firstTryScore = isCampaign
    ? campaignFirstTryScore
    : isInfinite
      ? infiniteFirstTryScore
      : 0;
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
      sessionRound.campaign?.level === activeCampaignLevel,
  );
  const visibleMistakes = reviewLevel
    ? outstandingMistakes.filter(
        ({ sessionRound }) => sessionRound.campaign?.level === reviewLevel,
      )
    : outstandingMistakes;
  const reviewLevelFirstTryScore = reviewLevel
    ? Array.from(
        { length: CAMPAIGN_PROBLEMS_PER_LEVEL },
        (_, index) =>
          campaignProgress[campaignRoundId(reviewLevel, index)]
            ?.firstAttempt === "correct",
      ).filter(Boolean).length
    : 0;
  const infiniteEnergy = comboEnergyPercent(infiniteAdaptive.combo);
  const infiniteSupercharged =
    infiniteAdaptive.combo >= MAX_ENERGY_COMBO;

  const clearAttemptTimers = useCallback(() => {
    for (const timer of attemptTimersRef.current) clearTimeout(timer);
    attemptTimersRef.current = [];
  }, []);

  const resetAttemptState = useCallback(() => {
    animationTokenRef.current += 1;
    clearAttemptTimers();
    inputLockedRef.current = false;
    retryFocusIndexRef.current = null;
    setSelectedIndex(null);
    setRetryReady(false);
    setRevealStage(0);
    setPhase("idle");
  }, [clearAttemptTimers]);

  const openCampaignReview = useCallback(
    (level: CampaignLevel, problemIndex: number) => {
      const id = campaignRoundId(level, problemIndex);
      if (
        !canOpenHistoricalReview({
          isIdle: phase === "idle",
          isSolved: Boolean(campaignProgress[id]?.solved),
          isReviewOpen: campaignReviewSelection !== null,
        })
      ) {
        return;
      }
      reviewOriginIdRef.current = id;
      setCampaignReviewSelection({ level, problemIndex });
    },
    [campaignProgress, campaignReviewSelection, phase],
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

  const chooseOption = useCallback(
    (optionIndex: number) => {
      if (
        inputLockedRef.current ||
        phase !== "idle" ||
        complete ||
        !hasStarted ||
        generationExhausted ||
        campaignReviewSelection !== null ||
        (isCampaign && activeCampaignLevelComplete) ||
        !activeSessionRound
      ) {
        return;
      }

      inputLockedRef.current = true;
      setRetryReady(false);
      const isCorrect = optionIndex === round.correctIndex;
      controlledSession?.answer({
        correct: isCorrect,
        answerToken: `option-${optionIndex}`,
      });
      const wasMissed = mistakes.some(
        ({ sessionRound }) => sessionRound.id === activeSessionRound.id,
      );
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      playFeedbackSound(isCorrect);
      setSelectedIndex(optionIndex);
      setRevealStage(0);

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
          setCompletedCount((current) => current + 1);
        } else if (!isRedemption && !wasMissed) {
          setMistakes((current) => [
            ...current,
            { sessionRound: activeSessionRound, chosenIndex: optionIndex },
          ]);
        }
      }

      const animationToken = animationTokenRef.current + 1;
      animationTokenRef.current = animationToken;
      clearAttemptTimers();

      if (isCorrect) {
        setPhase("animating");
        const stageCount = Math.max(unfoldPatterns.length, 1);
        const foldCount = Math.max(stageCount - 1, 0);
        if (reducedMotion) {
          setRevealStage(stageCount - 1);
          attemptTimersRef.current.push(
            setTimeout(() => {
              if (animationTokenRef.current !== animationToken) return;
              setPhase("answered");
            }, REDUCED_UNFOLD_MS),
          );
          return;
        }
        for (let stage = 1; stage < stageCount; stage += 1) {
          attemptTimersRef.current.push(
            setTimeout(() => {
              if (animationTokenRef.current === animationToken) {
                setRevealStage(stage);
              }
            }, UNFOLD_STAGE_MS * stage),
          );
        }
        const finishDelay =
          Math.max(UNFOLD_STAGE_MS * foldCount, UNFOLD_FLIP_MS) + 30;
        attemptTimersRef.current.push(
          setTimeout(() => {
            if (animationTokenRef.current !== animationToken) return;
            setRevealStage(stageCount - 1);
            setPhase("answered");
          }, finishDelay),
        );
        return;
      }

      setPhase("wrong-review");
      attemptTimersRef.current.push(
        setTimeout(
          () => {
            if (animationTokenRef.current !== animationToken) return;
            retryFocusIndexRef.current = optionIndex;
            inputLockedRef.current = false;
            setSelectedIndex(null);
            setRetryReady(true);
            setPhase("idle");
            controlledSession?.retry();
          },
          reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
        ),
      );
    },
    [
      activeCampaignLevelComplete,
      activeSessionRound,
      campaignReviewSelection,
      clearAttemptTimers,
      complete,
      controlledSession,
      generationExhausted,
      isCampaign,
      isInfinite,
      isRedemption,
      mistakes,
      phase,
      playFeedbackSound,
      round,
      hasStarted,
      unfoldPatterns.length,
    ],
  );

  const startCampaign = useCallback(() => {
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    infiniteAdaptiveRef.current = initialAdaptive;
    setSessionMode("campaign");
    setPlayMode("campaign");
    setRoundQueue([]);
    setRoundCursor(0);
    setActiveCampaignLevel("Starter");
    setCampaignCursors(initialCampaignCursors());
    setCampaignProgress({});
    setInfiniteAdaptive(initialAdaptive);
    setCompletedCount(0);
    setMistakes([]);
    setRedemptionTotal(0);
    setReviewLevel(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setCampaignReviewSelection(null);
    setStarted(true);
    setComplete(false);
    setGenerationExhausted(false);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, resumeAudio]);

  const startInfinite = useCallback(() => {
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    infiniteAdaptiveRef.current = initialAdaptive;
    const firstRound = safeInfiniteRound(
      1,
      "Easy",
      infiniteFingerprintsRef.current,
    );
    if (!firstRound) return;
    setSessionMode("infinite");
    setPlayMode("infinite");
    setRoundQueue([firstRound]);
    setRoundCursor(0);
    setInfiniteAdaptive(initialAdaptive);
    setCompletedCount(0);
    setMistakes([]);
    setRedemptionTotal(0);
    setReviewLevel(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setCampaignReviewSelection(null);
    setStarted(true);
    setComplete(false);
    setGenerationExhausted(false);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, resumeAudio]);

  const selectCampaignLevel = useCallback(
    (level: CampaignLevel) => {
      if (
        !isCampaign ||
        phase !== "idle" ||
        campaignReviewSelection !== null ||
        level === activeCampaignLevel
      ) {
        return;
      }
      resetAttemptState();
      setActiveCampaignLevel(level);
      shouldFocusFirstOption.current = !isCampaignLevelComplete(
        campaignProgress,
        level,
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

  const startRedemption = useCallback(() => {
    if (visibleMistakes.length === 0) return;
    const queue = visibleMistakes.map(({ sessionRound }, index) => ({
      ...sessionRound,
      id: `redemption-${index}-${sessionRound.id}`,
      ordinal: index + 1,
    }));
    setRedemptionMistakeIds(
      visibleMistakes.map(({ sessionRound }) => sessionRound.id),
    );
    setSessionMode("redemption");
    setCampaignReviewSelection(null);
    setRoundQueue(queue);
    setRoundCursor(0);
    setCompletedCount(0);
    setRedemptionTotal(queue.length);
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, visibleMistakes]);

  const goNext = useCallback(() => {
    if (phase !== "answered") return;

    if (controlledSession) {
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
      const nextOrdinal = (activeSessionRound?.ordinal ?? roundCursor + 1) + 1;
      const nextRound = safeInfiniteRound(
        nextOrdinal,
        infiniteAdaptiveRef.current.targetDifficulty,
        infiniteFingerprintsRef.current,
      );
      shouldFocusFirstOption.current = true;
      resetAttemptState();
      if (!nextRound) {
        shouldFocusFirstOption.current = false;
        setGenerationExhausted(true);
        return;
      }
      setGenerationExhausted(false);
      setRoundQueue((current) => [...current, nextRound]);
      setRoundCursor((current) => current + 1);
      return;
    }

    if (isLastRedemptionRound) {
      resetAttemptState();
      if (reviewLevel) {
        const redeemedLevel = reviewLevel;
        setRedeemedMistakeIds((current) => [
          ...new Set([...current, ...redemptionMistakeIds]),
        ]);
        setRedemptionMistakeIds([]);
        setReviewLevel(null);
        setSessionMode("campaign");
        setRoundQueue([]);
        setRoundCursor(0);
        setRedemptionTotal(0);
        setActiveCampaignLevel(redeemedLevel);
        setComplete(false);
        shouldFocusFirstOption.current = false;
        return;
      }
      setRedeemedMistakeIds((current) => [
        ...new Set([...current, ...redemptionMistakeIds]),
      ]);
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
    controlledSession,
    isCampaign,
    isInfinite,
    isLastRedemptionRound,
    phase,
    redemptionMistakeIds,
    reviewLevel,
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

  useEffect(() => {
    const enabled = readSoundPreference(["shape-fold-sound"]);
    if (enabled) return;
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

    const currentRound = controlledSession.current.round;
    const savedOptionIndex = progressionOptionIndexFromAnswerToken(
      controlledSession.lastAnswerToken,
    );
    const hydrateTimer = window.setTimeout(() => {
      hydratedProgressionPlayIdRef.current = hydrationKey;
      resetAttemptState();
      setGenerationExhausted(false);
      setCampaignReviewSelection(null);
      if (controlledSession.roundPhase === "solved") {
        inputLockedRef.current = true;
        setSelectedIndex(currentRound.correctIndex);
        setRevealStage(
          Math.max(
            unfoldStages(currentRound.folds, currentRound.punches).length - 1,
            0,
          ),
        );
        setPhase("answered");
        return;
      }
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
        attemptTimersRef.current.push(
          setTimeout(
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
          ),
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
    if (!controlledSession.current) {
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
    controlledSession.setTurboClockPaused(
      campaignReviewSelection !== null || generationExhausted,
    );
    const nextInteractionState =
      controlledSession.roundPhase === "solved"
        ? "blocked"
        : controlledSession.roundPhase === "feedback"
          ? "mandatory-feedback"
          : phase === "idle" &&
        !inputLockedRef.current &&
        campaignReviewSelection === null &&
        !generationExhausted
            ? "answering"
            : "mandatory-feedback";
    if (controlledSession.interactionState !== nextInteractionState) {
      controlledSession.setInteractionState(nextInteractionState);
    }
  }, [
    campaignReviewSelection,
    controlledSession,
    generationExhausted,
    phase,
  ]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        !hasStarted ||
        complete ||
        generationExhausted ||
        campaignReviewSelection !== null ||
        phase !== "idle" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
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
    generationExhausted,
    phase,
    hasStarted,
  ]);

  useEffect(() => {
    if (phase === "answered") nextButtonRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (shouldFocusFirstOption.current && hasStarted && !complete) {
      optionButtonRefs.current[0]?.focus();
      shouldFocusFirstOption.current = false;
    }
  }, [
    activeCampaignLevel,
    campaignProblemIndex,
    complete,
    roundCursor,
    sessionMode,
    hasStarted,
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
    if (campaignReviewSelection) {
      historicalReviewHeadingRef.current?.focus();
    }
  }, [campaignReviewSelection]);

  useEffect(() => {
    if (showCampaignLevelComplete || generationExhausted) {
      levelCompleteButtonRef.current?.focus();
    }
  }, [generationExhausted, showCampaignLevelComplete]);

  useEffect(() => {
    function finishTeachingMotion() {
      if (!inputLockedRef.current || phase !== "animating") return;
      animationTokenRef.current += 1;
      clearAttemptTimers();
      setRevealStage(Math.max(unfoldPatterns.length - 1, 0));
      setPhase("answered");
    }
    window.addEventListener("resize", finishTeachingMotion);
    window.addEventListener("scroll", finishTeachingMotion, true);
    return () => {
      window.removeEventListener("resize", finishTeachingMotion);
      window.removeEventListener("scroll", finishTeachingMotion, true);
    };
  }, [clearAttemptTimers, phase, unfoldPatterns.length]);

  useEffect(
    () => () => {
      animationTokenRef.current += 1;
      clearAttemptTimers();
      const context = audioContextRef.current;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    },
    [clearAttemptTimers],
  );

  const resultMessage = useMemo(() => {
    const denominator = isInfinite
      ? Math.max(infiniteAdaptive.attempts.length, 1)
      : ROUNDS.length;
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
  const displayedResultFirstTryScore = reviewLevel
    ? reviewLevelFirstTryScore
    : firstTryScore;
  const resultDenominator = reviewLevel
    ? CAMPAIGN_PROBLEMS_PER_LEVEL
    : isInfinite
      ? infiniteAdaptive.attempts.length
      : ROUNDS.length;
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
        <span className={styles.gameTitle}>{shapeFoldGame.title}</span>
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
            <h1 id="tutorial-title">Fold it. Punch it. Open it.</h1>
            <div className={styles.exampleFlow}>
              <FoldSequence round={TUTORIAL} />
              <span className={styles.exampleConnector} aria-hidden="true">
                →
              </span>
              <div className={styles.exampleAnswer}>
                <PaperDiagram
                  holes={TUTORIAL.correctPattern}
                  size="tutorialPaper"
                  label={`Correct opened paper: ${describePattern(
                    TUTORIAL.correctPattern,
                  )}`}
                />
                <span className={styles.exampleMark} aria-label="Correct">
                  ✓
                </span>
              </div>
            </div>
            <div className={styles.nearMiss}>
              <span aria-hidden="true">Not this</span>
              <PaperDiagram
                holes={TUTORIAL.nearMiss}
                size="reviewPaper"
                label={`Near match, not the answer: ${describePattern(
                  TUTORIAL.nearMiss,
                )}`}
              />
              <span className={styles.wrongMark} aria-label="Not a match">
                ×
              </span>
            </div>
            {controlledSession?.sectionIntro ? (
              <ProgressionCulminationSectionIntro
                gameTitle={shapeFoldGame.title}
                section={controlledSession.sectionIntro}
                onBegin={controlledSession.beginSection}
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
                remainingMs={
                  controlledSession.turboRemainingMs ?? undefined
                }
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
                  <div className={styles.campaignLevels}>
                    {CAMPAIGN_LEVELS.map((level) => {
                      const levelComplete = isCampaignLevelComplete(
                        campaignProgress,
                        level,
                      );
                      const hasIncorrect = Array.from(
                        { length: CAMPAIGN_PROBLEMS_PER_LEVEL },
                        (_, index) =>
                          campaignProgress[campaignRoundId(level, index)]
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
                                : styles.campaignLevelNotDone
                          } ${
                            activeCampaignLevel === level
                              ? styles.campaignLevelActive
                              : ""
                          }`}
                          type="button"
                          aria-pressed={activeCampaignLevel === level}
                          aria-controls="campaign-play-area"
                          aria-label={`${level}, ${state}`}
                          disabled={
                            phase !== "idle" ||
                            campaignReviewSelection !== null
                          }
                          onClick={() => selectCampaignLevel(level)}
                          key={level}
                        >
                          {level}
                        </button>
                      );
                    })}
                  </div>
                  <div
                    className={styles.campaignProblems}
                    role="group"
                    aria-label={`${activeCampaignLevel} problems`}
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
                          campaignReviewSelection?.level ===
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
                            aria-label={`${activeCampaignLevel} problem ${
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
                    className={styles.visuallyHidden}
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
                  ? `${campaignProblemIndex + 1} / 12`
                  : `${activeSessionRound?.ordinal ?? roundCursor + 1} / ${
                      isInfinite ? "∞" : sessionLength
                    }`}
              </span>
              {!isCampaign ? (
                <span className={styles.difficulty}>
                  {LEVEL_FROM_ADAPTIVE[round.difficulty]}
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

            {isInfinite && generationExhausted ? (
              <section
                className={styles.levelCompleteCard}
                id="campaign-play-area"
                aria-labelledby="fresh-set-title"
              >
                <p className={styles.kicker}>Infinite</p>
                <h2 id="fresh-set-title">Fresh set complete</h2>
                <p className={styles.checkpointCopy}>
                  You’ve used every new puzzle at this level in this run.
                </p>
                <button
                  className={styles.primaryButton}
                  type="button"
                  ref={levelCompleteButtonRef}
                  onClick={endInfinite}
                >
                  Results
                  <span aria-hidden="true">→</span>
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
                      {historicalSessionRound.campaign?.level} · Problem{" "}
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
                  <div className={styles.historicalPrompt}>
                    <span>Original fold</span>
                    <FoldSequence
                      round={historicalSessionRound.round}
                      compact
                    />
                  </div>
                  <div className={styles.historicalAnswers}>
                    <div>
                      <span>Correct opened paper</span>
                      <PaperDiagram
                        holes={historicalSessionRound.round.correctPattern}
                        size="tutorialPaper"
                        label={`Correct opened paper: ${describePattern(
                          historicalSessionRound.round.correctPattern,
                        )}`}
                      />
                    </div>
                    {historicalWrongPattern ? (
                      <div className={styles.historicalWrongAnswer}>
                        <span>Your first answer</span>
                        <PaperDiagram
                          holes={historicalWrongPattern}
                          size="tutorialPaper"
                          label={`Your first incorrect answer: ${describePattern(
                            historicalWrongPattern,
                          )}`}
                        />
                        <strong aria-hidden="true">×</strong>
                      </div>
                    ) : null}
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
                  {activeCampaignLevel} · 12 / 12
                </p>
                <h2 id="level-complete-title">Level complete</h2>
                <button
                  className={styles.primaryButton}
                  type="button"
                  ref={levelCompleteButtonRef}
                  onClick={() => {
                    if (activeLevelMistakes.length > 0) {
                      setReviewLevel(activeCampaignLevel);
                      setComplete(true);
                    } else if (nextCampaignLevel) {
                      selectCampaignLevel(nextCampaignLevel);
                    } else {
                      setReviewLevel(null);
                      setComplete(true);
                    }
                  }}
                >
                  {activeLevelMistakes.length > 0
                    ? "Review Mistakes"
                    : nextCampaignLevel ?? "Results"}
                  <span aria-hidden="true">→</span>
                </button>
              </section>
            ) : (
              <>
                <div className={styles.gameBoard} id="campaign-play-area">
                  <section
                    className={styles.cluePanel}
                    aria-label="Fold sequence and punch"
                  >
                    <div
                      className={`${styles.promptStage} ${
                        selectedCorrect &&
                        (phase === "animating" || phase === "answered")
                          ? styles.promptAnimating
                          : ""
                      }`}
                    >
                      <FoldSequence round={round} />
                    </div>
                    {selectedCorrect &&
                    (phase === "animating" || phase === "answered") ? (
                      <div
                        className={styles.unfoldReveal}
                      >
                        <span className={styles.unfoldLabel}>
                          {phase === "answered"
                            ? "Paper opened"
                            : `Opening ${Math.min(
                                revealStage + 1,
                                round.folds.length,
                              )} / ${
                                round.folds.length
                              }`}
                        </span>
                        <UnfoldingPaper
                          round={round}
                          holes={currentUnfoldPattern}
                          stageIndex={revealStage}
                          complete={phase === "answered"}
                        />
                      </div>
                    ) : null}
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
                        const optionComparison =
                          showWrong && round.difficulty !== "Wizard"
                            ? compareHolePatterns(
                                option,
                                round.correctPattern,
                              )
                            : {
                                missing: [] as readonly Cell[],
                                extra: [] as readonly Cell[],
                              };
                        const answerState = showCorrect
                          ? ", correct answer"
                          : showWrong
                            ? round.difficulty !== "Wizard"
                              ? `, your answer; ${
                                  optionComparison.missing.length
                                } missing and ${
                                  optionComparison.extra.length
                                } extra openings`
                              : ", your answer; does not match"
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
                            }: ${describePattern(option)}${answerState}`}
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
                            <PaperDiagram
                              holes={option}
                              missing={optionComparison.missing}
                              extra={optionComparison.extra}
                              size="answerPaper"
                              hidden
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
                  </section>
                </div>

                <div
                  className={styles.feedbackBar}
                  aria-live="polite"
                  aria-atomic="true"
                  role="status"
                >
                  {phase === "animating" ? (
                    <strong>Opening the paper…</strong>
                  ) : phase === "wrong-review" ? (
                    <strong className={styles.wrongText}>
                      {round.difficulty === "Wizard"
                        ? "Not quite · this opening pattern does not match"
                        : `Not quite · ${differenceCount} ${
                            differenceCount === 1
                              ? "opening differs"
                              : "openings differ"
                          }`}
                    </strong>
                  ) : phase === "answered" ? (
                    <>
                      <strong className={styles.correctText}>Correct</strong>
                      <button
                        className={styles.nextButton}
                        type="button"
                        onClick={goNext}
                        ref={nextButtonRef}
                      >
                        {isLastRedemptionRound
                          ? reviewLevel
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
                    <strong>Try again</strong>
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
                : reviewLevel
                  ? `${reviewLevel} complete`
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
                    const wrongPattern = missedRound.options[chosenIndex];
                    const reviewComparison =
                      missedRound.difficulty !== "Wizard"
                        ? compareHolePatterns(
                            wrongPattern,
                            missedRound.correctPattern,
                          )
                        : {
                            missing: [] as readonly Cell[],
                            extra: [] as readonly Cell[],
                          };
                    return (
                      <article className={styles.reviewCard} key={missed.id}>
                        <span className={styles.reviewRound}>
                          {missed.campaign
                            ? `${missed.campaign.level} · Puzzle ${
                                missed.campaign.problemIndex + 1
                              }`
                            : `Puzzle ${missed.ordinal} · ${
                                LEVEL_FROM_ADAPTIVE[missedRound.difficulty]
                              }`}
                        </span>
                        <div className={styles.reviewVisual}>
                          <FoldSequence round={missedRound} compact />
                          <span
                            className={styles.reviewArrow}
                            aria-hidden="true"
                          >
                            →
                          </span>
                          <div className={styles.reviewWrong}>
                            <PaperDiagram
                              holes={wrongPattern}
                              missing={reviewComparison.missing}
                              extra={reviewComparison.extra}
                              size="reviewPaper"
                              label={`Your answer: ${describePattern(
                                wrongPattern,
                              )}`}
                            />
                            <span aria-hidden="true">×</span>
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
                  onClick={
                    playMode === "infinite" ? startInfinite : startCampaign
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
    </div>
  );
}
