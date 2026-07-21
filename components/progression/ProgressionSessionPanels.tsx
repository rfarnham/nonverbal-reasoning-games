"use client";

import Link from "next/link";
import { useEffect, useId, useRef } from "react";

import type { ProgressionAttempt } from "@/lib/progression";
import type { ProgressionCulminationSectionIntro as SectionIntro } from "./useProgressionGameSession";

import styles from "./progression-session-panels.module.css";

export function ProgressionRecoveryPanel({
  message,
}: Readonly<{ message: string }>) {
  return (
    <section className={styles.panel} aria-labelledby="journey-recovery-title">
      <p className={styles.kicker}>Journey pause</p>
      <h1 id="journey-recovery-title">Your trail is safe.</h1>
      <p>{message}</p>
      <Link className={styles.primary} href="/journey/">
        Return to Journey
      </Link>
    </section>
  );
}

export function ProgressionCulminationSectionIntro({
  gameTitle,
  section,
  onBegin,
}: Readonly<{
  gameTitle: string;
  section: SectionIntro;
  onBegin: () => void;
}>) {
  const labelId = useId();
  const descriptionId = useId();
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      primaryButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={styles.sectionIntro}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
    >
      <p className={styles.sectionLabel} id={labelId}>
        Level challenge · Game {section.current} of {section.total}
      </p>
      <p className={styles.sectionCopy} id={descriptionId}>
        Take a moment with this solved example. Begin the next{" "}
        {section.questionCount} questions when you’re ready.
      </p>
      <button
        className={styles.primary}
        type="button"
        onClick={onBegin}
        ref={primaryButtonRef}
      >
        Begin {gameTitle} <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}

export function ProgressionRedemptionIntro({
  attempt,
  onBegin,
}: Readonly<{
  attempt: ProgressionAttempt;
  onBegin: () => void;
}>) {
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const missed = attempt.rounds.filter(
    ({ firstTryCorrect }) => firstTryCorrect === false,
  );
  const gameCount = new Set(
    missed.map(({ question }) => question.gameSlug),
  ).size;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      primaryButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [attempt.id]);

  return (
    <section className={styles.panel} aria-labelledby="redemption-title">
      <span className={styles.badge} aria-hidden="true">
        ↻
      </span>
      <p className={styles.kicker}>Full stop complete</p>
      <h1 id="redemption-title">Here’s your chance at redemption.</h1>
      <p>
        You made it through every question. Revisit{" "}
        <strong>{missed.length}</strong>{" "}
        {missed.length === 1 ? "puzzle" : "puzzles"}
        {gameCount > 1 ? ` across ${gameCount} games` : ""}, one at a time,
        and turn each into a win.
      </p>
      <button
        className={styles.primary}
        type="button"
        onClick={onBegin}
        ref={primaryButtonRef}
      >
        Review Mistakes <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}
