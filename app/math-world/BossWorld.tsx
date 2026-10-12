"use client";

import { useEffect, useRef, useState } from "react";
import type { BossChallenge } from "./boss-challenges.ts";
import { printBossWorkbook } from "./boss-workbook.ts";
import { type WorldProgress } from "./engine.ts";
import { WORLD_DEFINITIONS } from "./world-data.ts";
import { WorldNavigation } from "./WorldNavigation";
import { StormArtwork } from "./StormArtwork";
import { CalmPassageArtwork } from "./CalmPassageArtwork";
import StormAnswerSheet from "./StormAnswerSheet";
import { bossAttempt, hasSubmittedBoss, type BossProgress } from "./boss-progress.ts";
import styles from "./math-world.module.css";

export function BossWorld({ challenge, progress, bossProgress, qaUnlocked, onChooseWorld, onChooseBoss, canNavigate, onBossAnswer, onSubmitBoss }: Readonly<{
  challenge: BossChallenge;
  progress: WorldProgress;
  bossProgress: BossProgress;
  canNavigate: (id: string) => boolean;
  onBossAnswer: (index: number, answer: number) => void;
  onSubmitBoss: () => void;
  qaUnlocked: boolean;
  onChooseWorld: (worldId: string) => void;
  onChooseBoss: (challenge: BossChallenge) => void;
}>) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(true);
  const printingRef = useRef(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const onward = WORLD_DEFINITIONS.find(world => world.number === Math.min(challenge.afterWorld + 1, WORLD_DEFINITIONS.length));
  const submitted = hasSubmittedBoss(bossProgress, challenge.id);

  useEffect(() => {
    mountedRef.current = true;
    headingRef.current?.focus({ preventScroll: true });
    return () => { mountedRef.current = false; };
  }, []);

  async function prepareWorkbook() {
    if (printingRef.current) return;
    printingRef.current = true;
    setPrinting(true);
    setPrintError(null);
    try {
      await printBossWorkbook(challenge);
    } catch (error) {
      if (mountedRef.current) setPrintError(error instanceof Error && error.message
        ? error.message : "We couldn’t prepare the test workbook. Please try again.");
    } finally {
      printingRef.current = false;
      if (mountedRef.current) setPrinting(false);
    }
  }

  return <main className={styles.worldShell} data-boss-id={challenge.id}>
    <WorldNavigation selectedId={challenge.id} progress={progress} bossProgress={bossProgress} qaUnlocked={qaUnlocked} busy={printing}
      canNavigate={canNavigate} onChooseWorld={onChooseWorld} onChooseBoss={onChooseBoss} />
    {qaUnlocked && <div className={`${styles.testNotice} ${styles.bossTestNotice}`} role="status"><strong>Test mode · all paths open</strong><span>Both storm challenges are available.</span></div>}
    <section className={styles.bossPlaceholder} aria-labelledby="boss-title">
      {submitted ? <CalmPassageArtwork className={styles.bossStormArtwork} /> : <StormArtwork className={styles.bossStormArtwork} />}
      <p className={styles.kicker}>After World {challenge.afterWorld} · Storm challenge</p>
      <h1 id="boss-title" ref={headingRef} tabIndex={-1}>{challenge.title}</h1>
      <p className={styles.bossTestDetails}>Math Kangaroo {challenge.year} · Grades 1–2 · {challenge.questionCount} questions</p>
      <p className={styles.bossDescription}>A full test to bring your learning together. Print the workbook and work through it with pencil and paper.</p>
      <button type="button" className={styles.workbookButton} disabled={printing} aria-busy={printing}
        aria-label={printing ? `Preparing ${challenge.year} full test workbook` : `Print whole ${challenge.year} test workbook`}
        onClick={() => void prepareWorkbook()}>
        {printing ? <span className={styles.workbookSpinner} aria-hidden="true" /> : <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M5 7V2.5h10V7M5 14H2.5V7h15v7H15M5 11.5h10v6H5Z"/><path d="M14.5 9h.5" strokeLinecap="round"/></svg>}
        {printing ? "Preparing workbook…" : "Print whole test workbook"}
      </button>
      <p className={styles.srOnly} role="status">{printing ? `Preparing all ${challenge.questionCount} questions from the ${challenge.year} test…` : ""}</p>
      {printError && <p className={styles.bossPrintError} role="alert">{printError}</p>}
      <StormAnswerSheet challenge={challenge} attempt={bossAttempt(bossProgress, challenge.id)} onAnswer={onBossAnswer} onSubmit={onSubmitBoss} />
      {onward && <button type="button" className={styles.primaryButton}
        disabled={printing || !canNavigate(onward.id)} onClick={() => onChooseWorld(onward.id)}>
        {challenge.afterWorld < WORLD_DEFINITIONS.length ? `Continue to World ${onward.number}` : `Back to World ${onward.number}`} <span aria-hidden="true">→</span>
      </button>}
    </section>
  </main>;
}
