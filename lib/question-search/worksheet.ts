import type { SearchQuestion } from "./types.ts";
import { MAX_WORKSHEET_QUESTIONS } from "./selection.ts";

export interface WorksheetImage { question: SearchQuestion; url: string }

/** Keep the caller's selected order, without printing the same question twice. */
export function worksheetQuestions(questions: SearchQuestion[]): SearchQuestion[] {
  const seen = new Set<string>();
  const unique = questions.filter(question => {
    if (seen.has(question.id)) return false;
    seen.add(question.id);
    return true;
  });
  if (!unique.length) throw new Error("Select at least one question for your worksheet.");
  if (unique.length > MAX_WORKSHEET_QUESTIONS) throw new Error(`Select at most ${MAX_WORKSHEET_QUESTIONS} questions per worksheet.`);
  return unique;
}

function abortError(): Error { return new DOMException("Worksheet preparation was cancelled.", "AbortError"); }

/** Bound each load, including decryption, so a stalled asset cannot lock the preview. */
function bounded<T>(run: () => Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const stop = () => fail(abortError());
    const timer = setTimeout(() => fail(new Error("A question image took too long to load. Reconnect and retry.")), timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      settled = true;
    }
    function fail(error: unknown) {
      if (settled) return;
      cleanup(); reject(error);
    }
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw abortError();
      return run();
    }).then(value => { if (!settled) { cleanup(); resolve(value); } }, fail);
  });
}

/** Images belong to SearchSession; this function neither persists nor revokes them. */
export async function prepareWorksheetImages(
  questions: SearchQuestion[],
  imageUrl: (question: SearchQuestion) => Promise<string>,
  options: { signal: AbortSignal; onProgress?: (done: number, total: number) => void; timeoutMs?: number },
): Promise<WorksheetImage[]> {
  const unique = worksheetQuestions(questions);
  const results: WorksheetImage[] = new Array(unique.length);
  let next = 0;
  let completed = 0;
  let failed = false;
  const { signal, timeoutMs = 20_000 } = options;
  const worker = async () => {
    while (next < unique.length && !failed) {
      if (signal.aborted) throw abortError();
      const index = next++;
      const question = unique[index];
      try {
        const url = await bounded(() => imageUrl(question), signal, timeoutMs);
        if (signal.aborted) throw abortError();
        if (!url.startsWith("blob:")) throw new Error("The worksheet needs a locally decrypted question image. Unlock the bank and retry.");
        results[index] = { question, url };
        options.onProgress?.(++completed, unique.length);
      } catch (error) { failed = true; throw error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, worker));
  return results;
}

/** Wait for the actual preview images, including decode, before enabling Print. */
export async function decodeWorksheetImages(images: HTMLImageElement[], signal: AbortSignal, timeoutMs = 20_000): Promise<void> {
  if (!images.length) throw new Error("There are no question images to print.");
  await bounded(async () => {
    await Promise.all(images.map(async image => {
      await image.decode();
      if (!image.complete || image.naturalWidth < 1 || image.naturalHeight < 1) throw new Error("A question image could not be displayed. Retry before printing.");
    }));
  }, signal, timeoutMs);
}
