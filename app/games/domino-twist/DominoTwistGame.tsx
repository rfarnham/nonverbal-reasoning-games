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
import { createPortal } from "react-dom";

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
import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
} from "./infinite-progression";
import {
  ROUNDS,
  TILING_LAYOUTS,
  TUTORIAL,
  generateInfiniteRound,
  pipDotIndexes,
  roundFingerprint,
  type BuildWitness,
  type Difficulty,
  type DominoDesign,
  type DominoPiece,
  type DominoRound,
  type LayoutId,
  type PipMask,
} from "./game-engine";
import { dominoTwistGame } from "./game-info";
import { progressionAdapter } from "./progression-adapter";
import styles from "./domino-twist.module.css";

type PrimaryMode = "campaign" | "infinite";
type SessionMode = PrimaryMode | "redemption";
type GamePhase = "idle" | "teaching" | "wrong-review" | "answered";
type CampaignMarker = "correct" | "incorrect";
type CustomProperties = CSSProperties & Record<`--${string}`, string>;

type DominoGhostPiece = {
  piece: DominoPiece;
  pieceIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  deltaX: number;
  deltaY: number;
  scale: number;
  rotationDegrees: number;
  delay: number;
};

type DominoGhostState = {
  pieces: readonly DominoGhostPiece[];
  reducedMotion: boolean;
};

type SessionRound = {
  id: string;
  originalId?: string;
  ordinal: number;
  round: DominoRound;
  campaign?: {
    level: Difficulty;
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

type CampaignReviewSelection = {
  level: Difficulty;
  problemIndex: number;
};

type CampaignProgress = Readonly<
  Record<string, CampaignProblemProgress | undefined>
>;

type CampaignCursors = Record<Difficulty, number>;

const LEVELS: readonly Difficulty[] = [
  "Starter",
  "Junior",
  "Expert",
  "Wizard",
];
const CAMPAIGN_PROBLEMS_PER_LEVEL = 12;
const TEACHING_MS = 900;
const REDUCED_TEACHING_MS = 140;
const WIZARD_WRONG_CUE_MS = 180;
const WRONG_TOTAL_MS = 2200;
const REDUCED_WRONG_TOTAL_MS = 1300;
const GHOST_STAGGER_MS = 70;
const PIECE_CLASSES = [
  styles.pieceCoral,
  styles.pieceGold,
  styles.pieceTeal,
  styles.pieceViolet,
] as const;
const WITNESS_CLASSES = [
  styles.witnessCoral,
  styles.witnessGold,
  styles.witnessTeal,
  styles.witnessViolet,
] as const;

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
    Starter: 0,
    Junior: 0,
    Expert: 0,
    Wizard: 0,
  };
}

function campaignRounds(level: Difficulty): readonly DominoRound[] {
  return ROUNDS.filter(({ difficulty }) => difficulty === level);
}

function campaignRoundId(level: Difficulty, problemIndex: number): string {
  return `campaign-${level.toLowerCase()}-${problemIndex + 1}`;
}

function campaignSessionRound(
  level: Difficulty,
  problemIndex: number,
): SessionRound | null {
  const round = campaignRounds(level)[problemIndex];
  if (!round) return null;
  return {
    id: campaignRoundId(level, problemIndex),
    ordinal: LEVELS.indexOf(level) * CAMPAIGN_PROBLEMS_PER_LEVEL + problemIndex + 1,
    round,
    campaign: { level, problemIndex },
  };
}

function isCampaignLevelComplete(
  progress: CampaignProgress,
  level: Difficulty,
): boolean {
  return Array.from(
    { length: CAMPAIGN_PROBLEMS_PER_LEVEL },
    (_, index) => progress[campaignRoundId(level, index)]?.solved === true,
  ).every(Boolean);
}

function nextIncompleteCampaignLevel(
  progress: CampaignProgress,
  activeLevel: Difficulty,
): Difficulty | null {
  const activeIndex = LEVELS.indexOf(activeLevel);
  for (let offset = 1; offset <= LEVELS.length; offset += 1) {
    const level = LEVELS[(activeIndex + offset) % LEVELS.length];
    if (!isCampaignLevelComplete(progress, level)) return level;
  }
  return null;
}

function gridPositionStyle(
  firstCell: number,
  secondCell: number,
  columns: number,
): CSSProperties {
  const firstRow = Math.floor(firstCell / columns);
  const secondRow = Math.floor(secondCell / columns);
  const firstColumn = firstCell % columns;
  const secondColumn = secondCell % columns;
  return {
    gridColumn: `${Math.min(firstColumn, secondColumn) + 1} / ${
      Math.max(firstColumn, secondColumn) + 2
    }`,
    gridRow: `${Math.min(firstRow, secondRow) + 1} / ${
      Math.max(firstRow, secondRow) + 2
    }`,
  };
}

function PipFace({ mask }: { mask: PipMask }) {
  const dots = new Set(pipDotIndexes(mask));
  return (
    <span className={styles.pipGrid} aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => (
        <span
          className={`${styles.pipDot} ${
            dots.has(index) ? styles.pipDotOn : ""
          }`}
          key={index}
        />
      ))}
    </span>
  );
}

function buildDominoGhost(
  pieces: readonly DominoPiece[],
  witness: BuildWitness,
  sourceElements: readonly (HTMLDivElement | null)[],
  targetButton: HTMLButtonElement,
  reducedMotion: boolean,
): DominoGhostState | null {
  const targetCells = new Map(
    Array.from(
      targetButton.querySelectorAll<HTMLElement>("[data-cell-index]"),
    ).map((element) => [
      Number(element.dataset.cellIndex),
      element,
    ]),
  );

  const ghostPieces = witness.placements.flatMap<DominoGhostPiece>(
    (placement, placementIndex) => {
      const pieceIndex = pieces.findIndex(
        ({ id }) => id === placement.pieceId,
      );
      const piece = pieces[pieceIndex];
      const sourceElement = sourceElements[pieceIndex];
      const firstTarget = targetCells.get(placement.fromCell);
      const secondTarget = targetCells.get(placement.toCell);
      if (!piece || !sourceElement || !firstTarget || !secondTarget) return [];

      const source = sourceElement.getBoundingClientRect();
      const first = firstTarget.getBoundingClientRect();
      const second = secondTarget.getBoundingClientRect();
      if (
        source.width <= 0 ||
        source.height <= 0 ||
        first.width <= 0 ||
        first.height <= 0 ||
        second.width <= 0 ||
        second.height <= 0
      ) {
        return [];
      }

      const targetLeft = Math.min(first.left, second.left);
      const targetTop = Math.min(first.top, second.top);
      const targetRight = Math.max(first.right, second.right);
      const targetBottom = Math.max(first.bottom, second.bottom);
      const targetWidth = targetRight - targetLeft;
      const targetHeight = targetBottom - targetTop;
      const vertical = placement.quarterTurns % 2 === 1;
      const rotatedWidth = vertical ? source.height : source.width;
      const rotatedHeight = vertical ? source.width : source.height;
      const scale = Math.min(
        targetWidth / rotatedWidth,
        targetHeight / rotatedHeight,
      );

      return [
        {
          piece,
          pieceIndex,
          left: source.left,
          top: source.top,
          width: source.width,
          height: source.height,
          deltaX:
            targetLeft +
            targetWidth / 2 -
            (source.left + source.width / 2),
          deltaY:
            targetTop +
            targetHeight / 2 -
            (source.top + source.height / 2),
          scale,
          rotationDegrees: placement.quarterTurns * 90,
          delay: placementIndex * GHOST_STAGGER_MS,
        },
      ];
    },
  );

  return ghostPieces.length === witness.placements.length
    ? { pieces: ghostPieces, reducedMotion }
    : null;
}

function DominoRack({
  pieces,
  label,
  onPieceRef,
}: {
  pieces: readonly DominoPiece[];
  label: string;
  onPieceRef?: (index: number, node: HTMLDivElement | null) => void;
}) {
  return (
    <div className={styles.sourceRack} role="img" aria-label={label}>
      {pieces.map((piece, index) => (
        <div
          className={`${styles.dominoPiece} ${
            PIECE_CLASSES[index % PIECE_CLASSES.length]
          }`}
          aria-hidden="true"
          ref={(node) => {
            onPieceRef?.(index, node);
          }}
          key={piece.id}
        >
          <span className={styles.pieceLabel}>{piece.id}</span>
          <span className={styles.dominoHalf}>
            <PipFace mask={piece.first} />
          </span>
          <span className={styles.dominoHalf}>
            <PipFace mask={piece.second} />
          </span>
        </div>
      ))}
    </div>
  );
}

function SeamOverlay({
  layoutId,
  columns,
}: {
  layoutId: LayoutId;
  columns: 2 | 3;
}) {
  const layout = TILING_LAYOUTS[layoutId];
  return (
    <span className={styles.seamOverlay} aria-hidden="true">
      {layout.pairs.map(([firstCell, secondCell], index) => {
        const sameRow =
          Math.floor(firstCell / columns) ===
          Math.floor(secondCell / columns);
        return (
          <span
            className={`${styles.seamPair} ${
              sameRow ? styles.seamHorizontal : styles.seamVertical
            }`}
            style={gridPositionStyle(firstCell, secondCell, columns)}
            key={`${firstCell}-${secondCell}-${index}`}
          />
        );
      })}
    </span>
  );
}

function WitnessOverlay({
  witness,
  pieces,
  columns,
}: {
  witness: BuildWitness;
  pieces: readonly DominoPiece[];
  columns: 2 | 3;
}) {
  return (
    <span className={styles.witnessOverlay} aria-hidden="true">
      {witness.placements.map((placement, index) => {
        const pieceIndex = Math.max(
          0,
          pieces.findIndex(({ id }) => id === placement.pieceId),
        );
        return (
          <span
            className={`${styles.witnessPiece} ${
              WITNESS_CLASSES[pieceIndex % WITNESS_CLASSES.length]
            }`}
            data-piece={placement.pieceId}
            style={
              {
                ...gridPositionStyle(
                  placement.fromCell,
                  placement.toCell,
                  columns,
                ),
                "--witness-delay": `${index * 85}ms`,
              } as CustomProperties
            }
            key={`${placement.pieceId}-${placement.fromCell}-${placement.toCell}`}
          />
        );
      })}
    </span>
  );
}

function DesignBoard({
  design,
  rows,
  columns,
  layoutId,
  witness,
  pieces,
  mismatchCells = [],
}: {
  design: DominoDesign;
  rows: 2;
  columns: 2 | 3;
  layoutId?: LayoutId | null;
  witness?: BuildWitness | null;
  pieces?: readonly DominoPiece[];
  mismatchCells?: readonly number[];
}) {
  const mismatchSet = new Set(mismatchCells);
  return (
    <span
      className={styles.designBoard}
      data-columns={columns}
      data-size={`${rows}x${columns}`}
      aria-hidden="true"
    >
      {design.cells.map((mask, index) => (
        <span
          className={`${styles.designCell} ${
            mismatchSet.has(index) ? styles.mismatchCell : ""
          }`}
          data-cell-index={index}
          key={`${mask}-${index}`}
        >
          <PipFace mask={mask} />
        </span>
      ))}
      {layoutId ? (
        <SeamOverlay layoutId={layoutId} columns={columns} />
      ) : null}
      {witness && pieces ? (
        <WitnessOverlay witness={witness} pieces={pieces} columns={columns} />
      ) : null}
    </span>
  );
}

function buildInfiniteSessionRound(
  ordinal: number,
  difficulty: Difficulty,
  seenFingerprints: Set<string>,
): SessionRound {
  const round = generateInfiniteRound(
    difficulty,
    Math.random,
    seenFingerprints,
  );
  const fingerprint = roundFingerprint(round);
  if (seenFingerprints.has(fingerprint)) {
    throw new Error("The generator repeated a puzzle from this run.");
  }
  seenFingerprints.add(fingerprint);
  return {
    id: `infinite-${ordinal}-${fingerprint}`,
    ordinal,
    round,
  };
}

export default function DominoTwistGame() {
  const router = useRouter();
  const progression = useProgressionGameSession(progressionAdapter);
  const [started, setStarted] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>("campaign");
  const [lastPrimaryMode, setLastPrimaryMode] =
    useState<PrimaryMode>("campaign");
  const [reviewSourceMode, setReviewSourceMode] =
    useState<PrimaryMode>("campaign");
  const [roundQueue, setRoundQueue] = useState<readonly SessionRound[]>([]);
  const [roundCursor, setRoundCursor] = useState(0);
  const [activeCampaignLevel, setActiveCampaignLevel] =
    useState<Difficulty>("Starter");
  const [campaignCursors, setCampaignCursors] = useState<CampaignCursors>(
    initialCampaignCursors,
  );
  const [campaignProgress, setCampaignProgress] = useState<CampaignProgress>(
    {},
  );
  const [infiniteAdaptive, setInfiniteAdaptive] = useState(() =>
    initialInfiniteAdaptiveState(),
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [ghost, setGhost] = useState<DominoGhostState | null>(null);
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [retryReady, setRetryReady] = useState(false);
  const [complete, setComplete] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [mistakes, setMistakes] = useState<readonly MistakeRecord[]>([]);
  const [redeemedMistakeIds, setRedeemedMistakeIds] = useState<
    readonly string[]
  >([]);
  const [redemptionMistakeIds, setRedemptionMistakeIds] = useState<
    readonly string[]
  >([]);
  const [redemptionTotal, setRedemptionTotal] = useState(0);
  const [reviewLevel, setReviewLevel] = useState<Difficulty | null>(null);
  const [campaignReviewSelection, setCampaignReviewSelection] =
    useState<CampaignReviewSelection | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const sourcePieceRefs = useRef<Array<HTMLDivElement | null>>([]);
  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const checkpointButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const generationRetryRef = useRef<HTMLButtonElement>(null);
  const historicalReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const campaignMarkerRefs = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
  const reviewOriginIdRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const teachingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationTokenRef = useRef(0);
  const inputLockedRef = useRef(false);
  const shouldFocusFirstOption = useRef(false);
  const retryFocusIndexRef = useRef<number | null>(null);
  const infiniteFingerprintsRef = useRef(new Set<string>());
  const infiniteAdaptiveRef = useRef(
    initialInfiniteAdaptiveState(),
  );
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
      ? campaignSessionRound(activeCampaignLevel, campaignProblemIndex)
      : (roundQueue[roundCursor] ?? null);
  const round = activeSessionRound?.round ?? null;
  const historicalSessionRound = campaignReviewSelection
    ? campaignSessionRound(
        campaignReviewSelection.level,
        campaignReviewSelection.problemIndex,
      )
    : null;
  const historicalProgress = historicalSessionRound
    ? campaignProgress[historicalSessionRound.id]
    : undefined;
  const historicalMistake = historicalSessionRound
    ? mistakes.find(
        ({ sessionRound }) => sessionRound.id === historicalSessionRound.id,
      )
    : undefined;
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
  const redeemedSet = new Set(redeemedMistakeIds);
  const outstandingMistakes = mistakes.filter(
    ({ sessionRound }) => !redeemedSet.has(sessionRound.id),
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
      : reviewSourceMode === "infinite"
        ? infiniteFirstTryScore
        : campaignFirstTryScore;
  const activeLevelFirstTryScore = reviewLevel
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
  const isLastRedemptionRound =
    isRedemption && roundCursor === roundQueue.length - 1;

  const clearAttemptTimers = useCallback(() => {
    if (teachingTimerRef.current) {
      clearTimeout(teachingTimerRef.current);
      teachingTimerRef.current = null;
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
    setGhost(null);
    setSelectedIndex(null);
    setRetryReady(false);
    setPhase("idle");
  }, [clearAttemptTimers]);

  const setSourcePieceRef = useCallback(
    (index: number, node: HTMLDivElement | null) => {
      sourcePieceRefs.current[index] = node;
    },
    [],
  );

  const openCampaignReview = useCallback(
    (level: Difficulty, problemIndex: number) => {
      const id = campaignRoundId(level, problemIndex);
      if (
        !isCampaign ||
        phase !== "idle" ||
        !campaignProgress[id]?.solved
      ) {
        return;
      }
      reviewOriginIdRef.current = id;
      setCampaignReviewSelection({ level, problemIndex });
    },
    [campaignProgress, isCampaign, phase],
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
      const play = () => playFeedbackEarcon(context, correct);
      if (context.state === "suspended") {
        void context.resume().then(play).catch(() => undefined);
      } else if (context.state === "running") {
        play();
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
        generationError ||
        !hasStarted ||
        !activeSessionRound ||
        !round ||
        campaignReviewSelection !== null ||
        (isCampaign && activeCampaignLevelComplete)
      ) {
        return;
      }

      inputLockedRef.current = true;
      setRetryReady(false);
      setGhost(null);
      const isCorrect = optionIndex === round.correctIndex;
      controlledSession?.answer({
        correct: isCorrect,
        answerToken: `option-${optionIndex}`,
      });
      setSelectedIndex(optionIndex);
      setPhase("teaching");
      const chosenOption = round.options[optionIndex];
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
          if (!isRedemption) setCompletedCount((current) => current + 1);
        } else if (!isRedemption && !wasMissed) {
          setMistakes((current) => [
            ...current,
            { sessionRound: activeSessionRound, chosenIndex: optionIndex },
          ]);
        }
      }

      const suppressWizardWitness =
        round.difficulty === "Wizard" && !isCorrect;
      const nextGhost =
        !isCorrect &&
        !suppressWizardWitness &&
        chosenOption.witness &&
        optionButtonRefs.current[optionIndex]
          ? buildDominoGhost(
              round.pieces,
              chosenOption.witness,
              sourcePieceRefs.current,
              optionButtonRefs.current[optionIndex],
              reducedMotion,
            )
          : null;
      setGhost(nextGhost);
      const teachingDuration = suppressWizardWitness
        ? WIZARD_WRONG_CUE_MS
        : reducedMotion
          ? REDUCED_TEACHING_MS
          : TEACHING_MS;
      const wrongTotalDuration = reducedMotion
        ? REDUCED_WRONG_TOTAL_MS
        : WRONG_TOTAL_MS;
      const animationToken = animationTokenRef.current + 1;
      animationTokenRef.current = animationToken;
      clearAttemptTimers();

      teachingTimerRef.current = setTimeout(() => {
        if (animationTokenRef.current !== animationToken) return;
        if (isCorrect) {
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
            controlledSession?.retry();
          },
          Math.max(0, wrongTotalDuration - teachingDuration),
        );
      }, teachingDuration);
    },
    [
      activeCampaignLevelComplete,
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
      round,
      hasStarted,
    ],
  );

  const startCampaign = useCallback(() => {
    resumeAudio();
    resetAttemptState();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    infiniteAdaptiveRef.current = initialAdaptive;
    setInfiniteAdaptive(initialAdaptive);
    setSessionMode("campaign");
    setLastPrimaryMode("campaign");
    setReviewSourceMode("campaign");
    setRoundQueue([]);
    setRoundCursor(0);
    setActiveCampaignLevel("Starter");
    setCampaignCursors(initialCampaignCursors());
    setCampaignProgress({});
    setCompletedCount(0);
    setMistakes([]);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setRedemptionTotal(0);
    setReviewLevel(null);
    setCampaignReviewSelection(null);
    setGenerationError(null);
    setComplete(false);
    setStarted(true);
    shouldFocusFirstOption.current = true;
  }, [resetAttemptState, resumeAudio]);

  const startInfinite = useCallback(() => {
    resumeAudio();
    resetAttemptState();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    infiniteAdaptiveRef.current = initialAdaptive;
    let firstRound: SessionRound | null = null;
    let error: string | null = null;
    try {
      firstRound = buildInfiniteSessionRound(
        1,
        initialAdaptive.targetDifficulty,
        infiniteFingerprintsRef.current,
      );
    } catch {
      error = "A fresh puzzle could not be built. Your run is safe to retry.";
    }
    setInfiniteAdaptive(initialAdaptive);
    setSessionMode("infinite");
    setLastPrimaryMode("infinite");
    setReviewSourceMode("infinite");
    setRoundQueue(firstRound ? [firstRound] : []);
    setRoundCursor(0);
    setCompletedCount(0);
    setMistakes([]);
    setRedeemedMistakeIds([]);
    setRedemptionMistakeIds([]);
    setRedemptionTotal(0);
    setReviewLevel(null);
    setCampaignReviewSelection(null);
    setGenerationError(error);
    setComplete(false);
    setStarted(true);
    shouldFocusFirstOption.current = Boolean(firstRound);
  }, [resetAttemptState, resumeAudio]);

  const selectCampaignLevel = useCallback(
    (level: Difficulty) => {
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
      campaignReviewSelection,
      campaignProgress,
      isCampaign,
      phase,
      resetAttemptState,
    ],
  );

  const startRedemption = useCallback(() => {
    if (visibleMistakes.length === 0 || isRedemption) return;
    const sourceMode: PrimaryMode = isInfinite ? "infinite" : "campaign";
    const queue = visibleMistakes.map(({ sessionRound }, index) => ({
      ...sessionRound,
      id: `redemption-${index}-${sessionRound.id}`,
      originalId: sessionRound.id,
      ordinal: index + 1,
    }));
    setReviewSourceMode(sourceMode);
    setRedemptionMistakeIds(
      visibleMistakes.map(({ sessionRound }) => sessionRound.id),
    );
    setSessionMode("redemption");
    setRoundQueue(queue);
    setRoundCursor(0);
    setCompletedCount(0);
    setRedemptionTotal(queue.length);
    setComplete(false);
    setGenerationError(null);
    resetAttemptState();
    shouldFocusFirstOption.current = true;
  }, [
    isInfinite,
    isRedemption,
    resetAttemptState,
    visibleMistakes,
  ]);

  const retryInfiniteGeneration = useCallback(() => {
    if (!isInfinite) return;
    const nextOrdinal =
      roundQueue.length === 0
        ? 1
        : (roundQueue[roundQueue.length - 1]?.ordinal ?? roundQueue.length) + 1;
    try {
      const nextRound = buildInfiniteSessionRound(
        nextOrdinal,
        infiniteAdaptiveRef.current.targetDifficulty,
        infiniteFingerprintsRef.current,
      );
      setRoundQueue((current) => [...current, nextRound]);
      setRoundCursor((current) =>
        roundQueue.length === 0 ? 0 : current + 1,
      );
      setGenerationError(null);
      resetAttemptState();
      shouldFocusFirstOption.current = true;
    } catch {
      setGenerationError(
        "A fresh puzzle still could not be built. Try again or end the run.",
      );
    }
  }, [isInfinite, resetAttemptState, roundQueue]);

  const goNext = useCallback(() => {
    if (phase !== "answered" || !activeSessionRound) return;

    if (controlledSession) {
      resetAttemptState();
      controlledSession.advance();
      shouldFocusFirstOption.current = true;
      return;
    }

    if (isCampaign) {
      resetAttemptState();
      if (campaignProblemIndex < CAMPAIGN_PROBLEMS_PER_LEVEL - 1) {
        setCampaignCursors((current) => ({
          ...current,
          [activeCampaignLevel]: campaignProblemIndex + 1,
        }));
        shouldFocusFirstOption.current = true;
      }
      return;
    }

    if (isInfinite) {
      const nextOrdinal = activeSessionRound.ordinal + 1;
      resetAttemptState();
      try {
        const nextRound = buildInfiniteSessionRound(
          nextOrdinal,
          infiniteAdaptiveRef.current.targetDifficulty,
          infiniteFingerprintsRef.current,
        );
        setRoundQueue((current) => [...current, nextRound]);
        setRoundCursor((current) => current + 1);
        setGenerationError(null);
        shouldFocusFirstOption.current = true;
      } catch {
        setGenerationError(
          "A fresh puzzle could not be built. Your completed rounds are safe.",
        );
      }
      return;
    }

    if (isLastRedemptionRound) {
      resetAttemptState();
      setRedeemedMistakeIds((current) => [
        ...new Set([...current, ...redemptionMistakeIds]),
      ]);
      setRedemptionMistakeIds([]);

      if (reviewLevel) {
        const completedLevel = reviewLevel;
        setReviewLevel(null);
        setSessionMode("campaign");
        setRoundQueue([]);
        setRoundCursor(0);
        setRedemptionTotal(0);
        setActiveCampaignLevel(completedLevel);
        setComplete(false);
        return;
      }

      setComplete(true);
      return;
    }

    resetAttemptState();
    setRoundCursor((current) => current + 1);
    shouldFocusFirstOption.current = true;
  }, [
    activeCampaignLevel,
    activeSessionRound,
    campaignProblemIndex,
    controlledSession,
    isCampaign,
    isInfinite,
    isLastRedemptionRound,
    phase,
    redemptionMistakeIds,
    resetAttemptState,
    reviewLevel,
  ]);

  const endInfinite = useCallback(() => {
    if (
      !isInfinite ||
      completedCount === 0 ||
      phase === "teaching" ||
      phase === "wrong-review"
    ) {
      return;
    }
    resetAttemptState();
    setComplete(true);
  }, [completedCount, isInfinite, phase, resetAttemptState]);

  const finishCampaignLevel = useCallback(() => {
    if (!showCampaignLevelComplete) return;
    if (activeLevelMistakes.length > 0) {
      setReviewLevel(activeCampaignLevel);
      setComplete(true);
      return;
    }
    if (nextCampaignLevel) {
      selectCampaignLevel(nextCampaignLevel);
      return;
    }
    setReviewLevel(null);
    setComplete(true);
  }, [
    activeCampaignLevel,
    activeLevelMistakes.length,
    nextCampaignLevel,
    selectCampaignLevel,
    showCampaignLevelComplete,
  ]);

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeSoundPreference(next);
    if (next) resumeAudio();
  }, [resumeAudio, soundEnabled]);

  useEffect(() => {
    if (readSoundPreference()) return;
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
      setGenerationError(null);
      setCampaignReviewSelection(null);
      if (controlledSession.roundPhase === "solved") {
        inputLockedRef.current = true;
        setSelectedIndex(currentRound.correctIndex);
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
        const teachingDuration =
          currentRound.difficulty === "Wizard"
            ? WIZARD_WRONG_CUE_MS
            : reducedMotion
              ? REDUCED_TEACHING_MS
              : TEACHING_MS;
        const wrongTotalDuration = reducedMotion
          ? REDUCED_WRONG_TOTAL_MS
          : WRONG_TOTAL_MS;
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
          Math.max(0, wrongTotalDuration - teachingDuration),
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
      campaignReviewSelection !== null || Boolean(generationError),
    );
    const nextInteractionState =
      controlledSession.roundPhase === "solved"
        ? "blocked"
        : controlledSession.roundPhase === "feedback"
          ? "mandatory-feedback"
          : phase === "idle" &&
        !inputLockedRef.current &&
        campaignReviewSelection === null &&
        !generationError
            ? "answering"
            : "mandatory-feedback";
    if (controlledSession.interactionState !== nextInteractionState) {
      controlledSession.setInteractionState(nextInteractionState);
    }
  }, [
    campaignReviewSelection,
    controlledSession,
    generationError,
    phase,
  ]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      if (
        !hasStarted ||
        complete ||
        campaignReviewSelection !== null ||
        phase !== "idle" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
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
    if (phase === "answered") nextButtonRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (
      shouldFocusFirstOption.current &&
      hasStarted &&
      !complete &&
      !generationError &&
      campaignReviewSelection === null
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
    roundQueue.length,
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
    if (showCampaignLevelComplete && campaignReviewSelection === null) {
      checkpointButtonRef.current?.focus();
    }
  }, [
    activeCampaignLevel,
    campaignReviewSelection,
    showCampaignLevelComplete,
  ]);

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
    if (!ghost) return;

    function cancelMovingGhost() {
      if (!inputLockedRef.current || selectedIndex === null) return;
      animationTokenRef.current += 1;
      clearAttemptTimers();
      retryFocusIndexRef.current = selectedIndex;
      inputLockedRef.current = false;
      setGhost(null);
      setSelectedIndex(null);
      setRetryReady(true);
      setPhase("idle");
    }

    window.addEventListener("resize", cancelMovingGhost);
    window.addEventListener("scroll", cancelMovingGhost, true);
    return () => {
      window.removeEventListener("resize", cancelMovingGhost);
      window.removeEventListener("scroll", cancelMovingGhost, true);
    };
  }, [clearAttemptTimers, ghost, selectedIndex]);

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

  const resultDenominator = reviewLevel
    ? CAMPAIGN_PROBLEMS_PER_LEVEL
    : isInfinite || (isRedemption && reviewSourceMode === "infinite")
      ? Math.max(infiniteAdaptive.attempts.length, 1)
      : ROUNDS.length;
  const displayedResultScore = reviewLevel
    ? activeLevelFirstTryScore
    : firstTryScore;
  const resultMessage = useMemo(() => {
    const accuracy = displayedResultScore / resultDenominator;
    if (accuracy === 1) return "Perfect set.";
    if (accuracy >= 0.7) return "Sharp work.";
    return "Good practice.";
  }, [displayedResultScore, resultDenominator]);
  const showRedemptionOffer =
    !isRedemption && visibleMistakes.length > 0;
  const resultTitle = isRedemption
    ? "Redemption complete."
    : showRedemptionOffer
      ? "Here’s your chance at redemption."
      : resultMessage;

  const soundButton = (
    <button
      className={styles.soundButton}
      type="button"
      onClick={toggleSound}
      aria-pressed={soundEnabled}
      aria-label={`Sound, ${soundEnabled ? "on" : "off"}`}
    >
      <span aria-hidden="true">♪</span>
      <small aria-hidden="true">{soundEnabled ? "On" : "Off"}</small>
    </button>
  );

  const ghostPortal =
    ghost && typeof document !== "undefined"
      ? createPortal(
          <div className={styles.dominoGhostLayer} aria-hidden="true">
            {ghost.pieces.map((ghostPiece) => (
              <div
                className={`${styles.dominoPiece} ${
                  PIECE_CLASSES[
                    ghostPiece.pieceIndex % PIECE_CLASSES.length
                  ]
                } ${styles.dominoGhost} ${
                  ghost.reducedMotion ? styles.dominoGhostReduced : ""
                }`}
                style={
                  {
                    left: `${ghostPiece.left}px`,
                    top: `${ghostPiece.top}px`,
                    width: `${ghostPiece.width}px`,
                    height: `${ghostPiece.height}px`,
                    "--ghost-x": `${ghostPiece.deltaX}px`,
                    "--ghost-y": `${ghostPiece.deltaY}px`,
                    "--ghost-scale": `${ghostPiece.scale}`,
                    "--ghost-rotation": `${ghostPiece.rotationDegrees}deg`,
                    "--ghost-counter-rotation": `${-ghostPiece.rotationDegrees}deg`,
                    "--ghost-delay": `${ghostPiece.delay}ms`,
                    "--ghost-duration": `${TEACHING_MS}ms`,
                  } as CustomProperties
                }
                data-domino-ghost={ghostPiece.piece.id}
                key={ghostPiece.piece.id}
              >
                <span className={styles.pieceLabel}>
                  {ghostPiece.piece.id}
                </span>
                <span className={styles.dominoHalf}>
                  <PipFace mask={ghostPiece.piece.first} />
                </span>
                <span className={styles.dominoHalf}>
                  <PipFace mask={ghostPiece.piece.second} />
                </span>
              </div>
            ))}
          </div>,
          document.body,
        )
      : null;

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
        <p className={styles.gameTitle}>{dominoTwistGame.title}</p>
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
            <h1 className={styles.tutorialTitle} id="tutorial-title">
              Twist the pieces. Test the design.
            </h1>
            <p className={styles.tutorialCopy}>
              Turn each whole domino. Keep its two pip faces together.
            </p>

            <div className={styles.exampleFlow}>
              <div className={styles.exampleSource}>
                <DominoRack
                  pieces={TUTORIAL.pieces}
                  label="Two example dominoes shown as a visual source set."
                />
              </div>
              <span className={styles.exampleArrow} aria-hidden="true">
                ↻
              </span>
              <div className={styles.exampleAnswer}>
                <DesignBoard
                  design={TUTORIAL.possible}
                  rows={TUTORIAL.rows}
                  columns={TUTORIAL.columns}
                  layoutId={TUTORIAL.layoutId}
                  witness={TUTORIAL.witness}
                  pieces={TUTORIAL.pieces}
                />
                <span className={styles.exampleMark} aria-label="Can be built">
                  ✓
                </span>
              </div>
            </div>

            <div className={styles.nearMiss}>
              <div className={styles.exampleAnswer}>
                <DesignBoard
                  design={TUTORIAL.nearMiss}
                  rows={TUTORIAL.rows}
                  columns={TUTORIAL.columns}
                  layoutId={TUTORIAL.layoutId}
                />
                <span
                  className={styles.nearMissMark}
                  aria-label="Cannot be built"
                >
                  ×
                </span>
              </div>
              <p className={styles.nearMissCaption}>A near-match breaks a pair.</p>
            </div>

            <div className={styles.modeActions} aria-label="Choose a game mode">
              <button
                className={styles.primaryButton}
                type="button"
                onClick={startCampaign}
                disabled={progressionBooting}
              >
                Campaign<span aria-hidden="true">→</span>
              </button>
              <button
                className={styles.modeButton}
                type="button"
                onClick={startInfinite}
                disabled={progressionBooting}
              >
                <span aria-hidden="true">∞</span> Infinite
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
                    {LEVELS.map((level) => {
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
                            level === activeCampaignLevel
                              ? styles.campaignLevelActive
                              : ""
                          }`}
                          type="button"
                          aria-pressed={level === activeCampaignLevel}
                          aria-controls="domino-play-area"
                          aria-label={`${level}, ${levelState}`}
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
                        const marker = problem?.firstAttempt ?? "not done";
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
                          campaignReviewSelection.problemIndex === problemIndex;
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
                              marker === "not done"
                                ? marker
                                : `${marker}; review problem`
                            }`}
                            aria-current={isCurrent ? "step" : undefined}
                            aria-controls="domino-play-area"
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
                  className={styles.energyTrack}
                  role="progressbar"
                  aria-label="Redemption progress"
                  aria-valuemin={0}
                  aria-valuemax={roundQueue.length}
                  aria-valuenow={
                    roundCursor + (phase === "answered" ? 1 : 0)
                  }
                >
                  <span
                    className={styles.energyFill}
                    style={
                      {
                        "--energy-fill": `${
                          ((roundCursor + (phase === "answered" ? 1 : 0)) /
                            Math.max(roundQueue.length, 1)) *
                          100
                        }%`,
                      } as CustomProperties
                    }
                  />
                </div>
              )}

              <span className={styles.roundCount}>
                {isCampaign
                  ? `${campaignProblemIndex + 1} / ${CAMPAIGN_PROBLEMS_PER_LEVEL}`
                  : `${activeSessionRound?.ordinal ?? 1} / ${
                      isInfinite ? "∞" : roundQueue.length
                    }`}
              </span>
              {!isCampaign ? (
                <span className={styles.difficulty}>
                  {round?.difficulty ??
                    infiniteAdaptive.targetDifficulty}
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
                    phase === "teaching" ||
                    phase === "wrong-review"
                  }
                >
                  End
                </button>
              ) : null}
              </div>
            )}

            {historicalSessionRound && historicalProgress ? (
              <section
                className={styles.historicalReview}
                id="domino-play-area"
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
                  <div className={styles.historicalSource}>
                    <span>Source dominoes</span>
                    <DominoRack
                      pieces={historicalSessionRound.round.pieces}
                      label={`${historicalSessionRound.round.pieces.length} source dominoes from this completed visual puzzle.`}
                    />
                  </div>

                  <div
                    className={styles.historicalChoices}
                    aria-label="Completed answer choices"
                  >
                    {historicalSessionRound.round.options.map(
                      (option, optionIndex) => {
                        const isCorrect =
                          optionIndex ===
                          historicalSessionRound.round.correctIndex;
                        const isFirstWrong =
                          historicalMistake?.chosenIndex === optionIndex;
                        const reviewLabel = isCorrect
                          ? "Correct answer; this design cannot be made"
                          : isFirstWrong
                            ? "Your first answer; this design can be made"
                            : "Another answer choice";
                        return (
                          <div
                            className={`${styles.historicalChoice} ${
                              isCorrect ? styles.correctOption : ""
                            } ${isFirstWrong ? styles.wrongOption : ""}`}
                            role="img"
                            aria-label={`Option ${
                              optionIndex + 1
                            }. ${reviewLabel}.`}
                            key={`${historicalSessionRound.id}-${optionIndex}`}
                          >
                            <span className={styles.historicalChoiceLabel}>
                              Option {optionIndex + 1}
                              {isCorrect
                                ? " · Correct"
                                : isFirstWrong
                                  ? " · First answer"
                                  : ""}
                            </span>
                            <DesignBoard
                              design={option.design}
                              rows={historicalSessionRound.round.rows}
                              columns={historicalSessionRound.round.columns}
                              layoutId={
                                historicalSessionRound.round.seamsVisible
                                  ? historicalSessionRound.round.layoutId
                                  : null
                              }
                              witness={
                                isCorrect
                                  ? option.mismatch?.closestWitness
                                  : isFirstWrong
                                    ? option.witness
                                    : null
                              }
                              pieces={historicalSessionRound.round.pieces}
                              mismatchCells={
                                isCorrect
                                  ? option.mismatch?.differingCells
                                  : undefined
                              }
                            />
                            {isCorrect || isFirstWrong ? (
                              <span
                                className={styles.choiceMark}
                                aria-hidden="true"
                              >
                                {isCorrect ? "✓" : "×"}
                              </span>
                            ) : null}
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
                <p className={styles.historicalExplanation}>
                  {historicalSessionRound.round.options[
                    historicalSessionRound.round.correctIndex
                  ].mismatch?.message ??
                    "The marked design breaks a whole domino pair."}
                  {historicalMistake
                    ? " The letter outlines show how your first design fits."
                    : ""}
                </p>
              </section>
            ) : showCampaignLevelComplete ? (
              <section
                className={styles.levelCompleteCard}
                id="domino-play-area"
                aria-labelledby="level-complete-title"
              >
                <p className={styles.kicker}>
                  {activeCampaignLevel} · 12 / 12
                </p>
                <h2 id="level-complete-title">Level complete</h2>
                <p>
                  {activeLevelMistakes.length > 0
                    ? "Revisit the designs that caught you before moving on."
                    : "Every design is solved. Choose where to go next."}
                </p>
                <button
                  className={styles.primaryButton}
                  type="button"
                  ref={checkpointButtonRef}
                  onClick={finishCampaignLevel}
                >
                  {activeLevelMistakes.length > 0
                    ? "Review Mistakes"
                    : nextCampaignLevel ?? "Results"}
                  <span aria-hidden="true">→</span>
                </button>
              </section>
            ) : generationError || !round ? (
              <section
                className={styles.generationError}
                id="domino-play-area"
                aria-labelledby="generation-error-title"
              >
                <h2 id="generation-error-title">Puzzle builder paused</h2>
                <p>
                  {generationError ??
                    "This puzzle is unavailable. Restart this mode to continue."}
                </p>
                {isInfinite ? (
                  <button
                    className={styles.primaryButton}
                    type="button"
                    onClick={retryInfiniteGeneration}
                    ref={generationRetryRef}
                  >
                    Try another puzzle
                  </button>
                ) : (
                  <button
                    className={styles.primaryButton}
                    type="button"
                    onClick={startCampaign}
                    ref={generationRetryRef}
                  >
                    Restart Campaign
                  </button>
                )}
              </section>
            ) : (
              <>
                <div className={styles.gameBoard} id="domino-play-area">
                  <section
                    className={styles.sourcePanel}
                    aria-labelledby="round-prompt"
                  >
                    <div className={styles.sourceStage}>
                      <h1 className={styles.roundPrompt} id="round-prompt">
                        Which design can’t be made?
                        <small>
                          Turn whole dominoes. Keep every pair together.
                        </small>
                      </h1>
                      <DominoRack
                        pieces={round.pieces}
                        label={`${round.pieces.length} dominoes shown for a visual assembly puzzle.`}
                        onPieceRef={setSourcePieceRef}
                      />
                      <p
                        className={styles.sourceInstruction}
                        id="round-instruction"
                      >
                        {round.seamsVisible
                          ? "Bold outlines show where each domino must sit."
                          : "The seams are hidden. Any complete tiling is allowed."}
                      </p>
                    </div>
                  </section>

                  <section
                    className={styles.answerPanel}
                    aria-label="Answer choices"
                  >
                    <div
                      className={styles.optionGrid}
                      role="group"
                      aria-labelledby="round-prompt"
                      aria-describedby="round-instruction"
                    >
                      {round.options.map((option, optionIndex) => {
                        const isCorrect = optionIndex === round.correctIndex;
                        const isSelected = optionIndex === selectedIndex;
                        const showingFeedback =
                          phase === "teaching" ||
                          phase === "wrong-review" ||
                          phase === "answered";
                        const showCorrect =
                          showingFeedback && isSelected && isCorrect;
                        const showWrong =
                          showingFeedback && isSelected && !isCorrect;
                        const muted =
                          (phase === "answered" && !isCorrect) ||
                          ((phase === "teaching" ||
                            phase === "wrong-review") &&
                            !isSelected);
                        const showWizardWitness =
                          round.difficulty !== "Wizard" || isCorrect;
                        const feedbackWitness =
                          isSelected && showingFeedback && showWizardWitness
                            ? isCorrect
                              ? option.mismatch?.closestWitness
                              : ghost
                                ? null
                                : option.witness
                            : null;
                        const mismatchCells =
                          showCorrect && option.mismatch
                            ? option.mismatch.differingCells
                            : [];
                        const stateLabel = showCorrect
                          ? ", correct; this design cannot be made"
                          : showWrong
                            ? ", your choice; this design can be made"
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
                            }: a ${round.rows} by ${
                              round.columns
                            } visual pip design${stateLabel}`}
                            aria-keyshortcuts={`${optionIndex + 1}`}
                            ref={(node) => {
                              optionButtonRefs.current[optionIndex] = node;
                            }}
                            key={`${optionIndex}-${round.id}`}
                          >
                            <span
                              className={styles.optionNumber}
                              aria-hidden="true"
                            >
                              {optionIndex + 1}
                            </span>
                            <DesignBoard
                              design={option.design}
                              rows={round.rows}
                              columns={round.columns}
                              layoutId={
                                round.seamsVisible ? round.layoutId : null
                              }
                              witness={feedbackWitness}
                              pieces={round.pieces}
                              mismatchCells={mismatchCells}
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
                  {selectedIndex !== null &&
                  (phase === "teaching" || phase === "wrong-review") &&
                  selectedIndex !== round.correctIndex ? (
                    <>
                      <strong className={styles.wrongText}>Not quite</strong>
                      <p className={styles.feedbackDetail}>
                        {round.difficulty === "Wizard"
                          ? "This design can be made. A hidden arrangement keeps every domino whole."
                          : "This design can be made—the ghost dominoes show how every whole pair fits."}
                      </p>
                    </>
                  ) : selectedIndex === round.correctIndex &&
                    phase === "teaching" ? (
                    <>
                      <strong className={styles.correctText}>That’s the break</strong>
                      <p className={styles.feedbackDetail}>
                        {round.options[round.correctIndex].mismatch?.message}
                      </p>
                    </>
                  ) : phase === "answered" ? (
                    <>
                      <strong className={styles.correctText}>Correct</strong>
                      <p className={styles.feedbackDetail}>
                        {round.options[round.correctIndex].mismatch?.message}
                      </p>
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
                : reviewLevel
                  ? `${reviewLevel} complete`
                  : "Complete"}
            </p>
            <h1 id="results-title" ref={resultHeadingRef} tabIndex={-1}>
              {resultTitle}
            </h1>
            <p className={styles.resultScore}>
              <strong>
                {isRedemption ? redemptionTotal : displayedResultScore}
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
                  ({ sessionRound: missed, chosenIndex }) => (
                    <article className={styles.reviewCard} key={missed.id}>
                      <span className={styles.reviewRound}>
                        {missed.campaign
                          ? `${missed.campaign.level} · Puzzle ${
                              missed.campaign.problemIndex + 1
                            }`
                          : `Puzzle ${missed.ordinal} · ${missed.round.difficulty}`}
                      </span>
                      <div className={styles.reviewVisual}>
                        <DominoRack
                          pieces={missed.round.pieces}
                          label={`${missed.round.pieces.length} source dominoes from this visual puzzle.`}
                        />
                        <span className={styles.exampleArrow} aria-hidden="true">
                          →
                        </span>
                        <div className={styles.reviewWrong}>
                          <DesignBoard
                            design={missed.round.options[chosenIndex].design}
                            rows={missed.round.rows}
                            columns={missed.round.columns}
                            layoutId={
                              missed.round.seamsVisible
                                ? missed.round.layoutId
                                : null
                            }
                          />
                          <span
                            className={styles.reviewWrongMark}
                            aria-hidden="true"
                          >
                            ×
                          </span>
                        </div>
                      </div>
                      <span className={styles.visuallyHidden}>
                        You chose option {chosenIndex + 1}. That design can be
                        built.
                      </span>
                    </article>
                  ),
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
                    isRedemption
                      ? reviewSourceMode === "infinite"
                        ? startInfinite
                        : startCampaign
                      : lastPrimaryMode === "infinite"
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
      {ghostPortal}
    </div>
  );
}
