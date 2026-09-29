import { decryptSearchBytes, deriveSearchKey, sha256, validateManifest } from "./crypto";
import { parseSearchQuery, validateCorpus } from "./engine";
import type { SearchCorpus, SearchManifest, SearchQuery, SearchQuestion, SearchResponse } from "./types";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DATA_ROOT = `${basePath}/question-search/data/`;
const OCR_ROOT = `${basePath}/question-search/ocr/`;

async function responseBytes(path: string, signal?: AbortSignal, revision?: string): Promise<Uint8Array> {
  const response = await fetch(`${DATA_ROOT}${path}${revision ? `?pack=${revision}` : ""}`, { signal, credentials: "same-origin" });
  if (!response.ok) throw new Error(`Could not load the search pack (${response.status}). Try again when connected.`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadManifest(): Promise<SearchManifest> {
  const response = await fetch(`${DATA_ROOT}manifest.json`, { cache: "no-cache", credentials: "same-origin" });
  if (!response.ok) throw new Error("The search pack is unavailable. Please reload when connected.");
  const value: unknown = await response.json();
  validateManifest(value);
  return value;
}

export class SearchSession {
  readonly corpus: SearchCorpus;
  private key: CryptoKey | null;
  private manifest: SearchManifest;
  private worker: Worker;
  private ready: Promise<unknown>;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: SearchResponse | boolean) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private workerFailure: Error | null = null;
  private urls = new Map<string, string>();
  private loadingImages = new Map<string, Promise<string>>();
  private controller = new AbortController();
  private closed = false;
  constructor(corpus: SearchCorpus, key: CryptoKey, manifest: SearchManifest) {
    this.corpus = corpus; this.key = key; this.manifest = manifest;
    this.worker = new Worker(new URL("./search.worker.ts", import.meta.url));
    this.worker.onmessage = (event: MessageEvent<{ id: number; ready?: boolean; error?: string; result?: SearchResponse }>) => {
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      this.pending.delete(event.data.id);
      clearTimeout(entry.timer);
      if (event.data.error) entry.reject(new Error(event.data.error));
      else entry.resolve(event.data.result ?? true);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.stopWorker(new Error("Search stopped on this device. Lock and try again."));
    };
    this.worker.onmessageerror = () => this.stopWorker(new Error("Search could not read its local result. Lock and try again."));
    this.ready = this.request({ corpus });
  }
  private fail(error: Error): void {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }
  private stopWorker(error: Error): void {
    this.workerFailure = error;
    this.worker.terminate();
    this.fail(error);
  }
  private request(message: { corpus?: SearchCorpus; query?: SearchQuery }): Promise<SearchResponse | boolean> {
    if (this.closed) return Promise.reject(new Error("The search pack is locked."));
    if (this.workerFailure) return Promise.reject(this.workerFailure);
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => this.stopWorker(new Error("Local search took too long. Lock and try again.")), 30_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, ...message }); }
      catch (error) { this.stopWorker(error instanceof Error ? error : new Error("Search could not start.")); }
    });
  }
  async search(query: SearchQuery): Promise<SearchResponse> {
    await this.ready;
    return this.request({ query: parseSearchQuery(query) }) as Promise<SearchResponse>;
  }
  async imageUrl(question: SearchQuestion): Promise<string> {
    if (this.closed || !this.key) throw new Error("The search pack is locked.");
    const existing = this.urls.get(question.id);
    if (existing) return existing;
    const loading = this.loadingImages.get(question.id);
    if (loading) return loading;
    const key = this.key;
    const promise = (async () => {
      const bytes = await responseBytes(question.image.path, this.controller.signal, this.manifest.index.sha256);
      const plain = await decryptSearchBytes(bytes, key, `question-search/v1/${this.manifest.version}/${question.image.path}`);
      if (await sha256(plain) !== question.image.hash) throw new Error("This question image is damaged. Please reload.");
      if (this.closed) throw new Error("The search pack is locked.");
      const url = URL.createObjectURL(new Blob([new Uint8Array(plain)], { type: question.image.mime }));
      this.urls.set(question.id, url);
      return url;
    })();
    this.loadingImages.set(question.id, promise);
    try { return await promise; } finally { this.loadingImages.delete(question.id); }
  }
  lock(): void {
    if (this.closed) return;
    this.closed = true; this.key = null; this.controller.abort(); this.worker.terminate();
    this.fail(new Error("The search pack is locked."));
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear(); this.loadingImages.clear();
  }
  async saveOffline(onProgress: (done: number, total: number) => void): Promise<void> {
    if (this.closed) throw new Error("Unlock the pack before downloading it.");
    if (!("serviceWorker" in navigator) || !("caches" in window)) throw new Error("Offline storage is unavailable in this browser.");
    await prepareOffline();
    // Cache the lazy client chunk even when OCR has never been used online.
    await import("tesseract.js");
    const cache = await caches.open("question-search-offline-v1");
    const paths = [...new Set(this.corpus.questions.map(q => q.image.path))];
    const urls = [
      `${basePath}/question-search/`, `${basePath}/favicon.svg`, `${DATA_ROOT}manifest.json`,
      `${DATA_ROOT}${this.manifest.index.path}?pack=${this.manifest.index.sha256}`,
      ...paths.map(path => `${DATA_ROOT}${path}?pack=${this.manifest.index.sha256}`),
      ...["worker.min.js", "eng.traineddata.gz", "tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core.wasm.js", "tesseract-core-simd.wasm.js"].map(path => `${OCR_ROOT}${path}`),
      ...Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map(s => s.src),
      ...Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')).map(s => s.href),
      ...performance.getEntriesByType("resource").map(r => r.name).filter(url => url.startsWith(location.origin) && /\.(js|css|wasm|mjs)(\?|$)/.test(url)),
    ];
    let completed = 0;
    onProgress(0, urls.length);
    // Bound concurrency and memory; the cache stores ciphertext only.
    for (let offset = 0; offset < urls.length; offset += 6) {
      if (this.closed) throw new Error("Offline download was stopped when you locked the pack.");
      await Promise.all(urls.slice(offset, offset + 6).map(async url => {
        if (!await cache.match(url)) {
          const response = await fetch(url, { signal: this.controller.signal });
          if (!response.ok) throw new Error("Some offline files could not be downloaded. Reconnect and try again.");
          await cache.put(url, response);
        }
        onProgress(++completed, urls.length);
      }));
    }
  }
}

export async function prepareOffline(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register(`${basePath}/question-search/sw.js`, { scope: `${basePath}/question-search/` });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Offline storage did not become ready. Reload and try again.")), 15000); }),
    ]);
  } finally { if (timeout) clearTimeout(timeout); }
}

export async function clearOffline(): Promise<void> {
  if ("caches" in window) await caches.delete("question-search-offline-v1");
}

export async function unlockCorpus(password: string, onProgress?: (status: string) => void): Promise<SearchSession> {
  onProgress?.("Loading the encrypted search pack…");
  const manifest = await loadManifest();
  const [key, encrypted] = await Promise.all([deriveSearchKey(password, manifest.encryption), responseBytes(manifest.index.path, undefined, manifest.index.sha256)]);
  if (encrypted.length !== manifest.index.bytes || await sha256(encrypted) !== manifest.index.sha256) throw new Error("The downloaded pack is incomplete. Reload and try again.");
  onProgress?.("Unlocking questions…");
  let plaintext: Uint8Array;
  try { plaintext = await decryptSearchBytes(encrypted, key, `question-search/v1/${manifest.version}/${manifest.index.path}`); }
  catch { throw new Error("That password did not unlock the pack. Please try again."); }
  const corpus: unknown = JSON.parse(new TextDecoder().decode(plaintext));
  plaintext.fill(0);
  validateCorpus(corpus);
  if (corpus.version !== manifest.version || corpus.questions.length !== manifest.count) throw new Error("The question pack version does not match. Please reload.");
  onProgress?.("Preparing local search…");
  const session = new SearchSession(corpus, key, manifest);
  try { await session.search({ text: "", limit: 1 }); return session; }
  catch (error) { session.lock(); throw error; }
}

export async function inspectImage(file: File): Promise<{ hash: string; dhash: string; previewUrl: string }> {
  if (!file.type.startsWith("image/") || file.size > 20_000_000) throw new Error("Choose an image smaller than 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("Please crop or resize this photo before searching.");
    const canvas = document.createElement("canvas"); canvas.width = 9; canvas.height = 8;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Image search is unavailable in this browser. You can still search with text.");
    context.fillStyle = "white"; context.fillRect(0, 0, 9, 8);
    context.drawImage(bitmap, 0, 0, 9, 8);
    const pixels = context.getImageData(0, 0, 9, 8).data;
    const gray = (i: number) => pixels[i * 4] * 0.299 + pixels[i * 4 + 1] * 0.587 + pixels[i * 4 + 2] * 0.114;
    let bits = BigInt(0);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << BigInt(1)) | (gray(y * 9 + x) > gray(y * 9 + x + 1) ? BigInt(1) : BigInt(0));
    return { hash: await sha256(new Uint8Array(await file.arrayBuffer())), dhash: bits.toString(16).padStart(16, "0"), previewUrl: URL.createObjectURL(file) };
  } finally { bitmap.close(); }
}

export async function recognizeImage(file: File, onProgress: (status: string) => void): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 20_000_000) throw new Error("Choose an image smaller than 20 MB.");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    workerPath: `${OCR_ROOT}worker.min.js`, corePath: OCR_ROOT, langPath: OCR_ROOT,
    workerBlobURL: false, gzip: true,
    logger: message => onProgress(`${message.status}${typeof message.progress === "number" ? ` · ${Math.round(message.progress * 100)}%` : ""}`),
  });
  try { const result = await worker.recognize(file); return result.data.text.trim(); }
  finally { await worker.terminate(); }
}
