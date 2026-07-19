"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

import {
  createGameAudioContext,
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import {
  ROUNDS,
  TUTORIAL,
  describeWeave,
  generateInfiniteRound,
  roundFingerprint,
  weaveDifferences,
  weaveKey,
  type Difficulty,
  type DistractorKind,
  type Ribbon,
  type RibbonColor,
  type RibbonMotif,
  type Round,
  type Weave,
  type WeaveDifferences,
} from "./game-engine";
import { braidsGame } from "./game-info";
import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
} from "./infinite-progression";
import { canOpenHistoricalReview } from "./campaign-review";
import styles from "./braids.module.css";

type DiagramSize = "tutorialDiagram" | "clueDiagram" | "optionDiagram" | "reviewDiagram" | "ghostDiagram";
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

type CampaignReviewSelection = {
  levelId: CampaignLevelId;
  problemIndex: number;
};

type CampaignProgress = Readonly<
  Record<string, CampaignProblemProgress | undefined>
>;

type CampaignCursors = Record<CampaignLevelId, number>;

type GhostState = {
  clue: Weave;
  answer: Weave;
  left: number;
  top: number;
  width: number;
  height: number;
  deltaX: number;
  deltaY: number;
  scale: number;
  reducedMotion: boolean;
  differences?: WeaveDifferences;
};

type CustomProperties = CSSProperties & Record<`--${string}`, string>;

const FLIP_ANIMATION_MS = 900;
const FLIP_SETTLE_MS = 930;
const REDUCED_FLIP_MS = 140;
const WIZARD_WRONG_FEEDBACK_MS = 180;
const WRONG_REVIEW_MS = 2200;
const REDUCED_WRONG_REVIEW_MS = 1300;
const CAMPAIGN_PROBLEMS_PER_LEVEL = 12;
const UNDERPASS_GAP = 26;

const CAMPAIGN_LEVELS: ReadonlyArray<{
  id: CampaignLevelId;
  label: string;
  difficulty: Difficulty;
}> = [
  { id: "starter", label: "Starter", difficulty: "Starter" },
  { id: "junior", label: "Junior", difficulty: "Junior" },
  { id: "expert", label: "Expert", difficulty: "Expert" },
  { id: "wizard", label: "Wizard", difficulty: "Wizard" },
];

const RIBBON_CLASS: Record<RibbonColor, string> = {
  coral: styles.ribbonCoral,
  gold: styles.ribbonGold,
  teal: styles.ribbonTeal,
  violet: styles.ribbonViolet,
  neutral: styles.ribbonNeutral,
};

function initialCampaignCursors(): CampaignCursors {
  return { starter: 0, junior: 0, expert: 0, wizard: 0 };
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

function positions(count: number, start: number, end: number): readonly number[] {
  if (count === 1) return [(start + end) / 2];
  return Array.from(
    { length: count },
    (_, index) => start + ((end - start) * index) / (count - 1),
  );
}

function MotifGlyph({ motif }: { motif: RibbonMotif }) {
  switch (motif) {
    case "none":
      return null;
    case "dot":
      return <circle cx="0" cy="0" r="3.5" />;
    case "ring":
      return <circle cx="0" cy="0" r="4.5" fill="none" strokeWidth="2.4" />;
    case "bars":
      return (
        <>
          <path d="M-4 -4V4" fill="none" strokeWidth="2.2" />
          <path d="M4 -4V4" fill="none" strokeWidth="2.2" />
        </>
      );
    case "diamond":
      return <path d="M0 -5 5 0 0 5-5 0Z" />;
    case "cross":
      return <path d="M-4-4 4 4M4-4-4 4" fill="none" strokeWidth="2.4" />;
    case "square":
      return <rect x="-4" y="-4" width="8" height="8" rx="1" />;
  }
}

function RibbonSymbol({
  ribbon,
  x,
  y,
}: {
  ribbon: Ribbon;
  x: number;
  y: number;
}) {
  if (ribbon.motif === "none") return null;
  return (
    <g className={styles.ribbonSymbol} transform={`translate(${x} ${y})`}>
      <circle className={styles.symbolPlate} cx="0" cy="0" r="8" />
      <g className={styles.symbolGlyph}>
        <MotifGlyph motif={ribbon.motif} />
      </g>
    </g>
  );
}

function WeaveDiagram({
  weave,
  size,
  label,
  hidden = false,
  diagramRef,
  differences,
}: {
  weave: Weave;
  size: DiagramSize;
  label?: string;
  hidden?: boolean;
  diagramRef?: Ref<SVGSVGElement>;
  differences?: WeaveDifferences;
}) {
  const diagramId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const maskPrefix = `braids-${diagramId}`;
  const xPositions = positions(weave.verticalRibbons.length, 68, 172);
  const yPositions = positions(weave.horizontalRibbons.length, 58, 132);
  const crossingDifferences = new Set(differences?.crossingIndexes ?? []);
  const verticalDifferences = new Set(
    differences?.verticalRibbonIndexes ?? [],
  );
  const horizontalDifferences = new Set(
    differences?.horizontalRibbonIndexes ?? [],
  );

  return (
    <svg
      className={`${styles.weaveDiagram} ${styles[size]}`}
      viewBox="0 0 240 190"
      role={hidden ? undefined : "img"}
      aria-label={hidden ? undefined : label}
      aria-hidden={hidden || undefined}
      ref={diagramRef}
    >
      <defs>
        {weave.verticalRibbons.map((_, column) => (
          <mask
            id={`${maskPrefix}-vertical-${column}`}
            x="0"
            y="0"
            width="240"
            height="190"
            maskUnits="userSpaceOnUse"
            key={`vertical-mask-${column}`}
          >
            <rect x="0" y="0" width="240" height="190" fill="white" />
            {yPositions.map((y, row) =>
              weave.crossings[
                row * weave.verticalRibbons.length + column
              ] === "horizontal" ? (
                <rect
                  x={xPositions[column] - UNDERPASS_GAP / 2}
                  y={y - UNDERPASS_GAP / 2}
                  width={UNDERPASS_GAP}
                  height={UNDERPASS_GAP}
                  fill="black"
                  key={`vertical-gap-${row}-${column}`}
                />
              ) : null,
            )}
          </mask>
        ))}
        {weave.horizontalRibbons.map((_, row) => (
          <mask
            id={`${maskPrefix}-horizontal-${row}`}
            x="0"
            y="0"
            width="240"
            height="190"
            maskUnits="userSpaceOnUse"
            key={`horizontal-mask-${row}`}
          >
            <rect x="0" y="0" width="240" height="190" fill="white" />
            {xPositions.map((x, column) =>
              weave.crossings[
                row * weave.verticalRibbons.length + column
              ] === "vertical" ? (
                <rect
                  x={x - UNDERPASS_GAP / 2}
                  y={yPositions[row] - UNDERPASS_GAP / 2}
                  width={UNDERPASS_GAP}
                  height={UNDERPASS_GAP}
                  fill="black"
                  key={`horizontal-gap-${row}-${column}`}
                />
              ) : null,
            )}
          </mask>
        ))}
      </defs>
      <rect className={styles.pane} x="11" y="11" width="218" height="168" rx="13" />
      <path className={styles.paneNotch} d="M17 87h8v16h-8" aria-hidden="true" />

      <g aria-hidden="true">
        {weave.verticalRibbons.map((ribbon, index) => (
          <g
            mask={`url(#${maskPrefix}-vertical-${index})`}
            key={`vertical-base-${index}-${ribbon.color}-${ribbon.motif}`}
          >
            <line className={styles.ribbonOutline} x1={xPositions[index]} y1="20" x2={xPositions[index]} y2="170" />
            <line className={`${styles.ribbonBody} ${RIBBON_CLASS[ribbon.color]}`} x1={xPositions[index]} y1="20" x2={xPositions[index]} y2="170" />
          </g>
        ))}
        {weave.horizontalRibbons.map((ribbon, index) => (
          <g
            mask={`url(#${maskPrefix}-horizontal-${index})`}
            key={`horizontal-base-${index}-${ribbon.color}-${ribbon.motif}`}
          >
            <line className={styles.ribbonOutline} x1="31" y1={yPositions[index]} x2="209" y2={yPositions[index]} />
            <line className={`${styles.ribbonBody} ${RIBBON_CLASS[ribbon.color]}`} x1="31" y1={yPositions[index]} x2="209" y2={yPositions[index]} />
          </g>
        ))}

        {weave.crossings.map((_, crossingIndex) => {
          if (!crossingDifferences.has(crossingIndex)) return null;
          const column = crossingIndex % weave.verticalRibbons.length;
          const row = Math.floor(
            crossingIndex / weave.verticalRibbons.length,
          );
          const x = xPositions[column];
          const y = yPositions[row];

          return (
            <circle
              className={styles.differenceRing}
              cx={x}
              cy={y}
              r="16"
              key={`crossing-difference-${crossingIndex}`}
            />
          );
        })}

        {weave.verticalRibbons.map((ribbon, index) => (
          <RibbonSymbol
            ribbon={ribbon}
            x={xPositions[index]}
            y={ribbon.motifEnd === "start" ? 28 : 162}
            key={`vertical-symbol-${index}-${ribbon.motif}-${ribbon.motifEnd}`}
          />
        ))}
        {weave.horizontalRibbons.map((ribbon, index) => (
          <RibbonSymbol
            ribbon={ribbon}
            x={ribbon.motifEnd === "start" ? 39 : 201}
            y={yPositions[index]}
            key={`horizontal-symbol-${index}-${ribbon.motif}-${ribbon.motifEnd}`}
          />
        ))}

        {verticalDifferences.size > 0
          ? [...verticalDifferences].map((index) => (
              <path
                className={styles.differenceBracket}
                d={`M${xPositions[index] - 11} 18v-5h22v5`}
                key={`vertical-difference-${index}`}
              />
            ))
          : null}
        {horizontalDifferences.size > 0
          ? [...horizontalDifferences].map((index) => (
              <path
                className={styles.differenceBracket}
                d={`M211 ${yPositions[index] - 11}h5v22h-5`}
                key={`horizontal-difference-${index}`}
              />
            ))
          : null}
      </g>
    </svg>
  );
}

function OtherSideCue({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`${styles.sideCue} ${compact ? styles.sideCueCompact : ""}`}
      role="img"
      aria-label="Walk around the pane to view its other side"
    >
      <svg viewBox="0 0 84 70" aria-hidden="true">
        <rect x="35" y="10" width="14" height="49" rx="3" />
        <path d="M22 16C5 28 7 52 27 59" />
        <path d="m23 52 5 7-8 2" />
        <path d="M62 54c17-12 15-36-5-43" />
        <path d="m61 18-5-7 8-2" />
      </svg>
      {compact ? null : <span>Other side</span>}
    </div>
  );
}

function buildInfiniteSessionRound(
  ordinal: number,
  seenFingerprints: Set<string>,
  difficulty: Difficulty,
): SessionRound {
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const round = generateInfiniteRound(difficulty);
    const fingerprint = roundFingerprint(round);
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);
    return {
      id: `infinite-${ordinal}-${fingerprint}`,
      ordinal,
      round,
    };
  }

  const fallback = ROUNDS.find(
    (round) =>
      round.difficulty === difficulty &&
      !seenFingerprints.has(roundFingerprint(round)),
  );
  if (fallback) {
    const fingerprint = roundFingerprint(fallback);
    seenFingerprints.add(fingerprint);
    return {
      id: `infinite-${ordinal}-${fingerprint}`,
      ordinal,
      round: fallback,
    };
  }

  throw new Error("A fresh braid could not be generated. Try again.");
}

function misconceptionFeedback(
  kind: DistractorKind | "correct",
  differences: WeaveDifferences,
  wizard: boolean,
): string {
  if (wizard) {
    return `${differences.total} ${
      differences.total === 1 ? "detail does" : "details do"
    } not match the other side`;
  }

  switch (kind) {
    case "mirror-only":
      return "The sides switched, but the crossings still face front";
    case "depth-only":
      return "The crossings switched, but left and right did not";
    case "top-turn":
      return "Top and bottom changed; keep the pane upright";
    case "one-crossing-off":
      return "One crossing has the wrong ribbon in front";
    case "two-crossings-off":
      return "Two crossings have the wrong ribbon in front";
    case "one-motif-off":
      return "One ribbon symbol is on the wrong end";
    case "correct":
      return "Sides and crossings switched";
  }
}

export default function BraidsPage() {
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
  const [redeemedMistakeIds, setRedeemedMistakeIds] = useState<
    readonly string[]
  >([]);
  const [redemptionMistakeIds, setRedemptionMistakeIds] = useState<
    readonly string[]
  >([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [campaignReviewSelection, setCampaignReviewSelection] =
    useState<CampaignReviewSelection | null>(null);

  const clueDiagramRef = useRef<SVGSVGElement>(null);
  const optionDiagramRefs = useRef<Array<SVGSVGElement | null>>([]);
  const optionButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const levelCompleteButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const historicalReviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const historicalReviewOriginRef = useRef<HTMLButtonElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const flightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    : (roundQueue[roundCursor] ?? roundQueue[0]);
  const round = activeSessionRound?.round ?? ROUNDS[0];
  const sessionLength = roundQueue.length;
  const selectedCorrect = selectedIndex === round.correctIndex;
  const selectedDifferences =
    selectedIndex !== null && !selectedCorrect
      ? weaveDifferences(round.options[selectedIndex], round.correctPattern)
      : undefined;
  const selectedKind =
    selectedIndex === null ? "correct" : round.optionKinds[selectedIndex];
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
        ({ sessionRound }) => sessionRound.id === historicalSessionRound.id,
      )
    : undefined;
  const historicalWrongPattern =
    historicalMistake?.sessionRound.round.options[
      historicalMistake.chosenIndex
    ];
  const historicalDifferences =
    historicalWrongPattern && historicalSessionRound
      ? weaveDifferences(
          historicalWrongPattern,
          historicalSessionRound.round.correctPattern,
        )
      : undefined;
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
  const infiniteSupercharged = infiniteAdaptive.combo >= MAX_ENERGY_COMBO;

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
    setGenerationError(null);
    setPhase("idle");
  }, [clearAttemptTimers]);

  const ensureAudioContext = useCallback(() => {
    if (typeof window === "undefined") return null;
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

  const chooseOption = useCallback(
    (optionIndex: number) => {
      if (
        inputLockedRef.current ||
        phase !== "idle" ||
        complete ||
        !started ||
        campaignReviewSelection !== null ||
        (isCampaign && activeCampaignLevelComplete) ||
        !activeSessionRound
      ) {
        return;
      }

      inputLockedRef.current = true;
      setRetryReady(false);
      setGenerationError(null);
      const isCorrect = optionIndex === round.correctIndex;
      const wasMissed = mistakes.some(
        ({ sessionRound }) => sessionRound.id === activeSessionRound.id,
      );
      const suppressWizardHint = round.difficulty === "Wizard" && !isCorrect;
      const sourceRect = clueDiagramRef.current?.getBoundingClientRect();
      const targetRect =
        optionDiagramRefs.current[optionIndex]?.getBoundingClientRect();
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
            : [
                ...current,
                { sessionRound: activeSessionRound, chosenIndex: optionIndex },
              ],
        );
      }

      if (!suppressWizardHint && sourceRect && targetRect) {
        setGhost({
          clue: round.clue,
          answer: round.correctPattern,
          left: sourceRect.left,
          top: sourceRect.top,
          width: sourceRect.width,
          height: sourceRect.height,
          deltaX: targetRect.left - sourceRect.left,
          deltaY: targetRect.top - sourceRect.top,
          scale: targetRect.width / sourceRect.width,
          reducedMotion,
          differences: isCorrect
            ? undefined
            : weaveDifferences(
                round.options[optionIndex],
                round.correctPattern,
              ),
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
          ? WIZARD_WRONG_FEEDBACK_MS
          : reducedMotion
            ? REDUCED_FLIP_MS
            : FLIP_SETTLE_MS,
      );
    },
    [
      activeCampaignLevelComplete,
      activeSessionRound,
      campaignReviewSelection,
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

    try {
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
      setRedeemedMistakeIds([]);
      setRedemptionMistakeIds([]);
      setCampaignReviewSelection(null);
      historicalReviewOriginRef.current = null;
      setStarted(true);
      setComplete(false);
      resetAttemptState();
      shouldFocusFirstOption.current = true;
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : "A fresh braid is unavailable.",
      );
    }
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
      if (!canOpenHistoricalReview({
        isCampaign,
        isIdle: phase === "idle",
        isSolved: Boolean(problem?.solved),
        hasOpenReview: campaignReviewSelection !== null,
      })) {
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
        return;
      }
      shouldFocusFirstOption.current = false;
      return;
    }

    if (isInfinite) {
      const nextOrdinal = (activeSessionRound?.ordinal ?? roundCursor + 1) + 1;
      try {
        const nextRound = buildInfiniteSessionRound(
          nextOrdinal,
          infiniteFingerprintsRef.current,
          infiniteAdaptiveRef.current.targetDifficulty,
        );
        shouldFocusFirstOption.current = true;
        resetAttemptState();
        setRoundQueue((current) => [...current, nextRound]);
        setRoundCursor((current) => current + 1);
      } catch (error) {
        setGenerationError(
          error instanceof Error
            ? error.message
            : "A fresh braid is unavailable. Try again.",
        );
      }
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
    isCampaign,
    isInfinite,
    isLastRedemptionRound,
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
    writeSoundPreference(next);
    if (next) resumeAudio();
  }, [resumeAudio, soundEnabled]);

  useEffect(() => {
    const storedPreference = readSoundPreference([
      "rotation-match-sound",
      "braids-sound",
    ]);
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
        campaignReviewSelection !== null ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select") ||
          Boolean(target.closest("input, textarea, select, [contenteditable]")))
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
    phase,
    started,
  ]);

  useEffect(() => {
    if (phase === "answered") nextButtonRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (shouldFocusFirstOption.current && started && !complete) {
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
    if (campaignReviewSelection) historicalReviewHeadingRef.current?.focus();
  }, [campaignReviewSelection]);

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
            "--ghost-duration": `${FLIP_ANIMATION_MS}ms`,
          } as CustomProperties
        }
        aria-hidden="true"
      >
        <div className={styles.ghostFlip}>
          <div className={`${styles.ghostFace} ${styles.ghostFront}`}>
            <WeaveDiagram weave={ghost.clue} size="ghostDiagram" hidden />
          </div>
          <div className={`${styles.ghostFace} ${styles.ghostBack}`}>
            <WeaveDiagram
              weave={ghost.answer}
              size="ghostDiagram"
              hidden
              differences={ghost.differences}
            />
          </div>
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
        <span className={styles.gameTitle}>{braidsGame.title}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {!started ? (
          <section className={styles.tutorial} aria-labelledby="tutorial-title">
            <p className={styles.kicker}>Example</p>
            <h1 id="tutorial-title">See the other side.</h1>

            <div className={styles.exampleFlow}>
              <div className={styles.exampleView}>
                <span className={styles.viewLabel}>Front</span>
                <WeaveDiagram
                  weave={TUTORIAL.clue}
                  size="tutorialDiagram"
                  label={`Front view: ${describeWeave(TUTORIAL.clue)}`}
                />
              </div>
              <OtherSideCue />
              <div className={`${styles.exampleView} ${styles.exampleAnswer}`}>
                <span className={styles.viewLabel}>Other side</span>
                <WeaveDiagram
                  weave={TUTORIAL.answer}
                  size="tutorialDiagram"
                  label={`Solved other-side view: ${describeWeave(
                    TUTORIAL.answer,
                  )}`}
                />
                <span className={styles.exampleMark} aria-label="Correct">
                  ✓
                </span>
              </div>
            </div>

            <div className={styles.mirrorLesson}>
              <div>
                <span className={styles.mirrorLabel}>Mirror only</span>
                <WeaveDiagram
                  weave={TUTORIAL.mirror}
                  size="optionDiagram"
                  label="A simple mirror image, which keeps the front-side crossing order"
                />
                <span className={styles.mirrorMark} aria-label="Not a match">
                  ×
                </span>
              </div>
              <p>
                <strong>Sides switch.</strong> Every crossing switches too.
              </p>
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
            {generationError ? (
              <p className={styles.generationError} role="alert">
                {generationError}
              </p>
            ) : null}
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

                  <ol
                    className={styles.campaignProblems}
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
                          <li
                            className={styles.campaignProblemItem}
                            key={problemIndex}
                          >
                            <button
                              className={`${styles.campaignProblem} ${
                                marker === "correct"
                                  ? styles.campaignProblemCorrect
                                  : marker === "incorrect"
                                    ? styles.campaignProblemIncorrect
                                    : styles.campaignProblemNotDone
                              } ${
                                isCurrent
                                  ? styles.campaignProblemCurrent
                                  : ""
                              }`}
                              type="button"
                              aria-label={`${campaignLevel(activeCampaignLevel).label} problem ${
                                problemIndex + 1
                              }: ${
                                marker === "not-done"
                                  ? "not attempted"
                                  : `${marker} on first try; review problem`
                              }`}
                              aria-current={isCurrent ? "step" : undefined}
                              aria-pressed={isReviewing}
                              disabled={
                                !problem?.solved ||
                                phase !== "idle" ||
                                campaignReviewSelection !== null
                              }
                              onClick={(event) =>
                                openCampaignReview(
                                  activeCampaignLevel,
                                  problemIndex,
                                  event.currentTarget,
                                )
                              }
                            />
                          </li>
                        );
                      },
                    )}
                  </ol>
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
                  ? `${
                      (campaignReviewSelection?.problemIndex ??
                        campaignProblemIndex) + 1
                    } / ${CAMPAIGN_PROBLEMS_PER_LEVEL}`
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
            ) : historicalSessionRound && historicalProgress ? (
              <section
                className={styles.historicalReview}
                id="campaign-play-area"
                aria-labelledby="historical-review-title"
              >
                <header className={styles.historicalReviewHeader}>
                  <div>
                    <p className={styles.kicker}>Historical review</p>
                    <h2
                      id="historical-review-title"
                      ref={historicalReviewHeadingRef}
                      tabIndex={-1}
                    >
                      {historicalSessionRound.campaign?.levelLabel} · Problem{" "}
                      {(historicalSessionRound.campaign?.problemIndex ?? 0) + 1}
                    </h2>
                  </div>
                  <button
                    className={styles.historicalBackButton}
                    type="button"
                    onClick={closeCampaignReview}
                  >
                    <span aria-hidden="true">←</span>
                    Back to level
                  </button>
                </header>

                <div
                  className={styles.historicalSolution}
                  aria-label="Solved other-side view"
                >
                  <figure className={styles.historicalFigure}>
                    <figcaption>Front</figcaption>
                    <WeaveDiagram
                      weave={historicalSessionRound.round.clue}
                      size="reviewDiagram"
                      label={`Front view of ${describeWeave(
                        historicalSessionRound.round.clue,
                      )}`}
                    />
                  </figure>
                  <OtherSideCue />
                  <figure
                    className={`${styles.historicalFigure} ${styles.historicalCorrectFigure}`}
                  >
                    <figcaption>Other side · Correct</figcaption>
                    <WeaveDiagram
                      weave={historicalSessionRound.round.correctPattern}
                      size="reviewDiagram"
                      label={`Correct other-side view of ${describeWeave(
                        historicalSessionRound.round.correctPattern,
                      )}`}
                    />
                    <span className={styles.historicalMark} aria-hidden="true">
                      ✓
                    </span>
                  </figure>
                </div>

                {historicalProgress.firstAttempt === "incorrect" &&
                historicalWrongPattern &&
                historicalDifferences ? (
                  <div className={styles.historicalAttempt}>
                    <div className={styles.historicalWrongFigure}>
                      <span>Your first answer</span>
                      <WeaveDiagram
                        weave={historicalWrongPattern}
                        size="reviewDiagram"
                        differences={historicalDifferences}
                        label={`First answer with ${historicalDifferences.total} differing details highlighted`}
                      />
                      <span className={styles.historicalWrongMark} aria-hidden="true">
                        ×
                      </span>
                    </div>
                    <p>
                      <strong>First try: incorrect.</strong>{" "}
                      {misconceptionFeedback(
                        historicalSessionRound.round.optionKinds[
                          historicalMistake?.chosenIndex ?? 0
                        ],
                        historicalDifferences,
                        false,
                      )}
                      . The red marker remains part of your history.
                    </p>
                  </div>
                ) : (
                  <p className={styles.historicalFirstTryCorrect}>
                    <span aria-hidden="true">✓</span>
                    <strong>Correct on the first try.</strong>
                  </p>
                )}
              </section>
            ) : (
              <>
                <div className={styles.gameBoard} id="campaign-play-area">
                  <section
                    className={styles.cluePanel}
                    aria-label="Front view to imagine from the other side"
                  >
                    <div
                      className={`${styles.clueStage} ${
                        phase === "animating" || phase === "wrong-review"
                          ? styles.clueAnimating
                          : ""
                      }`}
                    >
                      <span className={styles.viewLabel}>Front</span>
                      <WeaveDiagram
                        weave={round.clue}
                        size="clueDiagram"
                        label={`Front view of ${describeWeave(
                          round.clue,
                        )}; choose its view from the other side`}
                        diagramRef={clueDiagramRef}
                      />
                      <OtherSideCue compact />
                      {round.difficulty === "Expert" ? (
                        <span className={styles.featureHint}>
                          Track the end symbols
                        </span>
                      ) : round.difficulty === "Wizard" ? (
                        <span className={styles.featureHint}>
                          Symbols only
                        </span>
                      ) : null}
                    </div>
                  </section>

                  <section
                    className={styles.answerPanel}
                    aria-label="Other-side answer choices"
                  >
                    <div
                      className={styles.optionGrid}
                      role="group"
                      aria-label="Answer choices"
                    >
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
                          ? weaveDifferences(option, round.correctPattern)
                          : undefined;
                        const answerState = showCorrect
                          ? ", correct answer"
                          : showWrong
                            ? `, your answer; ${differences?.total ?? 0} details differ`
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
                            aria-label={`Option ${optionIndex + 1}, visual braid${answerState}`}
                            aria-keyshortcuts={`${optionIndex + 1}`}
                            ref={(node) => {
                              optionButtonRefs.current[optionIndex] = node;
                            }}
                            key={`${optionIndex}-${weaveKey(option)}`}
                          >
                            <span
                              className={styles.optionNumber}
                              aria-hidden="true"
                            >
                              {optionIndex + 1}
                            </span>
                            <WeaveDiagram
                              weave={option}
                              size="optionDiagram"
                              hidden
                              differences={differences}
                              diagramRef={(node) => {
                                optionDiagramRefs.current[optionIndex] = node;
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
                  {phase === "wrong-review" && selectedDifferences ? (
                    <strong className={styles.wrongText}>
                      Not quite ·{" "}
                      {misconceptionFeedback(
                        selectedKind,
                        selectedDifferences,
                        round.difficulty === "Wizard",
                      )}
                    </strong>
                  ) : phase === "answered" ? (
                    <>
                      <strong className={styles.correctText}>
                        Correct · sides and crossings switched
                      </strong>
                      <button
                        className={styles.nextButton}
                        type="button"
                        onClick={goNext}
                        ref={nextButtonRef}
                      >
                        {generationError
                          ? "Retry"
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
                  {generationError ? (
                    <span className={styles.generationError} role="alert">
                      {generationError}
                    </span>
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
                    const missedRound = missed.round;
                    const wrongPattern = missedRound.options[chosenIndex];
                    const differences = weaveDifferences(
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
                            : `Puzzle ${missed.ordinal} · ${missedRound.difficulty}`}
                        </span>
                        <div className={styles.reviewVisual}>
                          <WeaveDiagram
                            weave={missedRound.clue}
                            size="reviewDiagram"
                            label={`Puzzle ${missed.ordinal} front view: ${describeWeave(
                              missedRound.clue,
                            )}`}
                          />
                          <OtherSideCue compact />
                          <div className={styles.reviewWrong}>
                            <WeaveDiagram
                              weave={wrongPattern}
                              size="reviewDiagram"
                              differences={differences}
                              label={`Your answer with ${differences.total} differing details`}
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

      {ghostPortal}
    </div>
  );
}
