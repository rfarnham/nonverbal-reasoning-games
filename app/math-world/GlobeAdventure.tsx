"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GlobeBoard, type GlobeBoardHandle } from "./GlobeBoard";
import { WorldNavigation } from "./WorldNavigation";
import { BOSS_CHALLENGES, bossAfterWorld, type BossChallenge } from "./boss-challenges.ts";
import { canOpenRequiredStop, nextRequiredStopId, stopFirstTryAccuracy, type WorldProgress } from "./engine.ts";
import { QUESTIONS_BY_STOP, WORLD_DEFINITIONS, stopsForWorld, type WorldDefinition } from "./world-data.ts";
import { printWorldWorkbook, printDangerWorkbook } from "./workbook.ts";
import { printBossWorkbook } from "./boss-workbook.ts";
import { StoryPage } from "./StoryPage";
import { FIRST_WORLD_STORY } from "./story-content.ts";
import { advanceStoryPage, automaticStoryPage, markStoryBookRead, type AutomaticStoryPage, type WorldStoryProgress } from "./story-progress.ts";
import { dangerAfterWorld, dangerById, dangerSceneryStages, hasCrossedDanger, type DangerDefinition } from "./danger-definitions.ts";
import { DANGER_STORIES } from "./danger-content.ts";
import { dangerPacketQuestions, dangerPacketAccuracy, type DangerState, type DangerPacket } from "./danger-engine.ts";
import shell from "./math-world.module.css";
import styles from "./globe.module.css";

type Props = {
  danger: DangerDefinition | null; dangerState: DangerState;
  onChooseDanger: (danger: DangerDefinition) => void; canNavigate: (id: string) => boolean;
  onPrepareDanger: () => DangerPacket | undefined; onOpenDanger: () => void;
  world: WorldDefinition; boss: BossChallenge | null; progress: WorldProgress; qaUnlocked: boolean;
  avatarStopId: string | null; onChooseWorld: (id: string) => void; onChooseBoss: (boss: BossChallenge) => void;
  onOpenStop: (id: string) => void; onInspectStop: (id: string) => void; onExportQa: () => void;
  storyProgress: WorldStoryProgress; onStoryProgress: (next: WorldStoryProgress) => void;
};

export function GlobeAdventure(props: Props) {
  const { world, boss, danger, progress, qaUnlocked } = props;
  const boardRef = useRef<GlobeBoardHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const storyRef = useRef<HTMLDialogElement>(null);
  const storyOpener = useRef<HTMLButtonElement | null>(null);
  const [readDangerId, setReadDangerId] = useState<string | null>(null);
  const packet = danger ? props.dangerState.packets[danger.id] : undefined;
  const dangerBriefing = !!danger && !packet?.briefingRead && readDangerId !== danger.id;
  const [revisitDanger, setRevisitDanger] = useState(false);
  const [story, setStory] = useState<number | null>(null);
  const [preview, setPreview] = useState<AutomaticStoryPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const mounted = useRef(true), printingRef = useRef(false);
  const [initialOverview] = useState(() => !danger && !boss && !props.avatarStopId && !progress.checkpointStopId && Object.keys(progress.stopAttempts).length === 0);
  const destinationId = danger?.id ?? boss?.id ?? world.id;
  const stops = stopsForWorld(world.id);
  const completedCount = stops.filter(stop => progress.completedStopIds.includes(stop.id)).length;
  const complete = completedCount === stops.length;
  const questions = stops.reduce((sum, stop) => sum + (QUESTIONS_BY_STOP.get(stop.id)?.length ?? 0), 0);
  const checkpoint = stops.find(stop => stop.id === progress.checkpointStopId);
  const nextStopId = nextRequiredStopId(progress, world.id);
  const nextBoss = bossAfterWorld(danger?.afterWorld ?? world.number);
  const nextDanger = !boss && !danger ? dangerAfterWorld(world.number) : undefined;
  const nextWorld = WORLD_DEFINITIONS.find(candidate => candidate.number === (danger ? Math.min(danger.afterWorld + 1, WORLD_DEFINITIONS.length) : boss ? Math.min(boss.afterWorld + 1, WORLD_DEFINITIONS.length) : world.number + 1));
  const onBusyChange = useCallback((value: boolean) => setBusy(value), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [destinationId]);
  useEffect(() => {
    const closeReading = () => { storyRef.current?.close(); setPreview(null); setStory(null); setRevisitDanger(false); };
    window.addEventListener("popstate", closeReading);
    return () => window.removeEventListener("popstate", closeReading);
  }, []);
  useEffect(() => { if (world.number !== 1 && story !== null && !storyRef.current?.open) storyRef.current?.showModal(); }, [story, world.number]);
  const automaticPage = automaticStoryPage(props.storyProgress, progress, world.id, !!boss || !!danger);
  const chapterStage = preview ?? automaticPage;
  const chapterPage = chapterStage && chapterStage !== "shattering" ? FIRST_WORLD_STORY[chapterStage] : null;
  const bookPage = world.number === 1 && story !== null ? (story === 0 ? FIRST_WORLD_STORY.book1 : FIRST_WORLD_STORY.book2) : null;
  const reading = dangerBriefing || (!!danger && revisitDanger) || !!chapterStage || story !== null;
  function continueChapter() {
    if (!chapterStage) return;
    if (preview) setPreview(preview === "fracture" ? "shattering" : preview === "shattering" ? "appeal" : null);
    else props.onStoryProgress(advanceStoryPage(props.storyProgress, chapterStage));
  }
  function closeBook() {
    if (story !== null) props.onStoryProgress(markStoryBookRead(props.storyProgress, story));
    setStory(null);
    requestAnimationFrame(() => { if (storyOpener.current?.isConnected) storyOpener.current.focus({ preventScroll: true }); });
  }
  function navigate(id: string) {
    storyRef.current?.close();
    setPreview(null); setStory(null);
    setPrintError(null); setRevisitDanger(false);
    const targetDanger = dangerById(id);
    if (targetDanger) { props.onChooseDanger(targetDanger); return; }
    const targetBoss = BOSS_CHALLENGES.find(candidate => candidate.id === id);
    if (targetBoss) props.onChooseBoss(targetBoss); else props.onChooseWorld(id);
  }
  async function print() {
    if (printingRef.current || busy) return;
    printingRef.current = true; setPrinting(true); setPrintError(null);
    try { if (danger) { const prepared = props.onPrepareDanger(); if (prepared?.questionIds.length) await printDangerWorkbook(danger.title, danger.id, dangerPacketQuestions(prepared)); } else if (boss) await printBossWorkbook(boss); else await printWorldWorkbook(world); }
    catch (error) { if (mounted.current) setPrintError(error instanceof Error ? error.message : "The workbook could not be prepared. Please try again."); }
    finally { printingRef.current = false; if (mounted.current) setPrinting(false); }
  }
  return <main className={styles.adventure} data-world-id={boss || danger ? undefined : world.id} data-danger-id={danger?.id} data-boss-id={boss?.id}>
    <WorldNavigation selectedId={destinationId} progress={progress} qaUnlocked={qaUnlocked} busy={busy || printing || reading}
      canNavigate={props.canNavigate} onChooseDanger={danger => boardRef.current?.sailTo(danger.id)} onChooseWorld={id => boardRef.current?.sailTo(id)} onChooseBoss={boss => boardRef.current?.sailTo(boss.id)} />
    <header className={styles.destinationHeader}>
      <div><p className={styles.kicker}>{danger ? `After World ${danger.afterWorld} · Danger crossing` : boss ? `After World ${boss.afterWorld} · Storm challenge` : `World ${world.number} · ${world.concept} ${world.spiral}`}</p>
        <h1 ref={headingRef} tabIndex={-1}>{danger?.title ?? boss?.title ?? world.title}</h1>
        <p className={styles.description}>{danger ? "Revisit familiar puzzles, then try related challenges. Take all the time you need." : boss ? `Math Kangaroo ${boss.year} · Grades 1–2 · 24 questions` : world.description}</p>
      </div>
      <button type="button" className={styles.printButton} disabled={busy || printing || reading} aria-busy={printing}
        aria-label={printing ? "Preparing workbook" : danger ? `Print danger packet for ${danger.title}` : boss ? `Print whole ${boss.year} test workbook` : `Print workbook for ${world.title}`}
        onClick={() => void print()}><span aria-hidden="true">▤</span>{printing ? "Preparing workbook…" : danger ? packet ? "Print review packet" : "Prepare & print packet" : boss ? "Print whole test workbook" : "Print workbook"}</button>
    </header>
    {printError && <p role="alert" className={styles.error}>{printError}</p>}
    {qaUnlocked && <p className={styles.testNotice}><strong>Test mode</strong><span>Every destination is unlocked. Select a danger to preview it; other dangers follow your progress. Your adventure progress stays separate.</span></p>}
    {!boss && !danger && <div className={styles.progressRow}><span>{completedCount} / {stops.length} stops explored</span><progress aria-label={`${world.title} completion`} max={stops.length} value={completedCount} /><span>{questions} questions · Untimed</span></div>}
    {checkpoint && !boss && !danger && <div className={styles.completion} role="status"><span aria-hidden="true">✓</span><div><strong>{complete ? "Archipelago complete!" : `${checkpoint.shortLabel} complete!`}</strong><p>{QUESTIONS_BY_STOP.get(checkpoint.id)?.length} questions solved · {stopFirstTryAccuracy(progress.stopAttempts[checkpoint.id], QUESTIONS_BY_STOP.get(checkpoint.id) ?? [])}% first-try accuracy</p></div></div>}
    <GlobeBoard ref={boardRef} danger={danger} dangerStages={dangerSceneryStages(progress, props.dangerState, qaUnlocked, destinationId)} canNavigate={props.canNavigate} onOpenDanger={props.onOpenDanger} dangerReady={!!packet?.briefingRead} dangerComplete={!!packet?.completedAt} world={world} boss={boss} progress={progress} qaUnlocked={qaUnlocked}
      initialOverview={initialOverview} restingStopId={props.avatarStopId ?? progress.checkpointStopId}
      onNavigate={navigate} onOpenStop={props.onOpenStop} onInspectStop={props.onInspectStop} onBusyChange={onBusyChange}
      interactionLocked={reading} storyScene={chapterStage === "shattering"} onStorySceneEnd={continueChapter}
      storyScattered={props.storyProgress.ending === "appeal" || props.storyProgress.ending === "complete"}
      storyBookLabels={!danger && world.number === 1 ? [FIRST_WORLD_STORY.book1.title, FIRST_WORLD_STORY.book2.title] : undefined}
      onStory={(index, opener) => { storyOpener.current = opener; setStory(index); }} />
    {!danger && <section className={styles.actions} aria-label="World actions" inert={reading}>
      <div><strong>{boss ? "A full test awaits" : complete ? "Every trail explored" : "Your next discovery"}</strong><p>{boss ? "Print the test and work through it with pencil and paper." : complete ? "Your boat is ready for the next adventure." : "Choose a stop on the globe, or explore the list below."}</p></div>
      {boss ? nextWorld && <button className={styles.primary} disabled={busy || printing || !props.canNavigate(nextWorld.id)} onClick={() => boardRef.current?.sailTo(nextWorld.id)}>{boss.afterWorld === WORLD_DEFINITIONS.length ? `Back to World ${nextWorld.number}` : `Continue to World ${nextWorld.number}`} →</button>
        : complete && nextDanger && !hasCrossedDanger(progress, props.dangerState, nextDanger) ? <button className={styles.primary} disabled={busy || printing || !props.canNavigate(nextDanger.id)} onClick={() => boardRef.current?.sailTo(nextDanger.id)}>Sail to {nextDanger.title} →</button>
        : complete && nextBoss ? <button className={styles.primary} disabled={busy || printing || !props.canNavigate(nextBoss.id)} onClick={() => boardRef.current?.sailTo(nextBoss.id)}>Sail into the {nextBoss.year} storm →</button>
          : complete && nextWorld ? <button className={styles.primary} disabled={busy || printing || !props.canNavigate(nextWorld.id)} onClick={() => boardRef.current?.sailTo(nextWorld.id)}>Sail to {nextWorld.title} →</button>
            : <button className={styles.primary} disabled={busy || printing || !nextStopId} onClick={() => nextStopId && boardRef.current?.openStop(nextStopId)}>{completedCount ? "Continue adventure" : "Let’s explore"} →</button>}
    </section>}
    {danger && <section className={styles.actions} aria-label="Danger actions" inert={reading}>
      <div><strong>{packet?.completedAt ? "Safe passage!" : packet ? `${packet.questionIds.length} questions · One crossing` : "Get your review packet ready"}</strong><p>{packet?.completedAt ? packet.questionIds.length ? `${dangerPacketAccuracy(packet)}% first-try accuracy. Every question solved; your ship can sail on.` : "No puzzles are waiting for review. The passage is clear." : packet ? packet.questionIds.length ? "Work on paper, then enter your answers at the crossing." : "There are no missed questions waiting for this crossing." : "Print your packet before entering the crossing. It will stay the same when you return."}</p></div>
      {packet?.completedAt ? <button className={styles.primary} disabled={busy || printing} onClick={() => { const id = nextBoss?.id ?? nextWorld?.id; if (id) boardRef.current?.sailTo(id); }}>Sail onward →</button> : packet ? <button className={styles.primary} disabled={busy || printing} onClick={props.onOpenDanger}>{packet.questionIds.length ? packet.startedAt ? "Resume crossing" : "Enter danger crossing" : "Sail through safely"} →</button> : null}
      <button className={styles.exportButton} disabled={busy || printing} onClick={() => setRevisitDanger(true)}>Read about this danger</button>
    </section>}
    {!danger && (boss ? <section className={styles.bossNote}><strong>Take on the storm, one question at a time</strong><p>{boss.afterWorld === WORLD_DEFINITIONS.length ? "Beyond this storm lies an uncharted horizon. " : "This storm guards the crossing to the next archipelago. "}Work through the whole test on paper. Answer entry is coming later; for now, you can print and continue exploring.</p></section>
      : <details className={styles.directory} inert={reading}><summary>Explore the island stops</summary><ol>{stops.map((stop, index) => {
        const done = progress.completedStopIds.includes(stop.id); const available = canOpenRequiredStop(progress, stop.id, qaUnlocked);
        return <li key={stop.id}><button type="button" disabled={!available || busy} aria-current={nextStopId === stop.id ? "step" : undefined} onClick={() => done && !qaUnlocked ? props.onInspectStop(stop.id) : boardRef.current?.openStop(stop.id)}><span>{done ? "✓" : index + 1}</span><strong>{stop.shortLabel}</strong><small>{QUESTIONS_BY_STOP.get(stop.id)?.length} questions · {done ? qaUnlocked ? "Replay" : "Completed" : available ? "Explore" : "Locked"}</small></button></li>;
      })}</ol></details>)}
    {qaUnlocked && <button type="button" className={styles.exportButton} onClick={props.onExportQa}>Export playtest notes</button>}
    {!boss && !danger && world.number === 1 && <div className={styles.chapterActions}>
      <button type="button" disabled={busy || reading} onClick={() => setPreview("intro")}>Read the welcome</button>
      {(qaUnlocked || props.storyProgress.ending === "complete") && <button type="button" disabled={busy || reading} onClick={() => setPreview("fracture")}>{qaUnlocked ? "Preview crystal shattering" : "Revisit the falling stars"}</button>}
    </div>}
    {danger && (dangerBriefing || revisitDanger) && <StoryPage page={DANGER_STORIES[danger.kind]} actionLabel="Prepare for the crossing" onContinue={() => { setReadDangerId(danger.id); setRevisitDanger(false); }} />}
    {chapterPage && <StoryPage key={chapterPage.id} page={chapterPage} onContinue={continueChapter}
      actionLabel={chapterStage === "intro" ? "Begin exploring" : chapterStage === "fracture" ? "Watch the sky" : "I’ll help find the shards"} />}
    {!chapterPage && bookPage && <StoryPage key={bookPage.id} page={bookPage} onContinue={closeBook} actionLabel="Back to the map" />}
    {world.number !== 1 && <dialog ref={storyRef} className={shell.storyDialog} aria-labelledby="globe-story-title" onClose={() => { setStory(null); storyOpener.current?.focus({ preventScroll: true }); }}>
      <div className={styles.storyIcon} aria-hidden="true">▤</div><p className={styles.kicker}>{world.title} · Island {(story ?? 0) + 1}</p>
      <h2 id="globe-story-title">Story coming soon</h2><p>A little story will connect this island to the rest of the adventure.</p>
      <button type="button" className={styles.primary} onClick={() => storyRef.current?.close()}>Back to the map</button>
    </dialog>}
  </main>;
}
