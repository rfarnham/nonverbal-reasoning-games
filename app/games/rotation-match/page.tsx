"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { rotationMatchGame } from "./game-info";
import {
  ROUNDS,
  describePattern,
  patternKey,
  rotatePattern,
  type Pattern,
} from "./game-engine";
import styles from "./rotation-match.module.css";

function PatternGrid({
  pattern,
  size,
  label,
  hidden = false,
}: {
  pattern: Pattern;
  size: "clue" | "option" | "result";
  label?: string;
  hidden?: boolean;
}) {
  return (
    <div
      className={`${styles.pattern} ${styles[size]}`}
      role={hidden ? undefined : "img"}
      aria-label={hidden ? undefined : label}
      aria-hidden={hidden || undefined}
    >
      {pattern.map((tile, index) => (
        <span
          className={`${styles.tile} ${styles[tile]}`}
          aria-hidden="true"
          key={`${index}-${tile}`}
        />
      ))}
    </div>
  );
}

export default function RotationMatchPage() {
  const [roundIndex, setRoundIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [complete, setComplete] = useState(false);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const focusFirstOption = useRef(false);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  const round = ROUNDS[roundIndex];
  const selectedCorrect = selectedIndex === round.correctIndex;
  const answered = roundIndex + (selectedIndex === null ? 0 : 1);

  const chooseOption = useCallback(
    (optionIndex: number) => {
      if (selectedIndex !== null || complete) return;

      setSelectedIndex(optionIndex);
      if (optionIndex === round.correctIndex) {
        setScore((current) => current + 1);
        setStreak((current) => {
          const nextStreak = current + 1;
          setBestStreak((best) => Math.max(best, nextStreak));
          return nextStreak;
        });
      } else {
        setStreak(0);
      }
    },
    [complete, round.correctIndex, selectedIndex],
  );

  const goNext = useCallback(() => {
    if (selectedIndex === null) return;

    if (roundIndex === ROUNDS.length - 1) {
      setComplete(true);
      setSelectedIndex(null);
      return;
    }

    focusFirstOption.current = true;
    setRoundIndex((current) => current + 1);
    setSelectedIndex(null);
  }, [roundIndex, selectedIndex]);

  const restart = useCallback(() => {
    focusFirstOption.current = true;
    setRoundIndex(0);
    setSelectedIndex(null);
    setScore(0);
    setStreak(0);
    setBestStreak(0);
    setComplete(false);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        complete ||
        selectedIndex !== null ||
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
  }, [chooseOption, complete, selectedIndex]);

  useEffect(() => {
    if (selectedIndex !== null) nextButtonRef.current?.focus();
  }, [selectedIndex]);

  useEffect(() => {
    if (focusFirstOption.current) {
      firstOptionRef.current?.focus();
      focusFirstOption.current = false;
    }
  }, [roundIndex]);

  useEffect(() => {
    if (complete) resultHeadingRef.current?.focus();
  }, [complete]);

  const resultMessage = useMemo(() => {
    const accuracy = score / ROUNDS.length;
    if (accuracy === 1) return "Flawless rotation sense.";
    if (accuracy >= 0.75) return "Your mental turns are sharp.";
    if (accuracy >= 0.5) return "A strong start—another run will lock it in.";
    return "Reflections are sneaky. Slow down and track one corner tile.";
  }, [score]);

  return (
    <div className={styles.pageShell}>
      <div className={styles.ambientOne} aria-hidden="true" />
      <div className={styles.ambientTwo} aria-hidden="true" />

      <header className={styles.topbar}>
        <Link className={styles.backLink} href="/">
          <span aria-hidden="true">←</span>
          <span>All games</span>
        </Link>
        <span className={styles.gameNumber}>Game 01</span>
      </header>

      <main className={styles.main}>
        {!complete ? (
          <>
            <section className={styles.gameHeading} aria-labelledby="game-title">
              <div>
                <p className={styles.eyebrow}>Spatial workout</p>
                <h1 id="game-title">{rotationMatchGame.title}</h1>
                <p className={styles.intro}>{rotationMatchGame.description}</p>
              </div>

              <dl className={styles.scoreboard} aria-label="Current game score">
                <div>
                  <dt>Score</dt>
                  <dd>{score}</dd>
                </div>
                <div>
                  <dt>Streak</dt>
                  <dd>{streak}</dd>
                </div>
              </dl>
            </section>

            <div className={styles.progressBlock}>
              <div className={styles.progressLabels}>
                <span>
                  Round {roundIndex + 1} of {ROUNDS.length}
                </span>
                <span>{answered} complete</span>
              </div>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label="Game progress"
                aria-valuemin={0}
                aria-valuemax={ROUNDS.length}
                aria-valuenow={answered}
              >
                {ROUNDS.map((_, index) => (
                  <span
                    className={index < answered ? styles.progressDone : undefined}
                    key={index}
                  />
                ))}
              </div>
            </div>

            <div className={styles.gameBoard}>
              <section className={styles.cluePanel} aria-labelledby="clue-title">
                <div className={styles.panelTopline}>
                  <span className={styles.stepBadge}>01</span>
                  <span>Study the pattern</span>
                </div>

                <div className={styles.clueCopy}>
                  <h2 id="clue-title">Turn it in your mind.</h2>
                  <p>
                    Find this exact arrangement after a rotation. A mirror image
                    does not count.
                  </p>
                </div>

                <div className={styles.clueStage}>
                  <div className={styles.rotationCue} aria-hidden="true">
                    <span>↻</span>
                    <small>{round.turn}</small>
                  </div>
                  <PatternGrid
                    pattern={round.clue}
                    size="clue"
                    label={`Pattern to rotate: ${describePattern(round.clue)}`}
                  />
                </div>

                <p className={styles.tip}>
                  <span aria-hidden="true">◎</span>
                  Tip: anchor one corner tile, then follow its neighbors.
                </p>
              </section>

              <section className={styles.answerPanel} aria-labelledby="answer-title">
                <div className={styles.panelTopline}>
                  <span className={styles.stepBadge}>02</span>
                  <span>Choose the match</span>
                  <span className={styles.keyHint}>Keys 1–4</span>
                </div>

                <h2 id="answer-title" className={styles.visuallyHidden}>
                  Four answer choices
                </h2>

                <div className={styles.optionGrid} role="group" aria-label="Answer choices">
                  {round.options.map((option, optionIndex) => {
                    const isCorrect = optionIndex === round.correctIndex;
                    const isSelected = selectedIndex === optionIndex;
                    const showCorrect = selectedIndex !== null && isCorrect;
                    const showWrong = isSelected && !isCorrect;
                    const muted =
                      selectedIndex !== null && !isCorrect && !isSelected;

                    return (
                      <button
                        className={`${styles.optionButton} ${
                          showCorrect ? styles.correctOption : ""
                        } ${showWrong ? styles.wrongOption : ""} ${
                          muted ? styles.mutedOption : ""
                        }`}
                        type="button"
                        onClick={() => chooseOption(optionIndex)}
                        disabled={selectedIndex !== null}
                        aria-label={`Option ${optionIndex + 1}: ${describePattern(option)}`}
                        aria-keyshortcuts={`${optionIndex + 1}`}
                        ref={optionIndex === 0 ? firstOptionRef : undefined}
                        key={patternKey(option)}
                      >
                        <span className={styles.optionNumber} aria-hidden="true">
                          {optionIndex + 1}
                        </span>
                        <PatternGrid pattern={option} size="option" hidden />
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

                <div
                  className={`${styles.feedback} ${
                    selectedIndex === null
                      ? styles.feedbackWaiting
                      : selectedCorrect
                        ? styles.feedbackCorrect
                        : styles.feedbackWrong
                  }`}
                  aria-live="polite"
                  role="status"
                >
                  {selectedIndex === null ? (
                    <p>Choose the grid that keeps every tile in the same order.</p>
                  ) : (
                    <>
                      <div>
                        <strong>
                          {selectedCorrect ? "That’s the rotation." : "Close—check the mirror."}
                        </strong>
                        <span>
                          {selectedCorrect
                            ? "Every tile kept the same relationship."
                            : `The true match is option ${round.correctIndex + 1}.`}
                        </span>
                      </div>
                      <button
                        className={styles.nextButton}
                        type="button"
                        onClick={goNext}
                        ref={nextButtonRef}
                      >
                        {roundIndex === ROUNDS.length - 1
                          ? "See results"
                          : "Next round"}
                        <span aria-hidden="true">→</span>
                      </button>
                    </>
                  )}
                </div>
              </section>
            </div>
          </>
        ) : (
          <section className={styles.results} aria-labelledby="results-title">
            <div className={styles.resultMotif} aria-hidden="true">
              <PatternGrid
                pattern={rotatePattern(ROUNDS[0].clue, 1)}
                size="result"
                hidden
              />
            </div>
            <p className={styles.eyebrow}>Workout complete</p>
            <h1 id="results-title" ref={resultHeadingRef} tabIndex={-1}>
              {resultMessage}
            </h1>
            <p className={styles.resultIntro}>
              You found {score} of {ROUNDS.length} rotations and reached a best
              streak of {bestStreak}.
            </p>

            <div className={styles.resultScore} aria-label={`${score} out of ${ROUNDS.length}`}>
              <span>{score}</span>
              <small>out of {ROUNDS.length}</small>
            </div>

            <div className={styles.resultActions}>
              <button className={styles.restartButton} type="button" onClick={restart}>
                Play again
                <span aria-hidden="true">↻</span>
              </button>
              <Link className={styles.secondaryLink} href="/">
                Back to all games
              </Link>
            </div>

            <p className={styles.resultTip}>
              Next run: name a corner in your head and track it through the turn.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
