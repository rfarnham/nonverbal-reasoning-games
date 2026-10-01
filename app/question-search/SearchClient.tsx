"use client";

/* Question illustrations are decrypted blob URLs and must never enter an image optimizer. */
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { clearOffline, inspectImage, loadManifest, recognizeImage, unlockCorpus, type SearchSession } from "@/lib/question-search/browser";
import { parseSearchQuery } from "@/lib/question-search/engine";
import { runFrontierSearch, type FrontierConnection } from "@/lib/question-search/frontier";
import FrontierControls from "./FrontierControls";
import QuestionImageInput from "./QuestionImageInput";
import QuestionWorksheet from "./QuestionWorksheet";
import { MAX_WORKSHEET_QUESTIONS, addWorksheetQuestions, removeWorksheetQuestions, worksheetLimit } from "@/lib/question-search/selection";
import type { MatchRelationship, SearchHit, SearchJudgment, SearchManifest, SearchQuery, SearchQuestion, SearchResponse } from "@/lib/question-search/types";
import styles from "./question-search.module.css";

const REVIEW_KEY = "spatial-gym:question-search:judgments:v1";
const PAGE_SIZE = 12;
type FrontierResult = Awaited<ReturnType<typeof runFrontierSearch>>;
const relationships: [MatchRelationship, string][] = [
  ["same_method", "Same structure and method"],
  ["adaptation", "Same method, with adaptation"],
  ["related_skill", "Related skill"],
  ["surface_only", "Similar appearance only"],
  ["unrelated", "Unrelated"],
  ["uncertain", "Uncertain"],
];
const relationshipGrades: Record<MatchRelationship, number | null> = {
  same_method: 3, adaptation: 2, related_skill: 1, surface_only: 1, unrelated: 0, uncertain: null,
};

function message(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }
function label(value: string) { return value.replaceAll("_", " ").replaceAll("-", " "); }
function relationshipLabel(value: MatchRelationship) { return relationships.find(([id]) => id === value)?.[1] ?? value; }
function sourceLabel(q: SearchQuestion) { return `${q.source.year} · Grade ${q.source.grade} · Q${q.source.question}`; }
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function queryIdentity(query: SearchQuery) {
  const canonical = JSON.stringify({ ...query, offset: 0, limit: 0 });
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index++) hash = Math.imul(hash ^ canonical.charCodeAt(index), 16777619);
  return `external:${(hash >>> 0).toString(16)}`;
}
function isJudgment(value: unknown): value is SearchJudgment {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["queryId", "candidateId", "queryVersion", "candidateVersion", "reason", "reviewer", "createdAt"].every((key) => typeof row[key] === "string")
    && relationships.some(([relationship]) => relationship === row.relationship)
    && (row.grade === null || (typeof row.grade === "number" && Number.isInteger(row.grade) && row.grade >= 0 && row.grade <= 3));
}
async function dataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read an image for export."));
    reader.readAsDataURL(blob);
  });
}

function QuestionImage({ question, session, large = false }: { question: SearchQuestion; session: SearchSession; large?: boolean }) {
  const holder = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      void session.imageUrl(question).then((value) => { if (active) setUrl(value); }).catch(() => { if (active) setFailed(true); });
    };
    if (large || typeof IntersectionObserver === "undefined") start();
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { start(); observer?.disconnect(); }
    }, { rootMargin: "200px" }) : null;
    if (holder.current) observer?.observe(holder.current);
    return () => { active = false; observer?.disconnect(); };
  }, [question, session, large]);
  return <div ref={holder} className={large ? styles.largeImage : styles.questionImage}>
    {url ? <img src={url} alt={`Original question and diagram, ${sourceLabel(question)}. A text transcription follows.`} loading={large ? "eager" : "lazy"} /> : <span>{failed ? "Image unavailable. The transcription is below." : "Loading question…"}</span>}
    {large && url && <a className={styles.textButton} href={url} target="_blank" rel="noopener" aria-label="Open original image (new tab)">Open original image <span aria-hidden="true">↗</span></a>}
  </div>;
}

function QuestionDialog({ hit, session, onClose, onRelated, query, queryQuestion, saved, onSave }: {
  hit: SearchHit; session: SearchSession; onClose: () => void; onRelated: (q: SearchQuestion, family: boolean) => void;
  query: SearchQuery; queryQuestion: SearchQuestion | null; saved?: SearchJudgment; onSave: (value: SearchJudgment) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [excludeFamily, setExcludeFamily] = useState(true);
  const [relationship, setRelationship] = useState<MatchRelationship>(saved?.relationship ?? "uncertain");
  const [reviewer, setReviewer] = useState(saved?.reviewer ?? "");
  const [reason, setReason] = useState(saved?.reason ?? "");
  const [didSave, setDidSave] = useState(false);
  const q = hit.question;
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (origin?.isConnected) origin.focus(); };
  }, []);
  function saveReview(event: FormEvent) {
    event.preventDefault();
    onSave({ queryId: queryQuestion?.id ?? queryIdentity(query), candidateId: q.id, queryVersion: queryQuestion?.version ?? "external:v1", candidateVersion: q.version,
      relationship, grade: relationshipGrades[relationship], reason: reason.trim(), reviewer: reviewer.trim() || "Anonymous reviewer", createdAt: new Date().toISOString() });
    setDidSave(true);
  }
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="question-detail-title" onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <div className={styles.dialogInner}>
      <header className={styles.dialogHeader}><div><span className={styles.kicker}>{q.source.label}</span><h2 id="question-detail-title">{sourceLabel(q)}</h2></div><button type="button" className={styles.secondary} onClick={onClose} aria-label="Close question details">Close <span aria-hidden="true">×</span></button></header>
      <QuestionImage question={q} session={session} large />
      <div className={styles.detailBody}>
        <p className={styles.fullPrompt}>{q.prompt || q.originalPrompt}</p>
        {q.options.length > 0 && <ol className={styles.answerOptions} type="A">{q.options.map((option, index) => <li key={index}>{option}</li>)}</ol>}
        {q.originalPrompt && q.originalPrompt !== q.prompt && <details className={styles.originalText}><summary>Original text · {label(q.source.language)}</summary><p className={styles.fullPrompt}>{q.originalPrompt}</p>{q.originalOptions && q.originalOptions.length > 0 && <ol className={styles.answerOptions} type="A">{q.originalOptions.map((option, index) => <li key={index}>{option}</li>)}</ol>}</details>}
        <div className={styles.answerReveal}><button className={styles.secondary} type="button" aria-expanded={showAnswer} onClick={() => setShowAnswer(!showAnswer)}>{showAnswer ? "Hide answer" : "Show answer"}</button>{showAnswer && <p>{q.answer ? `Answer: ${q.answer}` : "No answer recorded."} <span className={styles.muted}>({label(q.answerStatus)})</span></p>}</div>
        <section className={styles.evidencePanel} aria-labelledby="match-evidence-title"><h3 id="match-evidence-title">Why it surfaced</h3>{hit.ai && <div className={styles.aiEvidence}><span className={styles.aiBadge}>AI reviewed · {relationshipLabel(hit.ai.relationship)}</span><p>{hit.ai.reason}</p><span className={styles.finePrint}>An AI assessment, not a verified equivalence.</span></div>}<ul>{hit.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          {q.structure && <p><strong>Structure</strong> {q.structure}</p>}{q.method && <p><strong>Method</strong> {q.method}</p>}{q.description && <p><strong>Description</strong> {q.description}</p>}
          <div className={styles.tags}>{q.topics.map((tag) => <span key={tag}>{session.corpus.facets.topics[tag] ?? label(tag)}</span>)}{q.strategies.map((tag) => <span key={tag}>{session.corpus.facets.strategies[tag] ?? label(tag)}</span>)}</div>
          <p className={styles.finePrint}>Annotation: {label(q.annotationStatus)}. Search evidence is a lead to inspect, not a verified judgment of shared reasoning.</p>
          <details><summary>Ranking signals</summary><p className={styles.finePrint}>Local retrieval score: {hit.score.toFixed(2)}. Scores are not probabilities or comparable across queries.{hit.ai ? " AI review determines this candidate’s final position." : ""}</p><dl className={styles.signalList}>{Object.entries(hit.signals).map(([name, value]) => <div key={name}><dt>{name === "text" ? "Wording" : name === "visual" ? "Image layout" : label(name)}</dt><dd>{value.toFixed(2)}</dd></div>)}</dl></details>
          {q.evidence.length > 0 && <details><summary>Annotation sources</summary><ul>{q.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
        </section>
        <section className={styles.relatedPanel} aria-label="Use this question as your query"><div><h3>Search from this question</h3><label className={styles.check}><input type="checkbox" checked={excludeFamily} onChange={(event) => setExcludeFamily(event.target.checked)} /> Exclude its duplicate family</label></div><button className={styles.primary} type="button" onClick={() => { onRelated(q, excludeFamily); onClose(); }}>Find related <span aria-hidden="true">↗</span></button></section>
        <details className={styles.reviewDetails}><summary>Review this match{saved || didSave ? " · reviewed" : ""}</summary><form onSubmit={saveReview} className={styles.reviewForm}>
          <p className={styles.muted}>Compare the actual questions. This judgment improves the evaluation set when you export it.</p>
          <label>Relationship<select aria-label="Relationship" value={relationship} onChange={(event) => { setRelationship(event.target.value as MatchRelationship); setDidSave(false); }}>{relationships.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
          <label>Reviewer<input value={reviewer} maxLength={100} onChange={(event) => { setReviewer(event.target.value); setDidSave(false); }} placeholder="Your name (optional)" /></label>
          <label className={styles.spanAll}>Private review note<textarea value={reason} maxLength={4000} rows={3} onChange={(event) => { setReason(event.target.value); setDidSave(false); }} placeholder="What reasoning do they share? What differs?" /></label>
          <div className={styles.row}><button type="submit" className={styles.primary}>Save judgment</button>{didSave && <span role="status">✓ Saved</span>}</div><p className={`${styles.finePrint} ${styles.spanAll}`}>Reviews are stored unencrypted on this device. They are never uploaded automatically.</p>
        </form></details>
        <p className={styles.identifier}>{q.id} · content {q.version}</p>
      </div>
    </div>
  </dialog>;
}

function SearchWorkspace({ session, onLock }: { session: SearchSession; onLock: () => void }) {
  const [text, setText] = useState("");
  const [connection, setConnection] = useState<FrontierConnection>({ kind: "local" });
  const [frontierResult, setFrontierResult] = useState<FrontierResult | null>(null);
  const [cachedResults, setCachedResults] = useState<SearchResponse | null>(null);
  const [searchStatus, setSearchStatus] = useState("");
  const searchController = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<SearchQuery["mode"]>("hybrid");
  const [grade, setGrade] = useState("");
  const [topic, setTopic] = useState("");
  const [strategy, setStrategy] = useState("");
  const [image, setImage] = useState<{ hash: string; dhash: string; previewUrl: string; name: string } | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageStatus, setImageStatus] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [selectedQuestions, setSelectedQuestions] = useState<SearchQuestion[]>([]);
  const [topCount, setTopCount] = useState("10");
  const [selectionBusy, setSelectionBusy] = useState(false);
  const selectionSerial = useRef(0);
  const selectedIds = useMemo(() => new Set(selectedQuestions.map((question) => question.id)), [selectedQuestions]);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<SearchHit | null>(null);
  const [queryQuestion, setQueryQuestion] = useState<SearchQuestion | null>(null);
  const [exclusions, setExclusions] = useState<Pick<SearchQuery, "excludeIds" | "excludeFamily">>({});
  const [recipeExtras, setRecipeExtras] = useState<Pick<SearchQuery, "topics" | "strategies" | "source" | "imageHash" | "dhash">>({});
  const [recipe, setRecipe] = useState("");
  const [judgments, setJudgments] = useState<SearchJudgment[]>([]);
  const [includeImages, setIncludeImages] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);
  const [copyFallback, setCopyFallback] = useState("");
  const [offlineProgress, setOfflineProgress] = useState<{ done: number; total: number } | null>(null);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const searchSerial = useRef(0);
  const imageSerial = useRef(0);
  const imageRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const queryInput = useRef<HTMLTextAreaElement>(null);
  const grades = useMemo(() => [...new Set(session.corpus.questions.map((q) => q.source.grade))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [session]);
  const topics = Object.entries(session.corpus.facets.topics).sort((a, b) => a[1].localeCompare(b[1]));
  const strategies = Object.entries(session.corpus.facets.strategies).sort((a, b) => a[1].localeCompare(b[1]));

  useEffect(() => {
    mounted.current = true;
    Promise.resolve().then(() => {
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(REVIEW_KEY) ?? "[]");
        if (Array.isArray(stored) && mounted.current) setJudgments(stored.filter(isJudgment).map((judgment) => ({ ...judgment, grade: relationshipGrades[judgment.relationship] })));
      } catch { /* A blocked or corrupt store does not prevent searching. */ }
    });
    queryInput.current?.focus();
    // These are request generation counters, not DOM refs: invalidate their latest values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted.current = false; searchSerial.current++; selectionSerial.current++; searchController.current?.abort(); imageSerial.current++; if (imageRef.current) URL.revokeObjectURL(imageRef.current); };
  }, []);
  function cancelSearch(showNotice = true) {
    searchController.current?.abort(); searchController.current = null;
    searchSerial.current++; setBusy(false); setSearchStatus("");
    if (showNotice) setNotice("Search cancelled. Any displayed results are from local retrieval.");
  }
  async function runSearch(query: SearchQuery, origin?: SearchQuestion | null, locally = false, preserveSelection = false) {
    searchController.current?.abort();
    selectionSerial.current++; setSelectionBusy(false);
    if (!preserveSelection) setSelectedQuestions([]);
    const controller = new AbortController(); searchController.current = controller;
    const serial = ++searchSerial.current;
    const current = () => mounted.current && serial === searchSerial.current && !controller.signal.aborted;
    const useFrontier = !locally && connection.kind !== "local";
    setBusy(true); setError(""); setNotice(""); setFrontierResult(null); setCachedResults(null); setSearchStatus(useFrontier ? "Finding local candidates…" : "Searching this device…");
    setResult(null); setDetail(null);
    if (origin !== undefined) setQueryQuestion(origin);
    let localAvailable = false;
    try {
      // Present a useful local answer even when the provider is unreachable or the AI request is cancelled.
      const localResponse = await session.search({ ...query, limit: PAGE_SIZE, offset: query.offset ?? 0 });
      if (!current()) return;
      setResult(localResponse); localAvailable = true;
      if (useFrontier) {
        const sourceQuestion = origin === undefined ? queryQuestion : origin;
        const queryImageUrl = sourceQuestion ? await session.imageUrl(sourceQuestion) : image?.previewUrl;
        if (!current()) return;
        const enhanced = await runFrontierSearch({ connection, query, imageUrl: queryImageUrl, session, signal: controller.signal,
          onProgress: (status) => { if (current()) setSearchStatus(status); },
          onLocalResults: (response) => {
            if (current()) {
              // The first callback is a page from the full bank; only a complete union can be paged from memory.
              setCachedResults(response.hits.length === response.total ? response : null);
              setResult({ ...response, hits: response.hits.slice(0, PAGE_SIZE), query: { ...response.query, offset: 0, limit: PAGE_SIZE } });
            }
          },
        });
        if (!current()) return;
        setFrontierResult(enhanced); setCachedResults(enhanced.response);
        setResult({ ...enhanced.response, hits: enhanced.response.hits.slice(0, PAGE_SIZE), query: { ...enhanced.response.query, offset: 0, limit: PAGE_SIZE } });
        if (enhanced.warning) setNotice(enhanced.warning);
      }
      requestAnimationFrame(() => { if (current()) resultHeading.current?.focus(); });
    } catch (cause) {
      if (current()) setError(`${message(cause)}${useFrontier && localAvailable ? " Local search results are still available below; they have not been reviewed by AI." : ""}`);
    } finally { if (current()) { setBusy(false); setSearchStatus(""); searchController.current = null; } }
  }
  function changePage(nextOffset: number) {
    if (!result) return;
    if (cachedResults) {
      const response = cachedResults;
      setResult({ ...response, hits: response.hits.slice(nextOffset, nextOffset + PAGE_SIZE), query: { ...response.query, offset: nextOffset, limit: PAGE_SIZE } });
      resultHeading.current?.focus();
    } else void runSearch({ ...result.query, offset: nextOffset, limit: PAGE_SIZE }, undefined, true, true);
  }
  async function selectTopQuestions() {
    if (!result || busy) return;
    const limit = worksheetLimit(topCount);
    if (limit === null) { setNotice(`Choose a whole number from 1 to ${MAX_WORKSHEET_QUESTIONS}.`); return; }
    const serial = ++selectionSerial.current;
    setSelectionBusy(true); setError("");
    try {
      // Reuse the final AI order when available; otherwise retrieve the first N locally across pages.
      const response = cachedResults ?? await session.search({ ...result.query, offset: 0, limit });
      if (!mounted.current || serial !== selectionSerial.current) return;
      const questions = addWorksheetQuestions([], response.hits.slice(0, limit).map((hit) => hit.question));
      setSelectedQuestions(questions); setNotice(`Selected the top ${questions.length} matching questions.`);
    } catch (cause) { if (mounted.current && serial === selectionSerial.current) setError(message(cause)); }
    finally { if (mounted.current && serial === selectionSerial.current) setSelectionBusy(false); }
  }
  function selectQuestions(questions: SearchQuestion[]) {
    const available = new Set([...selectedIds, ...questions.map((question) => question.id)]).size;
    setSelectedQuestions((previous) => addWorksheetQuestions(previous, questions));
    if (available > MAX_WORKSHEET_QUESTIONS) setNotice(`A worksheet can contain up to ${MAX_WORKSHEET_QUESTIONS} questions. Deselect some to add others.`);
  }
  function currentQuery(): SearchQuery {
    return { ...recipeExtras, text: [text, ocrText].filter(Boolean).join("\n"), mode, grade: grade || undefined, topics: topic ? [topic, ...(recipeExtras.topics ?? [])] : recipeExtras.topics, strategies: strategy ? [strategy, ...(recipeExtras.strategies ?? [])] : recipeExtras.strategies, imageHash: image?.hash ?? recipeExtras.imageHash, dhash: image?.dhash ?? recipeExtras.dhash, ...exclusions, limit: PAGE_SIZE, offset: 0 };
  }
  function submit(event: FormEvent) { event.preventDefault(); void runSearch(currentQuery(), queryQuestion && exclusions.excludeIds?.includes(queryQuestion.id) ? queryQuestion : null); }
  function clearImage() {
    cancelSearch(false);
    imageSerial.current++; if (imageRef.current) URL.revokeObjectURL(imageRef.current); imageRef.current = null;
    setImage(null); setOcrText(""); setImageBusy(false); setImageStatus(""); setPendingFile(null);
  }
  async function addImage(file: File) {
    clearImage(); setQueryQuestion(null); setExclusions({}); setRecipeExtras({});
    const serial = ++imageSerial.current;
    setImageBusy(true); setImageStatus("Reading image…"); setError("");
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPEG, WebP, or another browser-supported image.");
      if (file.size > 20 * 1024 * 1024) throw new Error("Please choose an image smaller than 20 MB.");
      const inspected = await inspectImage(file);
      if (!mounted.current || serial !== imageSerial.current) { URL.revokeObjectURL(inspected.previewUrl); return; }
      imageRef.current = inspected.previewUrl;
      setImage({ ...inspected, name: file.name });
      setImageStatus("Reading words locally…");
      try {
        const words = await recognizeImage(file, (progress) => { if (mounted.current && serial === imageSerial.current) setImageStatus(progress); });
        if (mounted.current && serial === imageSerial.current) { setOcrText(words); setImageStatus(words.trim() ? "Words extracted. Check and edit them before searching." : "No words detected. Add a description or search for visual matches."); }
      } catch { if (mounted.current && serial === imageSerial.current) setImageStatus("Text recognition is unavailable. Type the question or search for visual matches."); }
    } catch (cause) { if (mounted.current && serial === imageSerial.current) { setError(message(cause)); setImageStatus(""); } }
    finally { if (mounted.current && serial === imageSerial.current) setImageBusy(false); }
  }
  function related(q: SearchQuestion, family: boolean) {
    const next: SearchQuery = { text: [q.prompt, q.structure, q.method].filter(Boolean).join("\n"), mode: "hybrid", excludeIds: [q.id], excludeFamily: family ? q.family : undefined, imageHash: q.image.hash, dhash: q.image.dhash, limit: PAGE_SIZE, offset: 0 };
    clearImage(); setText(next.text); setMode("hybrid"); setGrade(""); setTopic(""); setStrategy(""); setRecipeExtras({ imageHash: q.image.hash, dhash: q.image.dhash });
    setExclusions({ excludeIds: next.excludeIds, excludeFamily: next.excludeFamily });
    void runSearch(next, q);
  }
  function importRecipe() {
    try {
      const parsed = parseSearchQuery(JSON.parse(recipe));
      const unknownTopic = parsed.topics?.find((id) => !Object.hasOwn(session.corpus.facets.topics, id));
      const unknownStrategy = parsed.strategies?.find((id) => !Object.hasOwn(session.corpus.facets.strategies, id));
      if (unknownTopic || unknownStrategy) throw new Error(`Unknown ${unknownTopic ? "topic" : "strategy"} ID: ${unknownTopic ?? unknownStrategy}. Copy the search instructions for supported IDs.`);
      if (parsed.grade && !grades.includes(parsed.grade)) throw new Error(`Unknown grade ${parsed.grade}. Use a grade from the filters or omit it.`);
      clearImage(); setText(parsed.text); setMode(parsed.mode ?? "hybrid"); setGrade(parsed.grade ?? ""); setTopic(parsed.topics?.[0] ?? ""); setStrategy(parsed.strategies?.[0] ?? ""); setExclusions({ excludeIds: parsed.excludeIds, excludeFamily: parsed.excludeFamily });
      setRecipeExtras({ topics: parsed.topics?.slice(1), strategies: parsed.strategies?.slice(1), source: parsed.source, imageHash: parsed.imageHash, dhash: parsed.dhash });
      void runSearch({ ...parsed, offset: 0, limit: PAGE_SIZE }, null, true);
    } catch (cause) { setError(`Could not import recipe: ${message(cause)}`); }
  }
  function saveJudgment(value: SearchJudgment) {
    const next = [...judgments.filter((item) => !(item.queryId === value.queryId && item.candidateId === value.candidateId && item.reviewer === value.reviewer)), value];
    setJudgments(next);
    try { localStorage.setItem(REVIEW_KEY, JSON.stringify(next)); setNotice("Judgment saved on this device."); }
    catch { setNotice("Judgment saved for this visit. Browser storage is unavailable; export reviews to keep it."); }
  }
  async function copyInstructions() {
    const instructions = `Help me find questions that share a mathematical structure or solution method. Analyze the question I provide, including its diagram. Preserve ambiguity. Return a JSON search recipe only, using this schema: {"text":"original terms plus a concise structure and plausible methods", "mode":"hybrid", "topics":[], "strategies":[]}. Valid modes: hybrid, text, strategy, visual. Optional filters: grade (string), topics and strategies (arrays of the exact IDs below). Omit filters unless strongly justified; filters restrict recall. Do not invent question IDs or executable code. After I return a candidate packet, inspect the original questions and images, distinguish same method, adaptation, related skill, surface similarity and unrelated, and propose a revised search if useful. Annotations are retrieval clues, not proof.\n\nTopic IDs: ${JSON.stringify(session.corpus.facets.topics)}\nStrategy IDs: ${JSON.stringify(session.corpus.facets.strategies)}\n\nCurrent query: ${text || "[I will attach my question]"}${ocrText ? `\nExtracted text: ${ocrText}` : ""}`;
    try { await navigator.clipboard.writeText(instructions); if (mounted.current) setNotice("Search instructions copied. Paste them into ChatGPT or Codex with your question."); }
    catch { if (mounted.current) { setCopyFallback(instructions); setNotice("Select and copy the instructions below."); } }
  }
  async function exportCandidates() {
    if (!result) return;
    setExportBusy(true); setError("");
    try {
      const candidates = await Promise.all(result.hits.map(async (hit) => ({ ...hit, ...(includeImages ? { imageDataUrl: await dataUrl(await session.imageUrl(hit.question)) } : {}) })));
      if (!mounted.current) return;
      download("question-search-candidates.json", { schemaVersion: 1, corpusVersion: session.corpus.version, exportedAt: new Date().toISOString(), query: result.query, queryId: queryQuestion?.id ?? queryIdentity(result.query), total: result.total, candidates });
      setNotice(`Exported ${candidates.length} candidates${includeImages ? " with their images" : ""}. The file contains decrypted question content.`);
    } catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { if (mounted.current) setExportBusy(false); }
  }
  async function saveForOffline() {
    setOfflineBusy(true); setError("");
    try {
      await session.saveOffline((done, total) => { if (mounted.current && (done % 25 === 0 || done === total)) setOfflineProgress({ done, total }); });
      if (mounted.current) setNotice("The search workspace and encrypted bank are saved for offline use in this browser. You will still need the password.");
    } catch (cause) { if (mounted.current) setError(message(cause)); }
    finally { if (mounted.current) setOfflineBusy(false); }
  }
  async function removeOffline() {
    try { await clearOffline(); if (mounted.current) { setOfflineProgress(null); setNotice("The offline download was removed. Your reviews were kept."); } }
    catch (cause) { if (mounted.current) setError(message(cause)); }
  }
  const activeQueryId = result ? queryQuestion?.id ?? queryIdentity(result.query) : "";
  const offset = result?.query.offset ?? 0;
  return <>
    <header className={styles.topbar}><Link href="/" prefetch={false} className={styles.back}>← Spatial Gym</Link><span className={styles.topbarTitle}>Question Search</span><button className={styles.secondary} type="button" onClick={() => { cancelSearch(false); onLock(); }}>Lock bank <span aria-hidden="true">↗</span></button></header>
    <main className={styles.workspace}>
      <div className={styles.intro}><div><span className={styles.kicker}>A question leads to another</span><h1>Find the shared idea.</h1><p>Search the question bank by words, structure, or approach.</p></div><div className={styles.corpusBadge}><strong>{session.corpus.questions.length.toLocaleString()}</strong><span>questions · browser search</span></div></div>
      <div className={styles.searchLayout}><aside className={styles.searchSidebar} aria-label="Search controls">
        <form onSubmit={submit} className={styles.queryPanel}>
          <FrontierControls connection={connection} disabled={busy} onChange={(next) => { cancelSearch(false); setConnection(next); }} />
          <label className={styles.queryLabel} htmlFor="question-query">Your question</label>
          <textarea ref={queryInput} id="question-query" value={text} onChange={(event) => setText(event.target.value)} rows={6} placeholder="Paste a question, or describe the key idea…" maxLength={20000} />
          <QuestionImageInput disabled={busy || imageBusy} onImage={(file) => void addImage(file)} onError={setError} pendingFile={pendingFile} onPendingFileConsumed={() => setPendingFile(null)} />
          <div className={styles.pasteTarget} tabIndex={0} role="group" aria-label="Paste a question image here" onPaste={(event) => { const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith("image/")); if (file) { event.preventDefault(); if (!busy && !imageBusy) setPendingFile(file); } }}>Paste an image here <span aria-hidden="true">⌘ / Ctrl + V</span></div>
          {image && <div className={styles.inputImage}><img src={image.previewUrl} alt="Your uploaded question" /><div><span>{image.name}</span><button className={styles.textButton} type="button" onClick={clearImage}>Remove</button></div></div>}
          {imageStatus && <p className={styles.finePrint} role="status">{imageStatus}</p>}
          {image && <label className={styles.field}>Text from picture<textarea value={ocrText} onChange={(event) => setOcrText(event.target.value)} rows={4} placeholder="Edit or add the words in your picture…" maxLength={20000} /><span className={styles.finePrint}>OCR reads words locally. Check symbols and numbers. AI search also examines the cropped picture to understand its diagram and solution method.</span></label>}
          <label className={styles.field}>Match by<select aria-label="Match by" value={mode} onChange={(event) => setMode(event.target.value as SearchQuery["mode"])}><option value="hybrid">All available evidence</option><option value="strategy">Structure & method</option><option value="text">Question wording</option><option value="visual">Visual resemblance</option></select></label>
          <details className={styles.filters}><summary>Narrow the search{grade || topic || strategy ? " · filters active" : ""}</summary><div className={styles.filterFields}>
            <label className={styles.field}>Grade<select aria-label="Grade" value={grade} onChange={(event) => setGrade(event.target.value)}><option value="">All grades</option>{grades.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
            <label className={styles.field}>Question type<select aria-label="Question type" value={topic} onChange={(event) => { setTopic(event.target.value); setRecipeExtras({ ...recipeExtras, topics: undefined }); }}><option value="">All types</option>{topics.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
            <label className={styles.field}>Solution strategy<select aria-label="Solution strategy" value={strategy} onChange={(event) => { setStrategy(event.target.value); setRecipeExtras({ ...recipeExtras, strategies: undefined }); }}><option value="">All strategies</option>{strategies.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
            <p className={styles.finePrint}>These filters use indexed annotations. Leave them broad to include questions with incomplete annotations.</p>
          </div></details>
          {exclusions.excludeIds?.length || exclusions.excludeFamily ? <div className={styles.exclusion}><span>Source question excluded{exclusions.excludeFamily ? ", including its duplicate family" : ""}.</span><button type="button" className={styles.textButton} onClick={() => { setExclusions({}); setRecipeExtras({}); }}>Clear</button></div> : null}
          {!!(recipeExtras.topics?.length || recipeExtras.strategies?.length || recipeExtras.source) && <div className={styles.exclusion}><span>Additional recipe filters: {[...(recipeExtras.topics ?? []).map((id) => session.corpus.facets.topics[id]), ...(recipeExtras.strategies ?? []).map((id) => session.corpus.facets.strategies[id]), recipeExtras.source].filter(Boolean).join(", ")}</span><button className={styles.textButton} type="button" onClick={() => setRecipeExtras({})}>Clear</button></div>}
          <button type="submit" className={`${styles.primary} ${styles.searchButton}`} disabled={busy || (imageBusy && (connection.kind === "local" || !image))}>{busy ? "Searching…" : imageBusy && (connection.kind === "local" || !image) ? "Reading picture…" : connection.kind === "local" ? "Search questions" : "Search with AI"}<span aria-hidden="true">↗</span></button>
          {busy && <button type="button" className={styles.textButton} onClick={() => cancelSearch()}>Cancel search</button>}
          {searchStatus && <p className={styles.searchProgress} role="status">{searchStatus}</p>}
          {connection.kind === "local" && <p className={styles.localNote}><span aria-hidden="true">○</span> Your query stays in this browser.</p>}
        </form>
        <details className={styles.agentPanel}><summary>Manual handoff to an assistant</summary><p>Let an assistant interpret your question, then use its search recipe here. Share a candidate packet for closer comparison.</p><button className={styles.secondary} type="button" onClick={() => void copyInstructions()}>Copy search instructions</button>
          {copyFallback && <label className={styles.field}>Instructions to copy<textarea readOnly rows={5} value={copyFallback} onFocus={(event) => event.target.select()} /></label>}
          <label className={styles.field}>Paste a JSON search recipe<textarea value={recipe} onChange={(event) => setRecipe(event.target.value)} rows={4} maxLength={60000} spellCheck={false} placeholder={'{"text": "work backward through a sequence", "mode": "strategy"}'} /></label><button className={styles.secondary} type="button" disabled={!recipe.trim() || busy} onClick={importRecipe}>Search recipe locally</button>
          <p className={styles.finePrint}>Recipes are validated as data. No model-generated code is executed.</p>
        </details>
        <details className={styles.agentPanel}><summary>Review collection{judgments.length ? ` · ${judgments.length}` : ""}</summary><p>Open a result and review its relationship to your query. Save examples that work and near-matches that do not.</p><button type="button" className={styles.secondary} disabled={!judgments.length} onClick={() => download("question-search-judgments.json", { schemaVersion: 1, corpusVersion: session.corpus.version, provenance: "browser-review", cases: [...new Map(judgments.filter((item) => !item.queryId.startsWith("external:")).map((item) => [item.queryId, { queryId: item.queryId, queryVersion: item.queryVersion, split: "development" }])).values()], judgments })}>Export {judgments.length} judgments</button>
          <button type="button" className={styles.textButton} disabled={!judgments.length} onClick={() => { if (window.confirm("Clear all saved review judgments on this device? Export them first if you want to keep them.")) { setJudgments([]); try { localStorage.removeItem(REVIEW_KEY); } catch { /* The in-memory list is still cleared. */ } } }}>Clear saved reviews</button><p className={styles.finePrint}>Saved locally, unencrypted. Exporting creates a file; nothing is sent automatically.</p>
        </details>
        <details className={styles.agentPanel}><summary>Use the bank offline</summary><p>Download the encrypted questions, illustrations, and local text reader to this browser. Allow approximately 200 MB of device storage. The password is still required.</p><button type="button" className={styles.secondary} disabled={offlineBusy} onClick={() => void saveForOffline()}>{offlineBusy ? "Downloading…" : "Download for offline use"}</button>
          {offlineProgress && <div className={styles.offlineProgress}><progress max={offlineProgress.total} value={offlineProgress.done} aria-label="Offline download progress" /><span role="status">{offlineProgress.done.toLocaleString()} of {offlineProgress.total.toLocaleString()} files</span></div>}
          <button type="button" className={styles.textButton} disabled={offlineBusy} onClick={() => void removeOffline()}>Remove offline download</button><p className={styles.finePrint}>Only encrypted question data is cached. Browsers may reclaim storage; keep the password somewhere safe.</p>
        </details>
      </aside>
      <section className={styles.results} aria-labelledby="search-results-heading" aria-busy={busy}>
        <div className={styles.resultsHeader}><div><span className={styles.kicker}>The question bank</span><h2 id="search-results-heading" ref={resultHeading} tabIndex={-1}>{result ? `${result.total.toLocaleString()} candidates` : "Start with a question."}</h2></div>{result && <span className={styles.resultRange}>{result.total ? `${offset + 1}–${offset + result.hits.length}` : "0"} shown</span>}</div>
        <div className={styles.messages} aria-live="polite" aria-atomic="true">{notice && <p className={styles.notice}>{notice}</p>}{error && <p className={styles.error} role="alert">{error}</p>}</div>
        {frontierResult && <section className={styles.understanding} aria-label="AI question understanding"><div className={styles.understandingHeading}><h3>The shared reasoning</h3><span className={styles.aiBadge}>AI reviewed {frontierResult.reviewed} of {frontierResult.retrieved} candidates</span></div><p>{frontierResult.understanding.summary}</p>{frontierResult.understanding.strategies.length > 0 && <div className={styles.tags}>{frontierResult.understanding.strategies.map((item, index) => <span key={index}>{item}</span>)}</div>}{frontierResult.understanding.uncertainties.length > 0 && <div className={styles.uncertainties}><strong>Still uncertain</strong><ul>{frontierResult.understanding.uncertainties.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}<details><summary>Searches used</summary><ul>{frontierResult.understanding.searches.map((item, index) => <li key={index}>{item}</li>)}</ul></details></section>}
        {!result && <div className={styles.emptyState}><div className={styles.searchArt} aria-hidden="true"><span>?</span><span>↗</span><span>≈</span></div><h3>Different questions.<br />A familiar way through.</h3><p>Paste text, upload a picture, or describe a solution method. The search brings together clues for you to inspect.</p><div className={styles.exampleQueries}><span>Try an idea</span>{["work backward through a sequence", "count paths through a grid", "fold a cube from a net"].map((example) => <button key={example} type="button" onClick={() => { setText(example); void runSearch({ text: example, mode: "hybrid", limit: PAGE_SIZE, offset: 0 }, null, true); }}>{example} <span aria-hidden="true">↗</span></button>)}</div></div>}
        {result && !result.hits.length && <div className={styles.emptyState}><h3>No matches with these settings.</h3><p>Try fewer filters, a broader description, or words explaining how the question is solved.</p><button className={styles.secondary} type="button" onClick={() => { setGrade(""); setTopic(""); setStrategy(""); setExclusions({}); setRecipeExtras({}); void runSearch({ text: [text, ocrText].join("\n"), mode: "hybrid", dhash: image?.dhash, imageHash: image?.hash, limit: PAGE_SIZE }, null, true); }}>Broaden search</button></div>}
        {result && result.hits.length > 0 && <><p className={styles.resultNote}>{frontierResult ? "AI review promotes stronger reasoning matches and moves weaker matches down. Unreviewed candidates retain local ranking. Inspect the explanations; AI judgments can be mistaken." : busy && connection.kind !== "local" ? "Local candidates while AI works. These results have not been reviewed by AI yet." : "Ranked by local retrieval. Open a question to inspect its method and evidence."}</p><section className={styles.worksheetToolbar} aria-label="Worksheet selection">
          <div className={styles.worksheetHeading}><div><h3>Make a worksheet</h3><p role="status">{selectedQuestions.length} selected · up to {MAX_WORKSHEET_QUESTIONS} questions</p></div><QuestionWorksheet questions={selectedQuestions} session={session} disabled={busy || selectionBusy} /></div>
          <div className={styles.worksheetActions}>
            <label className={styles.worksheetLimit}>Number to select<input type="number" inputMode="numeric" min={1} max={MAX_WORKSHEET_QUESTIONS} step={1} value={topCount} disabled={busy || selectionBusy} onChange={(event) => setTopCount(event.target.value)} /></label>
            <button type="button" className={styles.secondary} disabled={busy || selectionBusy} onClick={() => void selectTopQuestions()}>{selectionBusy ? "Selecting…" : "Select top N"}</button>
            <button type="button" className={styles.secondary} disabled={busy || selectionBusy || selectedQuestions.length >= MAX_WORKSHEET_QUESTIONS} onClick={() => selectQuestions(result.hits.map((hit) => hit.question))}>Select this page</button>
            <button type="button" className={styles.textButton} disabled={busy || selectionBusy || !result.hits.some((hit) => selectedIds.has(hit.question.id))} onClick={() => setSelectedQuestions((previous) => removeWorksheetQuestions(previous, result.hits.map((hit) => hit.question.id)))}>Deselect this page</button>
            <button type="button" className={styles.textButton} disabled={busy || selectionBusy || !selectedQuestions.length} onClick={() => setSelectedQuestions([])}>Clear selection</button>
          </div>
          <p className={styles.finePrint}>Selections stay across pages. “Select top N” replaces them with the highest-ranked matches. A new search clears the selection.</p>
        </section><div className={styles.resultGrid}>{result.hits.map((hit) => <article className={styles.resultCard} key={hit.question.id}>
          <label className={styles.worksheetChoice}><input type="checkbox" checked={selectedIds.has(hit.question.id)} disabled={busy || selectionBusy} aria-label={`Include ${sourceLabel(hit.question)}, ${hit.question.source.label}, ${hit.question.id} in worksheet`} onChange={(event) => { if (event.target.checked) selectQuestions([hit.question]); else setSelectedQuestions((previous) => removeWorksheetQuestions(previous, [hit.question.id])); }} /> Include in worksheet</label>
          <button type="button" className={styles.cardOpen} onClick={() => setDetail(hit)} aria-label={`Inspect ${sourceLabel(hit.question)}`}><QuestionImage question={hit.question} session={session} /><div className={styles.cardBody}><div className={styles.cardMeta}><span>{sourceLabel(hit.question)}</span><span aria-hidden="true">↗</span></div><h3>{hit.question.prompt || hit.question.description || "Inspect this visual question"}</h3></div></button>
          <div className={styles.cardFooter}>{hit.ai ? <div className={styles.cardAi}><span className={styles.aiBadge}>AI reviewed · {relationshipLabel(hit.ai.relationship)}</span><p>{hit.ai.reason}</p></div> : frontierResult ? <span className={styles.unreviewed}>Not reviewed by AI</span> : null}{hit.reasons.slice(0, 2).map((reason, index) => <span key={index}>{reason}</span>)}{judgments.some((item) => item.queryId === activeQueryId && item.candidateId === hit.question.id) && <span className={styles.reviewed}>✓ Your review saved</span>}</div>
        </article>)}</div>
        <nav className={styles.pagination} aria-label="Search result pages"><button className={styles.secondary} type="button" disabled={busy || selectionBusy || offset === 0} onClick={() => changePage(Math.max(0, offset - PAGE_SIZE))}>← Previous</button><span>Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(result.total / PAGE_SIZE)}</span><button className={styles.secondary} type="button" disabled={busy || selectionBusy || offset + PAGE_SIZE >= result.total} onClick={() => changePage(offset + PAGE_SIZE)}>Next →</button></nav>
        <div className={styles.exportPanel}><div><h3>Take a closer look with an assistant.</h3><p>Export these {result.hits.length} candidates with their evidence and your search recipe.</p><label className={styles.check}><input type="checkbox" checked={includeImages} onChange={(event) => setIncludeImages(event.target.checked)} /> Include question images</label></div><button className={styles.secondary} type="button" disabled={exportBusy} onClick={() => void exportCandidates()}>{exportBusy ? "Preparing packet…" : "Download candidate packet"}</button></div></>}
      </section></div>
      <footer className={styles.footer}><span title={session.corpus.version}>Question Search · index {session.corpus.version.slice(0, 12)}</span><span>Unlocked questions and AI credentials stay in memory. Saved reviews and downloaded exports remain on your device.</span></footer>
    </main>
    {detail && result && <QuestionDialog key={detail.question.id} hit={detail} session={session} onClose={() => setDetail(null)} onRelated={related} query={result.query} queryQuestion={queryQuestion} saved={judgments.findLast((item) => item.queryId === activeQueryId && item.candidateId === detail.question.id)} onSave={saveJudgment} />}
  </>;
}

export default function SearchClient() {
  const [manifest, setManifest] = useState<SearchManifest | null>(null);
  const [session, setSession] = useState<SearchSession | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const serial = useRef(0);
  const sessionRef = useRef<SearchSession | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    void loadManifest().then((value) => { if (active) setManifest(value); }).catch(() => { /* The unlock operation provides an actionable load error. */ });
    // Invalidate the latest request even if the component unmounts during decryption.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { active = false; serial.current++; sessionRef.current?.lock(); };
  }, []);
  async function unlock(event: FormEvent) {
    event.preventDefault();
    const attempt = ++serial.current;
    setBusy(true); setError(""); setStatus("Opening the encrypted question bank…");
    try {
      const opened = await unlockCorpus(password, (progress) => { if (serial.current === attempt) setStatus(progress); });
      if (serial.current !== attempt) { opened.lock(); return; }
      sessionRef.current = opened; setSession(opened); setPassword(""); setStatus("");
    } catch (cause) { if (serial.current === attempt) { setError(message(cause)); setStatus(""); } }
    finally { if (serial.current === attempt) setBusy(false); }
  }
  function lock() { serial.current++; sessionRef.current?.lock(); sessionRef.current = null; setSession(null); setPassword(""); setStatus("Bank locked."); setError(""); requestAnimationFrame(() => passwordInput.current?.focus()); }
  if (session) return <SearchWorkspace session={session} onLock={lock} />;
  return <div className={styles.lockedPage}><header className={styles.topbar}><Link className={styles.back} href="/" prefetch={false}>← Spatial Gym</Link><span className={styles.topbarTitle}>Question Search</span><span className={styles.privateBadge}>Contributor access</span></header>
    <main className={styles.lockedMain}>
      <section className={styles.lockedIntro}><span className={styles.kicker}>Look beyond the surface</span><h1>Different questions.<br /><span>The same idea.</span></h1><p>A place to find the questions that think alike. Search by text, picture, or a promising way to solve it.</p>
        <div className={styles.lockedArt} aria-hidden="true"><div><i /><i /><i /><i /></div><span>≈</span><div><b>?</b><small>the shared idea</small></div></div>
        <div className={styles.lockedStats}><span><strong>{manifest ? manifest.count.toLocaleString() : "One"}</strong>question bank</span><span><strong>Local</strong>browser retrieval</span><span><strong>Open</strong>to closer inspection</span></div>
      </section>
      <section className={styles.unlockCard} aria-labelledby="unlock-heading"><div className={styles.lockIcon} aria-hidden="true">↳</div><span className={styles.kicker}>Your search workspace</span><h2 id="unlock-heading">Unlock the bank.</h2><p>Use the shared contributor password to open the encrypted questions and search index.</p>
        <form onSubmit={unlock}><label className={styles.field} htmlFor="bank-password">Bank password<input ref={passwordInput} id="bank-password" name="bank-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} aria-describedby="password-note" /></label><button className={styles.primary} type="submit" disabled={busy || !password}>{busy ? "Unlocking…" : "Unlock question bank"}<span aria-hidden="true">↗</span></button></form>
        <div aria-live="polite" aria-atomic="true">{status && <p className={styles.notice}>{status}</p>}{error && <p className={styles.error} role="alert">{error}</p>}</div>
        <p id="password-note" className={styles.finePrint}>Decryption and local search happen in your browser. This page never saves the password or sends it to AI. Optional AI connections are available after unlocking.</p>
        <div className={styles.unlockFoot}><span aria-hidden="true">○</span><p>After unlocking, add a question, inspect related problems, and collect useful matches.</p></div>
      </section>
    </main><footer className={styles.lockedFooter}>Spatial Gym <span>Explore the reasoning. Find the connection.</span></footer>
  </div>;
}
