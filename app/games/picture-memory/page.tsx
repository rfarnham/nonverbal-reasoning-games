"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { useProgressionGameSession } from "@/components/progression/useProgressionGameSession";
import { journeyLevelLabel } from "@/lib/progression/types";

import {
  CAMPAIGN_ROUNDS,
  EXAMPLE,
  generateInfiniteRound,
  roundFingerprint,
  evaluateSelection,
  type Difficulty,
  type Round,
  type PictureId,
} from "./game-engine";
import { pictureMemoryGame } from "./game-info";
import {
  MAX_ENERGY_COMBO,
  comboEnergyPercent,
  initialInfiniteAdaptiveState,
  recordInfiniteFirstAttempt,
} from "./infinite-progression";
import { Picture } from "./picture";
import { PICTURE_BY_ID } from "./picture-data";
import {
  encodeSelectionAnswerToken,
  decodeSelectionFromAnswerToken,
} from "./selection-tokens";
import { progressionAdapter } from "./progression-adapter";
import styles from "./picture-memory.module.css";
import campaignStyles from "@/components/games/campaign-progress.module.css";

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
  selected: readonly PictureId[];
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
const LEGACY_SOUND_KEYS = ["picture-memory-sound"] as const;

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
  return CAMPAIGN_LEVELS.find(({ id }) => id === levelId) ?? CAMPAIGN_LEVELS[0];
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
  return Array.from(
    { length: CAMPAIGN_PROBLEMS_PER_LEVEL },
    (_, index) => progress[campaignRoundId(levelId, index)]?.solved,
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

function PictureRow({
  ids,
  label,
}: {
  ids: readonly PictureId[];
  label: string;
}) {
  return (
    <div className={styles.pictureRow} role="group" aria-label={label}>
      {ids.map((id) => (
        <span className={styles.pictureTile} key={id}>
          <Picture
            id={id}
            role="img"
            aria-hidden={false}
            aria-label={PICTURE_BY_ID[id].label}
          />
        </span>
      ))}
    </div>
  );
}

function selectionFeedback(
  round: Round,
  selected: readonly PictureId[],
): string {
  const result = evaluateSelection(round, selected);
  if (result.correct) return "Every picture remembered.";
  return (
    [
      result.extra.length
        ? `${result.extra.length} ${result.extra.length === 1 ? "picture was" : "pictures were"} not in the study set`
        : "",
      result.missed.length
        ? `${result.missed.length} ${result.missed.length === 1 ? "picture is" : "pictures are"} still missing`
        : "",
    ]
      .filter(Boolean)
      .join("; ") + "."
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input, textarea, select, [role='textbox']"))
  );
}

export default function PictureMemoryPage() {
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
  const [selected, setSelected] = useState<readonly PictureId[]>([]);
  const [recalling, setRecalling] = useState(false);
  const [hydratedPlayId, setHydratedPlayId] = useState<string | null>(null);
  const readyButtonRef = useRef<HTMLButtonElement>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [complete, setComplete] = useState(false);
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [mistakes, setMistakes] = useState<readonly MistakeRecord[]>([]);
  const [retryReady, setRetryReady] = useState(false);
  const [redemptionTotal, setRedemptionTotal] = useState(0);
  const [reviewLevelId, setReviewLevelId] = useState<CampaignLevelId | null>(
    null,
  );
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
  const campaignMarkerRefs = useRef<Record<string, HTMLButtonElement | null>>(
    {},
  );
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
  const isCampaign = !progressionControlled && sessionMode === "campaign";
  const isInfinite = !progressionControlled && sessionMode === "infinite";
  const isRedemption = progressionControlled
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
        ({ sessionRound }) => sessionRound.campaign?.levelId === reviewLevelId,
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
    setSelected([]);
    setRecalling(false);
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

  const submitSelection = useCallback(() => {
    if (
      !recalling ||
      selected.length === 0 ||
      inputLockedRef.current ||
      phase !== "idle" ||
      complete ||
      !gameplayStarted ||
      campaignReviewSelection !== null ||
      (!progressionControlled && isCampaign && activeCampaignLevelComplete) ||
      !activeSessionRound
    ) {
      return;
    }

    inputLockedRef.current = true;
    setRetryReady(false);
    setGenerationError(null);
    const isCorrect = evaluateSelection(round, selected).correct;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (progressionControlled) {
      progression.answer({
        correct: isCorrect,
        answerToken: encodeSelectionAnswerToken(selected, round.options),
      });
    }
    playFeedbackSound(isCorrect);
    setPhase(isCorrect ? "correct-reveal" : "wrong-review");

    if (!progressionControlled && isCampaign) {
      setCampaignProgress((current) => {
        const existing = current[activeSessionRound.id];
        return {
          ...current,
          [activeSessionRound.id]: {
            solved: Boolean(existing?.solved || isCorrect),
            firstAttempt:
              existing?.firstAttempt ?? (isCorrect ? "correct" : "incorrect"),
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
    } else if (!progressionControlled && !isCorrect && !isRedemption) {
      setMistakes((current) =>
        current.some(
          ({ sessionRound }) => sessionRound.id === activeSessionRound.id,
        )
          ? current
          : [
              ...current,
              { sessionRound: activeSessionRound, selected: [...selected] },
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
        retryFocusIndexRef.current = 0;
        inputLockedRef.current = false;
        setSelected([]);
        setRecalling(false);
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
  }, [
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
    recalling,
    selected,
  ]);

  const startCampaign = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
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
    window.scrollTo({ top: 0, behavior: "instant" });
    resumeAudio();
    infiniteFingerprintsRef.current.clear();
    const initialAdaptive = initialInfiniteAdaptiveState();
    const firstRound = tryBuildInfiniteSessionRound(
      1,
      infiniteFingerprintsRef.current,
      initialAdaptive.targetDifficulty,
    );
    if (!firstRound) {
      setGenerationError(
        "Could not build a fresh picture set. Try Infinite again.",
      );
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
          "Could not build a fresh picture set. Try another puzzle.",
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
        }:${progression.current.playId}`
      : null;
  const recallStorageKey = progressionControlled
    ? `picture-memory-recall-v1:${progression.profile.id}`
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
    const savedSelection = controlled.current
      ? decodeSelectionFromAnswerToken(
          controlled.lastAnswerToken,
          controlled.current.round.options,
        )
      : null;
    const timer = window.setTimeout(() => {
      hydratedProgressionPlayIdRef.current = progressionPlayId;
      setHydratedPlayId(progressionPlayId);
      setGenerationError(null);
      if (controlled.roundPhase === "solved" && controlled.current) {
        inputLockedRef.current = true;
        setSelected([...controlled.current.round.study]);
        setRecalling(true);
        setRetryReady(false);
        setPhase("answered");
        shouldFocusFirstOption.current = false;
      } else if (
        controlled.roundPhase === "feedback" &&
        controlled.current &&
        savedSelection !== null &&
        !evaluateSelection(controlled.current.round, savedSelection).correct
      ) {
        inputLockedRef.current = true;
        setSelected(savedSelection);
        setRecalling(true);
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
            retryFocusIndexRef.current = 0;
            inputLockedRef.current = false;
            setSelected([]);
            setRecalling(false);
            setRetryReady(true);
            setPhase("idle");
          },
          reducedMotion ? REDUCED_WRONG_REVIEW_MS : WRONG_REVIEW_MS,
        );
      } else {
        if (controlled.roundPhase === "feedback") controlled.retry();
        inputLockedRef.current = false;
        setSelected([]);
        setRecalling(false);
        setRetryReady(controlled.currentAttemptCount > 0);
        setPhase("idle");
        shouldFocusFirstOption.current = true;
        {
          try {
            const saved = JSON.parse(
              localStorage.getItem(
                recallStorageKey ?? "picture-memory-recall-v1",
              ) ?? "null",
            );
            if (
              saved?.playId === progressionPlayId &&
              saved?.recalling === true
            ) {
              setRecalling(true);
              setSelected(
                decodeSelectionFromAnswerToken(
                  saved.token,
                  controlled.current?.round.options ?? [],
                ) ?? [],
              );
            }
          } catch {
            /* Device storage is optional. */
          }
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    clearFeedbackTimer,
    progression,
    progressionControlled,
    progressionPlayId,
    recallStorageKey,
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
      !progression.current || progression.stage === "redemption-ready"
        ? "blocked"
        : progression.roundPhase === "feedback"
          ? "mandatory-feedback"
          : progression.roundPhase === "solved" || phase === "answered"
            ? "blocked"
            : phase === "idle"
              ? "answering"
              : "mandatory-feedback";
    if (progression.interactionState !== desiredState) {
      progression.setInteractionState(desiredState);
    }
  }, [phase, progression, progressionControlled, progressionPlayId]);

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

  const togglePicture = useCallback(
    (optionIndex: number) => {
      if (
        !recalling ||
        phase !== "idle" ||
        inputLockedRef.current ||
        campaignReviewSelection ||
        complete
      )
        return;
      const id = round.options[optionIndex];
      if (!id) return;
      setSelected((current) =>
        current.includes(id)
          ? current.filter((item) => item !== id)
          : [...current, id],
      );
    },
    [recalling, phase, campaignReviewSelection, complete, round],
  );

  useEffect(() => {
    if (
      !progressionControlled ||
      !progressionPlayId ||
      hydratedProgressionPlayIdRef.current !== progressionPlayId ||
      phase !== "idle"
    )
      return;
    try {
      localStorage.setItem(
        recallStorageKey ?? "picture-memory-recall-v1",
        JSON.stringify({
          playId: progressionPlayId,
          recalling,
          token: encodeSelectionAnswerToken(selected, round.options),
        }),
      );
    } catch {
      /* Optional device-local recall state. */
    }
  }, [
    progressionControlled,
    progressionPlayId,
    recalling,
    selected,
    round,
    phase,
    recallStorageKey,
  ]);

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
      )
        return;
      const index = Number(event.key) - 1;
      if (recalling && index >= 0 && index < round.options.length) {
        event.preventDefault();
        togglePicture(index);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    gameplayStarted,
    complete,
    campaignReviewSelection,
    phase,
    recalling,
    round.options.length,
    togglePicture,
  ]);

  useEffect(() => {
    if (
      gameplayStarted &&
      !complete &&
      !campaignReviewSelection &&
      phase === "idle"
    ) {
      if (recalling) optionButtonRefs.current[0]?.focus();
      else readyButtonRef.current?.focus();
    }
  }, [
    recalling,
    gameplayStarted,
    complete,
    campaignReviewSelection,
    phase,
    round.id,
    hydratedPlayId,
    progressionPlayId,
    recallStorageKey,
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
      (recalling
        ? optionButtonRefs.current[0]
        : readyButtonRef.current
      )?.focus();
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
    recalling,
  ]);

  useEffect(() => {
    if (phase === "idle" && retryReady && retryFocusIndexRef.current !== null) {
      readyButtonRef.current?.focus();
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
  const firstTryScore =
    isCampaign || Object.keys(campaignProgress).length > 0
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
    : infiniteAdaptive.attempts.length > 0
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
        <span className={styles.gameTitle}>{pictureMemoryGame.title}</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {progression.mode === "recovery" ? (
          <ProgressionRecoveryPanel message={progression.message} />
        ) : progression.mode === "redirect" ? null : !gameplayStarted ? (
          <section className={styles.tutorial} aria-labelledby="tutorial-title">
            <div className={styles.tutorialCopy}>
              <p className={styles.kicker}>Example</p>
              <h1 id="tutorial-title">Look. Hide. Remember.</h1>
              <p className={styles.tutorialLede}>
                Study the pictures. When you’re ready, hide them and find the
                same ones.
              </p>
            </div>
            <div className={styles.examplePanel}>
              <div className={styles.exampleStudy}>
                <span className={styles.kicker}>1 · Study</span>
                <PictureRow
                  ids={EXAMPLE.study}
                  label="Example study pictures"
                />
              </div>
              <span className={styles.exampleArrow} aria-hidden="true">
                →
              </span>
              <div className={styles.exampleRecall}>
                <span className={styles.kicker}>2 · Hide & find</span>
                <div className={styles.exampleOptions}>
                  {EXAMPLE.options.map((id) => (
                    <span
                      key={id}
                      className={`${styles.exampleTile} ${EXAMPLE.study.includes(id) ? styles.exampleSelected : ""}`}
                    >
                      <Picture
                        id={id}
                        role="img"
                        aria-hidden={false}
                        aria-label={PICTURE_BY_ID[id].label}
                      />
                      {EXAMPLE.study.includes(id) ? (
                        <b aria-label="Remembered picture">✓</b>
                      ) : null}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <p className={styles.exampleNote}>
              Choose every picture you saw. The order doesn’t matter. Take your
              time.
            </p>

            {progressionControlled && progression.sectionIntro ? (
              <ProgressionCulminationSectionIntro
                gameTitle={pictureMemoryGame.title}
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
                levelLabel={journeyLevelLabel(progression.attempt.journeyLevel)}
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
                            className={`${campaignStyles.campaignLevel} ${
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
                      className={campaignStyles.campaignProblems}
                      role="group"
                      aria-label={`${campaignLevel(activeCampaignLevel).label} problems`}
                    >
                      {Array.from(
                        { length: CAMPAIGN_PROBLEMS_PER_LEVEL },
                        (_, problemIndex) => {
                          const problem =
                            campaignProgress[
                              campaignRoundId(activeCampaignLevel, problemIndex)
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
                              className={`${campaignStyles.campaignProblem} ${
                                marker === "correct"
                                  ? campaignStyles.campaignProblemCorrect
                                  : marker === "incorrect"
                                    ? campaignStyles.campaignProblemIncorrect
                                    : campaignStyles.campaignProblemNotDone
                              } ${
                                isCurrent
                                  ? campaignStyles.campaignProblemCurrent
                                  : ""
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
                    style={{
                      gridTemplateColumns: `repeat(${sessionLength}, 1fr)`,
                    }}
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
            progression.current &&
            hydratedPlayId !== progressionPlayId ? (
              <p className={styles.loadingQuestion} role="status">
                Loading your saved question…
              </p>
            ) : progressionControlled &&
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
                  <p className={styles.kicker}>
                    Study pictures · Correct answer
                  </p>
                  <PictureRow
                    ids={historicalSessionRound.round.study}
                    label="Remembered pictures"
                  />
                  {historicalMistake ? (
                    <>
                      <p className={styles.kicker}>Your first answer</p>
                      <PictureRow
                        ids={historicalMistake.selected}
                        label="Your first answer"
                      />
                      <p>
                        {selectionFeedback(
                          historicalSessionRound.round,
                          historicalMistake.selected,
                        )}
                      </p>
                    </>
                  ) : null}
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
                    {recalling ? "2 · Remember" : "1 · Study"}
                  </p>
                  <h1>
                    {recalling
                      ? "Which pictures did you see?"
                      : `Remember ${round.study.length === 1 ? "this picture" : "these pictures"}.`}
                  </h1>
                  <p>
                    {recalling
                      ? round.difficulty === "Wizard"
                        ? "Choose every picture you remember. Then check your answer."
                        : `Choose ${round.study.length} ${round.study.length === 1 ? "picture" : "pictures"}. Then check your answer.`
                      : "Take your time. Hide the pictures when you’re ready."}
                  </p>
                </div>
                <div className={styles.gameBoard} id="campaign-play-area">
                  {!recalling ? (
                    <section
                      className={styles.studyPanel}
                      aria-label="Study pictures"
                    >
                      <PictureRow
                        ids={round.study}
                        label="Pictures to remember"
                      />
                      <button
                        className={styles.primaryButton}
                        type="button"
                        ref={readyButtonRef}
                        onClick={() => {
                          resumeAudio();
                          setRecalling(true);
                          setSelected([]);
                        }}
                      >
                        I’m ready <span aria-hidden="true">→</span>
                      </button>
                    </section>
                  ) : (
                    <section
                      className={styles.answerPanel}
                      aria-label="Recall pictures"
                    >
                      <div
                        className={styles.optionGrid}
                        role="group"
                        aria-label="Answer choices"
                      >
                        {round.options.map((id, index) => {
                          const isSelected = selected.includes(id);
                          const solved =
                            phase === "correct-reveal" || phase === "answered";
                          const wrong =
                            phase === "wrong-review" &&
                            isSelected &&
                            !round.study.includes(id);
                          return (
                            <button
                              type="button"
                              key={id}
                              className={`${styles.optionButton} ${isSelected ? styles.selectedOption : ""} ${solved && isSelected ? styles.correctOption : ""} ${solved && !isSelected ? styles.mutedOption : ""} ${wrong ? styles.wrongOption : ""}`}
                              aria-pressed={isSelected}
                              aria-label={`Picture ${index + 1}: ${PICTURE_BY_ID[id].label}${wrong ? ", not in the study set" : ""}`}
                              aria-keyshortcuts={`${index + 1}`}
                              disabled={phase !== "idle"}
                              onClick={() => togglePicture(index)}
                              ref={(node) => {
                                optionButtonRefs.current[index] = node;
                              }}
                            >
                              <span
                                className={styles.optionNumber}
                                aria-hidden="true"
                              >
                                {index + 1}
                              </span>
                              <Picture id={id} aria-hidden="true" />
                              <span
                                className={styles.choiceMark}
                                aria-hidden="true"
                              >
                                {wrong ? "×" : isSelected ? "✓" : ""}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {phase === "idle" ? (
                        <div className={styles.selectionActions}>
                          <span role="status" aria-live="polite">
                            {selected.length} selected
                          </span>
                          <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={submitSelection}
                            disabled={selected.length === 0}
                          >
                            Check answer
                          </button>
                        </div>
                      ) : null}
                    </section>
                  )}
                </div>
                <div
                  className={styles.feedbackBar}
                  aria-live="polite"
                  role="status"
                >
                  {phase === "wrong-review" ? (
                    <div className={styles.wrongFeedback}>
                      <strong className={styles.wrongText}>
                        × {selectionFeedback(round, selected)}
                      </strong>
                      <span>Look again at the pictures you studied.</span>
                      <PictureRow
                        ids={round.study}
                        label="Study pictures shown again"
                      />
                    </div>
                  ) : phase === "correct-reveal" ? (
                    <strong className={styles.correctText}>
                      ✓ Correct · Every picture remembered.
                    </strong>
                  ) : phase === "answered" ? (
                    <>
                      <strong className={styles.correctText}>
                        ✓ {generationError ?? "Correct"}
                      </strong>
                      <button
                        className={styles.nextButton}
                        type="button"
                        onClick={goNext}
                        ref={nextButtonRef}
                      >
                        {generationError
                          ? "Try another picture set"
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
                    <strong className={styles.retryText}>
                      Try again · Study once more, then hide the pictures.
                    </strong>
                  ) : null}
                </div>
                {recalling ? (
                  <p className={styles.keyboardHint}>
                    Keys 1–{round.options.length} to select · Check answer when
                    ready
                  </p>
                ) : null}
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
                  ({ sessionRound: missed, selected: firstSelection }) => (
                    <article className={styles.reviewCard} key={missed.id}>
                      <span className={styles.reviewRound}>
                        {missed.campaign
                          ? `${missed.campaign.levelLabel} · Puzzle ${missed.campaign.problemIndex + 1}`
                          : `Puzzle ${missed.ordinal} · ${missed.round.difficulty}`}
                      </span>
                      <PictureRow
                        ids={missed.round.study}
                        label="Pictures to remember"
                      />
                      <p>{selectionFeedback(missed.round, firstSelection)}</p>
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
    </div>
  );
}
