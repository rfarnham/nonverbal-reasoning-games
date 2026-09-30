"use client";

import { useEffect, useId, useRef, useState } from "react";
import { StoryPage, type StoryPageProps } from "./StoryPage";
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

function LibraryDialog({ panel, pages, glossary, onRead, onClose }: {
  panel: ReadingPanel;
  pages: VoyageLibraryProps["pages"];
  glossary: VoyageLibraryProps["glossary"];
  onRead: (id: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const isStory = panel === "story";
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

  return <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
    data-voyage-library={panel} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className={styles.bookSheet}>
      <header className={styles.header}>
        <div className={styles.folio}><span>Oceania</span><span aria-hidden="true">✦</span><span>{isStory ? "The island chronicles" : "A voyager’s field guide"}</span></div>
        <div className={styles.headingRow}>
          <div>
            <p className={styles.kicker}>{isStory ? "Your voyage, remembered" : "Little words, wide world"}</p>
            <h2 ref={headingRef} tabIndex={-1} id={titleId}>{isStory ? "Story so far" : "Glossary"}</h2>
          </div>
          <button type="button" onClick={onClose} className={styles.close} aria-label={isStory ? "Close story" : "Close glossary"}>
            <span aria-hidden="true">×</span><span>Close</span>
          </button>
        </div>
        <p id={descriptionId} className={styles.intro}>{isStory ? "Open a page to revisit the tale." : "A few useful words for exploring Oceania."}</p>
      </header>
      {isStory ? pages.length ? <ol className={styles.contents}>
        {pages.map((page, index) => <li key={page.id}>
          <button type="button" className={styles.chapter} onClick={() => onRead(page.id)}>
            <span className={styles.chapterNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className={styles.chapterText}><span>{page.kicker}</span><strong>{page.title}</strong></span>
            <span className={styles.arrow} aria-hidden="true">↗</span>
          </button>
        </li>)}
      </ol> : <div className={styles.empty}><TomeIcon /><p>Your story is just beginning.</p><span>The pages you discover will be kept here.</span></div>
        : <dl className={styles.glossary}>
          {entries.map(entry => <div className={styles.entry} key={entry.term}><dt>{entry.term}</dt><dd>{entry.definition}</dd></div>)}
        </dl>}
      <div className={styles.endmark} aria-hidden="true"><span />◆<span /></div>
    </div>
  </dialog>;
}

/** Read-only companions to the globe. Story callbacks never advance the voyage. */
export function VoyageLibrary({ pages, glossary, panel, onPanelChange, disabled }: VoyageLibraryProps) {
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const storyButtonRef = useRef<HTMLButtonElement>(null);
  const glossaryButtonRef = useRef<HTMLButtonElement>(null);
  const previousPanel = useRef(panel);
  const returnFocusTo = useRef<ReadingPanel | null>(null);
  const selectedPage = panel === "story" ? pages.find(page => page.id === selectedPageId) : undefined;

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
      const dialog = document.querySelector<HTMLDialogElement>("dialog[data-voyage-library][open]")
        ?? [...document.querySelectorAll<HTMLDialogElement>("dialog[data-story-page][open]")]
          .find(candidate => candidate.dataset.storyPage === selectedPage?.id);
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
  }, [panel, selectedPage?.id]);

  function openPanel(next: ReadingPanel) {
    setSelectedPageId(null);
    onPanelChange(next);
  }
  function closePanel() {
    setSelectedPageId(null);
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
    {panel && (selectedPage ? <StoryPage page={selectedPage} onContinue={() => setSelectedPageId(null)} actionLabel="Back to contents" onClose={closePanel} />
      : <LibraryDialog key={panel} panel={panel} pages={pages} glossary={glossary} onRead={setSelectedPageId} onClose={closePanel} />)}
  </>;
}
