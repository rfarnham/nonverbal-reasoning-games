"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createGameAudioContext, playFeedbackEarcon, readSoundPreference, writeSoundPreference } from "@/lib/game-audio";
import { warmDigitRecognizer } from "../subtraction-flash/digit-recognition";
import { addActiveTime, advance, beginSession, currentProblem, differenceFeedback, explain, features, freshProgress,
  PATTERN_NAMES, recordAnswer, retryAnswer, TIER_INFO, TIERS, type Attempt, type Evidence, type Problem, type Progress, type Tier } from "./engine";
import { loadProgress, saveProgress } from "./storage";
import { Calculation, Workspace } from "./workspace";
import styles from "./trainer.module.css";

const EXAMPLE: Problem = { id: "example", tier: 1, top: 8, bottom: 3, purpose: "focus" };
function duration(ms: number) { const seconds = Math.round(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function seconds(ms: number) { return `${(ms / 1000).toFixed(1)}s`; }
function browserStorage() { try { return window.localStorage; } catch { return null; } }

function Teaching({ problem }: { problem: Problem }) {
  return <ol className={styles.steps} aria-label="How the subtraction works">
    {explain(problem).map((line, i) => <li key={line} style={{ animationDelay: `${i * 150}ms` }}>{line}</li>)}
  </ol>;
}

function ParentReport({ progress, onName }: { progress: Progress; onName(name: string): void }) {
  const history = progress.history;
  return <details className={styles.parent}>
    <summary>Parent view · progress and timing</summary>
    <div className={styles.parentBody}>
      <label className={styles.name}>Learner name <input aria-label="Learner name" maxLength={24} defaultValue={progress.name}
        onBlur={e => onName(e.currentTarget.value.trim() || "Player")} /></label>
      <p>Only first attempts affect accuracy and advancement. Writing time includes thinking and borrow marks; it excludes recognition and confirmation. Uncertain readings, interruptions, and corrections never qualify for a speed gate.</p>
      <div className={styles.tableScroll}><table><caption>Progress by tier</caption><thead><tr><th>Tier</th><th>First try</th><th>Writing time¹</th><th>Target</th><th>Status</th></tr></thead><tbody>
        {TIERS.map(t => { const all = history.filter(a => a.problem.tier === t), reliable = all.filter(a => a.reliable);
          const mean = reliable.length ? reliable.reduce((n, a) => n + a.elapsedMs, 0) / reliable.length : null;
          return <tr key={t}><th>{t}</th><td>{all.length ? `${Math.round(all.filter(a => a.correct).length / all.length * 100)}% (${all.length})` : "—"}</td>
            <td>{mean === null ? "—" : seconds(mean)}</td><td>{seconds(TIER_INFO[t].targetMs)}</td><td>{progress.mastered.includes(t) ? "✓ Achieved" : t <= progress.unlocked ? "Practicing" : "Locked"}</td></tr>; })}
      </tbody></table></div>
      <p className={styles.small}>¹ Average of reliable first responses, including wrong answers. History retains the latest 2,000 questions. Speed does not measure intelligence.</p>
      <h3>Recent three-column patterns</h3>
      <div className={styles.patternStats}>{Object.entries(PATTERN_NAMES).map(([key, label]) => {
        const items = history.filter(a => a.problem.tier === 5 && features(a.problem).pattern === key).slice(-20);
        return <div key={key}><span>{label}</span><strong>{items.length ? `${items.filter(a => a.correct).length}/${items.length} correct` : "Not sampled yet"}</strong></div>;
      })}</div>
      <p>Scratch marks appeared on {history.filter(a => a.scratch).length} of {history.length} recorded questions. Marks are allowed and count toward the same gates.</p>
      <h3>Worksheet readiness</h3>
      <p>The reference is about 90 questions in 10 minutes: <strong>6.67 seconds each overall</strong>. A seven-second tier gate is a training milestone. It does not guarantee this whole-assignment pace.</p>
      {progress.summaries.filter(s => s.kind === "benchmark").slice(-3).map(s => <p key={s.id}>
        {new Date(s.at).toLocaleDateString()}: {s.correct}/{s.total} first try · {s.meanMs === null ? "No reliable timing sample" : `${seconds(s.meanMs)} mean written response`} · {duration(s.activeMs)} active session time.
      </p>)}
      <p className={styles.small}>The 30-question check samples all five borrowing patterns equally. Confirm transfer on the actual worksheet; its mix, page scanning, corrections, and app controls differ.</p>
      <h3>Recent sessions</h3>
      {!progress.summaries.length ? <p>Your first session will appear here.</p> : <ul>{progress.summaries.slice(-8).reverse().map(s => <li key={s.id}>
        Tier {s.tier} · {s.correct}/{s.total} first try · {duration(s.activeMs)} · {s.promoted ? "Tier achieved" : s.kind === "benchmark" ? "Readiness check" : "Practice"}
      </li>)}</ul>}
      <p className={styles.small}>Saved only in this browser. Clearing browser data removes this progress. Borrow Flash and Journey have separate saves.</p>
    </div>
  </details>;
}

export default function TrainerPage() {
  const [progress, renderProgress] = useState<Progress>(freshProgress);
  const data = useRef(progress);
  const canSave = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [warning, setWarning] = useState("");
  const [ready, setReady] = useState(false);
  const [loadingFailed, setLoadingFailed] = useState(false);
  const [selected, setSelected] = useState<Tier>(1);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(true);
  const audio = useRef<AudioContext | null>(null);
  const [paused, setPaused] = useState(false);
  const [away, setAway] = useState(false);
  const [timingAllowed, setTimingAllowed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [retryReady, setRetryReady] = useState(false);
  const [inspected, setInspected] = useState<Attempt | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const originFocus = useRef<HTMLElement | null>(null);
  const nextFocus = useRef<HTMLButtonElement>(null);
  const resultsFocus = useRef<HTMLHeadingElement>(null);
  const clock = useRef<number | null>(null);

  const update = useCallback((fn: (p: Progress) => Progress) => {
    let current = data.current;
    if (clock.current !== null) {
      const now = performance.now(); current = addActiveTime(current, now - clock.current); clock.current = now;
    }
    const next = fn(current); data.current = next; renderProgress(next);
    if (canSave.current && !saveProgress(browserStorage(), next)) {
      canSave.current = false; setWarning("This browser could not save the latest progress. Keep this tab open to continue this visit.");
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const saved = loadProgress(browserStorage()); data.current = saved.progress; renderProgress(saved.progress);
      canSave.current = saved.canSave; setWarning(saved.warning); setSelected(saved.progress.unlocked);
      const enabled = readSoundPreference(); soundRef.current = enabled; setSound(enabled);
      setLoaded(true);
      if (saved.progress.active && !saved.progress.active.complete) { setPaused(true); setTimingAllowed(false); }
    });
    let live = true;
    const timeout = setTimeout(() => { if (live) setLoadingFailed(true); }, 15000);
    void warmDigitRecognizer().then(() => { if (live) { setReady(true); setLoadingFailed(false); clearTimeout(timeout); } })
      .catch(() => { if (live) { setLoadingFailed(true); clearTimeout(timeout); } });
    return () => { live = false; cancelAnimationFrame(frame); clearTimeout(timeout); };
  }, []);
  const session = progress.active;
  const active = Boolean(session && !session.complete);
  useEffect(() => {
    if (!active || paused || away || inspected) { clock.current = null; return; }
    clock.current = performance.now();
    const interval = setInterval(() => update(p => p), 5000);
    return () => { clearInterval(interval); clock.current = null; };
  }, [active, paused, away, inspected, update]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) { update(p => p); clock.current = null; setTimingAllowed(false); setAway(true); setPaused(true); }
      else setAway(false);
    };
    const save = () => update(p => p);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", save);
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", save); };
  }, [update]);
  useEffect(() => {
    if (session?.complete) resultsFocus.current?.focus();
    else if (session?.phase === "correct") nextFocus.current?.focus();
    if (session?.phase !== "wrong") return;
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1300 : 2200;
    const timer = setTimeout(() => { setRetryReady(true); nextFocus.current?.focus(); }, delay);
    return () => clearTimeout(timer);
  }, [session?.phase, session?.complete]);
  useEffect(() => {
    if (inspected) dialog.current?.showModal();
  }, [inspected]);

  function primeAudio() {
    if (!soundRef.current) return;
    audio.current ??= createGameAudioContext();
    if (audio.current?.state === "suspended") void audio.current.resume().catch(() => {});
  }
  function toggleSound() {
    const next = !sound; soundRef.current = next; setSound(next); writeSoundPreference(next);
    if (next) primeAudio();
  }
  function begin(kind: "practice" | "benchmark" = "practice") {
    primeAudio(); setTimingAllowed(true); setPaused(false); setRetryKey(0);
    try { update(p => beginSession(p, kind === "benchmark" ? 5 : selected, kind, Date.now())); }
    catch { setWarning("We couldn’t prepare this practice. Your progress is safe; try again."); }
  }
  function answer(value: number, evidence: Evidence) {
    const s = data.current.active;
    if (!s || s.phase !== "answer") return;
    primeAudio(); setRetryReady(false);
    const p = currentProblem(s), correct = value === p.top - p.bottom;
    update(state => recordAnswer(state, value, evidence, Date.now()));
    if (soundRef.current && audio.current) playFeedbackEarcon(audio.current, correct);
  }
  function next(endEarly = false) { setTimingAllowed(true); setRetryKey(0); update(p => advance(p, Date.now(), endEarly)); }
  function retry() { setRetryReady(false); setTimingAllowed(false); setRetryKey(k => k + 1); update(retryAnswer); }
  function pause() { update(p => p); clock.current = null; setTimingAllowed(false); setPaused(true); }
  function closeReview() { dialog.current?.close(); setInspected(null); requestAnimationFrame(() => originFocus.current?.focus()); }
  const problem = session && !session.complete ? currentProblem(session) : null;
  const lastSummary = progress.summaries.at(-1);

  return <div className={styles.shell}>
    <header className={styles.topbar}>
      <Link href="/">← All games</Link><span>Subtraction Steps</span>
      <button type="button" aria-pressed={sound} aria-label={`Sound ${sound ? "on" : "off"}`} onClick={toggleSound}>{sound ? "♪ Sound on" : "♪ Sound off"}</button>
    </header>
    <main className={styles.main}>
      {warning && <p role="status" className={styles.warning}>{warning}</p>}
      {!loaded ? <p role="status">Opening your practice…</p> : active && session && problem ? <>
        <div className={styles.sessionHeading}><div><p className={styles.kicker}>{session.review ? "Here’s your chance at redemption" : session.kind === "benchmark" ? "Worksheet readiness check" : `Tier ${session.tier} · ${TIER_INFO[session.tier].title}`}</p>
          <h1>{session.review ? "Make it yours." : problem.purpose === "check" ? "Find your flow." : "One step at a time."}</h1></div>
          <button type="button" onClick={pause} disabled={paused}>Pause</button></div>
        <div className={styles.progressLine}><span>{session.review ? `Review ${session.reviewIndex + 1} of ${session.review.length}` : `Question ${session.index + 1} of ${session.plan.length}`}</span>
          <span>{session.review ? "Practice without a time target" : problem.purpose === "check" ? `Progress check · ${session.index - 7} of 8` : problem.purpose === "review" ? "A little review" : "Draw your answer"}</span></div>
        <progress className={styles.progress} aria-label={session.review ? "Mistake review progress" : "Practice progress"}
          max={session.review ? session.review.length : session.plan.length} value={session.review ? session.reviewIndex : session.index} />
        {paused || away ? <section className={styles.pause} aria-label="Practice paused"><span className={styles.bigSymbol}>Ⅱ</span><h2>Take your time.</h2>
          <p>Your place and writing are saved. This question won’t count toward a speed gate after a pause.</p>
          <button type="button" className={styles.primary} disabled={away} onClick={() => { setPaused(false); setTimingAllowed(false); }}>Continue practice</button>
        </section> : <section className={styles.play} aria-label="Subtraction workspace">
          <Workspace key={`${problem.id}:${Boolean(session.review)}:${retryKey}`} problem={problem} initialInk={session.ink}
            disabled={session.phase !== "answer"} timingAllowed={timingAllowed}
            onInk={ink => update(p => p.active ? { ...p, active: { ...p.active, ink } } : p)} onAnswer={answer} />
          {session.phase !== "answer" && <div className={`${styles.feedback} ${session.phase === "correct" ? styles.correct : styles.incorrect}`}>
            <p className={styles.feedbackTitle} role="status">{session.phase === "correct" ? "✓ Correct" : `✕ ${differenceFeedback(problem, session.lastAnswer!)}`}</p>
            {session.phase === "wrong" && <p>You wrote {session.lastAnswer}. The difference is <strong>{problem.top - problem.bottom}</strong>.</p>}
            <Teaching problem={problem} />
            {session.phase === "correct" ? <div className={styles.actions}>
              <button type="button" ref={nextFocus} className={styles.primary} onClick={() => next()}>{session.review ? session.reviewIndex + 1 === session.review.length ? "Finish review" : "Next" : session.index + 1 === session.plan.length ? session.results.some(a => !a.correct) ? "Review Mistakes" : "Results" : "Next"}</button>
              {!session.review && session.index + 1 < session.plan.length && <button type="button" onClick={() => next(true)}>Finish practice</button>}
            </div> : <button type="button" ref={nextFocus} disabled={!retryReady} className={styles.primary} onClick={retry}>{retryReady ? "Try again" : "Take a look…"}</button>}
          </div>}
        </section>}
        <p className={styles.small}>Only first tries change your score. Notes and borrow marks are always welcome.</p>
      </> : session?.complete && lastSummary ? <section className={styles.results}>
        <span className={styles.bigSymbol}>✓</span><p className={styles.kicker}>Practice complete</p>
        <h1 ref={resultsFocus} tabIndex={-1}>{session.promoted ? session.tier === 5 ? "All five tiers achieved!" : `Tier ${session.tier} achieved!` : "Every step counts."}</h1>
        <p>{session.promoted ? "Eight varied answers, correct first time and within your target. Beautifully done." : "You showed up, practiced, and finished. Your next session will build on this work."}</p>
        <div className={styles.summaryStats}><div><strong>{lastSummary.correct}/{lastSummary.total}</strong><span>Correct first try</span></div><div><strong>{duration(lastSummary.activeMs)}</strong><span>Active practice</span></div></div>
        {session.review && <p>✓ All {session.review.length} missed {session.review.length === 1 ? "question" : "questions"} reviewed. Your first-try record stays the same.</p>}
        {session.kind === "practice" && !session.promoted && !progress.mastered.includes(session.tier) && <p>Stay with this tier for another short practice. Accurate answers come first; fluency grows with review.</p>}
        <nav className={styles.markers} aria-label="Read-only question history">{session.results.map((a, i) => <button type="button" key={a.problem.id}
          className={a.correct ? styles.markerCorrect : styles.markerIncorrect} aria-label={`Review question ${i + 1}: ${a.correct ? "correct" : "incorrect"} first try`}
          onClick={e => { originFocus.current = e.currentTarget; setInspected(a); }}>{i + 1} {a.correct ? "✓" : "✕"}</button>)}</nav>
        <button type="button" className={styles.primary} onClick={() => { setSelected(progress.unlocked); update(p => ({ ...p, active: null })); }}>Back to practice</button>
        <ParentReport progress={progress} onName={name => update(p => ({ ...p, name }))} />
      </section> : <>
        <section className={styles.welcome}><p className={styles.kicker}>A little practice. A little smoother.</p><h1>Subtraction,<br /><em>step by step.</em></h1>
          <p>Write your answers. Work on what needs practice.<br />Grow through five small steps.</p>
          <div className={styles.example}><div><span className={styles.kicker}>Example</span><h2>Write below the line.</h2><p>Use the whole page for notes and borrow marks. Tap Check when you’re done.</p><span className={styles.exampleCheck}>✓ 8 minus 3 is 5</span></div>
            <div className={styles.examplePaper}><Calculation problem={EXAMPLE} solved example /></div></div>
        </section>
        <section className={styles.choose} aria-labelledby="tier-heading"><h2 id="tier-heading">Your next step{progress.name !== "Player" ? `, ${progress.name}` : ""}</h2>
          <nav className={styles.tiers} aria-label="Practice tiers">{TIERS.map(t => <button key={t} type="button" disabled={t > progress.unlocked} aria-current={selected === t ? "step" : undefined}
            aria-pressed={selected === t} onClick={() => setSelected(t)}><span>{progress.mastered.includes(t) ? "✓" : t > progress.unlocked ? "○" : t}</span>{TIER_INFO[t].title}</button>)}</nav>
          <p>{TIER_INFO[selected].detail} · 16 questions, with a little review.</p>
          <p className={styles.small}>The final eight questions check your progress. There’s always time to finish and try again.</p>
          <button type="button" className={styles.primary} disabled={!ready} onClick={() => begin()}>{ready ? `Start tier ${selected}` : "Loading handwriting…"}</button>
          {loadingFailed && !ready && <p role="status">Handwriting could not load. <button type="button" onClick={() => window.location.reload()}>Try again</button></p>}
          {progress.mastered.includes(5) && <div className={styles.readiness}><h3>Ready for a longer check?</h3><p>30 fresh three-column questions. Your progress is already earned.</p><button type="button" disabled={!ready} onClick={() => begin("benchmark")}>Start readiness check</button></div>}
        </section>
        <ParentReport progress={progress} onName={name => update(p => ({ ...p, name }))} />
      </>}
      <footer className={styles.footer}><span>Private practice · Saved on this device</span><Link href="/lab/subtraction-flash/">Borrow Flash →</Link></footer>
    </main>
    <dialog ref={dialog} className={styles.dialog} onCancel={e => { e.preventDefault(); closeReview(); }} aria-labelledby="history-title">
      {inspected && <><h2 id="history-title">Question review</h2><p>{inspected.correct ? "✓ Correct" : "✕ Incorrect"} on the first try · You wrote {inspected.answer}</p>
        <div className={styles.reviewPaper}><Calculation problem={inspected.problem} solved /></div><Teaching problem={inspected.problem} />
        <p>This is a read-only view. Your progress stays the same.</p><button autoFocus type="button" className={styles.primary} onClick={closeReview}>Close review</button></>}
    </dialog>
  </div>;
}
