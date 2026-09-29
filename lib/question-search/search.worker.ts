import { QuestionSearchIndex } from "./engine";
import type { SearchCorpus, SearchQuery } from "./types";

let index: QuestionSearchIndex | null = null;
self.onmessage = (event: MessageEvent<{ id: number; corpus?: SearchCorpus; query?: SearchQuery }>) => {
  const { id, corpus, query } = event.data;
  try {
    if (corpus) { index = new QuestionSearchIndex(corpus); self.postMessage({ id, ready: true }); }
    else if (query && index) self.postMessage({ id, result: index.search(query) });
    else throw new Error("Search is not ready yet.");
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Search could not finish." });
  }
};
