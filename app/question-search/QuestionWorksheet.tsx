"use client";

/* Original cards are locally decrypted blob URLs, never optimizer requests. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SearchSession } from "@/lib/question-search/browser";
import type { SearchQuestion } from "@/lib/question-search/types";
import { decodeWorksheetImages, prepareWorksheetImages, worksheetQuestions, type WorksheetImage } from "@/lib/question-search/worksheet";
import styles from "./question-worksheet.module.css";

interface Props { questions: SearchQuestion[]; session: SearchSession; disabled?: boolean }

function WorksheetPreview({ questions, session, onClose }: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const portal = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [images, setImages] = useState<WorksheetImage[]>([]);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    const afterPrint = () => { if (portal.current) delete portal.current.dataset.printing; };
    window.addEventListener("afterprint", afterPrint);
    return () => {
      controller.current?.abort();
      window.removeEventListener("afterprint", afterPrint);
      element?.close();
      if (origin?.isConnected) origin.focus();
    };
  }, []);

  useEffect(() => {
    const run = new AbortController();
    controller.current = run;
    void prepareWorksheetImages(questions, question => session.imageUrl(question), {
      signal: run.signal,
      onProgress: done => { if (!run.signal.aborted) setProgress(done); },
    }).then(items => { if (!run.signal.aborted) setImages(items); }).catch(reason => {
      if (!run.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not prepare the worksheet. Retry loading the images.");
    });
    return () => run.abort();
  }, [questions, session, attempt]);

  useEffect(() => {
    if (!images.length || !pages.current) return;
    const run = new AbortController();
    const elements = Array.from(pages.current.querySelectorAll("img"));
    void decodeWorksheetImages(elements, run.signal).then(() => {
      if (!run.signal.aborted) setReady(true);
    }).catch(() => {
      if (!run.signal.aborted) setError("A question image could not be displayed. Retry loading the images before printing.");
    });
    return () => run.abort();
  }, [images]);

  function retry() {
    controller.current?.abort();
    setError(""); setReady(false); setImages([]); setProgress(0); setAttempt(value => value + 1);
  }

  function print() {
    const elements = Array.from(pages.current?.querySelectorAll("img") ?? []);
    if (!ready || error || elements.length !== questions.length || elements.some(image => !image.complete || !image.naturalWidth)) {
      setReady(false);
      setError("Some question images are not ready. Retry loading them before printing.");
      return;
    }
    // Synchronous with the explicit button gesture; nothing is automatically printed.
    if (portal.current) portal.current.dataset.printing = "true";
    try { window.print(); }
    catch { if (portal.current) delete portal.current.dataset.printing; setError("Printing is unavailable in this browser. Try opening the search in your regular browser."); }
  }

  return createPortal(<div className={styles.portal} ref={portal}>
    <dialog className={styles.dialog} ref={dialog} aria-labelledby="question-worksheet-title" onCancel={event => { event.preventDefault(); onClose(); }}>
      <header className={styles.controls}>
        <div><h2 id="question-worksheet-title">Your question worksheet</h2><p>{questions.length} question{questions.length === 1 ? "" : "s"} · One per page, with space to work.</p></div>
        <button type="button" className={styles.secondary} onClick={onClose} autoFocus>Close</button>
        <p className={styles.note}>Original questions and choices are printed as shown. No answer key is added. Choose Save as PDF in the print dialog to keep a copy.</p>
        <div className={styles.actions}><button type="button" className={styles.primary} disabled={!ready || !!error} onClick={print}>Print / Save PDF</button>
          {error ? <><p className={styles.error} role="alert">{error}</p><button type="button" className={styles.secondary} onClick={retry}>Retry loading images</button></>
            : <p role="status">{ready ? "All images are ready to print." : progress < questions.length ? `Loading question images… ${progress} of ${questions.length}` : "Checking that every image displays…"}</p>}
        </div>
      </header>
      <div ref={pages} className={styles.pages} aria-label="Worksheet preview" aria-busy={!ready && !error}>
        {images.map(({ question, url }, index) => <article className={styles.page} key={question.id}>
          <header className={styles.pageHeader}><h3>Question {index + 1}</h3><span>Name: <span className={styles.nameLine} /></span></header>
          <p className={styles.source}>{question.source.label} · {question.source.year} · Grade {question.source.grade} · Original Q{question.source.question}</p>
          <img className={styles.questionImage} src={url} width={question.image.width} height={question.image.height} alt={`Original question ${index + 1}, with its diagram and answer choices.`} loading="eager" />
          <div className={styles.workSpace} aria-hidden="true"><span>Working</span></div>
          <footer className={styles.pageFooter}><span>{question.id}</span><span>{index + 1} / {questions.length}</span></footer>
        </article>)}
      </div>
    </dialog>
  </div>, document.body);
}

export default function QuestionWorksheet({ questions, session, disabled }: Props) {
  const [snapshot, setSnapshot] = useState<SearchQuestion[] | null>(null);
  const [error, setError] = useState("");
  function preview() {
    try { setSnapshot(worksheetQuestions(questions)); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Select questions to print."); }
  }
  return <>
    <button type="button" className={styles.secondary} disabled={disabled || !questions.length} onClick={preview}>Preview / print worksheet{questions.length ? ` (${questions.length})` : ""}</button>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {snapshot && <WorksheetPreview questions={snapshot} session={session} onClose={() => setSnapshot(null)} />}
  </>;
}
