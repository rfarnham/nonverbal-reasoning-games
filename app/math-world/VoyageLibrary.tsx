"use client";

import { useEffect, useId, useRef, useState } from "react";
import { StoryArtwork, type StoryPageProps } from "./StoryPage";
import styles from "./voyage-library.module.css";

export type ReadingPanel = "story" | "glossary";

type VoyageLibraryProps = {
  pages: readonly StoryPageProps["page"][];
  glossary: readonly { term: string; definition: string }[];
  panel: ReadingPanel | null;
  onPanelChange: (panel: ReadingPanel | null) => void;
  disabled: boolean;
};

function TomeIcon({ guide = false }: { guide?: boolean }) {
  return <svg viewBox="0 0 64 72" fill="none" aria-hidden="true" focusable="false">
    <path d="M14 10h35a5 5 0 0 1 5 5v48H15a7 7 0 0 1-7-7V18a8 8 0 0 1 6-8Z" fill={guide ? "#326963" : "#263f5b"} stroke="#e1c993" strokeWidth="1.6" />
    <path d="M15 11v43M8 56c0-4 4-6 8-6h38v13H16c-4 0-8-2-8-7Z" fill={guide ? "#264f4b" : "#1d3045"} stroke="#e1c993" strokeWidth="1.4" />
    <path d="M18 54h31v6H18c-4 0-4-6 0-6Z" fill="#f1e5c7" />
    <path d="M20 57h29M9 23h6M9 43h6" stroke="#bc9f63" />
    <path d="M21 17h25v27H21Z" stroke="#d9bf88" strokeWidth=".9" />
    {guide ? <>
      <path d="M27 35 33 23l6 12M29 31h8" stroke="#fff0c9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M41 11v13l4-3 4 3V11" fill="#d7ad64" />
    </> : <>
      <path d="m33 21 7 9-7 9-7-9Z" fill="#89c8cd" stroke="#eef9dd" strokeWidth="1.2" />
      <path d="M33 21v18M26 30h14" stroke="#eef9dd" strokeWidth=".8" />
      <path d="m23 21 2 2m16 16 2 2m-20 0 2-2m16-16 2-2" stroke="#d9bf88" strokeLinecap="round" />
    </>}
  </svg>;
}

function CompassRose({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 240 240" fill="none" aria-hidden="true" focusable="false">
    <circle cx="120" cy="120" r="88" stroke="currentColor" strokeWidth=".8" />
    <circle cx="120" cy="120" r="77" stroke="currentColor" strokeWidth=".7" strokeDasharray="1 6" />
    <path d="M120 16v208M16 120h208M48 48l144 144M48 192 192 48" stroke="currentColor" strokeWidth=".6" />
    <path d="m120 23 15 82 82 15-82 15-15 82-15-82-82-15 82-15Z" fill="currentColor" fillOpacity=".1" stroke="currentColor" strokeWidth="1.2" />
    <path d="m120 23 15 82-15 15Zm97 97-82 15-15-15Zm-97 97-15-82 15-15Zm-97-97 82-15 15 15Z" fill="currentColor" fillOpacity=".75" />
    <path d="m63 63 57 36 57-36-36 57 36 57-57-36-57 36 36-57Z" stroke="currentColor" strokeWidth=".8" />
    <circle cx="120" cy="120" r="8" fill="currentColor" /><circle cx="120" cy="120" r="3" fill="#f7efd9" />
    <path d="m117 7 3-4 3 4m110 110 4 3-4 3m-116 110 3 4 3-4M7 117l-4 3 4 3" stroke="currentColor" />
  </svg>;
}

function PageArrow({ previous = false }: { previous?: boolean }) {
  return <svg viewBox="0 0 72 32" fill="none" aria-hidden="true" focusable="false" style={previous ? { transform: "rotate(180deg)" } : undefined}>
    <path d="M8 16h53m-13-9 13 9-13 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="m5 16 4-4 4 4-4 4ZM23 16q8-10 17-6m-17 6q8 10 17 6" stroke="currentColor" strokeWidth=".8" />
  </svg>;
}

function LibraryDialog({ panel, pages, glossary, onClose }: {
  panel: ReadingPanel;
  pages: VoyageLibraryProps["pages"];
  glossary: VoyageLibraryProps["glossary"];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const titleId = useId();
  const isStory = panel === "story";
  const page = pages[pageIndex - 1];
  const entries = [...glossary].sort((a, b) => a.term.localeCompare(b.term, "en"));

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    readingRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [pageIndex]);

  function turnPage(direction: number) {
    setPageIndex(current => Math.max(0, Math.min(pages.length, current + direction)));
  }

  return <dialog ref={dialogRef} className={`${styles.dialog} ${isStory ? styles.storyDialog : ""}`}
    aria-labelledby={isStory ? undefined : titleId} aria-label={isStory ? "Story so far" : undefined}
    data-voyage-library={panel} onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (!isStory || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
        || !(event.target instanceof Element) || event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); event.stopPropagation(); turnPage(event.key === "ArrowLeft" ? -1 : 1);
      }
    }}>
    {isStory ? <div className={styles.bookFrame}>
      <div className={styles.openBook}>
        <div className={styles.bookToolbar}>
          <button type="button" onClick={onClose} className={styles.close} aria-label="Close story"><span aria-hidden="true">×</span></button>
        </div>
        <div ref={readingRef} className={styles.readingViewport}>
          {page ? <article key={page.id} className={styles.spread} data-story-replay-page={page.id}>
            <div className={styles.picturePage}><StoryArtwork illustration={page.illustration} className={styles.storyArtwork} /></div>
            <div className={styles.textPage}>
              <h2 ref={headingRef} tabIndex={-1} className={styles.storyTitle}>{page.title}</h2>
              <div className={styles.rule} aria-hidden="true"><span />◆<span /></div>
              <div className={styles.prose}>{page.paragraphs.map((paragraph, index) => <p key={`${page.id}-${index}`}>{paragraph}</p>)}</div>
            </div>
          </article> : <div className={`${styles.spread} ${styles.titleSpread}`} data-story-title-page="true">
            <div className={styles.frontispiece}><CompassRose className={styles.compass} /></div>
            <div className={styles.titlePage}>
              <div className={styles.titleOrnament} aria-hidden="true">✦</div>
              <h2 ref={headingRef} tabIndex={-1} className={styles.bookTitle}>Oceania</h2>
              <p className={styles.bookSubtitle}>Story so far</p>
              <div className={styles.rule} aria-hidden="true"><span />◆<span /></div>
            </div>
          </div>}
        </div>
        <nav className={styles.pagination} aria-label="Story pages">
          <button type="button" className={styles.pageArrow} onClick={() => turnPage(-1)} disabled={pageIndex === 0}
            aria-label="Previous page" aria-keyshortcuts="ArrowLeft"><PageArrow previous /></button>
          <span className={styles.pageCount} aria-live="polite" aria-atomic="true" aria-label={`Page ${pageIndex + 1} of ${pages.length + 1}`}>{pageIndex + 1} / {pages.length + 1}</span>
          <button type="button" className={styles.pageArrow} onClick={() => turnPage(1)} disabled={pageIndex === pages.length}
            aria-label="Next page" aria-keyshortcuts="ArrowRight"><PageArrow /></button>
        </nav>
      </div>
      <div className={styles.openingCover} aria-hidden="true">
        <div className={styles.coverBorder}><span className={styles.coverTitle}>Oceania</span><CompassRose className={styles.coverCompass} /><span className={styles.coverSubtitle}>Story so far</span></div>
      </div>
    </div> : <div className={styles.bookSheet}>
      <header className={styles.header}>
        <div className={styles.headingRow}>
          <h2 ref={headingRef} tabIndex={-1} id={titleId}>Glossary</h2>
          <button type="button" onClick={onClose} className={styles.close} aria-label="Close glossary"><span aria-hidden="true">×</span></button>
        </div>
      </header>
      <dl className={styles.glossary}>
        {entries.map(entry => <div className={styles.entry} key={entry.term}><dt>{entry.term}</dt><dd>{entry.definition}</dd></div>)}
      </dl>
    </div>}
  </dialog>;
}

/** Read-only companions to the globe. Story callbacks never advance the voyage. */
export function VoyageLibrary({ pages, glossary, panel, onPanelChange, disabled }: VoyageLibraryProps) {
  const storyButtonRef = useRef<HTMLButtonElement>(null);
  const glossaryButtonRef = useRef<HTMLButtonElement>(null);
  const previousPanel = useRef(panel);
  const returnFocusTo = useRef<ReadingPanel | null>(null);

  useEffect(() => {
    if (!panel && previousPanel.current) returnFocusTo.current = previousPanel.current;
    if (panel) returnFocusTo.current = null;
    previousPanel.current = panel;
    // The globe unlocks one effect after a reader closes. Wait for that render
    // before restoring focus to a temporarily disabled rail button.
    if (panel || disabled || !returnFocusTo.current) return;
    const button = returnFocusTo.current === "story" ? storyButtonRef.current : glossaryButtonRef.current;
    const frame = requestAnimationFrame(() => {
      if (button?.isConnected && !button.disabled) {
        button.focus({ preventScroll: true });
        returnFocusTo.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [panel, disabled]);

  useEffect(() => {
    if (!panel) return;
    function keepFocusInReader(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLDialogElement>("dialog[data-voyage-library][open]");
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]")]
        .filter(control => control.tabIndex >= 0 && control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener("keydown", keepFocusInReader);
    return () => document.removeEventListener("keydown", keepFocusInReader);
  }, [panel]);

  function openPanel(next: ReadingPanel) {
    onPanelChange(next);
  }
  function closePanel() {
    onPanelChange(null);
  }

  return <>
    <aside className={styles.rail} aria-label="Voyage library">
      <button ref={storyButtonRef} type="button" className={`${styles.libraryButton} ${styles.storyButton}`} disabled={disabled}
        onClick={() => openPanel("story")} aria-haspopup="dialog" aria-expanded={panel === "story"}>
        <TomeIcon /><span>Story so far</span>
      </button>
      <button ref={glossaryButtonRef} type="button" className={`${styles.libraryButton} ${styles.glossaryButton}`} disabled={disabled}
        onClick={() => openPanel("glossary")} aria-haspopup="dialog" aria-expanded={panel === "glossary"}>
        <TomeIcon guide /><span>Glossary</span>
      </button>
    </aside>
    {panel && <LibraryDialog key={panel} panel={panel} pages={pages} glossary={glossary} onClose={closePanel} />}
  </>;
}
