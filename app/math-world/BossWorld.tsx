"use client";

import { useEffect, useRef, useState } from "react";
import type { BossChallenge } from "./boss-challenges.ts";
import { printBossWorkbook } from "./boss-workbook.ts";
import { canOpenWorld, type WorldProgress } from "./engine.ts";
import { WORLD_DEFINITIONS } from "./world-data.ts";
import { WorldNavigation } from "./WorldNavigation";
import { StormArtwork } from "./StormArtwork";
import styles from "./math-world.module.css";

export function BossWorld({ challenge, progress, qaUnlocked, onChooseWorld, onChooseBoss }: Readonly<{
  challenge: BossChallenge;
  progress: WorldProgress;
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
    <WorldNavigation selectedId={challenge.id} progress={progress} qaUnlocked={qaUnlocked} busy={printing}
      onChooseWorld={onChooseWorld} onChooseBoss={onChooseBoss} />
    {qaUnlocked && <div className={`${styles.testNotice} ${styles.bossTestNotice}`} role="status"><strong>Test mode · all paths open</strong><span>Both storm challenges are available.</span></div>}
    <section className={styles.bossPlaceholder} aria-labelledby="boss-title">
      <StormArtwork className={styles.bossStormArtwork} />
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
      <div className={styles.bossComingSoon}><strong>Take on the storm, one question at a time</strong><p>{challenge.afterWorld === WORLD_DEFINITIONS.length ? "Beyond this storm lies an uncharted horizon. " : "This storm guards the crossing to the next archipelago. "}Answer entry is coming later. For now, print the whole test and work through it on paper.</p></div>
      {onward && <button type="button" className={styles.primaryButton}
        disabled={printing || !canOpenWorld(progress, onward.id, qaUnlocked)} onClick={() => onChooseWorld(onward.id)}>
        {challenge.afterWorld < WORLD_DEFINITIONS.length ? `Continue to World ${onward.number}` : `Back to World ${onward.number}`} <span aria-hidden="true">→</span>
      </button>}
    </section>
  </main>;
}
