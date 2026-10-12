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
import { journeyLevelLabel } from "@/lib/progression/types";
import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
  type SuiteDifficulty as AdaptiveDifficulty,
} from "@/lib/infinite-progression";

import {
  ROUNDS,
  TUTORIAL,
  describeItem,
  generateInfiniteRound,
  initialPaper,
  itemById,
  patternKey,
  roundFingerprint,
  type Difficulty,
  type Round,
} from "./game-engine";
import { FoldSequence, FoldingPaper, ItemSet, ItemToken } from "./fold-visuals";
import { incorrectFeedback } from "./feedback";
import { canOpenHistoricalReview } from "./historical-review";
import { progressionAdapter } from "./progression-adapter";
import styles from "./folded-items.module.css";
import campaignStyles from "@/components/games/campaign-progress.module.css";

type GamePhase = "idle" | "animating" | "wrong-review" | "answered";
type SessionMode = "campaign" | "infinite" | "redemption";
type PlayMode = Exclude<SessionMode, "redemption">;
type CampaignMarker = "correct" | "incorrect";
type CampaignLevel = "Starter" | "Junior" | "Expert" | "Wizard";
type CampaignReviewSelection = {
  level: CampaignLevel;
  problemIndex: number;
};
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
const FOLD_FLIP_MS = 900;
const FOLD_STAGE_MS = 1250;
const REDUCED_FOLD_MS = 140;
const WRONG_REVIEW_MS = 2200;
const REDUCED_WRONG_REVIEW_MS = 1300;
function progressionTargetHref(
  target: Readonly<{
    pathname: string;
    query?: Readonly<Record<string, string>>;
  }>,
): string {
  const query = new URLSearchParams(target.query).toString();
  return query ? `${target.pathname}?${query}` : target.pathname;
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

function describePattern(round: Round, items: readonly number[]): string {
  return items.map((id) => describeItem(round, id)).join(", ");
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
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
          seededRandom(ordinal * 65_537 + attempt * 7_919),
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

export default function FoldedItemsPage() {
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

  const cluePanelRef = useRef<HTMLElement>(null);
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
  const foldingStages = useMemo(
    () => [initialPaper(round.source), ...round.foldSteps.map((step) => step.after)],
    [round],
  );
  
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
        // The choices sit below the sheet on a phone; bring the teaching
        // sequence into view before it starts.
        const panel = cluePanelRef.current;
        if (panel) {
          const bounds = panel.getBoundingClientRect();
          if (bounds.top < 0 || bounds.bottom > window.innerHeight) panel.scrollIntoView({ block: "start", behavior: "instant" });
        }
        setPhase("animating");
        const stageCount = Math.max(foldingStages.length, 1);
        const foldCount = Math.max(stageCount - 1, 0);
        if (reducedMotion) {
          setRevealStage(stageCount - 1);
          attemptTimersRef.current.push(
            setTimeout(() => {
              if (animationTokenRef.current !== animationToken) return;
              setPhase("answered");
            }, REDUCED_FOLD_MS),
          );
          return;
        }
        for (let stage = 1; stage < stageCount; stage += 1) {
          attemptTimersRef.current.push(
            setTimeout(() => {
              if (animationTokenRef.current === animationToken) {
                setRevealStage(stage);
              }
            }, FOLD_STAGE_MS * stage),
          );
        }
        const finishDelay =
          Math.max(FOLD_STAGE_MS * foldCount, FOLD_FLIP_MS) + 30;
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
          reducedMotion ? REDUCED_WRONG_REVIEW_MS
            : WRONG_REVIEW_MS,
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
      foldingStages.length,
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
    const enabled = readSoundPreference();
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
            [initialPaper(currentRound.source), ...currentRound.foldSteps.map((step) => step.after)].length - 1,
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
        setRevealStage(0);
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
      window.requestAnimationFrame(() => {
        if (
          hydratedProgressionPlayIdRef.current !== hydrationKey ||
          inputLockedRef.current
        ) return;
        const firstOption = optionButtonRefs.current[0];
        if (!firstOption || firstOption.disabled) return;
        firstOption.focus({ preventScroll: true });
        cluePanelRef.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
        shouldFocusFirstOption.current = false;
      });
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
        event.repeat ||
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
    if (phase !== "animating") return;
    // A native answer click can finish its own focus/scroll work after the
    // synchronous answer handler. Reframe after React mounts the teaching
    // sheet so neither the click nor scroll anchoring can hide the fold.
    const frame = window.requestAnimationFrame(() => {
      const panel = cluePanelRef.current;
      const sheet = panel?.querySelector<SVGElement>("[data-fold-animation]");
      const bounds = (sheet ?? panel)?.getBoundingClientRect();
      if (panel && bounds && (bounds.top < 0 || bounds.bottom > window.innerHeight)) {
        panel.scrollIntoView({ block: "start", behavior: "instant" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (phase === "answered") nextButtonRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (shouldFocusFirstOption.current && hasStarted && !complete) {
      optionButtonRefs.current[0]?.focus({ preventScroll: true });
      const panel = cluePanelRef.current;
      if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: "start", behavior: "instant" });
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
      setRevealStage(Math.max(foldingStages.length - 1, 0));
      setPhase("answered");
    }
    window.addEventListener("resize", finishTeachingMotion);
    return () => {
      window.removeEventListener("resize", finishTeachingMotion);
    };
  }, [clearAttemptTimers, phase, foldingStages.length]);

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
        <span className={styles.gameTitle}>{"Folded Items"}</span>
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
            <h1 id="tutorial-title">Fold it. Follow the stack.</h1>
            <div className={styles.exampleFlow}>
              <FoldSequence round={TUTORIAL} reveal />
              <span className={styles.exampleTarget}>Stacked with <span role="img" aria-label={describeItem(TUTORIAL, TUTORIAL.targetId)}><ItemToken item={itemById(TUTORIAL, TUTORIAL.targetId)} /></span></span>
              <span className={styles.exampleConnector} aria-hidden="true">
                →
              </span>
              <div className={styles.exampleAnswer}>
                <ItemSet round={TUTORIAL} items={TUTORIAL.correctItems}
                  label={`Stacked with the highlighted item: ${describePattern(TUTORIAL, TUTORIAL.correctItems)}`} />
                <span className={styles.exampleMark} aria-label="Correct">
                  ✓
                </span>
              </div>
            </div>
            <p className={styles.foldLegend}>A moving flap turns over: its layers reverse. Follow the over or under arrow. From Junior, read each answer from top to bottom.</p>
            <div className={styles.nearMiss}>
              <span aria-hidden="true">Not this</span>
              <ItemSet round={TUTORIAL} items={TUTORIAL.options.find((_, index) => index !== TUTORIAL.correctIndex) ?? []}
                label="Near match: the item lands in a different stack" />
              <span className={styles.wrongMark} aria-label="Not a match">
                ×
              </span>
            </div>
            {controlledSession?.sectionIntro ? (
              <ProgressionCulminationSectionIntro
                gameTitle={"Folded Items"}
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
                levelLabel={journeyLevelLabel(
                  controlledSession.attempt.journeyLevel,
                )}
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
                  className={campaignStyles.campaignNavigator}
                  aria-label="Campaign progress"
                >
                  <div className={campaignStyles.campaignLevels}>
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
                          className={`${campaignStyles.campaignLevel} ${
                            state === "correct"
                              ? campaignStyles.campaignLevelCorrect
                              : state === "incorrect"
                                ? campaignStyles.campaignLevelIncorrect
                                : campaignStyles.campaignLevelNotDone
                          } ${
                            activeCampaignLevel === level
                              ? campaignStyles.campaignLevelActive
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
                    className={campaignStyles.campaignProblems}
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
                            className={`${campaignStyles.campaignProblem} ${
                              marker === "correct"
                                ? campaignStyles.campaignProblemCorrect
                                : marker === "incorrect"
                                  ? campaignStyles.campaignProblemIncorrect
                                  : campaignStyles.campaignProblemNotDone
                            } ${
                              isCurrent ? campaignStyles.campaignProblemCurrent : ""
                            }`}
                            type="button"
                            aria-label={`${activeCampaignLevel} problem ${
                              problemIndex + 1
                            }: ${
                              marker === "not-done"
                                ? "not done"
                                : `${marker}${problem?.solved ? "; review problem" : ""}`
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
                  No fresh puzzle could be prepared. Your completed puzzles are saved for these results.
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
                    <span>Original paper and folds</span>
                    <FoldSequence round={historicalSessionRound.round} compact reveal />
                    <FoldingPaper round={historicalSessionRound.round} stageIndex={historicalSessionRound.round.foldSteps.length} complete inline />
                  </div>
                  <div className={styles.historicalAnswers}>
                    <div>
                      <span>Correct stack</span>
                      <ItemSet round={historicalSessionRound.round} items={historicalSessionRound.round.correctItems}
                        label={`Correct stack: ${describePattern(historicalSessionRound.round, historicalSessionRound.round.correctItems)}`} />
                    </div>
                    {historicalWrongPattern ? (
                      <div className={styles.historicalWrongAnswer}>
                        <span>Your first answer</span>
                        <ItemSet round={historicalSessionRound.round} items={historicalWrongPattern}
                          label={`Your first incorrect answer: ${describePattern(historicalSessionRound.round, historicalWrongPattern)}`} />
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
                <div className={styles.gameBoard} id="campaign-play-area" style={{ overflowAnchor: "none" }}>
                  <section
                    className={styles.cluePanel}
                    ref={cluePanelRef}
                    aria-label="Labeled paper and folds"
                  >
                    <div
                      className={`${styles.promptStage} ${
                        (selectedCorrect && (phase === "animating" || phase === "answered"))
                          ? styles.promptAnimating
                          : ""
                      }`}
                    >
                      <FoldSequence round={round} />
                      <p className={styles.questionText}>
                        {round.answerMode === "group" ? "Which item is stacked with" : "Which is the final stack containing"}
                        <span className={styles.targetBadge} role="img" aria-label={describeItem(round, round.targetId)}><ItemToken item={itemById(round, round.targetId)} /></span>?
                      </p>
                      {round.answerMode === "ordered" ? <p className={styles.orderHint}>Read each answer from top to bottom.</p> : null}
                    </div>
                    {(selectedCorrect && (phase === "animating" || phase === "answered")) ? (
                      <FoldingPaper round={round} stageIndex={revealStage}
                        complete={revealStage === foldingStages.length - 1} />
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
                        const answerState = showCorrect
                          ? ", correct answer"
                          : showWrong ? ", your answer; does not match" : "";
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
                            }${round.answerMode === "ordered" ? ", top to bottom" : ""}: ${describePattern(round, option)}${answerState}`}
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
                            <ItemSet round={round} items={option} hidden />
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
                    <strong>Tracking the folds…</strong>
                  ) : phase === "wrong-review" ? (
                    <strong className={styles.wrongText}>
                      × Not quite · {incorrectFeedback(round, selectedIndex)}
                    </strong>
                  ) : phase === "answered" ? (
                    <>
                      <strong className={styles.correctText}>✓ Correct</strong>
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
                            <ItemSet round={missedRound} items={wrongPattern}
                              label={`Your answer: ${describePattern(missedRound, wrongPattern)}`} />
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
