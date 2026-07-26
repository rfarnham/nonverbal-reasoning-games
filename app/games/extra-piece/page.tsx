"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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
import campaignStyles from "@/components/games/campaign-progress.module.css";
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
import { journeyLevelLabel } from "@/lib/progression/types";

import {
  ROUNDS,
  TUTORIAL,
  analyzeWrongAttempt,
  generateInfiniteRound,
  hiddenPatternCount,
  pieceBounds,
  rotatePieceCells,
  roundFingerprint,
  type AccentColor,
  type Difficulty,
  type ExtraPieceRound,
  type Mark,
  type Motif,
  type Piece,
  type PiecePlacement,
  type QuarterTurn,
  type Scaffold,
} from "./game-engine";
import { extraPieceGame } from "./game-info";
import { progressionAdapter } from "./progression-adapter";
import { solutionPresentationForPiece } from "./solution-presentation";
import {
  EMPTY_WORKING_GRID,
  clearWorkingCells,
  toggleWorkingCell,
  workingCellsForRound,
  type WorkingGridState,
} from "./working-grid";
import styles from "./extra-piece.module.css";

type GamePhase = "idle" | "animating" | "wrong-review" | "answered";
type SessionMode = "campaign" | "infinite" | "redemption";
type CampaignLevelId = "starter" | "junior" | "expert" | "wizard";
type CampaignMarker = "correct" | "incorrect";

type SessionRound = {
  id: string;
  ordinal: number;
  round: ExtraPieceRound;
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
type HistoricalReview = {
  sessionRound: SessionRound;
  progress: CampaignProblemProgress;
};
type CustomProperties = CSSProperties & Record<`--${string}`, string>;

const FIT_MS = 900;
const REDUCED_FIT_MS = 140;
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

const FILL_BY_COLOR: Readonly<Record<AccentColor, string>> = {
  coral: "#f06f5f",
  gold: "#f3bd4e",
  teal: "#35a999",
  violet: "#7767d7",
  ink: "#fffdf8",
};

function initialCampaignCursors(): CampaignCursors {
  return { starter: 0, junior: 0, expert: 0, wizard: 0 };
}

function campaignLevel(levelId: CampaignLevelId) {
  return (
    CAMPAIGN_LEVELS.find(({ id }) => id === levelId) ??
    CAMPAIGN_LEVELS[0]
  );
}

function campaignRounds(levelId: CampaignLevelId) {
  const { difficulty } = campaignLevel(levelId);
  return ROUNDS.filter((round) => round.difficulty === difficulty);
}

function campaignRoundId(
  levelId: CampaignLevelId,
  problemIndex: number,
) {
  return `campaign-${levelId}-${problemIndex}`;
}

function buildCampaignSessionRound(
  levelId: CampaignLevelId,
  problemIndex: number,
): SessionRound {
  const level = campaignLevel(levelId);
  const levelIndex = CAMPAIGN_LEVELS.findIndex(({ id }) => id === levelId);
  return {
    id: campaignRoundId(levelId, problemIndex),
    ordinal:
      levelIndex * CAMPAIGN_PROBLEMS_PER_LEVEL + problemIndex + 1,
    round: campaignRounds(levelId)[problemIndex] ?? ROUNDS[0],
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
) {
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
      CAMPAIGN_LEVELS[(currentIndex + offset) % CAMPAIGN_LEVELS.length]
        .id;
    if (!isCampaignLevelComplete(progress, candidate)) return candidate;
  }
  return null;
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
    return {
      id: `infinite-${ordinal}-${roundFingerprint(round)}`,
      ordinal,
      round,
    };
  } catch {
    const fallback = ROUNDS.find(
      (round) =>
        round.difficulty === difficulty &&
        !seenFingerprints.has(roundFingerprint(round)),
    );
    return fallback
      ? {
          id: `infinite-${ordinal}-${roundFingerprint(fallback)}`,
          ordinal,
          round: fallback,
        }
      : null;
  }
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.matches("input, textarea, select") ||
    target.isContentEditable ||
    Boolean(target.closest("[contenteditable='true']"))
  );
}

function Chevron({
  x,
  y,
  size,
  orientation,
}: {
  x: number;
  y: number;
  size: number;
  orientation: QuarterTurn;
}) {
  const centerX = x + size / 2;
  const centerY = y + size / 2;
  const arm = size * 0.2;
  return (
    <path
      d={`M ${centerX - arm} ${centerY + arm * 0.45} L ${centerX} ${
        centerY - arm * 0.55
      } L ${centerX + arm} ${centerY + arm * 0.45}`}
      fill="none"
      stroke="#17213d"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={Math.max(2, size * 0.075)}
      transform={`rotate(${orientation * 90} ${centerX} ${centerY})`}
    />
  );
}

function starPoints(
  centerX: number,
  centerY: number,
  outerRadius: number,
) {
  const innerRadius = outerRadius * 0.46;
  return Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    return `${centerX + Math.cos(angle) * radius},${
      centerY + Math.sin(angle) * radius
    }`;
  }).join(" ");
}

function MotifMark({
  x,
  y,
  size,
  motif,
  orientation,
}: {
  x: number;
  y: number;
  size: number;
  motif: Motif;
  orientation: QuarterTurn;
}) {
  if (motif === "none") return null;
  if (motif === "chevron") {
    return (
      <Chevron
        x={x}
        y={y}
        size={size}
        orientation={orientation}
      />
    );
  }

  const centerX = x + size / 2;
  const centerY = y + size / 2;
  const radius = size * 0.23;
  const strokeWidth = Math.max(2, size * 0.065);
  const shared = {
    fill: "none",
    stroke: "#17213d",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth,
  };

  if (motif === "star") {
    return (
      <polygon
        {...shared}
        points={starPoints(centerX, centerY, radius * 1.08)}
      />
    );
  }
  if (motif === "diamond") {
    return (
      <polygon
        {...shared}
        points={`${centerX},${centerY - radius} ${
          centerX + radius
        },${centerY} ${centerX},${centerY + radius} ${
          centerX - radius
        },${centerY}`}
      />
    );
  }
  if (motif === "circle") {
    return (
      <circle
        {...shared}
        cx={centerX}
        cy={centerY}
        r={radius * 0.82}
      />
    );
  }
  return (
    <g
      transform={`rotate(${orientation * 90} ${centerX} ${centerY})`}
    >
      <path
        {...shared}
        d={`M ${centerX} ${centerY + radius} V ${
          centerY - radius * 0.42
        } M ${centerX - radius * 0.58} ${
          centerY - radius * 0.02
        } L ${centerX} ${centerY - radius} L ${
          centerX + radius * 0.58
        } ${centerY - radius * 0.02}`}
      />
    </g>
  );
}

function pieceLabel(piece: Piece, optionNumber?: number) {
  const prefix =
    optionNumber === undefined ? "A candidate piece" : `Piece ${optionNumber}`;
  const motifs = piece.cells.filter(
    ({ mark }) => mark.motif !== "none",
  ).length;
  return `${prefix} made from ${piece.cells.length} joined squares${
    motifs > 0 ? " with monochrome picture symbols" : ""
  }. Inspect its visual shape.`;
}

function PieceVisual({
  piece,
  scaffold,
  optionNumber,
  matchedFill = null,
  className = "",
}: {
  piece: Piece;
  scaffold: Scaffold;
  optionNumber?: number;
  matchedFill?: string | null;
  className?: string;
}) {
  const { width, height } = pieceBounds(piece);
  const unit = 30;
  const pad = 4;
  return (
    <svg
      className={`${styles.pieceVisual} ${className}`}
      viewBox={`0 0 ${width * unit + pad * 2} ${height * unit + pad * 2}`}
      role="img"
      aria-label={`${pieceLabel(piece, optionNumber)}${
        matchedFill && optionNumber !== undefined
          ? ` It is color-matched to board region ${optionNumber}.`
          : ""
      }`}
      preserveAspectRatio="xMidYMid meet"
    >
      {piece.cells.map(({ x, y, mark }, index) => {
        const cellX = x * unit + pad;
        const cellY = y * unit + pad;
        const fill = matchedFill
          ? matchedFill
          : scaffold === "color" || scaffold === "color-orientation"
            ? FILL_BY_COLOR[mark.color]
            : "#fffdf8";
        return (
          <g key={`${x}-${y}-${index}`}>
            <rect
              x={cellX}
              y={cellY}
              width={unit}
              height={unit}
              fill={fill}
              stroke="#17213d"
              strokeWidth="2.4"
            />
            {mark.motif !== "none" ? (
              <MotifMark
                x={cellX}
                y={cellY}
                size={unit}
                motif={mark.motif}
                orientation={mark.orientation}
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function markForPlacedCell(
  round: ExtraPieceRound,
  placement: PiecePlacement,
  x: number,
  y: number,
): Mark | null {
  const piece = round.pieces[placement.pieceIndex];
  const rotated = rotatePieceCells(piece.cells, placement.rotation);
  const local = rotated.find(
    (cell) =>
      cell.x + placement.offsetX === x &&
      cell.y + placement.offsetY === y,
  );
  return local?.mark ?? null;
}

function BoardVisual({
  round,
  revealSolution = false,
  showSolutionLabels = true,
  highlightedPlacement = null,
  compact = false,
}: {
  round: ExtraPieceRound;
  revealSolution?: boolean;
  showSolutionLabels?: boolean;
  highlightedPlacement?: PiecePlacement | null;
  compact?: boolean;
}) {
  const cellSize = 52;
  const size = round.boardSize * cellSize;
  const unknownCount = hiddenPatternCount(round);
  const solutionAt = new Map<string, PiecePlacement>();
  const solutionLabelAt = new Map<string, PiecePlacement>();
  if (revealSolution) {
    for (const placement of round.solution) {
      for (const cell of placement.cells) {
        solutionAt.set(`${cell.x},${cell.y}`, placement);
      }
      const labelCell = [...placement.cells].sort(
        (left, right) => left.y - right.y || left.x - right.x,
      )[0];
      if (labelCell) {
        solutionLabelAt.set(
          `${labelCell.x},${labelCell.y}`,
          placement,
        );
      }
    }
  }
  const highlighted = new Set(
    highlightedPlacement?.cells.map(({ x, y }) => `${x},${y}`) ?? [],
  );
  return (
    <svg
      className={`${styles.boardVisual} ${
        compact ? styles.boardVisualCompact : ""
      }`}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={
        revealSolution
          ? `Solved ${round.boardSize} by ${round.boardSize} square. ${
              showSolutionLabels
                ? "Each colored region is labeled with its matching piece number."
                : "Colored regions show the completed tiling."
            } Piece ${round.correctIndex + 1} is left over.`
          : `A ${round.boardSize} by ${round.boardSize} target square${
              round.scaffold === "symbols"
                ? " marked with repeated stars, diamonds, circles, and arrows"
                : ""
            }${
              unknownCount > 0
                ? `, including ${unknownCount} gray question-mark cells that accept any symbol`
                : ""
            }. Work out which candidate pieces can fill it without overlaps or gaps.`
      }
    >
      {round.board.map(({ x, y, mark, hidden }) => {
        const placement = solutionAt.get(`${x},${y}`);
        const matchedFill = placement
          ? solutionPresentationForPiece(placement.pieceIndex).fill
          : null;
        const solutionLabel = solutionLabelAt.get(`${x},${y}`);
        const isHighlighted = highlighted.has(`${x},${y}`);
        const showUnknown =
          Boolean(hidden) && !revealSolution && !isHighlighted;
        const fill =
          revealSolution && matchedFill
            ? matchedFill
            : showUnknown
              ? "#e4e0d7"
              : round.scaffold === "color" ||
                  round.scaffold === "color-orientation"
                ? FILL_BY_COLOR[mark.color]
                : "#fffdf8";
        const visibleMark =
          highlightedPlacement && isHighlighted
            ? markForPlacedCell(round, highlightedPlacement, x, y)
            : revealSolution && placement
              ? markForPlacedCell(round, placement, x, y)
              : hidden
                ? null
                : mark;
        return (
          <g key={`${x}-${y}`}>
            <rect
              className={
                isHighlighted
                  ? styles.wrongPlacementCell
                  : revealSolution
                    ? styles.solutionCell
                    : undefined
              }
              x={x * cellSize + 1.5}
              y={y * cellSize + 1.5}
              width={cellSize - 3}
              height={cellSize - 3}
              rx="3"
              fill={isHighlighted ? "#f7cbc5" : fill}
              fillOpacity="1"
              strokeDasharray={showUnknown ? "7 5" : undefined}
              stroke={
                isHighlighted
                  ? "#bf493e"
                  : revealSolution
                    ? "#17213d"
                    : showUnknown
                      ? "#657087"
                      : "#8c918f"
              }
              strokeWidth={isHighlighted ? 4 : 2}
            />
            {visibleMark && visibleMark.motif !== "none" ? (
              <MotifMark
                x={x * cellSize}
                y={y * cellSize}
                size={cellSize}
                motif={visibleMark.motif}
                orientation={visibleMark.orientation}
              />
            ) : null}
            {showUnknown ? (
              <text
                className={styles.unknownPatternMark}
                x={x * cellSize + cellSize / 2}
                y={y * cellSize + cellSize / 2}
                textAnchor="middle"
                dominantBaseline="central"
                aria-hidden="true"
              >
                ?
              </text>
            ) : null}
            {revealSolution &&
            showSolutionLabels &&
            solutionLabel ? (
              <g
                className={styles.solutionRegionLabel}
                aria-hidden="true"
              >
                <circle
                  cx={x * cellSize + 11}
                  cy={y * cellSize + 11}
                  r="9"
                />
                <text
                  x={x * cellSize + 11}
                  y={y * cellSize + 11}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {solutionLabel.pieceIndex + 1}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function moveWorkingCellFocus(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  x: number,
  y: number,
  boardSize: number,
) {
  const movement: Readonly<Record<string, readonly [number, number]>> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const delta = movement[event.key];
  if (!delta) return;
  event.preventDefault();
  const nextX = Math.max(
    0,
    Math.min(boardSize - 1, x + delta[0]),
  );
  const nextY = Math.max(
    0,
    Math.min(boardSize - 1, y + delta[1]),
  );
  const nextButton =
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
      `button[data-working-cell="${nextX}-${nextY}"]`,
    );
  nextButton?.focus();
}

function WorkingBoard({
  round,
  workingCells,
  interactive,
  revealSolution,
  highlightedPlacement,
  onToggle,
  onClear,
}: {
  round: ExtraPieceRound;
  workingCells: ReadonlySet<string>;
  interactive: boolean;
  revealSolution: boolean;
  highlightedPlacement: PiecePlacement | null;
  onToggle: (cellKey: string) => void;
  onClear: () => void;
}) {
  const markedCount = workingCells.size;
  const markedCopy =
    markedCount === 0
      ? "No marks"
      : `${markedCount} marked`;
  return (
    <div className={styles.workingBoard}>
      <div className={styles.interactiveBoard}>
        <BoardVisual
          round={round}
          revealSolution={revealSolution}
          highlightedPlacement={highlightedPlacement}
        />
        {interactive ? (
          <div
            className={styles.workingGrid}
            role="group"
            aria-label="Working grid. Use arrow keys to move and Space to mark squares as checked."
            style={
              {
                "--board-size": String(round.boardSize),
              } as CustomProperties
            }
          >
            {round.board.map(({ x, y }) => {
              const cellKey = `${x},${y}`;
              const marked = workingCells.has(cellKey);
              return (
                <button
                  className={styles.workingCellButton}
                  type="button"
                  data-working-cell={`${x}-${y}`}
                  tabIndex={x === 0 && y === 0 ? 0 : -1}
                  aria-pressed={marked}
                  aria-label={`Row ${y + 1}, column ${x + 1}, ${
                    marked ? "marked as checked" : "not marked"
                  }.`}
                  onClick={() => onToggle(cellKey)}
                  onKeyDown={(event) => {
                    if (
                      event.key === " " ||
                      event.key === "Space" ||
                      event.key === "Spacebar" ||
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      onToggle(cellKey);
                      return;
                    }
                    moveWorkingCellFocus(
                      event,
                      x,
                      y,
                      round.boardSize,
                    );
                  }}
                  key={cellKey}
                >
                  {marked ? (
                    <span
                      className={styles.workingCellCheck}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {interactive ? (
        <div className={styles.workingTools}>
          <span>Select squares to mark what you’ve checked.</span>
          <div>
            <span aria-live="polite">{markedCopy}</span>
            <button
              type="button"
              onClick={onClear}
              disabled={markedCount === 0}
            >
              Clear marks
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function progressionTargetHref(
  target: Readonly<{
    pathname: string;
    query?: Readonly<Record<string, string>>;
  }>,
) {
  const query = new URLSearchParams(target.query).toString();
  return query ? `${target.pathname}?${query}` : target.pathname;
}

export default function ExtraPiecePage() {
  const progression = useProgressionGameSession(progressionAdapter);
  const [started, setStarted] = useState(false);
  const [sessionMode, setSessionMode] =
    useState<SessionMode>("campaign");
  const [roundQueue, setRoundQueue] =
    useState<readonly SessionRound[]>([]);
  const [roundCursor, setRoundCursor] = useState(0);
  const [activeCampaignLevel, setActiveCampaignLevel] =
    useState<CampaignLevelId>("starter");
  const [campaignCursors, setCampaignCursors] =
    useState<CampaignCursors>(initialCampaignCursors);
  const [campaignProgress, setCampaignProgress] =
    useState<CampaignProgress>({});
  const [infiniteAdaptive, setInfiniteAdaptive] = useState(
    initialInfiniteAdaptiveState,
  );
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [highlightedPlacement, setHighlightedPlacement] =
    useState<PiecePlacement | null>(null);
  const [score, setScore] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [complete, setComplete] = useState(false);
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [mistakes, setMistakes] =
    useState<readonly MistakeRecord[]>([]);
  const [retryReady, setRetryReady] = useState(false);
  const [redemptionTotal, setRedemptionTotal] = useState(0);
  const [reviewLevelId, setReviewLevelId] =
    useState<CampaignLevelId | null>(null);
  const [redeemedMistakeIds, setRedeemedMistakeIds] =
    useState<readonly string[]>([]);
  const [redemptionMistakeIds, setRedemptionMistakeIds] =
    useState<readonly string[]>([]);
  const [generationError, setGenerationError] =
    useState<string | null>(null);
  const [historicalReview, setHistoricalReview] =
    useState<HistoricalReview | null>(null);
  const [workingGrid, setWorkingGrid] =
    useState<WorkingGridState>(EMPTY_WORKING_GRID);

  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const levelCompleteButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const historicalHeadingRef = useRef<HTMLHeadingElement>(null);
  const historicalOriginRef = useRef<HTMLButtonElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const phaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptTokenRef = useRef(0);
  const inputLockedRef = useRef(false);
  const shouldFocusFirstOption = useRef(false);
  const retryFocusIndexRef = useRef<number | null>(null);
  const infiniteFingerprintsRef = useRef(new Set<string>());
  const infiniteAdaptiveRef = useRef(initialInfiniteAdaptiveState());

  const progressionControlled = progression.mode === "controlled";
  const progressionRound =
    progressionControlled && progression.current
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
  const isRedemption = progressionControlled
    ? progression.isRedemption
    : sessionMode === "redemption";
  const campaignProblemIndex =
    campaignCursors[activeCampaignLevel];
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
  const workingRoundId = activeSessionRound?.id ?? "";
  const activeWorkingCells = new Set(
    workingCellsForRound(workingGrid, workingRoundId),
  );
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
          campaignProgress[
            campaignRoundId(reviewLevelId, problemIndex)
          ]?.firstAttempt === "correct",
      ).filter(Boolean).length
    : 0;
  const infiniteEnergy = comboEnergyPercent(infiniteAdaptive.combo);
  const infiniteSupercharged =
    infiniteAdaptive.combo >= MAX_ENERGY_COMBO;

  const wrongFeedback = useMemo(() => {
    if (
      selectedIndex === null ||
      selectedIndex === round.correctIndex
    ) {
      return "";
    }
    return analyzeWrongAttempt(round, selectedIndex).message;
  }, [round, selectedIndex]);

  const toggleActiveWorkingCell = useCallback(
    (cellKey: string) => {
      if (!workingRoundId || phase !== "idle") return;
      setWorkingGrid((current) =>
        toggleWorkingCell(current, workingRoundId, cellKey),
      );
    },
    [phase, workingRoundId],
  );

  const clearActiveWorkingCells = useCallback(() => {
    if (!workingRoundId || phase !== "idle") return;
    setWorkingGrid((current) =>
      clearWorkingCells(current, workingRoundId),
    );
  }, [phase, workingRoundId]);

  const clearAttemptTimer = useCallback(() => {
    if (phaseTimerRef.current) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
  }, []);

  const resetAttemptState = useCallback(() => {
    attemptTokenRef.current += 1;
    clearAttemptTimer();
    inputLockedRef.current = false;
    retryFocusIndexRef.current = null;
    setSelectedIndex(null);
    setHighlightedPlacement(null);
    setRetryReady(false);
    setGenerationError(null);
    setPhase("idle");
  }, [clearAttemptTimer]);

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
      } else if (context.state === "running") {
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
            ({ sessionRound }) =>
              sessionRound.id === activeSessionRound.id,
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
              firstChosenIndex:
                existing?.firstChosenIndex ?? optionIndex,
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
            ({ sessionRound }) =>
              sessionRound.id === activeSessionRound.id,
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

      const attemptToken = attemptTokenRef.current + 1;
      attemptTokenRef.current = attemptToken;
      clearAttemptTimer();
      if (isCorrect) {
        setHighlightedPlacement(null);
        setPhase("animating");
        phaseTimerRef.current = setTimeout(
          () => {
            if (attemptTokenRef.current !== attemptToken) return;
            setPhase("answered");
          },
          reducedMotion ? REDUCED_FIT_MS : FIT_MS,
        );
      } else {
        const analysis = analyzeWrongAttempt(round, optionIndex);
        setHighlightedPlacement(analysis.placement);
        setPhase("wrong-review");
        phaseTimerRef.current = setTimeout(
          () => {
            if (attemptTokenRef.current !== attemptToken) return;
            if (progressionControlled) progression.retry();
            retryFocusIndexRef.current = optionIndex;
            inputLockedRef.current = false;
            setHighlightedPlacement(null);
            setSelectedIndex(null);
            setRetryReady(true);
            setPhase("idle");
          },
          reducedMotion
            ? REDUCED_WRONG_REVIEW_MS
            : WRONG_REVIEW_MS,
        );
      }
    },
    [
      activeCampaignLevelComplete,
      activeSessionRound,
      campaignProgress,
      clearAttemptTimer,
      complete,
      gameplayStarted,
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
    setStarted(true);
    setComplete(false);
    setHistoricalReview(null);
    setWorkingGrid(EMPTY_WORKING_GRID);
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
        "Couldn’t prepare a fresh square. Try Infinite again.",
      );
      return;
    }
    infiniteFingerprintsRef.current.add(
      roundFingerprint(firstRound.round),
    );
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
    setWorkingGrid(EMPTY_WORKING_GRID);
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
    const redemptionQueue = visibleMistakes.map(
      ({ sessionRound }, index) => ({
        ...sessionRound,
        id: `redemption-${index}-${sessionRound.id}`,
        ordinal: index + 1,
      }),
    );
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
      } else {
        shouldFocusFirstOption.current = false;
      }
      return;
    }
    if (isInfinite) {
      const nextOrdinal =
        (activeSessionRound?.ordinal ?? roundCursor + 1) + 1;
      const nextRound = makeInfiniteSessionRound(
        nextOrdinal,
        infiniteFingerprintsRef.current,
        infiniteAdaptiveRef.current.targetDifficulty,
      );
      if (!nextRound) {
        setGenerationError(
          "Couldn’t make a fresh square. Choose Next to retry.",
        );
        return;
      }
      infiniteFingerprintsRef.current.add(
        roundFingerprint(nextRound.round),
      );
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
      const problem =
        campaignProgress[campaignRoundId(levelId, problemIndex)];
      if (!problem?.solved || historicalReview || phase !== "idle") {
        return;
      }
      historicalOriginRef.current = origin;
      setHistoricalReview({
        sessionRound: buildCampaignSessionRound(levelId, problemIndex),
        progress: problem,
      });
    },
    [campaignProgress, historicalReview, phase],
  );

  const closeHistoricalReview = useCallback(() => {
    if (!historicalReview) return;
    setHistoricalReview(null);
    window.setTimeout(
      () => historicalOriginRef.current?.focus(),
      0,
    );
  }, [historicalReview]);

  useEffect(() => {
    const enabled = readSoundPreference(["extra-piece-sound"]);
    if (enabled) return;
    const timer = window.setTimeout(
      () => setSoundEnabled(enabled),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  const progressionPlayId =
    progressionControlled && progression.current
      ? `${progression.attemptId}:${
          progression.isRedemption ? "redemption" : "main"
        }:${progression.current.playId}`
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
    clearAttemptTimer();
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
        setHighlightedPlacement(null);
        setRetryReady(false);
        setPhase("answered");
        shouldFocusFirstOption.current = false;
      } else if (
        controlled.roundPhase === "feedback" &&
        controlled.current &&
        savedOptionIndex !== null &&
        savedOptionIndex < controlled.current.round.pieces.length &&
        savedOptionIndex !== controlled.current.round.correctIndex
      ) {
        const analysis = analyzeWrongAttempt(
          controlled.current.round,
          savedOptionIndex,
        );
        inputLockedRef.current = true;
        setSelectedIndex(savedOptionIndex);
        setHighlightedPlacement(analysis.placement);
        setRetryReady(false);
        setPhase("wrong-review");
        shouldFocusFirstOption.current = false;
        const hydrationToken = attemptTokenRef.current;
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        phaseTimerRef.current = setTimeout(
          () => {
            if (attemptTokenRef.current !== hydrationToken) return;
            controlled.retry();
            retryFocusIndexRef.current = savedOptionIndex;
            inputLockedRef.current = false;
            setSelectedIndex(null);
            setHighlightedPlacement(null);
            setRetryReady(true);
            setPhase("idle");
          },
          reducedMotion
            ? REDUCED_WRONG_REVIEW_MS
            : WRONG_REVIEW_MS,
        );
      } else {
        if (controlled.roundPhase === "feedback") controlled.retry();
        inputLockedRef.current = false;
        setSelectedIndex(null);
        setHighlightedPlacement(null);
        setRetryReady(controlled.currentAttemptCount > 0);
        setPhase("idle");
        shouldFocusFirstOption.current = true;
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    clearAttemptTimer,
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
    const basePath = (
      process.env.NEXT_PUBLIC_BASE_PATH ?? ""
    ).replace(/\/$/, "");
    const query = new URLSearchParams(
      progression.navigationTarget.query,
    );
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
      clearAttemptTimer();
    },
    [clearAttemptTimer],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (historicalReview) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeHistoricalReview();
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
      if (
        optionIndex >= 0 &&
        optionIndex < round.pieces.length
      ) {
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
    round.pieces.length,
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
    gameplayStarted,
    roundCursor,
    sessionMode,
  ]);

  useEffect(() => {
    if (
      phase === "idle" &&
      retryReady &&
      retryFocusIndexRef.current !== null
    ) {
      optionButtonRefs.current[
        retryFocusIndexRef.current
      ]?.focus();
      retryFocusIndexRef.current = null;
    }
  }, [phase, retryReady]);

  useEffect(() => {
    if (complete) resultHeadingRef.current?.focus();
  }, [complete]);

  useEffect(() => {
    if (showCampaignLevelComplete) {
      levelCompleteButtonRef.current?.focus();
    }
  }, [showCampaignLevelComplete]);

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
  const showRedemptionOffer =
    !isRedemption && visibleMistakes.length > 0;
  const displayedResultFirstTryScore = reviewLevelId
    ? reviewLevelFirstTryScore
    : firstTryScore;
  const resultDenominator = reviewLevelId
    ? CAMPAIGN_PROBLEMS_PER_LEVEL
    : isInfinite
      ? infiniteAdaptive.attempts.length
      : CAMPAIGN_TOTAL;
  const resultTitle = isRedemption
    ? "Redemption complete."
    : showRedemptionOffer
      ? "Here’s your chance at redemption."
      : firstTryScore === resultDenominator
        ? "Perfect set."
        : "Good practice.";

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
        <span className={styles.gameTitle}>{extraPieceGame.title}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {progression.mode === "recovery" ? (
          <ProgressionRecoveryPanel message={progression.message} />
        ) : progression.mode === "redirect" ? null : !gameplayStarted ? (
          <section
            className={styles.tutorial}
            aria-labelledby="tutorial-title"
          >
            <p className={styles.kicker}>Example</p>
            <h1 id="tutorial-title">Which piece is left over?</h1>
            <p className={styles.exampleRule}>
              Count the symbols first. Then turn pieces to match them.
              Do not flip them over.
            </p>
            <div className={styles.exampleFlow}>
              <div className={styles.exampleBoard}>
                <BoardVisual
                  round={TUTORIAL}
                  revealSolution
                  showSolutionLabels={false}
                />
                <span className={styles.exampleCaption}>
                  These pieces fill the square
                </span>
              </div>
              <span className={styles.exampleArrow} aria-hidden="true">
                →
              </span>
              <div className={styles.exampleExtra}>
                <span className={styles.examplePieceNumber}>Extra</span>
                <PieceVisual
                  piece={TUTORIAL.pieces[TUTORIAL.correctIndex]}
                  scaffold={TUTORIAL.scaffold}
                />
                <span className={styles.exampleCheck} aria-label="Correct">
                  ✓
                </span>
              </div>
            </div>

            {progressionControlled && progression.sectionIntro ? (
              <ProgressionCulminationSectionIntro
                gameTitle={extraPieceGame.title}
                section={progression.sectionIntro}
                onBegin={progression.beginSection}
              />
            ) : (
              <div className={styles.modeActions}>
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
                levelLabel={journeyLevelLabel(
                  progression.attempt.journeyLevel,
                )}
                current={progression.currentQuestionNumber}
                total={progression.totalQuestions}
                remainingMs={
                  progression.turboRemainingMs ?? undefined
                }
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
                    className={campaignStyles.campaignNavigator}
                    aria-label="Campaign progress"
                  >
                    <div
                      className={campaignStyles.campaignLevels}
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
                            className={`${
                              campaignStyles.campaignLevel
                            } ${
                              levelState === "correct"
                                ? campaignStyles.campaignLevelCorrect
                                : levelState === "incorrect"
                                  ? campaignStyles.campaignLevelIncorrect
                                  : campaignStyles.campaignLevelNotDone
                            } ${
                              activeCampaignLevel === level.id
                                ? campaignStyles.campaignLevelActive
                                : ""
                            }`}
                            type="button"
                            aria-pressed={
                              activeCampaignLevel === level.id
                            }
                            aria-label={`${level.label}, ${levelState}`}
                            disabled={
                              phase !== "idle" ||
                              Boolean(historicalReview)
                            }
                            onClick={() =>
                              selectCampaignLevel(level.id)
                            }
                            key={level.id}
                          >
                            {level.label}
                          </button>
                        );
                      })}
                    </div>
                    <div
                      className={campaignStyles.campaignProblems}
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
                          const marker =
                            problem?.firstAttempt ?? "not-done";
                          const isCurrent =
                            !activeCampaignLevelComplete &&
                            problemIndex === campaignProblemIndex;
                          const markerClass = `${
                            marker === "correct"
                              ? campaignStyles.campaignProblemCorrect
                              : marker === "incorrect"
                                ? campaignStyles.campaignProblemIncorrect
                                : campaignStyles.campaignProblemNotDone
                          } ${
                            isCurrent
                              ? campaignStyles.campaignProblemCurrent
                              : ""
                          }`;
                          const markerLabel = `${campaignLevel(activeCampaignLevel).label} problem ${
                            problemIndex + 1
                          }: ${
                            marker === "not-done"
                              ? "not attempted"
                              : marker
                          }`;
                          return problem?.solved ? (
                            <span
                              className={
                                campaignStyles.campaignProblemItem
                              }
                              role="listitem"
                              key={problemIndex}
                            >
                              <button
                                className={`${campaignStyles.campaignProblem} ${campaignStyles.campaignProblemButton} ${markerClass}`}
                                type="button"
                                aria-label={`${markerLabel}. Open review.`}
                                aria-current={
                                  isCurrent ? "step" : undefined
                                }
                                disabled={
                                  phase !== "idle" ||
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
                              className={`${campaignStyles.campaignProblem} ${markerClass}`}
                              role="listitem"
                              aria-label={markerLabel}
                              aria-current={
                                isCurrent ? "step" : undefined
                              }
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
                      infiniteSupercharged
                        ? styles.infiniteSupercharged
                        : ""
                    }`}
                    role="group"
                    aria-label="Infinite combo energy"
                  >
                    <span
                      className={styles.comboAnnouncement}
                      role="status"
                      aria-live="polite"
                    >
                      Combo {infiniteAdaptive.combo}. Energy{" "}
                      {Math.round(infiniteEnergy)} percent.
                    </span>
                    <div className={styles.infiniteHudLabels}>
                      <span>Combo {infiniteAdaptive.combo}</span>
                      <span>
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
                    aria-label="Review progress"
                    aria-valuemin={0}
                    aria-valuemax={sessionLength}
                    aria-valuenow={progress}
                  >
                    {roundQueue.map(({ id }, index) => (
                      <span
                        className={
                          index < progress ? styles.progressDone : ""
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
                    {infiniteLevelLabel(round.difficulty)}
                  </span>
                ) : null}
                <span className={styles.score}>
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
                      : "Results"}{" "}
                  <span aria-hidden="true">→</span>
                </button>
              </section>
            ) : (
              <>
                <section
                  className={styles.promptLine}
                  aria-labelledby="round-prompt"
                >
                  <p className={styles.kicker}>Build the square</p>
                  <h1 id="round-prompt">Which piece is left over?</h1>
                  <span className={styles.turnRule}>
                    {hiddenPatternCount(round) > 0
                      ? `? = any symbol · ${hiddenPatternCount(
                          round,
                        )} open cells · turn only · no flipping`
                      : round.difficulty === "Medium"
                        ? "5 × 5 · match symbols · turn only · no flipping"
                        : "↻ Match symbols · turn only · no flipping"}
                  </span>
                </section>
                <div
                  className={styles.gameBoard}
                  id="campaign-play-area"
                >
                  <section
                    className={styles.targetPanel}
                    aria-label="Target square"
                  >
                    <WorkingBoard
                      round={round}
                      workingCells={activeWorkingCells}
                      interactive={
                        phase === "idle" &&
                        !historicalReview &&
                        Boolean(activeSessionRound)
                      }
                      revealSolution={
                        phase === "animating" ||
                        phase === "answered"
                      }
                      highlightedPlacement={highlightedPlacement}
                      onToggle={toggleActiveWorkingCell}
                      onClear={clearActiveWorkingCells}
                    />
                  </section>
                  <section
                    className={styles.answerPanel}
                    aria-label="Candidate pieces"
                  >
                    <div
                      className={styles.optionGrid}
                      role="group"
                      aria-label="Candidate pieces"
                      data-option-count={round.pieces.length}
                    >
                      {round.pieces.map((piece, optionIndex) => {
                        const isCorrect =
                          optionIndex === round.correctIndex;
                        const isSelected =
                          selectedIndex === optionIndex;
                        const showCorrect =
                          phase === "answered" && isCorrect;
                        const showWrong =
                          phase === "wrong-review" &&
                          isSelected &&
                          !isCorrect;
                        const solvedPlacement = round.solution.find(
                          (placement) =>
                            placement.pieceIndex === optionIndex,
                        );
                        const showSolvedLayout =
                          phase === "animating" ||
                          phase === "answered";
                        const matchedFill =
                          showSolvedLayout && solvedPlacement
                            ? solutionPresentationForPiece(
                                optionIndex,
                              ).fill
                            : null;
                        const muted =
                          phase === "wrong-review" && !isSelected;
                        return (
                          <button
                            className={`${styles.optionButton} ${
                              showCorrect
                                ? styles.correctOption
                                : ""
                            } ${
                              showWrong ? styles.wrongOption : ""
                            } ${
                              matchedFill
                                ? styles.matchedOption
                                : ""
                            } ${muted ? styles.mutedOption : ""}`}
                            type="button"
                            onClick={() => chooseOption(optionIndex)}
                            disabled={phase !== "idle"}
                            aria-label={`${pieceLabel(
                              piece,
                              optionIndex + 1,
                            )}${
                              showCorrect
                                ? " Correct extra piece."
                                : showWrong
                                  ? " Your answer; this piece fits."
                                  : matchedFill
                                    ? ` It fills board region ${optionIndex + 1}.`
                                  : ""
                            }`}
                            aria-keyshortcuts={`${optionIndex + 1}`}
                            ref={(node) => {
                              optionButtonRefs.current[optionIndex] =
                                node;
                            }}
                            key={`${round.id}-${optionIndex}`}
                          >
                            <span
                              className={styles.optionNumber}
                              aria-hidden="true"
                            >
                              {optionIndex + 1}
                            </span>
                            <PieceVisual
                              piece={piece}
                              scaffold={round.scaffold}
                              optionNumber={optionIndex + 1}
                              matchedFill={matchedFill}
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
                      <strong className={styles.wrongText}>
                        Not quite
                      </strong>
                      <span className={styles.feedbackDetail}>
                        {wrongFeedback}
                      </span>
                    </>
                  ) : phase === "answered" ? (
                    <>
                      <strong className={styles.correctText}>
                        Correct
                      </strong>
                      <span className={styles.feedbackDetail}>
                        Each color and number shows where the other
                        pieces fit. Piece {round.correctIndex + 1} is
                        left over.
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
                              campaignProblemIndex === 11
                            ? "Finish level"
                            : "Next"}{" "}
                        <span aria-hidden="true">→</span>
                      </button>
                    </>
                  ) : retryReady ? (
                    <strong className={styles.retryText}>
                      Try again
                    </strong>
                  ) : generationError ? (
                    <strong className={styles.retryText}>
                      {generationError}
                    </strong>
                  ) : null}
                </div>
                <p className={styles.keyboardHint}>
                  Keys 1–{round.pieces.length}
                </p>
              </>
            )}
          </>
        ) : (
          <section
            className={styles.results}
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
              <div className={styles.reviewGrid}>
                {visibleMistakes.map(
                  ({ sessionRound: missed, chosenIndex }) => (
                    <article
                      className={styles.reviewCard}
                      key={missed.id}
                    >
                      <span className={styles.reviewRound}>
                        {missed.campaign
                          ? `${missed.campaign.levelLabel} · Puzzle ${
                              missed.campaign.problemIndex + 1
                            }`
                          : `Puzzle ${missed.ordinal}`}
                      </span>
                      <div className={styles.reviewVisual}>
                        <BoardVisual
                          round={missed.round}
                          compact
                        />
                        <span
                          className={styles.reviewArrow}
                          aria-hidden="true"
                        >
                          ×
                        </span>
                        <PieceVisual
                          piece={missed.round.pieces[chosenIndex]}
                          scaffold={missed.round.scaffold}
                        />
                      </div>
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
            <h2
              id="history-title"
              ref={historicalHeadingRef}
              tabIndex={-1}
            >
              {historicalReview.sessionRound.campaign?.levelLabel} ·
              Puzzle{" "}
              {(historicalReview.sessionRound.campaign?.problemIndex ??
                0) + 1}
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
              <BoardVisual
                round={historicalReview.sessionRound.round}
                revealSolution
              />
              <div className={styles.historyAnswers}>
                {historicalReview.progress.firstAttempt ===
                "incorrect" ? (
                  <div className={styles.historyAnswer}>
                    <span>Your first choice · ×</span>
                    <PieceVisual
                      piece={
                        historicalReview.sessionRound.round.pieces[
                          historicalReview.progress.firstChosenIndex
                        ]
                      }
                      scaffold={
                        historicalReview.sessionRound.round.scaffold
                      }
                    />
                  </div>
                ) : null}
                <div className={styles.historyAnswer}>
                  <span>The extra piece · ✓</span>
                  <PieceVisual
                    piece={
                      historicalReview.sessionRound.round.pieces[
                        historicalReview.sessionRound.round.correctIndex
                      ]
                    }
                    scaffold={
                      historicalReview.sessionRound.round.scaffold
                    }
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {progression.mode === "recovery" ? (
        <Link
          className={styles.secondaryLink}
          href={progressionTargetHref(progression.navigationTarget)}
        >
          Return to Journey
        </Link>
      ) : null}
    </div>
  );
}
