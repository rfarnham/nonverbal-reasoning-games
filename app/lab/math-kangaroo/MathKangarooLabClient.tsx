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
  emptyMkLabProgress,
  readMkLabProgress,
  restoreMkLabDraw,
  writeMkLabProgress,
  type MkLabProgress,
} from "./storage";

import styles from "./math-kangaroo-lab.module.css";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

type AnswerPhase = "answering" | "reviewing" | "retry" | "solved";

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
  const [progress, setProgress] = useState<MkLabProgress>(
    emptyMkLabProgress,
  );
  const progressRef = useRef<MkLabProgress>(emptyMkLabProgress());
  const currentRoundIdRef = useRef<string | undefined>(undefined);
  const appliedFilterKeyRef = useRef<string | null>(null);
  const focusAnswersRef = useRef(false);
  const answerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
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
    writeMkLabProgress(deviceStorage(), next, MK_CONTENT_VERSION);
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
      persistProgress({
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
      focusAnswersRef.current = focusAnswer;
      setDraw(next);
      currentRoundIdRef.current = next?.round.id;
    },
    [persistProgress],
  );

  useEffect(() => {
    const loaded =
      readMkLabProgress(
        deviceStorage(),
        MK_ROUNDS,
        MK_CONTENT_VERSION,
      ) ?? emptyMkLabProgress();
    const restored = restoreMkLabDraw(loaded, MK_ROUNDS);
    const timer = window.setTimeout(() => {
      progressRef.current = loaded;
      setProgress(loaded);
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

  const chooseAnswer = useCallback(
    (index: number) => {
      if (!draw || phase !== "answering") return;
      const correct = draw.answers[index].correct;
      const saved = progressRef.current;
      if (!saved.current || saved.current.roundId !== draw.round.id) return;
      setSelectedIndex(index);
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
    [draw, ensureAudio, persistProgress, phase, soundEnabled],
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
            <p className={styles.kicker}>The Lab</p>
            <h1 id="lab-title">Math Kangaroo shuffle</h1>
            <p>
              Draw from 168 reviewed spatial questions. Set the mix, then solve
              at your own pace.
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
