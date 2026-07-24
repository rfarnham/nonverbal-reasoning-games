"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
  createGameAudioContext,
  playFeedbackEarcon,
  readSoundPreference,
  writeSoundPreference,
} from "@/lib/game-audio";
import { journeyLevelLabel } from "@/lib/progression/types";
import { MkExplanationAnimation } from "./MkExplanationAnimation";
import { progressionAdapter } from "./progression-adapter";

import styles from "./math-kangaroo.module.css";

const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input, textarea, select") ||
      Boolean(
        target.closest(
          "input, textarea, select, [contenteditable='true']",
        ),
      ))
  );
}

function SolvedExample() {
  return (
    <section className={styles.example} aria-labelledby="mk-example-title">
      <div>
        <p className={styles.reviewKicker}>Solved example</p>
        <h1 id="mk-example-title">Track what stays the same.</h1>
        <p>
          A turn can change direction without changing the order of the parts.
          Check each distinctive mark, then choose the picture that preserves
          every relationship.
        </p>
        <p className={styles.exampleAnswer}>
          <span aria-hidden="true">✓</span> The matching picture keeps both
          marks in the same clockwise order.
        </p>
      </div>
      <div className={styles.exampleVisual}>
        <svg
          className={styles.examplePuzzle}
          viewBox="0 0 320 150"
          role="img"
          aria-labelledby="mk-example-visual-title mk-example-visual-desc"
        >
          <title id="mk-example-visual-title">
            Solved quarter-turn example
          </title>
          <desc id="mk-example-visual-desc">
            The triangle, circle, and bar all move together through one
            clockwise quarter-turn. The first answer preserves their
            relationships and is marked correct.
          </desc>
          <g className={styles.exampleClue}>
            <rect x="8" y="25" width="82" height="82" rx="13" />
            <path d="M25 38 37 58 13 58Z" />
            <circle cx="72" cy="88" r="10" />
            <rect x="17" y="69" width="8" height="25" rx="4" />
          </g>
          <path
            className={styles.exampleTurnArrow}
            d="M102 70 C119 43 137 43 151 65"
          />
          <path
            className={styles.exampleTurnArrowHead}
            d="m143 61 10 5-2-11"
          />
          <g className={styles.exampleChoiceCorrect}>
            <rect x="166" y="25" width="64" height="82" rx="13" />
            <path d="m197 39 20 12-20 12Z" />
            <circle cx="184" cy="88" r="10" />
            <rect x="176" y="34" width="25" height="8" rx="4" />
            <circle cx="219" cy="96" r="13" />
            <path d="m213 96 4 4 8-9" />
          </g>
          <g className={styles.exampleChoiceNearMiss}>
            <rect x="246" y="25" width="64" height="82" rx="13" />
            <path d="m277 39 20 12-20 12Z" />
            <circle cx="264" cy="88" r="10" />
            <rect x="276" y="90" width="25" height="8" rx="4" />
          </g>
          <text x="198" y="128">Match</text>
          <text x="278" y="128">Near-match</text>
        </svg>
        <div className={styles.exampleMethod} aria-label="Three-step method">
          <span>Notice a mark</span>
          <span aria-hidden="true">→</span>
          <span>Track its relation</span>
          <span aria-hidden="true">→</span>
          <span>Verify the match</span>
        </div>
      </div>
    </section>
  );
}

export function MathKangarooReviewClient() {
  const progression = useProgressionGameSession(progressionAdapter);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const answerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastPlayIdRef = useRef<string | null>(null);

  const controlled = progression.mode === "controlled"
    ? progression
    : null;
  const current = controlled?.current ?? null;
  const round = current?.round ?? null;
  const roundPhase = controlled?.roundPhase ?? null;
  const currentPlayId = current?.playId ?? null;
  const hasCurrentRound = currentPlayId !== null;
  const showWrong = roundPhase === "feedback";
  const showCorrect = roundPhase === "solved";
  const usesSemanticChoices =
    round?.choices.some(({ displayText }) => displayText !== undefined) ??
    false;
  const illustrationAspect = round
    ? round.illustration.width / round.illustration.height
    : 1;
  const illustrationIsWide = illustrationAspect > 3.5;
  const illustrationStyle = round
    ? {
        maxWidth: `${Math.min(round.illustration.width, 900)}px`,
        ...(illustrationIsWide
          ? {
              minWidth: `${
                Math.min(
                  round.illustration.width,
                  Math.max(640, illustrationAspect * 120),
                )
              }px`,
            }
          : {}),
      }
    : undefined;
  const persistedIndex = controlled
    ? progressionOptionIndexFromAnswerToken(controlled.lastAnswerToken)
    : null;
  const visibleSelectedIndex =
    selectedIndex ??
    (showCorrect ? round?.correctIndex ?? null : persistedIndex);

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

  useEffect(() => {
    const enabled = readSoundPreference();
    if (!enabled) {
      const timer = window.setTimeout(() => setSoundEnabled(false), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (!current || lastPlayIdRef.current === current.playId) return;
    lastPlayIdRef.current = current.playId;
    const saved = progressionOptionIndexFromAnswerToken(
      controlled?.lastAnswerToken,
    );
    const timer = window.setTimeout(() => {
      setSelectedIndex(
        controlled?.roundPhase === "solved"
          ? current.round.correctIndex
          : saved,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [controlled, current]);

  useEffect(() => {
    if (!showWrong || currentPlayId === null) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(() => {
      setRetryReady(true);
      window.requestAnimationFrame(() => {
        retryButtonRef.current?.focus();
      });
    }, reducedMotion ? 1_300 : 2_200);
    return () => window.clearTimeout(timer);
  }, [currentPlayId, showWrong]);

  useEffect(() => {
    if (!controlled) return;
    controlled.setTurboClockPaused(current === null);
    const desiredState =
      current === null || controlled.stage === "redemption-ready"
        ? "blocked"
        : controlled.roundPhase === "answering"
          ? "answering"
          : controlled.roundPhase === "feedback"
            ? "mandatory-feedback"
            : "blocked";
    if (controlled.interactionState !== desiredState) {
      controlled.setInteractionState(desiredState);
    }
  }, [controlled, current]);

  useEffect(() => {
    if (progression.mode !== "redirect") return;
    const query = new URLSearchParams(progression.navigationTarget.query);
    const suffix = query.size ? `?${query.toString()}` : "";
    window.location.assign(
      `${basePath}${progression.navigationTarget.pathname}${suffix}`,
    );
  }, [progression]);

  const chooseAnswer = useCallback(
    (index: number) => {
      if (!controlled || !round || controlled.roundPhase !== "answering") {
        return;
      }
      const correct = index === round.correctIndex;
      setSelectedIndex(index);
      if (soundEnabled) {
        const context = ensureAudio();
        if (context) playFeedbackEarcon(context, correct);
      }
      controlled.answer({
        correct,
        answerToken: `option-${index}`,
      });
    },
    [controlled, ensureAudio, round, soundEnabled],
  );

  const retry = useCallback(() => {
    if (
      !controlled ||
      controlled.roundPhase !== "feedback" ||
      !retryReady
    ) {
      return;
    }
    const attempted = visibleSelectedIndex;
    setRetryReady(false);
    controlled.retry();
    setSelectedIndex(null);
    window.requestAnimationFrame(() => {
      if (attempted !== null) answerRefs.current[attempted]?.focus();
    });
  }, [controlled, retryReady, visibleSelectedIndex]);

  const advance = useCallback(() => {
    if (!controlled || controlled.roundPhase !== "solved") return;
    setSelectedIndex(null);
    controlled.advance();
  }, [controlled]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isEditableTarget(event.target) ||
        controlled?.roundPhase !== "answering"
      ) {
        return;
      }
      const index = Number(event.key) - 1;
      if (index < 0 || index >= 5) return;
      event.preventDefault();
      chooseAnswer(index);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [chooseAnswer, controlled?.roundPhase]);

  useEffect(() => {
    if (!hasCurrentRound) return;
    if (roundPhase === "answering") {
      answerRefs.current[0]?.focus();
    } else if (roundPhase === "solved") {
      nextButtonRef.current?.focus();
    }
  }, [hasCurrentRound, roundPhase]);

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

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    writeSoundPreference(next);
    if (next) ensureAudio();
  }, [ensureAudio, soundEnabled]);

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

  if (progression.mode === "redirect") {
    return (
      <div className={styles.shell}>
        <header className={styles.topbar}>
          <Link className={styles.backLink} href="/journey/">
            ← Journey
          </Link>
          <span className={styles.routeTitle}>Math Kangaroo</span>
          {soundButton}
        </header>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/journey/">
          <span aria-hidden="true">←</span>
          <span>Journey</span>
        </Link>
        <span className={styles.routeTitle}>Math Kangaroo</span>
        {soundButton}
      </header>

      <main className={styles.main}>
        {progression.mode === "recovery" ? (
          <ProgressionRecoveryPanel message={progression.message} />
        ) : progression.mode === "standalone" ? (
          <section
            className={styles.reviewCard}
            aria-labelledby="mk-journey-only-title"
          >
            <p className={styles.reviewKicker}>Journey spatial review</p>
            <h1 id="mk-journey-only-title">Math Kangaroo</h1>
            <p>
              These reviewed questions live inside your Journey so progress,
              redemption, and missed-question history stay together.
            </p>
            <Link className={styles.primaryButton} href="/journey/">
              Return to Journey
            </Link>
          </section>
        ) : progression.mode === "booting" ? (
          <p className={styles.status} role="status">
            Opening your saved question…
          </p>
        ) : controlled?.sectionIntro ? (
          <div className={styles.round}>
            <SolvedExample />
            <ProgressionCulminationSectionIntro
              gameTitle="Math Kangaroo"
              section={controlled.sectionIntro}
              onBegin={controlled.beginSection}
            />
          </div>
        ) : controlled ? (
          <div className={styles.round}>
            <ProgressionGameHud
              mode={controlled.runKind}
              levelLabel={journeyLevelLabel(
                controlled.attempt.journeyLevel,
              )}
              current={controlled.currentQuestionNumber}
              total={controlled.totalQuestions}
              redemption={controlled.isRedemption}
            />

            {controlled.stage === "redemption-ready" ? (
              <ProgressionRedemptionIntro
                attempt={controlled.attempt}
                onBegin={controlled.beginRedemption}
              />
            ) : round ? (
              <>
                <section
                  className={styles.promptPanel}
                  aria-labelledby="mk-question-title"
                >
                  <p className={styles.reviewKicker}>
                    Visual-spatial challenge
                  </p>
                  <h1 className={styles.prompt} id="mk-question-title">
                    {round.prompt}
                  </h1>
                  <div
                    className={[
                      styles.illustrationFrame,
                      illustrationIsWide
                        ? styles.illustrationFrameScrollable
                        : "",
                    ].filter(Boolean).join(" ")}
                    role={illustrationIsWide ? "region" : undefined}
                    tabIndex={illustrationIsWide ? 0 : undefined}
                    aria-label={
                      illustrationIsWide
                        ? usesSemanticChoices
                          ? "Scrollable puzzle illustration; the answer choices are listed below"
                          : "Scrollable puzzle illustration with five answer choices"
                        : undefined
                    }
                  >
                    {/* The private source build emits only selected, local,
                        question-scoped illustrations into this route. */}
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
                      {usesSemanticChoices
                        ? "Scroll sideways to inspect the full diagram."
                        : "Scroll sideways to inspect all five choices."}
                    </p>
                  ) : null}
                </section>

                <section
                  className={styles.answerGroup}
                  aria-labelledby="mk-answer-label"
                >
                  <p className={styles.answerLabel} id="mk-answer-label">
                    Choose an answer
                  </p>
                  <div
                    className={[
                      styles.answers,
                      usesSemanticChoices ? styles.answersText : "",
                    ].filter(Boolean).join(" ")}
                  >
                    {round.choices.map((choice, index) => {
                      const selected = visibleSelectedIndex === index;
                      const correct = showCorrect &&
                        index === round.correctIndex;
                      const wrong = showWrong && selected;
                      const muted =
                        (showWrong || showCorrect) && !wrong && !correct;
                      return (
                        <button
                          className={[
                            styles.answerButton,
                            usesSemanticChoices
                              ? styles.answerButtonText
                              : "",
                            wrong ? styles.answerSelectedWrong : "",
                            correct ? styles.answerCorrect : "",
                            muted ? styles.answerMuted : "",
                          ].filter(Boolean).join(" ")}
                          type="button"
                          onClick={() => chooseAnswer(index)}
                          disabled={controlled.roundPhase !== "answering"}
                          aria-keyshortcuts={String(index + 1)}
                          aria-label={`${choice.accessibleLabel}${
                            wrong
                              ? ", not quite"
                              : correct
                                ? ", correct"
                                : ""
                          }`}
                          ref={(node) => {
                            answerRefs.current[index] = node;
                          }}
                          key={index}
                        >
                          {usesSemanticChoices ? (
                            <>
                              <span
                                className={styles.answerIndex}
                                aria-hidden="true"
                              >
                                {index + 1}
                              </span>
                              <span className={styles.answerDisplayText}>
                                {choice.displayText}
                              </span>
                            </>
                          ) : (
                            choice.label
                          )}
                          {wrong ? (
                            <span
                              className={styles.answerResult}
                              aria-hidden="true"
                            >
                              ×
                            </span>
                          ) : null}
                          {correct ? (
                            <span
                              className={styles.answerResult}
                              aria-hidden="true"
                            >
                              ✓
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>

                {showWrong ? (
                  <section
                    className={`${styles.feedbackPanel} ${styles.feedbackWrong}`}
                    aria-labelledby="mk-feedback-title"
                  >
                    <span className={styles.feedbackMark} aria-hidden="true">
                      ×
                    </span>
                    <div className={styles.feedbackContent} role="status">
                      <p className={styles.reviewKicker}>Good thinking</p>
                      <h2 id="mk-feedback-title">
                        Check one more visual detail.
                      </h2>
                      <p>{round.explanation.wrongAnswerHint}</p>
                    </div>
                    <button
                      className={styles.primaryButton}
                      type="button"
                      onClick={retry}
                      disabled={!retryReady}
                      ref={retryButtonRef}
                    >
                      {retryReady ? "Try again" : "Look closely…"}
                    </button>
                  </section>
                ) : showCorrect ? (
                  <section
                    className={`${styles.feedbackPanel} ${styles.feedbackCorrect}`}
                    aria-labelledby="mk-feedback-title"
                  >
                    <span className={styles.feedbackMark} aria-hidden="true">
                      ✓
                    </span>
                    <div className={styles.feedbackContent} role="status">
                      <p className={styles.reviewKicker}>Correct</p>
                      <h2 id="mk-feedback-title">
                        {round.explanation.headline}
                      </h2>
                    </div>
                    <MkExplanationAnimation
                      illustration={round.illustration}
                      choices={round.choices}
                      visual={round.explanation.visualExplanation}
                      fallbackBeats={round.explanation.animationBeats}
                    />
                    <ol className={styles.explanationSteps}>
                      {round.explanation.steps.map((step, index) => (
                        <li key={`${round.id}-step-${index}`}>{step}</li>
                      ))}
                    </ol>
                    <p className={styles.sourceNote}>
                      Official Cyprus competition, {round.source.year};
                      answer checked against the official key.
                    </p>
                    <button
                      className={styles.primaryButton}
                      type="button"
                      onClick={advance}
                      ref={nextButtonRef}
                    >
                      Continue <span aria-hidden="true">→</span>
                    </button>
                  </section>
                ) : (
                  <p className={styles.status} aria-live="polite">
                    Use buttons 1–5 or the matching number keys.
                  </p>
                )}
              </>
            ) : (
              <p className={styles.status} role="status">
                Preparing the next question…
              </p>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
