"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  MK_CONTENT_VERSION,
  MK_ROUNDS,
} from "@/app/journey/reviews/math-kangaroo/authored-rounds";
import {
  createGameAudioContext,
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import {
  DEFAULT_MK_LAB_FILTERS,
  MK_LAB_GRADE_BANDS,
  MK_LAB_MECHANICS,
  MK_LAB_MECHANIC_LABELS,
  MK_LAB_POINT_VALUES,
  drawMkLabQuestion,
  filterMkLabRounds,
  mathKangarooPointValue,
  type MkLabDraw,
  type MkLabFilters,
  type MkLabGradeBand,
  type MkLabMechanicFilter,
  type MkLabPointFilter,
} from "./engine";
import {
  MK_LAB_QA_ISSUES,
  captureMkLabQaObservation,
  emptyMkLabQaEntry,
  emptyMkLabProgress,
  hasMkLabQaFeedback,
  readMkLabQaArchives,
  readMkLabQaFeedback,
  readMkLabProgress,
  restoreMkLabDraw,
  writeMkLabQaFeedback,
  writeMkLabProgress,
  type MkLabProgress,
  type MkLabQaArchive,
  type MkLabQaEntry,
  type MkLabQaFeedback,
  type MkLabQaIssue,
  type MkLabQaVerdict,
} from "./storage";

import styles from "./math-kangaroo-lab.module.css";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

type AnswerPhase = "answering" | "reviewing" | "retry" | "solved";
type PendingQaAction = "reset-progress" | "clear-feedback" | null;

const QA_ISSUE_LABELS: Readonly<Record<MkLabQaIssue, string>> = {
  "answer-key": "Answer or key",
  "prompt-wording": "Prompt wording",
  "image-diagram": "Image or diagram",
  classification: "Grade, points, or type",
  "layout-accessibility": "Layout or accessibility",
  other: "Other",
};

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input, textarea, select") ||
      Boolean(
        target.closest("input, textarea, select, [contenteditable='true']"),
      ))
  );
}

function filterKeyFor(filters: MkLabFilters): string {
  return `${filters.gradeBand}:${filters.points}:${filters.mechanic}`;
}

function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function MathKangarooLabClient() {
  const [filters, setFilters] = useState<MkLabFilters>(
    DEFAULT_MK_LAB_FILTERS,
  );
  const [draw, setDraw] = useState<MkLabDraw | null>(null);
  const [phase, setPhase] = useState<AnswerPhase>("answering");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [qaMode, setQaMode] = useState(false);
  const [qaFeedback, setQaFeedback] = useState<MkLabQaFeedback>({});
  const [qaArchives, setQaArchives] = useState<readonly MkLabQaArchive[]>([]);
  const [qaSaveStatus, setQaSaveStatus] = useState("");
  const [pendingQaAction, setPendingQaAction] =
    useState<PendingQaAction>(null);
  const [progress, setProgress] = useState<MkLabProgress>(
    emptyMkLabProgress,
  );
  const progressRef = useRef<MkLabProgress>(emptyMkLabProgress());
  const qaFeedbackRef = useRef<MkLabQaFeedback>({});
  const currentRoundIdRef = useRef<string | undefined>(undefined);
  const appliedFilterKeyRef = useRef<string | null>(null);
  const focusAnswersRef = useRef(false);
  const answerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const qaSummaryRef = useRef<HTMLElement>(null);
  const qaCancelButtonRef = useRef<HTMLButtonElement>(null);
  const qaConfirmationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const matchingRounds = useMemo(
    () => filterMkLabRounds(MK_ROUNDS, filters),
    [filters],
  );
  const filterKey = filterKeyFor(filters);

  const ensureAudio = useCallback(() => {
    let context = audioContextRef.current;
    if (!context || context.state === "closed") {
      context = createGameAudioContext();
      audioContextRef.current = context;
    }
    if (context?.state === "suspended") {
      void context.resume().catch(() => undefined);
    }
    return context;
  }, []);

  const persistProgress = useCallback((next: MkLabProgress) => {
    progressRef.current = next;
    setProgress(next);
    return writeMkLabProgress(deviceStorage(), next, MK_CONTENT_VERSION);
  }, []);

  const drawQuestion = useCallback(
    (activeFilters: MkLabFilters, focusAnswer: boolean) => {
      const saved = progressRef.current;
      const next = drawMkLabQuestion({
        rounds: MK_ROUNDS,
        filters: activeFilters,
        seenIds: new Set(saved.seenIds),
        avoidId: currentRoundIdRef.current,
      });
      const nextSeenIds = next && !saved.seenIds.includes(next.round.id)
        ? [...saved.seenIds, next.round.id]
        : saved.seenIds;
      const savedOnDevice = persistProgress({
        ...saved,
        filters: activeFilters,
        seenIds: nextSeenIds,
        current: next
          ? {
              roundId: next.round.id,
              sourceIndexes: next.answers.map(
                ({ sourceIndex }) => sourceIndex,
              ) as unknown as NonNullable<MkLabProgress["current"]>["sourceIndexes"],
              phase: "answering",
              selectedIndex: null,
              missed: false,
            }
          : null,
      });
      setSelectedIndex(null);
      setPhase("answering");
      setPendingQaAction(null);
      focusAnswersRef.current = focusAnswer;
      setDraw(next);
      currentRoundIdRef.current = next?.round.id;
      return savedOnDevice;
    },
    [persistProgress],
  );

  useEffect(() => {
    const storage = deviceStorage();
    const loaded =
      readMkLabProgress(
        storage,
        MK_ROUNDS,
        MK_CONTENT_VERSION,
      ) ?? emptyMkLabProgress();
    const loadedQa =
      readMkLabQaFeedback(
        storage,
        MK_ROUNDS,
        MK_CONTENT_VERSION,
      ) ?? {};
    const loadedQaArchives = readMkLabQaArchives(
      storage,
      MK_CONTENT_VERSION,
    );
    const restored = restoreMkLabDraw(loaded, MK_ROUNDS);
    const timer = window.setTimeout(() => {
      progressRef.current = loaded;
      qaFeedbackRef.current = loadedQa;
      setProgress(loaded);
      setQaFeedback(loadedQa);
      setQaArchives(loadedQaArchives);
      setQaMode(
        new URLSearchParams(window.location.search).get("qa") === "1",
      );
      setFilters(loaded.filters);
      if (restored && loaded.current) {
        setDraw(restored);
        setPhase(loaded.current.phase);
        setSelectedIndex(loaded.current.selectedIndex);
        currentRoundIdRef.current = restored.round.id;
        appliedFilterKeyRef.current = filterKeyFor(loaded.filters);
      } else {
        appliedFilterKeyRef.current = null;
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (appliedFilterKeyRef.current === filterKey) return;
    const isFirstDraw = appliedFilterKeyRef.current === null;
    appliedFilterKeyRef.current = filterKey;
    drawQuestion(filters, isFirstDraw);
  }, [drawQuestion, filterKey, filters, hydrated]);

  useEffect(() => {
    const enabled = readSoundPreference();
    if (!enabled) {
      const timer = window.setTimeout(() => setSoundEnabled(false), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!draw || !focusAnswersRef.current) return;
    focusAnswersRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      answerRefs.current[0]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [draw]);

  useEffect(() => {
    if (phase !== "reviewing") return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(() => {
      setPhase("retry");
      window.requestAnimationFrame(() => retryButtonRef.current?.focus());
    }, reducedMotion ? 1_300 : 2_200);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "solved") return;
    const frame = window.requestAnimationFrame(() => nextButtonRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (!pendingQaAction) return;
    const frame = window.requestAnimationFrame(() => {
      qaCancelButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingQaAction]);

  useEffect(
    () => () => {
      const context = audioContextRef.current;
      audioContextRef.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch(() => undefined);
      }
    },
    [],
  );

  const captureQaObservation = useCallback(
    (activeDraw: MkLabDraw, answerIndex: number) => {
      const existing = qaFeedbackRef.current[activeDraw.round.id];
      if (!existing || !hasMkLabQaFeedback(existing)) return;
      const observedSourceIndexes = activeDraw.answers.map(
        ({ sourceIndex }) => sourceIndex,
      ) as unknown as NonNullable<MkLabQaEntry["observedSourceIndexes"]>;
      const entry = captureMkLabQaObservation(
        existing,
        observedSourceIndexes,
        activeDraw.answers[answerIndex]?.letter ?? null,
      );
      if (entry === existing) return;
      const next: MkLabQaFeedback = {
        ...qaFeedbackRef.current,
        [activeDraw.round.id]: entry,
      };
      qaFeedbackRef.current = next;
      setQaFeedback(next);
      const saved = writeMkLabQaFeedback(
        deviceStorage(),
        next,
        MK_CONTENT_VERSION,
      );
      setQaSaveStatus(saved ? "Saved on this device" : "Could not save locally");
    },
    [],
  );

  const chooseAnswer = useCallback(
    (index: number) => {
      if (!draw || phase !== "answering") return;
      const correct = draw.answers[index].correct;
      const saved = progressRef.current;
      if (!saved.current || saved.current.roundId !== draw.round.id) return;
      setSelectedIndex(index);
      captureQaObservation(draw, index);
      if (soundEnabled) {
        const context = ensureAudio();
        if (context) playFeedbackEarcon(context, correct);
      }
      if (correct) {
        persistProgress({
          ...saved,
          solvedCount: saved.solvedCount + 1,
          firstTryCorrectCount:
            saved.firstTryCorrectCount + (saved.current.missed ? 0 : 1),
          current: {
            ...saved.current,
            phase: "solved",
            selectedIndex: index,
          },
        });
        setPhase("solved");
      } else {
        persistProgress({
          ...saved,
          current: {
            ...saved.current,
            phase: "retry",
            selectedIndex: index,
            missed: true,
          },
        });
        setPhase("reviewing");
      }
    },
    [captureQaObservation, draw, ensureAudio, persistProgress, phase, soundEnabled],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        phase !== "answering" ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      const letterIndex = "ABCDE".indexOf(event.key.toUpperCase());
      const numberIndex = Number(event.key) - 1;
      const index = letterIndex >= 0 ? letterIndex : numberIndex;
      if (index < 0 || index >= 5) return;
      event.preventDefault();
      chooseAnswer(index);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [chooseAnswer, phase]);

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeSoundPreference(next);
    if (next) ensureAudio();
  }, [ensureAudio, soundEnabled]);

  const retry = useCallback(() => {
    if (phase !== "retry") return;
    const attempted = selectedIndex;
    const saved = progressRef.current;
    if (saved.current) {
      persistProgress({
        ...saved,
        current: {
          ...saved.current,
          phase: "answering",
          selectedIndex: null,
          missed: true,
        },
      });
    }
    setSelectedIndex(null);
    setPhase("answering");
    window.requestAnimationFrame(() => {
      if (attempted !== null) answerRefs.current[attempted]?.focus();
    });
  }, [persistProgress, phase, selectedIndex]);

  const nextQuestion = useCallback(() => {
    drawQuestion(filters, true);
  }, [drawQuestion, filters]);

  const resetPlayProgress = useCallback(() => {
    const fresh: MkLabProgress = {
      ...emptyMkLabProgress(),
      filters,
    };
    currentRoundIdRef.current = undefined;
    persistProgress(fresh);
    qaConfirmationTriggerRef.current = null;
    const savedOnDevice = drawQuestion(filters, true);
    setQaSaveStatus(
      savedOnDevice
        ? "Play progress started over; QA notes were kept"
        : "Progress restarted for this tab, but this device could not save it",
    );
  }, [drawQuestion, filters, persistProgress]);

  const updateQaEntry = useCallback(
    (roundId: string, update: Partial<Omit<MkLabQaEntry, "updatedAt">>) => {
      const current = qaFeedbackRef.current;
      const existing = current[roundId] ?? emptyMkLabQaEntry();
      const updatedEntry: MkLabQaEntry = {
        ...existing,
        ...update,
        updatedAt: new Date().toISOString(),
      };
      const entry =
        draw && draw.round.id === roundId
          ? captureMkLabQaObservation(
              updatedEntry,
              draw.answers.map(
                ({ sourceIndex }) => sourceIndex,
              ) as unknown as NonNullable<
                MkLabQaEntry["observedSourceIndexes"]
              >,
              selectedIndex === null
                ? null
                : draw.answers[selectedIndex]?.letter ?? null,
            )
          : updatedEntry;
      const next: Partial<Record<string, MkLabQaEntry>> = { ...current };
      if (hasMkLabQaFeedback(entry)) next[roundId] = entry;
      else delete next[roundId];
      qaFeedbackRef.current = next;
      setQaFeedback(next);
      const saved = writeMkLabQaFeedback(
        deviceStorage(),
        next,
        MK_CONTENT_VERSION,
      );
      setQaSaveStatus(saved ? "Saved on this device" : "Could not save locally");
    },
    [draw, selectedIndex],
  );

  const exportQaFeedback = useCallback(() => {
    const roundsById = new Map(MK_ROUNDS.map((item) => [item.id, item]));
    const exportItems = (feedbackByRound: MkLabQaFeedback) =>
      Object.entries(feedbackByRound)
        .filter(([, entry]) => hasMkLabQaFeedback(entry))
        .map(([roundId, feedback]) => {
          const item = roundsById.get(roundId);
          return {
            roundId,
            ...(item
              ? {
                  source: {
                    year: item.source.year,
                    gradeBand: item.source.gradeBand,
                    questionNumber: item.source.questionNumber,
                  },
                  points: mathKangarooPointValue(item.source.questionNumber),
                  spatialType: item.mechanic,
                }
              : {}),
            feedback,
          };
        })
        .sort((left, right) => left.roundId.localeCompare(right.roundId));
    const payload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      contentVersion: MK_CONTENT_VERSION,
      catalogueSize: MK_ROUNDS.length,
      items: exportItems(qaFeedback),
      archivedContentVersions: qaArchives.map(
        ({ contentVersion, feedback }) => ({
          contentVersion,
          items: exportItems(feedback),
        }),
      ),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `math-kangaroo-qa-${MK_CONTENT_VERSION}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [qaArchives, qaFeedback]);

  const clearQaFeedback = useCallback(() => {
    const next: MkLabQaFeedback = {};
    qaFeedbackRef.current = next;
    setQaFeedback(next);
    const saved = writeMkLabQaFeedback(
      deviceStorage(),
      next,
      MK_CONTENT_VERSION,
    );
    setQaSaveStatus(
      saved ? "All QA notes cleared" : "Could not clear saved QA notes",
    );
    qaConfirmationTriggerRef.current = null;
    setPendingQaAction(null);
    window.requestAnimationFrame(() => qaSummaryRef.current?.focus());
  }, []);

  const cancelPendingQaAction = useCallback(() => {
    const trigger = qaConfirmationTriggerRef.current;
    qaConfirmationTriggerRef.current = null;
    setPendingQaAction(null);
    window.requestAnimationFrame(() => trigger?.focus());
  }, []);

  const round = draw?.round ?? null;
  const usesSemanticChoices =
    round?.choices.every(({ displayText }) => displayText !== undefined) ?? false;
  const illustrationAspect = round
    ? round.illustration.width / round.illustration.height
    : 1;
  const illustrationIsWide = illustrationAspect > 3.5;
  const illustrationStyle = round
    ? {
        maxWidth: `${Math.min(round.illustration.width, 900)}px`,
        ...(illustrationIsWide
          ? {
              minWidth: `${Math.min(
                round.illustration.width,
                Math.max(640, illustrationAspect * 120),
              )}px`,
            }
          : {}),
      }
    : undefined;
  const currentQaEntry = round
    ? qaFeedback[round.id] ?? emptyMkLabQaEntry()
    : emptyMkLabQaEntry();
  const qaFeedbackCount = Object.values(qaFeedback).filter(
    hasMkLabQaFeedback,
  ).length;
  const qaArchiveCount = qaArchives.reduce(
    (total, archive) =>
      total + Object.values(archive.feedback).filter(hasMkLabQaFeedback).length,
    0,
  );

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/">
          <span aria-hidden="true">←</span>
          <span>All games</span>
        </Link>
        <span className={styles.routeTitle}>Math Kangaroo Lab</span>
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
      </header>

      <main className={styles.main}>
        <section className={styles.labIntro} aria-labelledby="lab-title">
          <div>
            <p className={styles.kicker}>{qaMode ? "QA mode" : "The Lab"}</p>
            <h1 id="lab-title">Math Kangaroo shuffle</h1>
            <p>
              Draw from {MK_ROUNDS.length} reviewed spatial questions. Set the
              mix, then solve at your own pace.
            </p>
            <dl
              className={styles.progressSummary}
              aria-label="Saved Math Kangaroo Lab progress"
            >
              <div>
                <dt>Solved</dt>
                <dd>{progress.solvedCount}</dd>
              </div>
              <div>
                <dt>First try</dt>
                <dd>{progress.firstTryCorrectCount}</dd>
              </div>
              <div>
                <dt>Seen</dt>
                <dd>
                  {progress.seenIds.length} / {MK_ROUNDS.length}
                </dd>
              </div>
              {qaMode ? (
                <div>
                  <dt>QA notes</dt>
                  <dd>{qaFeedbackCount}</dd>
                </div>
              ) : null}
            </dl>
            <p className={styles.progressNote}>
              Progress is saved on this device.
            </p>
          </div>
          <div className={styles.shuffleMark} aria-hidden="true">
            <span>A</span>
            <span>C</span>
            <span>E</span>
          </div>
        </section>

        <section className={styles.filters} aria-labelledby="filter-title">
          <div className={styles.filterHeading}>
            <div>
              <p className={styles.kicker}>Question mix</p>
              <h2 id="filter-title">Choose your pool</h2>
            </div>
            <p className={styles.poolCount} id="pool-count" aria-live="polite">
              {matchingRounds.length}{" "}
              {matchingRounds.length === 1 ? "question" : "questions"}
            </p>
          </div>
          <div className={styles.filterGrid}>
            <label>
              <span>Grade</span>
              <select
                value={filters.gradeBand}
                disabled={!hydrated}
                aria-describedby="pool-count"
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    gradeBand: event.target.value as MkLabGradeBand,
                  }))
                }
              >
                <option value="all">All grades</option>
                {MK_LAB_GRADE_BANDS.map((gradeBand) => (
                  <option value={gradeBand} key={gradeBand}>
                    {gradeBand === "grades-1-2" ? "Grades 1–2" : "Grades 3–4"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Points</span>
              <select
                value={filters.points}
                disabled={!hydrated}
                aria-describedby="pool-count"
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    points: (event.target.value === "all"
                      ? "all"
                      : Number(event.target.value)) as MkLabPointFilter,
                  }))
                }
              >
                <option value="all">All points</option>
                {MK_LAB_POINT_VALUES.map((points) => (
                  <option value={points} key={points}>
                    {points} points
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Question type</span>
              <select
                value={filters.mechanic}
                disabled={!hydrated}
                aria-describedby="pool-count"
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    mechanic: event.target.value as MkLabMechanicFilter,
                  }))
                }
              >
                <option value="all">All spatial types</option>
                {MK_LAB_MECHANICS.map((mechanic) => (
                  <option value={mechanic} key={mechanic}>
                    {MK_LAB_MECHANIC_LABELS[mechanic]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.filterFooter}>
            <p>The current catalogue contains spatial and nonverbal questions only.</p>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={nextQuestion}
              disabled={!hydrated || matchingRounds.length === 0}
            >
              Shuffle question <span aria-hidden="true">↻</span>
            </button>
          </div>
        </section>

        {round && draw ? (
          <div className={styles.round}>
            <section
              className={styles.promptPanel}
              aria-labelledby="mk-lab-question-title"
            >
              <div className={styles.questionMeta}>
                <span>
                  {round.source.gradeBand === "grades-1-2"
                    ? "Grades 1–2"
                    : "Grades 3–4"}
                </span>
                <span>
                  {mathKangarooPointValue(round.source.questionNumber)} points
                </span>
                <span>{MK_LAB_MECHANIC_LABELS[round.mechanic]}</span>
                {qaMode ? <span>QA ID: {round.id}</span> : null}
              </div>
              <h2 className={styles.prompt} id="mk-lab-question-title">
                {round.prompt}
              </h2>
              <div
                className={`${styles.illustrationFrame} ${
                  illustrationIsWide ? styles.illustrationFrameScrollable : ""
                }`}
                role={illustrationIsWide ? "region" : undefined}
                tabIndex={illustrationIsWide ? 0 : undefined}
                aria-label={
                  illustrationIsWide
                    ? usesSemanticChoices
                      ? "Scrollable puzzle illustration; answer choices are listed below"
                      : "Scrollable puzzle illustration with five numbered pictures"
                    : undefined
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={styles.illustration}
                  src={`${basePath}${round.illustration.src}`}
                  width={round.illustration.width}
                  height={round.illustration.height}
                  alt={round.illustration.alt}
                  style={illustrationStyle}
                />
              </div>
              {illustrationIsWide ? (
                <p className={styles.scrollHint}>
                  Scroll sideways to inspect the full diagram.
                </p>
              ) : null}
            </section>

            <section className={styles.answerGroup} aria-labelledby="answer-title">
              <div className={styles.answerHeading}>
                <p className={styles.kicker} id="answer-title">
                  Choose an answer
                </p>
                <p>Letters are reshuffled for every draw.</p>
              </div>
              <div
                className={`${styles.answers} ${
                  usesSemanticChoices ? styles.answersText : ""
                }`}
              >
                {draw.answers.map((answer, index) => {
                  const selected = selectedIndex === index;
                  const wrong =
                    (phase === "reviewing" || phase === "retry") && selected;
                  const correct = phase === "solved" && answer.correct;
                  const muted = phase !== "answering" && !wrong && !correct;
                  return (
                    <button
                      className={[
                        styles.answerButton,
                        usesSemanticChoices ? styles.answerButtonText : "",
                        wrong ? styles.answerWrong : "",
                        correct ? styles.answerCorrect : "",
                        muted ? styles.answerMuted : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      type="button"
                      onClick={() => chooseAnswer(index)}
                      disabled={phase !== "answering"}
                      aria-keyshortcuts={`${answer.letter} ${index + 1}`}
                      aria-label={`Option ${answer.letter}: ${
                        usesSemanticChoices
                          ? answer.choice.displayText
                          : `picture ${answer.sourceIndex + 1}`
                      }${wrong ? ", not quite" : correct ? ", correct" : ""}`}
                      ref={(node) => {
                        answerRefs.current[index] = node;
                      }}
                      key={answer.letter}
                    >
                      <span className={styles.answerLetter} aria-hidden="true">
                        {answer.letter}
                      </span>
                      <span className={styles.answerContent}>
                        {usesSemanticChoices
                          ? answer.choice.displayText
                          : `Picture ${answer.sourceIndex + 1}`}
                      </span>
                      {wrong || correct ? (
                        <span className={styles.answerResult} aria-hidden="true">
                          {correct ? "✓" : "×"}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>

            {phase === "reviewing" || phase === "retry" ? (
              <section
                className={`${styles.feedbackPanel} ${styles.feedbackWrong}`}
                aria-labelledby="feedback-title"
              >
                <span className={styles.feedbackMark} aria-hidden="true">
                  ×
                </span>
                <div role="status">
                  <p className={styles.kicker}>Try again</p>
                  <h2 id="feedback-title">That answer doesn’t match yet.</h2>
                  <p>Compare one position, direction, or connection at a time.</p>
                </div>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={retry}
                  disabled={phase !== "retry"}
                  ref={retryButtonRef}
                >
                  {phase === "retry" ? "Try again" : "Look closely…"}
                </button>
              </section>
            ) : phase === "solved" ? (
              <section
                className={`${styles.feedbackPanel} ${styles.feedbackCorrect}`}
                aria-labelledby="feedback-title"
              >
                <span className={styles.feedbackMark} aria-hidden="true">
                  ✓
                </span>
                <div role="status">
                  <p className={styles.kicker}>Correct</p>
                  <h2 id="feedback-title">You found it.</h2>
                  <p className={styles.sourceNote}>
                    Official Cyprus competition, {round.source.year}; answer
                    checked against the official key.
                  </p>
                </div>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={nextQuestion}
                  ref={nextButtonRef}
                >
                  Next random question <span aria-hidden="true">→</span>
                </button>
              </section>
            ) : (
              <p className={styles.status} aria-live="polite">
                Use A–E or number keys 1–5.
              </p>
            )}

            {qaMode ? (
              <details className={styles.qaPanel} open>
                <summary ref={qaSummaryRef}>
                  <span>
                    <strong>QA notes</strong>
                    <small>Saved locally; excluded from your score</small>
                  </span>
                  <span className={styles.qaSummaryMeta}>
                    <span className={styles.qaCount}>
                      {qaFeedbackCount} saved
                      {qaArchiveCount > 0
                        ? ` · ${qaArchiveCount} archived`
                        : ""}
                    </span>
                    <span className={styles.qaChevron} aria-hidden="true">
                      ▾
                    </span>
                  </span>
                </summary>
                <div className={styles.qaBody}>
                  <div className={styles.qaReference}>
                    <div>
                      <span>Question ID</span>
                      <code>{round.id}</code>
                    </div>
                    <div>
                      <span>Content version</span>
                      <code>{MK_CONTENT_VERSION}</code>
                    </div>
                    <div>
                      <span>Current answer order</span>
                      <code>
                        {draw.answers
                          .map(
                            ({ letter, sourceIndex }) =>
                              `${letter}←${sourceIndex + 1}`,
                          )
                          .join(" · ")}
                      </code>
                    </div>
                    <div>
                      <span>Filtered pool</span>
                      <code>{draw.poolSize} questions</code>
                    </div>
                  </div>

                  <label className={styles.qaVerdict}>
                    <span>Review verdict</span>
                    <select
                      value={currentQaEntry.verdict}
                      onChange={(event) =>
                        updateQaEntry(round.id, {
                          verdict: event.target.value as MkLabQaVerdict,
                        })
                      }
                    >
                      <option value="unreviewed">Not reviewed</option>
                      <option value="looks-good">Looks good</option>
                      <option value="needs-change">Needs change</option>
                    </select>
                  </label>

                  <fieldset className={styles.qaIssues}>
                    <legend>What needs attention?</legend>
                    <div>
                      {MK_LAB_QA_ISSUES.map((issue) => (
                        <label key={issue}>
                          <input
                            type="checkbox"
                            checked={currentQaEntry.issues.includes(issue)}
                            onChange={(event) => {
                              const issues = event.target.checked
                                ? [...currentQaEntry.issues, issue]
                                : currentQaEntry.issues.filter(
                                    (currentIssue) => currentIssue !== issue,
                                  );
                              updateQaEntry(round.id, { issues });
                            }}
                          />
                          <span>{QA_ISSUE_LABELS[issue]}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  <label className={styles.qaNotes}>
                    <span>Notes</span>
                    <textarea
                      value={currentQaEntry.notes}
                      maxLength={4_000}
                      rows={4}
                      placeholder="Describe what you saw and what you expected."
                      onChange={(event) =>
                        updateQaEntry(round.id, { notes: event.target.value })
                      }
                    />
                  </label>

                  <div className={styles.qaActions}>
                    <p role="status" aria-live="polite">
                      {qaSaveStatus ||
                        (qaArchiveCount > 0
                          ? "Earlier catalogue feedback is preserved and included in downloads."
                          : "Changes save automatically on this device.")}
                    </p>
                    <div>
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={(event) => {
                          qaConfirmationTriggerRef.current = event.currentTarget;
                          setPendingQaAction("reset-progress");
                        }}
                      >
                        Start play progress over
                      </button>
                      <button
                        className={styles.secondaryButton}
                        type="button"
                        onClick={(event) => {
                          qaConfirmationTriggerRef.current = event.currentTarget;
                          setPendingQaAction("clear-feedback");
                        }}
                        disabled={qaFeedbackCount === 0}
                      >
                        Clear QA notes
                      </button>
                      <button
                        className={styles.primaryButton}
                        type="button"
                        onClick={exportQaFeedback}
                        disabled={qaFeedbackCount + qaArchiveCount === 0}
                      >
                        Download QA feedback
                      </button>
                    </div>
                  </div>
                  {pendingQaAction ? (
                    <div
                      className={styles.qaConfirm}
                      role="group"
                      aria-labelledby="qa-confirm-message"
                    >
                      <p id="qa-confirm-message" role="status">
                        {pendingQaAction === "reset-progress"
                          ? "Start play progress over? Saved QA notes will be kept."
                          : "Delete every saved QA note for this content version? This cannot be undone."}
                      </p>
                      <div>
                        <button
                          className={styles.secondaryButton}
                          type="button"
                          onClick={cancelPendingQaAction}
                          ref={qaCancelButtonRef}
                        >
                          Cancel
                        </button>
                        <button
                          className={styles.primaryButton}
                          type="button"
                          onClick={
                            pendingQaAction === "reset-progress"
                              ? resetPlayProgress
                              : clearQaFeedback
                          }
                        >
                          {pendingQaAction === "reset-progress"
                            ? "Yes, start over"
                            : "Yes, clear notes"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        ) : !hydrated ? (
          <p className={styles.status} role="status">
            Restoring saved progress…
          </p>
        ) : matchingRounds.length === 0 ? (
          <section className={styles.emptyState} aria-labelledby="empty-title">
            <p className={styles.kicker}>No match</p>
            <h2 id="empty-title">That exact mix has no questions yet.</h2>
            <p>Broaden one of the filters to draw a question.</p>
          </section>
        ) : (
          <p className={styles.status} role="status">
            Drawing a question…
          </p>
        )}
      </main>
    </div>
  );
}
