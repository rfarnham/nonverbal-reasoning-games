"use client";

import { useEffect, useId, useRef } from "react";
import type { BossChallenge } from "./boss-challenges.ts";
import type { BossAttempt } from "./boss-progress.ts";
import styles from "./storm-answer-sheet.module.css";

type Props = Readonly<{
  challenge: BossChallenge;
  attempt: BossAttempt;
  onAnswer: (questionIndex: number, answer: number) => void;
  onSubmit: () => void;
}>;

const LETTERS = ["A", "B", "C", "D", "E"] as const;

/** The paper workbook and this answer sheet share the original question order. */
export default function StormAnswerSheet({ challenge, attempt, onAnswer, onSubmit }: Props) {
  const prefix = useId();
  const status = useRef<HTMLHeadingElement>(null);
  const answered = attempt.answers.filter(answer => Number.isInteger(answer) && answer !== null && answer >= 0 && answer < LETTERS.length).length;
  const complete = attempt.answers.length === challenge.questionCount && answered === challenge.questionCount;
  const submitted = complete && typeof attempt.submittedAt === "string" && Number.isFinite(Date.parse(attempt.submittedAt));
  const wasSubmitted = useRef(submitted);
  useEffect(() => {
    if (submitted && !wasSubmitted.current) status.current?.focus();
    wasSubmitted.current = submitted;
  }, [submitted]);

  return <section className={styles.sheet} aria-labelledby={`${prefix}-heading`} data-storm-answer-sheet={challenge.id}>
    <h2 id={`${prefix}-heading`} ref={status} tabIndex={-1}>{submitted ? "Safe course charted" : "Chart a safe course"}</h2>
    <p>{submitted
      ? "Your workbook answers are submitted. The storm crossing is clear. You can review your answers below."
      : `Solve the workbook, then enter your A–E answers here. Submit all ${challenge.questionCount} answers to chart a safe course through the storm.`}</p>
    <p className={styles.progress} role="status">{submitted ? `${challenge.questionCount} answers submitted` : `${answered} of ${challenge.questionCount} answers entered`}</p>
    <form onSubmit={event => { event.preventDefault(); if (complete && !submitted) onSubmit(); }}>
      <div className={styles.questions}>
        {Array.from({ length: challenge.questionCount }, (_, questionIndex) => <fieldset className={styles.question} key={questionIndex} disabled={submitted}>
          <legend>Question {questionIndex + 1}</legend>
          <div className={styles.choices}>
            {LETTERS.map((letter, answer) => <label className={styles.choice} key={letter}>
              <input type="radio" name={`${prefix}-question-${questionIndex}`} value={letter} checked={attempt.answers[questionIndex] === answer}
                onChange={() => onAnswer(questionIndex, answer)} aria-label={`Question ${questionIndex + 1}, ${letter}`} />
              <span>{letter}{attempt.answers[questionIndex] === answer && <b aria-hidden="true">✓</b>}</span>
            </label>)}
          </div>
        </fieldset>)}
      </div>
      {!submitted && <div className={styles.submitRow}>
        <p>{complete ? "Check your answers, then submit your course." : "You can leave and return to finish your answer sheet."}</p>
        <button type="submit" disabled={!complete}>Submit workbook answers</button>
      </div>}
    </form>
  </section>;
}
