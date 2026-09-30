"use client";

import Image from "next/image";
import { useEffect, useId, useRef } from "react";
import type { StoryIllustration, StoryPageContent } from "./story-content";
import styles from "./story.module.css";

function Crystal({ prefix, fractured = false }: { prefix: string; fractured?: boolean }) {
  return <g transform="translate(320 117)">
    <ellipse cy="80" rx="67" ry="10" fill="#103f59" opacity=".2" />
    <circle r="96" fill={`url(#${prefix}-glow)`} />
    <path d="M0-92 53-8 0 75-53-8Z" fill="#8de7f1" stroke="#d7fcff" strokeWidth="2" />
    <path d="M0-92 0-8-53-8Z" fill="#dafdff" opacity=".84" />
    <path d="M0-92 53-8 0-8Z" fill="#48b5d0" opacity=".8" />
    <path d="M-53-8 0-8 0 75Z" fill="#2383ad" opacity=".8" />
    <path d="M0-8 53-8 0 75Z" fill="#baf9ff" opacity=".85" />
    <path d="M0-92V75M-53-8H53" fill="none" stroke="#f0ffff" strokeWidth="1.5" opacity=".9" />
    <path d="m-18-38 18 18 17-18M-17 11 17 11M-8 26H8" fill="none" stroke="#eaffff" strokeWidth="1.5" opacity=".75" />
    {fractured && <>
      <path d="m-7-83 9 25-15 17 23 21-15 26 14 20-5 32M10-20 30-27 45-19M-5 6-26 2-43 8" fill="none" stroke="#122e4b" strokeWidth="5" strokeLinejoin="round" />
      <path d="m-7-83 9 25-15 17 23 21-15 26 14 20-5 32M10-20 30-27 45-19M-5 6-26 2-43 8" fill="none" stroke="#edffff" strokeWidth="2" strokeLinejoin="round" />
      {[-1, 1].map(side => <g key={side} transform={`translate(${side * 73} -15)`} stroke="#ffe4a0" strokeWidth="2" strokeLinecap="round">
        <path d="M-9 0H9M0-9V9M-5-5 5 5M5-5-5 5" />
      </g>)}
    </>}
  </g>;
}

function Ship({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M-42 0H46L28 22H-23Z" fill="#774d35" stroke="#efd39a" strokeWidth="2" />
    <path d="M0-67V1" stroke="#ecd0a0" strokeWidth="3" />
    <path d="M5-61 34-6H5Z" fill="#fff3d5" />
    <path d="M-5-52-28-7H-5Z" fill="#e9ce91" />
    <path d="m0-70 19 5-19 7" fill="#bc6545" />
    <path d="M-47 27q20-5 38 0t39 0t25-1" fill="none" stroke="#c5ded7" strokeWidth="2" />
  </g>;
}

/** A local ink-and-wash illustration; the story text supplies its meaning. */
function StoryIllustration({ kind }: { kind: StoryIllustration }) {
  const prefix = useId().replace(/:/g, "");
  const night = kind === "fracture";
  const crystal = kind === "tideheart" || night;
  return <svg className={styles.illustration} viewBox="0 0 640 240" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${prefix}-sky`} x2="0" y2="1"><stop stopColor={night ? "#15283f" : "#d9e7dc"} /><stop offset="1" stopColor={night ? "#426879" : "#f7eacb"} /></linearGradient>
      <linearGradient id={`${prefix}-sea`} x2="0" y2="1"><stop stopColor="#70a9a4" /><stop offset="1" stopColor="#2d6a77" /></linearGradient>
      <radialGradient id={`${prefix}-glow`}><stop stopColor="#8dfaff" stopOpacity=".84" /><stop offset=".45" stopColor="#52e1f6" stopOpacity=".28" /><stop offset="1" stopColor="#52e1f6" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${prefix}-planet`} cx=".33" cy=".25"><stop stopColor="#82c9c1" /><stop offset="1" stopColor="#266473" /></radialGradient>
      <clipPath id={`${prefix}-cut`}><rect x="1" y="1" width="638" height="238" rx="108" /></clipPath>
    </defs>
    <g clipPath={`url(#${prefix}-cut)`}>
      <path d="M0 0h640v240H0Z" fill={`url(#${prefix}-sky)`} />
      {!night && <circle cx="477" cy="52" r="26" fill="#f5d890" opacity=".8" />}
      <g fill="none" stroke={night ? "#799297" : "#94ad9f"} strokeWidth="1.2" opacity=".55">
        <path d="M40 56c23-11 47-12 68-5m-62 13c38-13 62-10 83-6M433 38c29-12 55-11 79-4m-50 15 60-4M136 31l31-2" />
      </g>
      {kind !== "appeal" && <>
        <path d="m-20 147 50-43 34 13 35-38 32 34 28-12 44 56 90 20H-20Z" fill={night ? "#304d56" : "#6d9380"} />
        <path d="m428 148 26-34 35 8 45-49 29 31 39-12 60 65v52H414Z" fill={night ? "#29444d" : "#6a8a6d"} />
        <path d="m74 126 24-47 32 34-22-10-12 5Z" fill="#c2c6a0" opacity=".8" />
        <path d="M0 166q65-15 124 0t129 0t129 0t129 0t129 0v80H0Z" fill={`url(#${prefix}-sea)`} />
        <g fill="none" stroke="#c2dfd0" strokeWidth="1.4" opacity=".65">
          <path d="M24 187q34-8 68-2m53 10 66-4m210-4 81 4M76 214l95-3m214 12 68-4m71-13 59 2" />
          <path d="M11 172q44-8 85-1m448 2 64 6" />
        </g>
      </>}
      {kind === "welcome" && <>
        <Ship x={316} y={181} scale={1.18} />
        <g fill="none" stroke="#3a5e60" strokeWidth="2" strokeLinecap="round"><path d="M177 74q7-7 14 0 7-7 14 0M213 54q5-5 10 0 5-5 10 0M406 100q5-5 10 0 5-5 10 0" /></g>
      </>}
      {crystal && <>
        <path d="M241 214v-14h18v-16h122v16h18v14" fill="#657d7e" stroke="#d7d1ad" strokeWidth="2" />
        {night && <path d="M406 209c-20-21-11-43-24-58-4-5-7-10-4-18 4-11 24-17 34-6 8 9 3 19 0 25 14 20 18 29 29 48l12 9Z" fill="#102538" opacity=".8" />}
        <Crystal prefix={prefix} fractured={night} />
        {!night && <g fill="none" stroke="#48676a" strokeWidth="1.4" opacity=".7"><path d="M174 114h34m-17-17v34m234-40h30m-15-15v30M191 151l13-13m217-9 11 11" /><circle cx="191" cy="114" r="26" /><circle cx="440" cy="91" r="22" /></g>}
      </>}
      {kind === "peace" && <>
        <path d="M430 164v-41h24v41m5 0v-52h29v52m8 0v-39h28v39" fill="#f1dab1" stroke="#577c71" strokeWidth="1.5" />
        <path d="m426 123 16-15 16 15m-2-12 18-17 18 17m1 14 17-13 18 13" fill="#b87754" />
        <path d="M456 167h108v5H456Zm63 4v19m24-19v19" fill="none" stroke="#714f3f" strokeWidth="4" />
        <Ship x={260} y={177} scale={.8} /><Ship x={391} y={205} scale={.55} />
        <path d="M116 160v-54m-16 24q-12-29 17-37 31 11 19 36-22 8-36 1" fill="#4d8062" stroke="#537264" strokeWidth="3" />
        <path d="M181 108q13-8 26 0m-1-18q9-7 18 0" fill="none" stroke="#52716a" strokeWidth="1.5" />
      </>}
      {kind === "appeal" && <>
        <circle cx="320" cy="123" r="104" fill={`url(#${prefix}-glow)`} />
        <circle cx="320" cy="123" r="89" fill={`url(#${prefix}-planet)`} stroke="#d8e6c8" strokeWidth="2" />
        <path d="m266 73 25-20 28 4 8 17-18 11-8 17-24 3-19-12Zm66 58 19-24 23 10 12 31-23 7-5 25-23 12-16-25Zm-74 9 16-15 19 6 10 21-18 15-20-7Z" fill="#a3b788" stroke="#c4c79b" strokeWidth="1.5" />
        <g fill="none" stroke="#e6e1b9" opacity=".48"><ellipse cx="320" cy="123" rx="47" ry="89" /><ellipse cx="320" cy="123" rx="89" ry="31" /><path d="M231 123h178M320 34v178" /></g>
        {[[286, 82], [272, 145], [357, 143], [375, 88], [316, 179]].map(([x, y], index) => <g key={index} transform={`translate(${x} ${y})`}>
          <circle r="17" fill={`url(#${prefix}-glow)`} /><path d="M0-8 5 0 0 8-5 0Z" fill="#d3fcff" stroke="#1786a8" strokeWidth="1" />
        </g>)}
        <path d="M170 178q-53-63 17-112m280 14q45 55-7 102" fill="none" stroke="#9aaf9c" strokeWidth="1.5" strokeDasharray="3 7" />
        <path d="m174 64 14 1-3 14m178 99-3 14 14-3" fill="none" stroke="#9aaf9c" strokeWidth="1.5" />
      </>}
    </g>
    <rect x="1.5" y="1.5" width="637" height="237" rx="108" fill="none" stroke="#8d774c" strokeWidth="1.5" />
    <path d="M17 92V80m0 83v-12m606-59V80m0 83v-12" stroke="#bca66d" strokeWidth="4" strokeLinecap="round" />
  </svg>;
}

export type StoryPageProps = {
  page: Omit<StoryPageContent, "illustration"> & { illustration: StoryPageContent["illustration"] | { src: string; width: number; height: number; alt: string } };
  onContinue: () => void;
  onClose?: () => void;
  actionLabel?: string;
};

export function StoryPage({ page, onContinue, onClose, actionLabel = "Continue" }: StoryPageProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

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
    headingRef.current?.focus({ preventScroll: true });
    dialogRef.current?.scrollTo({ top: 0 });
  }, [page.id]);

  return <dialog ref={dialogRef} className={styles.dialog} aria-labelledby={titleId} data-story-page={page.id}
    onCancel={event => { event.preventDefault(); (onClose ?? onContinue)(); }}>
    <article className={styles.scroll}>
      <div className={styles.scrollRoll} aria-hidden="true" />
      <div className={styles.sheet}>
        <div className={styles.folio} aria-hidden="true"><span>Oceania</span><span>✦</span><span>The island chronicles</span></div>
        {typeof page.illustration === "string" ? <StoryIllustration kind={page.illustration} /> : <Image className={styles.illustration} src={`${(process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "")}${page.illustration.src}`} width={page.illustration.width} height={page.illustration.height} alt={page.illustration.alt} unoptimized priority style={{ height: "auto", maxHeight: "38vh", objectFit: "contain", borderRadius: "20px" }} />}
        <header className={styles.header}>
          <p className={styles.kicker}>{page.kicker}</p>
          <h2 ref={headingRef} tabIndex={-1} id={titleId} className={styles.title}>{page.title}</h2>
          <div className={styles.divider} aria-hidden="true"><span />◆<span /></div>
        </header>
        <div className={styles.prose}>
          {page.paragraphs.map((paragraph, index) => <p key={`${page.id}-${index}`}>{paragraph}</p>)}
        </div>
        <footer className={styles.actions}>
          <button type="button" onClick={onContinue} className={styles.continue}>{actionLabel}<span aria-hidden="true">→</span></button>
          {onClose && <button type="button" onClick={onClose} className={styles.close}>Close story</button>}
          <div className={styles.seal} aria-hidden="true">✦</div>
        </footer>
      </div>
      <div className={`${styles.scrollRoll} ${styles.bottomRoll}`} aria-hidden="true" />
    </article>
  </dialog>;
}
