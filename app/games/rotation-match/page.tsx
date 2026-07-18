"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import { rotationMatchGame as transformationMatchGame } from "./game-info";
import {
  ROUNDS,
  TUTORIAL,
  applyTransform,
  describePattern,
  differingTileIndexes,
  generateInfiniteRound,
  patternKey,
  roundFingerprint,
  type MirrorAxis,
  type Pattern,
  type PuzzleTransform,
  type RotationTransform,
  type Round,
  type Difficulty,
} from "./game-engine";
import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  infiniteLevelLabel,
  recordInfiniteFirstAttempt,
} from "./infinite-progression";
import styles from "./rotation-match.module.css";

type PatternSize = "tutorialPattern" | "clue" | "option" | "review" | "ghost";
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
  transformCss: string;
  reducedMotion: boolean;
};

type CustomProperties = CSSProperties & Record<`--${string}`, string>;

const GHOST_ANIMATION_MS = 900;
const GHOST_SETTLE_MS = 930;
const REDUCED_GHOST_MS = 140;
const HIDDEN_WRONG_FEEDBACK_MS = 180;
const WRONG_REVIEW_MS = 2200;
const REDUCED_WRONG_REVIEW_MS = 1300;
const CAMPAIGN_PROBLEMS_PER_LEVEL = 12;

function transformTutorialKey(transform: PuzzleTransform): string {
  return transform.kind === "rotation"
    ? `rotation:${transform.degrees}:${transform.direction}`
    : `reflection:${transform.axis}`;
}

function transformTutorialTitle(transform: PuzzleTransform): string {
  if (transform.kind === "rotation") {
    return `Rotate ${transform.degrees}° ${transform.direction}`;
  }

  switch (transform.axis) {
    case "vertical":
      return "Flip across the vertical axis";
    case "horizontal":
      return "Flip across the horizontal axis";
    case "main-diagonal":
      return "Flip across the diagonal";
    case "anti-diagonal":
      return "Flip across the other diagonal";
  }
}

function transformTutorialDescription(transform: PuzzleTransform): string {
  if (transform.kind === "rotation") {
    return "Every tile travels around the center. Any directional mark turns with its tile.";
  }

  switch (transform.axis) {
    case "vertical":
      return "Left and right trade places across the upright line.";
    case "horizontal":
      return "Top and bottom trade places across the flat line.";
    case "main-diagonal":
      return "Tiles cross the line from top left to bottom right, like a page turning on its fold.";
    case "anti-diagonal":
      return "Tiles cross the line from bottom left to top right, like a page turning on its fold.";
  }
}

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

function PatternGrid({
  pattern,
  size,
  label,
  hidden = false,
  gridRef,
  differenceIndexes = [],
}: {
  pattern: Pattern;
  size: PatternSize;
  label?: string;
  hidden?: boolean;
  gridRef?: Ref<HTMLDivElement>;
  differenceIndexes?: readonly number[];
}) {
  const differenceSet = new Set(differenceIndexes);

  return (
    <div
      className={`${styles.pattern} ${styles[size]}`}
      role={hidden ? undefined : "img"}
      aria-label={hidden ? undefined : label}
      aria-hidden={hidden || undefined}
      ref={gridRef}
    >
      {pattern.map((tile, index) => {
        const motifStyle = {
          "--motif-turn": `${tile.orientation * 90}deg`,
        } as CustomProperties;

        return (
          <span
            className={`${styles.tile} ${styles[tile.color]} ${
              differenceSet.has(index) ? styles.differenceTile : ""
            }`}
            aria-hidden="true"
            key={`${index}-${tile.color}-${tile.motif}-${tile.orientation}`}
          >
            {tile.motif === "cap" ? (
              <span className={styles.capMark} style={motifStyle} />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function TurnArrow({ transform }: { transform: RotationTransform }) {
  const shortDirection = transform.direction === "clockwise" ? "CW" : "CCW";
  const label = `Rotate ${transform.degrees} degrees ${transform.direction}`;
  const cueStyle = {
    "--arc": `${transform.degrees}deg`,
    "--arc-start":
      transform.direction === "clockwise"
        ? "0deg"
        : `-${transform.degrees}deg`,
    "--end-turn": `${transform.angleDegrees}deg`,
  } as CustomProperties;

  return (
    <div className={styles.turnCue} role="img" aria-label={label}>
      <div
        className={`${styles.turnGraphic} ${
          transform.direction === "clockwise"
            ? styles.clockwise
            : styles.counterclockwise
        }`}
        style={cueStyle}
        aria-hidden="true"
      >
        <span className={styles.turnArc} />
        <span className={styles.turnEnd}>
          <span className={styles.turnArrowHead}>
            {transform.direction === "clockwise" ? "›" : "‹"}
          </span>
        </span>
        <span className={styles.turnCenter} />
      </div>
      <span className={styles.turnLabel} aria-hidden="true">
        {transform.degrees}° {shortDirection}
      </span>
    </div>
  );
}

function MirrorCue({ axis }: { axis: MirrorAxis }) {
  const config: Record<
    MirrorAxis,
    { label: string; shortLabel: string; className: string }
  > = {
    vertical: {
      label: "Flip across the vertical axis",
      shortLabel: "V FLIP",
      className: styles.mirrorVertical,
    },
    horizontal: {
      label: "Flip across the horizontal axis",
      shortLabel: "H FLIP",
      className: styles.mirrorHorizontal,
    },
    "main-diagonal": {
      label: "Flip across the diagonal from top left to bottom right",
      shortLabel: "\\ FLIP",
      className: styles.mirrorMainDiagonal,
    },
    "anti-diagonal": {
      label: "Flip across the diagonal from bottom left to top right",
      shortLabel: "/ FLIP",
      className: styles.mirrorAntiDiagonal,
    },
  };
  const current = config[axis];

  return (
    <div className={styles.turnCue} role="img" aria-label={current.label}>
      <div
        className={`${styles.mirrorGraphic} ${current.className}`}
        aria-hidden="true"
      >
        <span className={styles.mirrorAxis} />
        <span className={styles.mirrorSides}>
          <span>→</span>
          <span>←</span>
        </span>
      </div>
      <span className={styles.turnLabel} aria-hidden="true">
        {current.shortLabel}
      </span>
    </div>
  );
}

function TransformCue({ transform }: { transform: PuzzleTransform }) {
  return transform.kind === "rotation" ? (
    <TurnArrow transform={transform} />
  ) : (
    <MirrorCue axis={transform.axis} />
  );
}

function PuzzleTransformCue({ round }: { round: Round }) {
  if (round.difficulty !== "Wizard") {
    return <TransformCue transform={round.transform} />;
  }

  return (
    <div
      className={`${styles.turnCue} ${styles.mysteryCue}`}
      role="img"
      aria-label="Mystery transformation"
    >
      <span aria-hidden="true">?</span>
    </div>
  );
}

function TransformTutorialModal({
  transform,
  continueRef,
  onContinue,
}: {
  transform: PuzzleTransform;
  continueRef: Ref<HTMLButtonElement>;
  onContinue: () => void;
}) {
  const transformedPattern = applyTransform(TUTORIAL.clue, transform);
  const moverStyle = {
    "--tutorial-transform": ghostTransformCss(transform),
  } as CustomProperties;
  const title = transformTutorialTitle(transform);

  return (
    <div className={styles.tutorialModalBackdrop} role="presentation">
      <section
        className={styles.tutorialModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transform-tutorial-title"
        aria-describedby="transform-tutorial-description"
      >
        <p className={styles.kicker}>Quick look</p>
        <h2 id="transform-tutorial-title">{title}</h2>
        <p id="transform-tutorial-description" className={styles.tutorialModalCopy}>
          {transformTutorialDescription(transform)}
        </p>

        <div className={styles.tutorialDemo} aria-label={`${title} demonstration`}>
          <div className={styles.tutorialDemoPattern}>
            <PatternGrid
              pattern={TUTORIAL.clue}
              size="tutorialPattern"
              label={`Before: ${describePattern(TUTORIAL.clue)}`}
            />
            <span>Before</span>
          </div>
          <div className={styles.tutorialDemoMotion} aria-hidden="true">
            <div className={styles.tutorialDemoMover} style={moverStyle}>
              <PatternGrid pattern={TUTORIAL.clue} size="tutorialPattern" hidden />
            </div>
          </div>
          <div className={styles.tutorialDemoPattern}>
            <PatternGrid
              pattern={transformedPattern}
              size="tutorialPattern"
              label={`After: ${describePattern(transformedPattern)}`}
            />
            <span>After</span>
          </div>
        </div>

        <div className={styles.tutorialCue}>
          <TransformCue transform={transform} />
        </div>
        <p className={styles.tutorialModalHint}>
          Watch the whole loop, then try it yourself.
        </p>
        <button
          className={styles.primaryButton}
          type="button"
          ref={continueRef}
          onClick={onContinue}
        >
          Got it <span aria-hidden="true">→</span>
        </button>
      </section>
    </div>
  );
}

function ghostTransformCss(transform: PuzzleTransform) {
  if (transform.kind === "rotation") {
    return `rotate(${transform.angleDegrees}deg)`;
  }

  switch (transform.axis) {
    case "vertical":
      return "rotateY(180deg)";
    case "horizontal":
      return "rotateX(180deg)";
    case "main-diagonal":
      return "rotate(45deg) rotateX(180deg) rotate(-45deg)";
    case "anti-diagonal":
      return "rotate(-45deg) rotateX(180deg) rotate(45deg)";
  }
}

function buildInfiniteSessionRound(
  ordinal: number,
  seenFingerprints: Set<string>,
  difficulty: Difficulty,
): SessionRound {
  let round = generateInfiniteRound(difficulty);
  let fingerprint = roundFingerprint(round);

  for (
    let attempt = 0;
    attempt < 24 && seenFingerprints.has(fingerprint);
    attempt += 1
  ) {
    round = generateInfiniteRound(difficulty);
    fingerprint = roundFingerprint(round);
  }

  seenFingerprints.add(fingerprint);
  return {
    id: `infinite-${ordinal}-${fingerprint}`,
    ordinal,
    round,
  };
}

function scheduleTone(
  context: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.015);
  oscillator.addEventListener(
    "ended",
    () => {
      oscillator.disconnect();
      gain.disconnect();
    },
    { once: true },
  );
}

function playTones(context: AudioContext, correct: boolean) {
  const now = context.currentTime + 0.012;

  if (correct) {
    scheduleTone(context, 523.25, now, 0.13, 0.052);
    scheduleTone(context, 659.25, now + 0.075, 0.15, 0.048);
    return;
  }

  scheduleTone(context, 220, now, 0.11, 0.048);
  scheduleTone(context, 174.61, now + 0.055, 0.12, 0.044);
}

export default function TransformationMatchPage() {
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
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [mistakes, setMistakes] = useState<readonly MistakeRecord[]>([]);
  const [retryReady, setRetryReady] = useState(false);
  const [redemptionTotal, setRedemptionTotal] = useState(0);
  const [reviewLevelId, setReviewLevelId] =
    useState<CampaignLevelId | null>(null);
  const [tutorialTransform, setTutorialTransform] =
    useState<PuzzleTransform | null>(null);
  const [redeemedMistakeIds, setRedeemedMistakeIds] = useState<
    readonly string[]
  >([]);
  const [redemptionMistakeIds, setRedemptionMistakeIds] = useState<
    readonly string[]
  >([]);

  const clueGridRef = useRef<HTMLDivElement>(null);
  const optionGridRefs = useRef<Array<HTMLDivElement | null>>([]);
  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const levelCompleteButtonRef = useRef<HTMLButtonElement>(null);
  const tutorialContinueRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const flightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTokenRef = useRef(0);
  const inputLockedRef = useRef(false);
  const shouldFocusFirstOption = useRef(false);
  const retryFocusIndexRef = useRef<number | null>(null);
  const infiniteFingerprintsRef = useRef(new Set<string>());
  const infiniteAdaptiveRef = useRef(initialInfiniteAdaptiveState());
  const seenTransformTutorialsRef = useRef(new Set<string>());

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
  const round = activeSessionRound?.round ?? ROUNDS[0];
  const sessionLength = roundQueue.length;
  const selectedCorrect = selectedIndex === round.correctIndex;
  const selectedDifferenceCount =
    selectedIndex !== null && !selectedCorrect
      ? differingTileIndexes(round.options[selectedIndex], round.correctPattern)
          .length
      : 0;
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

  const dismissTransformTutorial = useCallback(() => {
    setTutorialTransform(null);
    shouldFocusFirstOption.current = true;
  }, []);

  const maybeShowTransformTutorial = useCallback(
    (transform: PuzzleTransform) => {
      const key = transformTutorialKey(transform);
      if (seenTransformTutorialsRef.current.has(key)) return false;

      seenTransformTutorialsRef.current.add(key);
      setTutorialTransform(transform);
      return true;
    },
    [],
  );

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
          .then(() => playTones(context, correct))
          .catch(() => undefined);
        return;
      }

      if (context.state === "running") playTones(context, correct);
    },
    [ensureAudioContext, soundEnabled],
  );

  const chooseOption = useCallback(
    (optionIndex: number) => {
      if (
        inputLockedRef.current ||
        phase !== "idle" ||
        complete ||
        tutorialTransform !== null ||
        !started ||
        (isCampaign && activeCampaignLevelComplete) ||
        !activeSessionRound
      ) {
        return;
      }

      inputLockedRef.current = true;
      setRetryReady(false);
      const isCorrect = optionIndex === round.correctIndex;
      const wasMissed = mistakes.some(
        ({ sessionRound }) => sessionRound.id === activeSessionRound.id,
      );
      const suppressWizardHint =
        round.difficulty === "Wizard" && !isCorrect;
      const sourceRect = clueGridRef.current?.getBoundingClientRect();
      const targetRect = optionGridRefs.current[optionIndex]?.getBoundingClientRect();
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

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
            : [...current, { sessionRound: activeSessionRound, chosenIndex: optionIndex }],
        );
      }

      if (!suppressWizardHint && sourceRect && targetRect) {
        setGhost({
          pattern: round.clue,
          left: sourceRect.left,
          top: sourceRect.top,
          width: sourceRect.width,
          height: sourceRect.height,
          deltaX: targetRect.left - sourceRect.left,
          deltaY: targetRect.top - sourceRect.top,
          scale: targetRect.width / sourceRect.width,
          transformCss: ghostTransformCss(round.transform),
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
        suppressWizardHint
          ? HIDDEN_WRONG_FEEDBACK_MS
          : reducedMotion
            ? REDUCED_GHOST_MS
            : GHOST_SETTLE_MS,
      );
    },
    [
      activeSessionRound,
      activeCampaignLevelComplete,
      clearAttemptTimers,
      complete,
      isCampaign,
      isInfinite,
      isRedemption,
      mistakes,
      phase,
      playFeedbackSound,
      round,
      started,
      tutorialTransform,
    ],
  );

  const startCampaign = useCallback(() => {
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    seenTransformTutorialsRef.current.clear();
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
    setTutorialTransform(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setStarted(true);
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current = !maybeShowTransformTutorial(
      campaignRounds("starter")[0].transform,
    );
  }, [maybeShowTransformTutorial, resetAttemptState, resumeAudio]);

  const startInfinite = useCallback(() => {
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    seenTransformTutorialsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    infiniteAdaptiveRef.current = initialAdaptive;
    const firstRound = buildInfiniteSessionRound(
      1,
      infiniteFingerprintsRef.current,
      initialAdaptive.targetDifficulty,
    );
    setSessionMode("infinite");
    setRoundQueue([firstRound]);
    setRoundCursor(0);
    setInfiniteAdaptive(initialAdaptive);
    setScore(0);
    setCompletedCount(0);
    setMistakes([]);
    setRedemptionTotal(0);
    setReviewLevelId(null);
    setTutorialTransform(null);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setStarted(true);
    setComplete(false);
    resetAttemptState();
    shouldFocusFirstOption.current =
      firstRound.round.difficulty === "Wizard" ||
      !maybeShowTransformTutorial(firstRound.round.transform);
  }, [maybeShowTransformTutorial, resetAttemptState, resumeAudio]);

  const selectCampaignLevel = useCallback(
    (levelId: CampaignLevelId) => {
      if (
        !isCampaign ||
        phase !== "idle" ||
        tutorialTransform !== null ||
        levelId === activeCampaignLevel
      ) {
        return;
      }

      resetAttemptState();
      setActiveCampaignLevel(levelId);
      const levelComplete = isCampaignLevelComplete(campaignProgress, levelId);
      shouldFocusFirstOption.current = !levelComplete;
      if (!levelComplete) {
        const nextRound = campaignRounds(levelId)[0];
        shouldFocusFirstOption.current =
          nextRound.difficulty === "Wizard" ||
          !maybeShowTransformTutorial(nextRound.transform);
      }
    },
    [
      activeCampaignLevel,
      campaignProgress,
      isCampaign,
      maybeShowTransformTutorial,
      phase,
      resetAttemptState,
      tutorialTransform,
    ],
  );

  const startRedemption = useCallback(() => {
    if (visibleMistakes.length === 0) return;
    setTutorialTransform(null);
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

    if (isCampaign) {
      resetAttemptState();

      if (campaignProblemIndex < CAMPAIGN_PROBLEMS_PER_LEVEL - 1) {
        const nextRound = campaignRounds(activeCampaignLevel)[
          campaignProblemIndex + 1
        ];
        shouldFocusFirstOption.current =
          nextRound.difficulty === "Wizard" ||
          !maybeShowTransformTutorial(nextRound.transform);
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
      const nextRound = buildInfiniteSessionRound(
        nextOrdinal,
        infiniteFingerprintsRef.current,
        infiniteAdaptiveRef.current.targetDifficulty,
      );
      shouldFocusFirstOption.current =
        nextRound.round.difficulty === "Wizard" ||
        !maybeShowTransformTutorial(nextRound.round.transform);
      resetAttemptState();
      setRoundQueue((current) => [...current, nextRound]);
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
    maybeShowTransformTutorial,
    phase,
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
    try {
      window.localStorage.setItem("rotation-match-sound", String(next));
    } catch {
      // Sound still works for this visit when storage is unavailable.
    }
    if (next) resumeAudio();
  }, [resumeAudio, soundEnabled]);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("rotation-match-sound");
    } catch {
      return;
    }
    if (stored !== "false") return;
    const timer = window.setTimeout(() => setSoundEnabled(false), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (tutorialTransform === null) return;

    tutorialContinueRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismissTransformTutorial();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismissTransformTutorial, tutorialTransform]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        !started ||
        complete ||
        tutorialTransform !== null ||
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
  }, [chooseOption, complete, phase, started, tutorialTransform]);

  useEffect(() => {
    if (phase === "answered") nextButtonRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (
      shouldFocusFirstOption.current &&
      started &&
      !complete &&
      tutorialTransform === null
    ) {
      optionButtonRefs.current[0]?.focus();
      shouldFocusFirstOption.current = false;
    }
  }, [
    activeCampaignLevel,
    campaignProblemIndex,
    complete,
    roundCursor,
    sessionMode,
    started,
    tutorialTransform,
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
    function finishMovingGhost() {
      if (!inputLockedRef.current) return;

      if (phase === "animating") {
        animationTokenRef.current += 1;
        clearAttemptTimers();
        setGhost(null);
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
        setGhost(null);
        setSelectedIndex(null);
        setRetryReady(true);
        setPhase("idle");
      }
    }

    window.addEventListener("resize", finishMovingGhost);
    window.addEventListener("scroll", finishMovingGhost, true);
    return () => {
      window.removeEventListener("resize", finishMovingGhost);
      window.removeEventListener("scroll", finishMovingGhost, true);
    };
  }, [clearAttemptTimers, phase, selectedCorrect, selectedIndex]);

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
            "--ghost-transform": ghost.transformCss,
            "--ghost-duration": `${GHOST_ANIMATION_MS}ms`,
          } as CustomProperties
        }
        aria-hidden="true"
      >
        <div className={styles.ghostTurn}>
          <PatternGrid pattern={ghost.pattern} size="ghost" hidden />
        </div>
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
        <span className={styles.gameTitle}>{transformationMatchGame.title}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {!started ? (
          <section className={styles.tutorial} aria-labelledby="tutorial-title">
            <p className={styles.kicker}>Example</p>
            <h1 id="tutorial-title">Transform it. Find it.</h1>

            <div className={styles.exampleFlow}>
              <PatternGrid
                pattern={TUTORIAL.clue}
                size="tutorialPattern"
                label={`Starting pattern: ${describePattern(TUTORIAL.clue)}`}
              />
              <TransformCue transform={TUTORIAL.transform} />
              <div className={styles.exampleAnswer}>
                <PatternGrid
                  pattern={TUTORIAL.answer}
                  size="tutorialPattern"
                  label={`Correct answer: ${describePattern(TUTORIAL.answer)}`}
                />
                <span className={styles.exampleMark} aria-label="Correct">
                  ✓
                </span>
              </div>
            </div>

            <div className={styles.mirrorExample}>
              <span className={styles.notEqual} aria-hidden="true">
                ≠
              </span>
              <PatternGrid
                pattern={TUTORIAL.mirror}
                size="option"
                label={`Mirror image, not the answer for this turn: ${describePattern(
                  TUTORIAL.mirror,
                )}`}
              />
              <span className={styles.mirrorMark} aria-label="Not a match">
                ×
              </span>
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
                  aria-label="Game progress"
                  aria-valuemin={0}
                  aria-valuemax={sessionLength}
                  aria-valuenow={progress}
                  style={{ gridTemplateColumns: `repeat(${sessionLength}, 1fr)` }}
                >
                  {roundQueue.map(({ id }, index) => (
                    <span
                      className={index < progress ? styles.progressDone : undefined}
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
            ) : (
              <>
                <div className={styles.gameBoard} id="campaign-play-area">
              <section className={styles.cluePanel} aria-label="Pattern and transform">
                <div
                  className={`${styles.clueStage} ${
                    phase === "animating" || phase === "wrong-review"
                      ? styles.clueAnimating
                      : ""
                  }`}
                >
                  <PatternGrid
                    pattern={round.clue}
                    size="clue"
                    label={`Starting pattern: ${describePattern(round.clue)}`}
                    gridRef={clueGridRef}
                  />
                  <PuzzleTransformCue round={round} />
                </div>
              </section>

              <section className={styles.answerPanel} aria-label="Answer choices">
                <div className={styles.optionGrid} role="group" aria-label="Answer choices">
                  {round.options.map((option, optionIndex) => {
                    const isCorrect = optionIndex === round.correctIndex;
                    const isSelected = selectedIndex === optionIndex;
                    const showCorrect = phase === "answered" && isCorrect;
                    const showWrong =
                      phase === "wrong-review" && isSelected && !isCorrect;
                    const muted =
                      (phase === "answered" && !isCorrect) ||
                      (phase === "wrong-review" && !isSelected);
                    const differences = showWrong
                      ? differingTileIndexes(option, round.correctPattern)
                      : [];
                    const answerState = showCorrect
                      ? ", correct answer"
                      : showWrong
                        ? `, your answer; ${differences.length} tiles differ`
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
                        aria-label={`Option ${optionIndex + 1}: ${describePattern(
                          option,
                        )}${answerState}`}
                        aria-keyshortcuts={`${optionIndex + 1}`}
                        ref={(node) => {
                          optionButtonRefs.current[optionIndex] = node;
                        }}
                        key={`${optionIndex}-${patternKey(option)}`}
                      >
                        <span className={styles.optionNumber} aria-hidden="true">
                          {optionIndex + 1}
                        </span>
                        <PatternGrid
                          pattern={option}
                          size="option"
                          hidden
                          differenceIndexes={differences}
                          gridRef={(node) => {
                            optionGridRefs.current[optionIndex] = node;
                          }}
                        />
                        {showCorrect ? (
                          <span className={styles.choiceMark} aria-hidden="true">
                            ✓
                          </span>
                        ) : null}
                        {showWrong ? (
                          <span className={styles.choiceMark} aria-hidden="true">
                            ×
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
                </div>

            <div className={styles.feedbackBar} aria-live="polite" role="status">
              {phase === "wrong-review" ? (
                <strong className={styles.wrongText}>
                  Not quite · {selectedDifferenceCount}{" "}
                  {selectedDifferenceCount === 1 ? "tile differs" : "tiles differ"}
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
                  const wrongPattern = missedRound.options[chosenIndex];
                  const differences = differingTileIndexes(
                    wrongPattern,
                    missedRound.correctPattern,
                  );

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
                        <PatternGrid
                          pattern={missedRound.clue}
                          size="review"
                          label={`Puzzle ${missed.ordinal} starting pattern: ${describePattern(
                            missedRound.clue,
                          )}`}
                        />
                        <PuzzleTransformCue round={missedRound} />
                        <div className={styles.reviewWrong}>
                          <PatternGrid
                            pattern={wrongPattern}
                            size="review"
                            differenceIndexes={differences}
                            label={`Your answer with ${differences.length} differing tiles: ${describePattern(
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

      {tutorialTransform ? (
        <TransformTutorialModal
          transform={tutorialTransform}
          continueRef={tutorialContinueRef}
          onContinue={dismissTransformTutorial}
        />
      ) : null}
      {ghostPortal}
    </div>
  );
}
