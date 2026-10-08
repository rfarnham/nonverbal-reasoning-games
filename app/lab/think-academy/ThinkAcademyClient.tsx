'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGameAudioContext, playFeedbackEarcon, readSoundPreference, writeSoundPreference } from '@/lib/game-audio';
import { Diagram } from './Diagram';
import { generateRound, TYPE_INFO } from './engine';
import { activeIndex, activeRound, createSession, finishSession, nextQuestion, outstandingMistakes, restoreRound, retryQuestion, sessionStats, startReview, submitAnswer, type Mode, type Session } from './session';
import { readSession, writeSession } from './storage';
import { SOURCE_QUESTIONS } from './source-questions';
import { LEVELS, type ChallengeLevel, type ProblemType, type Round } from './types';
import styles from './think-academy.module.css';

function QuestionPreview({ round }: { round: Round }) {
  const answer = round.choices.find(choice => choice.id === round.correctId)!;
  return <>
    <p className={styles.prompt}>{round.prompt}</p>
    {round.diagram && <div className={styles.diagram}><Diagram diagram={round.diagram} /></div>}
    <div className={styles.exampleAnswer}><strong>✓ {answer.label}</strong>{answer.diagram && <div className={styles.optionDiagram}><Diagram diagram={answer.diagram} /></div>}</div>
    <p>{round.explanation}</p>
  </>;
}

export function ThinkAcademyClient() {
  const [mode, setMode] = useState<Mode>('test');
  const [type, setType] = useState<ProblemType>('arithmetic');
  const [level, setLevel] = useState<ChallengeLevel>(0);
  const [session, setSession] = useState<Session | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [retryReady, setRetryReady] = useState(false);
  const [history, setHistory] = useState<number | null>(null);
  const typeSelectRef = useRef<HTMLSelectElement>(null);
  const audio = useRef<AudioContext | null>(null);
  const answerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const markerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const actionRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sessionRef = useRef(session);
  const example = useMemo(() => generateRound('fruit-equations', 0, 427), []);
  const selectedInfo = TYPE_INFO.find(info => info.id === type)!;
  const roundResult = useMemo(() => {
    if (!session || !playing || !['play', 'review'].includes(session.stage)) return { round: null, error: '' };
    try { return { round: activeRound(session), error: '' }; }
    catch (cause) { return { round: null, error: cause instanceof Error ? cause.message : 'This question could not be restored.' }; }
  }, [session, playing]);
  const round = roundResult.round;
  const stats = session ? sessionStats(session) : null;
  const misses = session ? outstandingMistakes(session) : [];
  const currentIndex = session ? activeIndex(session) : 0;
  const historicalRound = useMemo(() => {
    if (!session || history === null) return null;
    try { return restoreRound(session.questions[history]); } catch { return null; }
  }, [history, session]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
    setSound(readSoundPreference());
    try { const saved = readSession(window.localStorage); setSession(saved.session); sessionRef.current = saved.session; setNotice(saved.notice); }
    catch { setNotice('Saved progress is unavailable. You can still play here.'); }
    setReady(true);
    });
    return () => { window.cancelAnimationFrame(frame); void audio.current?.close().catch(() => undefined); };
  }, []);

  const persist = useCallback((next: Session) => {
    sessionRef.current = next;
    setSession(next);
    try { if (!writeSession(window.localStorage, next)) setNotice('Progress stays in this tab because device storage is unavailable.'); }
    catch { setNotice('Progress stays in this tab because device storage is unavailable.'); }
  }, []);
  const earcon = useCallback((correct: boolean) => {
    if (!sound) return;
    audio.current ??= createGameAudioContext();
    const context = audio.current;
    if (!context) return;
    if (context.state === 'suspended') void context.resume().then(() => playFeedbackEarcon(context, correct)).catch(() => undefined);
    else playFeedbackEarcon(context, correct);
  }, [sound]);
  const choose = useCallback((id: string) => {
    const current = sessionRef.current;
    if (!current || !playing || history !== null) return;
    try {
      const next = submitAnswer(current, id);
      if (next === current) return;
      setRetryReady(false);
      persist(next);
      earcon(next.feedback === 'correct');
    } catch { setError('This question could not be checked. Start a fresh set to continue.'); }
  }, [earcon, history, persist, playing]);

  useEffect(() => {
    if (!playing || !session) return;
    if (session.stage === 'results') { resultRef.current?.focus(); return; }
    if (session.stage === 'checkpoint' || session.feedback === 'correct') { actionRef.current?.focus(); return; }
    if (session.feedback === 'idle' && round) {
      const index = round.choices.findIndex(choice => choice.id === session.selected);
      answerRefs.current[Math.max(0, index)]?.focus({ preventScroll: session.selected === null });
    }
  }, [playing, session?.stage, session?.feedback, session?.index, session?.reviewCursor, round, session]);

  useEffect(() => {
    if (session?.feedback !== 'wrong' || !playing) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setRetryReady(true), reduced ? 1300 : 2200);
    return () => window.clearTimeout(timer);
  }, [playing, session?.feedback, session?.selected]);

  useEffect(() => {
    if (retryReady && playing && session?.feedback === 'wrong') actionRef.current?.focus();
  }, [retryReady, playing, session?.feedback]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog')) return;
      if (!round || !/^[1-4]$/.test(event.key) || !playing || sessionRef.current?.feedback !== 'idle' || history !== null) return;
      event.preventDefault();
      choose(round.choices[Number(event.key) - 1].id);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [choose, history, playing, round]);

  useEffect(() => {
    if (history !== null && historicalRound) { dialogRef.current?.showModal(); closeRef.current?.focus(); }
    else if (dialogRef.current?.open) dialogRef.current.close();
  }, [history, historicalRound]);
  function closeHistory() { const index = history; if (dialogRef.current?.open) dialogRef.current.close(); setHistory(null); if (index !== null) markerRefs.current[index]?.focus(); }
  function start() {
    setError('');
    try { persist(createSession(mode, type, level, Date.now() >>> 0)); setPlaying(true); window.scrollTo({ top: 0, behavior: 'instant' }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'A new set could not be created. Try again.'); }
  }
  function advance() { if (sessionRef.current) { persist(nextQuestion(sessionRef.current)); window.scrollTo({ top: 0, behavior: 'instant' }); } }
  function toggleSound() { const next = !sound; setSound(next); writeSoundPreference(next); }
  const isReview = session?.stage === 'review';

  return <div className={styles.shell}>
    <header className={styles.topbar}>
      <Link href="/" prefetch={false} aria-label="Back to all games">← <span>All games</span></Link>
      <span className={styles.title}>Think Academy Lab</span>
      <button type="button" aria-pressed={sound} aria-label={sound ? 'Sound on' : 'Sound off'} onClick={toggleSound}>Sound {sound ? 'on' : 'off'}</button>
    </header>
    <main className={styles.main}>
      {!playing ? <>
        <section className={styles.intro}>
          <p className={styles.kicker}>A focused experiment</p>
          <h1>Little puzzles.<br />Bigger thinking.</h1>
          <p className={styles.lede}>Fresh math and spatial puzzles from 15 problem types in the recorded second-grade test.</p>
          <p className={styles.small}>Start at the recorded difficulty, then explore three extra challenges. Untimed practice, with room to try again.</p>
        </section>
        <section className={styles.setupGrid}>
          <div className={styles.example}>
            <p className={styles.kicker}>Example</p>
            <QuestionPreview round={example} />
          </div>
          <div className={styles.setup}>
            <h2>Choose your session</h2>
            <div className={styles.modeGrid} role="group" aria-label="Session mode">
              <button type="button" aria-pressed={mode === 'test'} onClick={() => setMode('test')}><strong>Test</strong><span>15 questions · a mix of every type</span></button>
              <button type="button" aria-pressed={mode === 'practice'} onClick={() => setMode('practice')}><strong>Practice</strong><span>12 questions · one problem type</span></button>
            </div>
            {mode === 'practice' && <div className={styles.field}><label htmlFor="practice-problem-type">Problem type</label><select id="practice-problem-type" ref={typeSelectRef} value={type} onChange={event => setType(event.target.value as ProblemType)}>{TYPE_INFO.map(info => <option key={info.id} value={info.id}>{info.sourceNumber}. {info.title}</option>)}</select></div>}
            <fieldset className={styles.levels}><legend>Challenge</legend><div>{LEVELS.map((item, i) => <button key={item.name} type="button" aria-pressed={level === i} onClick={() => setLevel(i as ChallengeLevel)}><strong>{item.name}</strong><span>{item.detail}</span></button>)}</div></fieldset>
            <p className={styles.challengeNote}>{mode === 'practice' ? selectedInfo.challenges[level] : level === 0 ? 'Each problem begins at the difficulty shown in the recording.' : 'Every type adds a reasoning step at this challenge. You can change levels between sets.'}</p>
            <button className={styles.primary} type="button" onClick={start} disabled={!ready}>{session && session.stage !== 'results' ? `Start a new ${mode} (replace saved set)` : `Start ${mode}` } <span aria-hidden="true">→</span></button>
            {session && session.stage !== 'results' && <button className={styles.secondary} type="button" onClick={() => { setPlaying(true); setError(''); window.scrollTo({ top: 0, behavior: 'instant' }); }}>Resume saved {session.mode} · {sessionStats(session).solved}/{session.questions.length} solved</button>}
            <p className={styles.small}>First answers count toward your score. Mistakes get a retry and a review at the end. Progress saves on this device.</p>
          </div>
        </section>
        <section className={styles.typeSection}><h2>Fifteen ways to think</h2><div className={styles.typeGrid}>{TYPE_INFO.map(info => <button key={info.id} type="button" onClick={() => { setMode('practice'); setType(info.id); window.requestAnimationFrame(() => typeSelectRef.current?.focus()); window.scrollTo({ top: 0, behavior: 'instant' }); }}><span>{String(info.sourceNumber).padStart(2, '0')}</span><strong>{info.title}</strong><small>{info.description}</small></button>)}</div></section>
        <details className={styles.sources}><summary>Questions extracted from the recording</summary><p>The recording contains 15 panels and 21 answer slots. Calculation panels become individual generated calculations during play. These are practice variants, not an official placement score.</p>{SOURCE_QUESTIONS.map(source => <article key={source.number}><h3>{source.number}. {TYPE_INFO.find(info => info.id === source.type)?.title} <small>· {source.timestamp}</small></h3><p>{source.prompt}</p><p>{source.details}</p><p><strong>Answer: {source.answers}</strong></p><p className={styles.small}>{source.answerEvidence}</p></article>)}</details>
      </> : session && <>
        <nav className={styles.sessionNav} aria-label="Session"><button type="button" onClick={() => { setPlaying(false); setHistory(null); }}>← Session setup</button><span>{session.mode === 'test' ? 'Mixed test' : TYPE_INFO.find(info => info.id === session.type)?.title} · {LEVELS[session.level].name}</span></nav>
        <section className={styles.status} aria-label="Progress">
          <div><strong>{isReview ? 'Here’s your chance at redemption' : session.stage === 'play' ? `Question ${session.index + 1} of ${session.questions.length}` : 'Set complete'}</strong><span>{stats?.correct}/{stats?.answered} first try</span></div>
          <nav className={styles.markers} aria-label="Question history">{session.questions.map((ref, i) => {
            const first = session.firstAnswers[i];
            return <button ref={node => { markerRefs.current[i] = node; }} type="button" key={`${ref.type}-${i}`} disabled={!session.completed[i]} aria-current={['play', 'review'].includes(session.stage) && currentIndex === i ? 'step' : undefined} aria-label={`Question ${i + 1}: ${first ? first.correct ? 'correct first try' : 'missed first try' : 'not attempted'}${session.completed[i] ? '. Open review' : ''}`} className={first ? first.correct ? styles.correctMarker : styles.wrongMarker : ''} onClick={() => setHistory(i)}>{i + 1}{first && <span aria-hidden="true">{first.correct ? '✓' : '×'}</span>}</button>;
          })}</nav>
          <progress aria-label="Questions solved" max={session.questions.length} value={stats?.solved ?? 0} />
        </section>
        {round && <>
          {isReview && <p className={styles.reviewNote}>Review {session.reviewCursor + 1} of {session.reviewQueue.length}. Your first-try score stays the same.</p>}
          <div className={styles.board}>
            <section className={styles.question} aria-labelledby="question-prompt"><p className={styles.kicker}>{TYPE_INFO.find(info => info.id === round.type)?.title}</p><h1 id="question-prompt" className={styles.prompt}>{round.prompt}</h1>{round.diagram && <div className={styles.diagram}><Diagram diagram={round.diagram} /></div>}</section>
            <section className={styles.answers} aria-label="Choose an answer">{round.choices.map((choice, i) => <button ref={node => { answerRefs.current[i] = node; }} key={choice.id} type="button" aria-keyshortcuts={String(i + 1)} disabled={session.feedback !== 'idle'} className={`${styles.answer} ${session.selected === choice.id && session.feedback === 'wrong' ? styles.incorrect : ''} ${session.feedback === 'correct' ? choice.id === round.correctId ? styles.correct : styles.muted : ''}`} onClick={() => choose(choice.id)} aria-label={`Answer ${i + 1}: ${choice.label}${session.feedback === 'correct' && choice.id === round.correctId ? ', correct' : session.feedback === 'wrong' && session.selected === choice.id ? ', incorrect' : ''}`}><span className={styles.choiceNumber}>{i + 1}</span><span className={styles.choiceContent}>{choice.diagram && <span className={styles.optionDiagram}><Diagram diagram={choice.diagram} /></span>}<strong>{choice.label}</strong></span>{session.selected === choice.id && session.feedback !== 'idle' && <span className={styles.symbol} aria-hidden="true">{session.feedback === 'correct' ? '✓' : '×'}</span>}</button>)}</section>
          </div>
          <section className={`${styles.feedback} ${session.feedback === 'correct' ? styles.feedbackCorrect : session.feedback === 'wrong' ? styles.feedbackWrong : ''}`} aria-live="polite" aria-atomic="true">
            {session.feedback === 'correct' ? <><h2>✓ Correct</h2><p>{round.explanation}</p><button ref={actionRef} className={styles.primary} type="button" onClick={advance}>{isReview ? session.reviewCursor === session.reviewQueue.length - 1 ? 'Finish review' : 'Next' : session.index === session.questions.length - 1 ? 'Finish set' : 'Next'} →</button></> : session.feedback === 'wrong' ? <><h2>× Try again</h2><p>{round.choices.find(choice => choice.id === session.selected)?.feedback || round.hint}</p><button ref={actionRef} className={styles.secondary} type="button" disabled={!retryReady} onClick={() => { setRetryReady(false); persist(retryQuestion(session)); }}>Try again</button></> : <p>{session.selected ? 'Try again. Take another look.' : 'Choose an answer. You can also use keys 1–4.'}</p>}
          </section>
        </>}
        {(session.stage === 'checkpoint' || session.stage === 'results') && <section className={styles.summary}>
          <p className={styles.kicker}>{session.stage === 'results' ? 'Results' : 'Checkpoint'}</p><h1 ref={resultRef} tabIndex={-1}>{session.stage === 'results' ? 'A good stretch for your mind.' : 'Every puzzle solved.'}</h1>
          <p className={styles.score}>{stats?.correct}<span> / {session.questions.length}</span></p><p>Correct on the first try · {stats?.percent}%</p>
          {misses.length ? <><p>{misses.length} {misses.length === 1 ? 'puzzle is' : 'puzzles are'} ready for a fresh look.</p><button ref={actionRef} type="button" className={styles.primary} onClick={() => persist(startReview(session))}>Review Mistakes →</button></> : session.stage === 'checkpoint' ? <><p>{session.redeemed.some(Boolean) ? 'Every missed puzzle has been redeemed. Your original score is preserved.' : 'You solved them all on your first try.'}</p><button ref={actionRef} type="button" className={styles.primary} onClick={() => persist(finishSession(session))}>Results →</button></> : <><p>Keep exploring, or spend a little more time on one problem type.</p><button type="button" className={styles.primary} onClick={() => { setPlaying(false); setMode(session.mode); setLevel(session.level); setType(session.type); }}>Choose another set →</button></>}
          <div className={styles.breakdown}>{TYPE_INFO.filter(info => session.questions.some(q => q.type === info.id)).map(info => { const indices = session.questions.flatMap((q, i) => q.type === info.id ? [i] : []); const correct = indices.filter(i => session.firstAnswers[i]?.correct).length; return <div key={info.id}><span>{info.title}</span><strong>{correct}/{indices.length} first try</strong><button type="button" onClick={() => { setPlaying(false); setMode('practice'); setType(info.id); setLevel(session.level); }}>Practice</button></div>; })}</div>
        </section>}
      </>}
      {(error || roundResult.error) && <p className={styles.error} role="alert">{error || roundResult.error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      <p className={styles.footer}>Independent practice inspired by the supplied recording. No accounts, timers, or placement claims.</p>
      <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="history-heading" onCancel={event => { event.preventDefault(); closeHistory(); }} onClose={() => { if (history !== null) closeHistory(); }}>
        <div className={styles.dialogTop}><h2 id="history-heading">Question {(history ?? 0) + 1} · Review</h2><button ref={closeRef} type="button" onClick={closeHistory}>Close ×</button></div>
        {historicalRound && <><p>{session?.firstAnswers[history!]?.correct ? '✓ Correct on the first try' : '× Missed on the first try'}{session?.redeemed[history!] ? ' · Redeemed' : ''}</p><QuestionPreview round={historicalRound} /></>}
      </dialog>
    </main>
  </div>;
}
