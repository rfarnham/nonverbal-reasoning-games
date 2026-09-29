/** Build-only bridge: use precisely the browser tokenizer when training LSA. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { tokenize } from "../lib/question-search/engine.ts";

export function semanticDocuments(corpus) {
  return corpus.questions.map(q => [
    q.prompt, q.description, q.structure, q.method,
    q.topics.map(id => corpus.facets.topics[id] ?? id).join(" "),
    q.strategies.map(id => corpus.facets.strategies[id] ?? id).join(" "),
  ].join(" "));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("Pass the private corpus JSON path.");
  const corpus = JSON.parse(await readFile(process.argv[2], "utf8"));
  process.stdout.write(JSON.stringify({
    ids: corpus.questions.map(q => q.id),
    tokens: semanticDocuments(corpus).map(tokenize),
  }));
}
