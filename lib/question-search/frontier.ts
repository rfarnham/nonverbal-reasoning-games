import { frontierInstruction, frontierSchema, FRONTIER_LIMITS, parseFrontierOutput, validateFrontierTask } from "./frontier-protocol.ts";
import type { FrontierImage, FrontierRanking, FrontierTask, QuestionUnderstanding } from "./frontier-protocol.ts";
import type { SearchHit, SearchQuery, SearchQuestion, SearchResponse } from "./types.ts";

export type FrontierConnection = { kind: "local" }
  | { kind: "api"; provider: "openai" | "gemini"; apiKey: string; model: string }
  | { kind: "companion"; url: string; token: string };
export type ActiveFrontierConnection = Exclude<FrontierConnection, { kind: "local" }>;
export interface CompanionStatus { protocolVersion: 1; backend: string; model: string; subscriptionOnly: true }
export interface FrontierSearchResult {
  response: SearchResponse; understanding: QuestionUnderstanding; reviewed: number; retrieved: number; warning?: string;
}
interface FrontierSession {
  search(query: SearchQuery): Promise<SearchResponse>;
  imageUrl(question: SearchQuestion): Promise<string>;
}
interface FrontierSearchOptions {
  connection: ActiveFrontierConnection; query: SearchQuery; imageUrl?: string; session: FrontierSession;
  signal: AbortSignal; onProgress: (status: string) => void; onLocalResults?: (response: SearchResponse) => void;
}

export function companionBase(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter the companion's full HTTPS address or localhost URL."); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || url.username || url.password || url.search || url.hash) throw new Error("Use HTTPS for a remote companion, or HTTP on localhost. Put the connection token in its own field.");
  return url.href.replace(/\/$/, "");
}
function secret(value: string): string {
  if (!value.trim() || value.length > 1000 || /[\r\n]/.test(value)) throw new Error("Enter a valid API key or companion token.");
  return value.trim();
}

/** Exported for deterministic transport tests; never logs or persists the returned headers. */
export function frontierHttpRequest(connection: ActiveFrontierConnection, input: FrontierTask): { url: string; headers: Record<string, string>; body: string } {
  const task = validateFrontierTask(input);
  if (connection.kind === "companion") return { url: `${companionBase(connection.url)}/v1/generate`, headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret(connection.token)}` }, body: JSON.stringify(task) };
  const key = secret(connection.apiKey);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(connection.model)) throw new Error("Enter a supported vision model ID.");
  if (connection.provider === "openai") {
    const content: Record<string, unknown>[] = [{ type: "input_text", text: task.text }];
    for (const image of task.images) content.push({ type: "input_text", text: image.label }, { type: "input_image", image_url: image.dataUrl, detail: "high" });
    return { url: "https://api.openai.com/v1/responses", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: connection.model, store: false, instructions: frontierInstruction(task.stage), input: [{ role: "user", content }], max_output_tokens: 12000, text: { format: { type: "json_schema", name: `question_search_${task.stage}`, strict: true, schema: frontierSchema(task.stage) } } }) };
  }
  if (connection.provider !== "gemini") throw new Error("Unsupported AI provider.");
  const parts: Record<string, unknown>[] = [{ text: task.text }];
  for (const image of task.images) {
    const [, mimeType, data] = /^data:([^;]+);base64,(.+)$/.exec(image.dataUrl)!;
    parts.push({ text: image.label }, { inlineData: { mimeType, data } });
  }
  return { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(connection.model)}:generateContent`, headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: frontierInstruction(task.stage) }] }, contents: [{ role: "user", parts }], generationConfig: { maxOutputTokens: 12000, responseMimeType: "application/json", responseJsonSchema: frontierSchema(task.stage) } }) };
}

async function fetchJson(url: string, init: RequestInit, signal?: AbortSignal, timeout = 180_000): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, { ...init, credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) {
      // Provider error bodies can echo inputs or credentials. Never surface them verbatim.
      const hints: Record<number, string> = { 400: "The model rejected this request. Check its vision and structured-output support.", 401: "The key or companion token was rejected.", 403: "This account or browser origin does not have access.", 404: "The model or companion endpoint was not found.", 429: "The AI connection reached its quota or is busy. Local search remains available.", 503: "The companion or AI service is unavailable. Check the host and subscription sign-in." };
      throw new Error(hints[response.status] ?? `The AI connection could not finish (${response.status}). Local search remains available.`);
    }
    const text = await response.text();
    if (text.length > 250_000) throw new Error("The AI response was too large.");
    return JSON.parse(text);
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    if (controller.signal.aborted) throw new Error("The AI request timed out. Local results remain available.");
    if (error instanceof TypeError) throw new Error("Could not reach the AI connection. Check internet access, the companion address, and browser local-network permission.");
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

export async function checkCompanion(connection: Extract<FrontierConnection, { kind: "companion" }>, signal?: AbortSignal): Promise<CompanionStatus> {
  const value = await fetchJson(`${companionBase(connection.url)}/v1/status`, { headers: { Authorization: `Bearer ${secret(connection.token)}` } }, signal, 12_000) as Partial<CompanionStatus> | null;
  if (!value || value.protocolVersion !== 1 || value.subscriptionOnly !== true || typeof value.backend !== "string" || typeof value.model !== "string") throw new Error("This endpoint is not a compatible subscription-only search companion.");
  return value as CompanionStatus;
}

export async function generateFrontier(connection: ActiveFrontierConnection, task: FrontierTask, signal: AbortSignal): Promise<string> {
  const request = frontierHttpRequest(connection, task);
  const value = await fetchJson(request.url, { method: "POST", headers: request.headers, body: request.body }, signal);
  if (connection.kind === "companion") return JSON.stringify(value);
  if (!value || typeof value !== "object") throw new Error("The AI provider returned an invalid response.");
  const data = value as Record<string, unknown>;
  if (connection.provider === "openai") {
    if (data.status && data.status !== "completed") throw new Error("The AI model did not finish its answer within the request limit.");
    const texts = (Array.isArray(data.output) ? data.output : []).flatMap(item => Array.isArray(item?.content) ? item.content : []).filter(part => part?.type === "output_text" && typeof part.text === "string").map(part => part.text);
    if (!texts.length) throw new Error("The AI model returned no usable answer.");
    return texts.join("\n");
  }
  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : undefined;
  if (!candidate || (candidate.finishReason && candidate.finishReason !== "STOP")) throw new Error("Gemini did not finish a usable answer within the request limit.");
  const texts = (Array.isArray(candidate.content?.parts) ? candidate.content.parts : []).filter((part: { text?: unknown; thought?: boolean }) => typeof part.text === "string" && !part.thought).map((part: { text: string }) => part.text);
  if (!texts.length) throw new Error("Gemini returned no usable answer.");
  return texts.join("\n");
}

/** Normalize pictures before disclosure: no remote URLs, bounded pixels, and no EXIF metadata. */
export async function prepareFrontierImage(url: string, label: string, signal: AbortSignal): Promise<FrontierImage> {
  signal.throwIfAborted();
  if (!url.startsWith("blob:")) throw new Error("Only an image opened in this search session can be sent to AI.");
  const response = await fetch(url, { signal });
  const blob = await response.blob();
  if (blob.size > 20_000_000) throw new Error("Please crop this image before using AI search.");
  const bitmap = await createImageBitmap(blob);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error("Please resize this image before using AI search.");
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preparation is unavailable in this browser.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    signal.throwIfAborted();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    if (dataUrl.length > FRONTIER_LIMITS.imageCharacters) throw new Error("This picture is too detailed. Crop it before using AI search.");
    return { label, dataUrl };
  } finally { bitmap.close(); }
}

/** Reciprocal rank fusion keeps wording, structure, and visual evidence on comparable scales. */
export function mergeFrontierCandidates(results: SearchResponse[]): SearchHit[] {
  const merged = new Map<string, { hit: SearchHit; score: number }>();
  for (const result of results) result.hits.forEach((hit, rank) => {
    const previous = merged.get(hit.question.id);
    if (previous) previous.score += 1 / (60 + rank + 1);
    else merged.set(hit.question.id, { hit: { ...hit, ai: undefined }, score: 1 / (60 + rank + 1) });
  });
  return [...merged.values()].sort((a, b) => b.score - a.score || a.hit.question.id.localeCompare(b.hit.question.id)).slice(0, 300).map(({ hit }) => hit);
}

export function applyFrontierRankings(hits: SearchHit[], rankings: FrontierRanking[]): SearchHit[] {
  const byId = new Map(hits.map(hit => [hit.question.id, hit]));
  const judgments = new Map<string, FrontierRanking>();
  for (const rank of rankings) {
    if (!byId.has(rank.id) || judgments.has(rank.id)) throw new Error("AI rankings did not match the supplied candidates.");
    judgments.set(rank.id, rank);
  }
  // Cross-batch scores are not calibrated probabilities. Relationship first, retrieval rank as tie-break.
  const weight = { same_method: 0, adaptation: 1, related_skill: 2, uncertain: 4, surface_only: 5, unrelated: 6 };
  return hits.map((hit, order) => ({ hit: judgments.has(hit.question.id) ? { ...hit, ai: { relationship: judgments.get(hit.question.id)!.relationship, reason: judgments.get(hit.question.id)!.reason } } : hit, order }))
    .sort((a, b) => (a.hit.ai ? weight[a.hit.ai.relationship] : 3) - (b.hit.ai ? weight[b.hit.ai.relationship] : 3) || a.order - b.order).map(item => item.hit);
}

function candidateText(question: SearchQuestion) {
  return { id: question.id, prompt: question.prompt.slice(0, 10000), originalPrompt: question.originalPrompt.slice(0, 10000), options: question.options.map(value => value.slice(0, 1000)), answer: question.answer, answerStatus: question.answerStatus, structure: question.structure.slice(0, 2000), method: question.method.slice(0, 2000), annotationStatus: question.annotationStatus };
}

export async function runFrontierSearch(options: FrontierSearchOptions): Promise<FrontierSearchResult> {
  const { connection, query, imageUrl, session, signal, onProgress, onLocalResults } = options;
  signal.throwIfAborted();
  if (!query.text.trim() && !imageUrl) throw new Error("Add question text or a picture before using AI search.");
  onProgress("Finding initial matches locally…");
  const initial = await session.search({ ...query, limit: 100, offset: 0 });
  signal.throwIfAborted(); onLocalResults?.(initial);
  const queryImages = imageUrl ? [await prepareFrontierImage(imageUrl, "Original input question", signal)] : [];
  onProgress("Understanding the question and diagram · AI request 1 of at most 4…");
  const understanding = parseFrontierOutput("understand", await generateFrontier(connection, { version: 1, stage: "understand", text: JSON.stringify({ query: query.text }), images: queryImages }, signal));
  signal.throwIfAborted();
  onProgress("Searching wording, structure, and solution methods locally…");
  const queries = [...new Set(understanding.searches)].slice(0, FRONTIER_LIMITS.queries);
  const searches = [initial];
  for (const text of queries) {
    signal.throwIfAborted();
    // Only the user may add hard filters. AI expands text without narrowing recall.
    searches.push(await session.search({ ...query, text, mode: "hybrid", limit: 100, offset: 0 }));
  }
  const hits = mergeFrontierCandidates(searches);
  const response: SearchResponse = { hits, total: hits.length, query: { ...query, offset: 0, limit: hits.length || 12 } };
  signal.throwIfAborted(); onLocalResults?.(response);
  const shortlist = hits.slice(0, FRONTIER_LIMITS.shortlist);
  const rankings: FrontierRanking[] = [];
  let missingImages = 0;
  for (let offset = 0; offset < shortlist.length; offset += FRONTIER_LIMITS.batch) {
    signal.throwIfAborted();
    const batch = shortlist.slice(offset, offset + FRONTIER_LIMITS.batch);
    onProgress(`Comparing original questions and diagrams · AI request ${2 + offset / FRONTIER_LIMITS.batch} of at most 4…`);
    const images = [...queryImages];
    const candidates = [];
    for (const hit of batch) {
      let imageAvailable = false;
      try { images.push(await prepareFrontierImage(await session.imageUrl(hit.question), `Candidate ${hit.question.id}`, signal)); imageAvailable = true; }
      catch { signal.throwIfAborted(); missingImages++; }
      candidates.push({ ...candidateText(hit.question), imageAvailable });
    }
    const task: FrontierTask = { version: 1, stage: "rerank", text: JSON.stringify({ query: query.text, understanding, candidates }), images };
    const result = parseFrontierOutput("rerank", await generateFrontier(connection, task, signal));
    const ids = new Set(batch.map(hit => hit.question.id));
    if (result.rankings.length !== ids.size || result.rankings.some(rank => !ids.has(rank.id))) throw new Error("AI did not review the exact candidate set. Local results remain available.");
    rankings.push(...result.rankings);
  }
  signal.throwIfAborted();
  return { response: { ...response, hits: applyFrontierRankings(hits, rankings) }, understanding, reviewed: rankings.length, retrieved: hits.length, ...(missingImages ? { warning: `${missingImages} candidate images could not be sent; those comparisons used text and annotations.` } : {}) };
}
