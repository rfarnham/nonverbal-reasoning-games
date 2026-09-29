import type { SearchCorpus, SearchHit, SearchQuery, SearchQuestion, SearchResponse } from "./types.ts";

const STOP = new Set("a an the and or of to in on at by for from with as is are was were be been being this that these those it its he she they them his her their what which who how many much does do did has have had can could will would should shown show figure picture question find choose answer following correct below above according using given one".split(" "));
const ALIASES = [
  "rotate rotation rotated rotating turn turns clockwise anticlockwise counterclockwise",
  "reflect reflection reflected mirror mirrored symmetry symmetric symmetrical",
  "backward backwards reverse undo inverse initial originally before start starting",
  "path paths route routes navigate navigation maze mazes journey",
  "fold folded folding unfold unfolded unfolding net nets paper",
  "cube cubes cuboid cuboids block blocks stack stacked stacking",
  "count counting enumerate enumeration possibilities combinations arrangements",
  "cycle cycles cyclic repeating repeat periodic periodicity pattern patterns",
  "parity odd even oddness evenness",
  "balance balanced scale scales weight weighs weigh mass equal equality",
  "invariant conservation conserve conserved unchanged total transfer transfers",
  "area areas surface cover covering tile tiles tiling",
  "perimeter boundary border fence fences length lengths",
  "fraction fractions half halves quarter quarters part parts proportion ratio ratios",
  "logic logical deduce deduction clue clues constraint constraints eliminate elimination",
  "overlap overlapping intersection intersect common shared both",
  "minimum least fewest smallest minimize maximum most largest greatest optimize",
  "order ordering position positions row rows lineup line queue queues rank ranking",
  "time clock clocks minute minutes hour hours elapsed duration",
];

/** Stable tokenizer shared by the browser, CLI and evaluation harness. */
export function tokenize(text: string): string[] {
  return (text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(word => word.length > 1 && !STOP.has(word));
}

function terms(text: string, expand: boolean): Map<string, number> {
  const result = new Map<string, number>();
  for (const word of tokenize(text)) result.set(word, (result.get(word) ?? 0) + 1);
  if (expand) for (const group of ALIASES) {
    const words = group.split(" ");
    if (words.some(word => result.has(word))) for (const word of words) {
      if (!result.has(word)) result.set(word, 0.24);
    }
  }
  return result;
}

type Posting = { index: number; frequency: number };
class TextField {
  private postings = new Map<string, Posting[]>();
  private lengths: number[] = [];
  private average = 1;
  constructor(texts: string[]) {
    texts.forEach((text, index) => {
      const frequencies = terms(text, false);
      this.lengths[index] = [...frequencies.values()].reduce((a, b) => a + b, 0);
      for (const [term, frequency] of frequencies) {
        const postings = this.postings.get(term) ?? [];
        postings.push({ index, frequency });
        this.postings.set(term, postings);
      }
    });
    this.average = Math.max(1, this.lengths.reduce((a, b) => a + b, 0) / texts.length);
  }
  score(query: Map<string, number>): Float64Array {
    const scores = new Float64Array(this.lengths.length);
    for (const [term, weight] of query) {
      const postings = this.postings.get(term);
      if (!postings) continue;
      const idf = Math.log(1 + (this.lengths.length - postings.length + 0.5) / (postings.length + 0.5));
      for (const { index, frequency } of postings) {
        const norm = frequency + 1.2 * (0.25 + 0.75 * this.lengths[index] / this.average);
        scores[index] += idf * frequency * 2.2 / norm * Math.min(weight, 2);
      }
    }
    return scores;
  }
}

function strings(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== "string" || v.length > 200)) {
    throw new Error(`${name} must be a list of at most 100 short strings.`);
  }
  return [...new Set(value as string[])];
}

/** A recipe is data only. Unknown keys are rejected, never executed. */
export function parseSearchQuery(value: unknown): SearchQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter a search recipe object.");
  const record = value as Record<string, unknown>;
  const allowed = new Set(["text", "topics", "strategies", "grade", "source", "mode", "excludeIds", "excludeFamily", "imageHash", "dhash", "limit", "offset"]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) throw new Error(`Unknown recipe field: ${key}.`);
  if (record.text !== undefined && (typeof record.text !== "string" || record.text.length > 20000)) throw new Error("Search text must be at most 20,000 characters.");
  for (const field of ["grade", "source", "excludeFamily", "imageHash", "dhash"] as const) {
    if (record[field] !== undefined && (typeof record[field] !== "string" || (record[field] as string).length > 200)) throw new Error(`Invalid ${field}.`);
  }
  if (record.imageHash !== undefined && !/^[a-f0-9]{64}$/i.test(String(record.imageHash))) throw new Error("Invalid image fingerprint.");
  if (record.dhash !== undefined && !/^[a-f0-9]{16}$/i.test(String(record.dhash))) throw new Error("Invalid visual fingerprint.");
  if (record.mode !== undefined && !["hybrid", "text", "strategy", "visual"].includes(String(record.mode))) throw new Error("Unknown search mode.");
  for (const field of ["limit", "offset"] as const) if (record[field] !== undefined && (!Number.isSafeInteger(record[field]) || Number(record[field]) < (field === "limit" ? 1 : 0) || Number(record[field]) > (field === "limit" ? 1000 : 100000))) throw new Error(`Invalid ${field}.`);
  return {
    ...record, text: (record.text as string | undefined) ?? "",
    topics: strings(record.topics, "topics"), strategies: strings(record.strategies, "strategies"),
    excludeIds: strings(record.excludeIds, "excludeIds"),
  } as SearchQuery;
}

export function hashDistance(left: string, right: string): number {
  if (!/^[a-f0-9]{16}$/i.test(left) || !/^[a-f0-9]{16}$/i.test(right)) return 64;
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (bits) { bits &= bits - BigInt(1); distance++; }
  return distance;
}

export function validateCorpus(value: unknown): asserts value is SearchCorpus {
  if (!value || typeof value !== "object") throw new Error("Invalid question pack.");
  const corpus = value as SearchCorpus;
  if (corpus.schemaVersion !== 1 || typeof corpus.version !== "string" || !corpus.version || !Array.isArray(corpus.questions) || !corpus.questions.length || corpus.questions.length > 100000 || !corpus.facets?.topics || !corpus.facets?.strategies) throw new Error("Unsupported question pack.");
  const ids = new Set<string>();
  for (const q of corpus.questions) {
    if (!q || typeof q.id !== "string" || ids.has(q.id) || typeof q.version !== "string" || typeof q.prompt !== "string" || typeof q.structure !== "string" || typeof q.method !== "string" || typeof q.description !== "string" || !Array.isArray(q.topics) || !Array.isArray(q.strategies) || !Array.isArray(q.options) || !q.image || !/^assets\/[a-f0-9]{64}\.bin$/.test(q.image.path) || !q.source || typeof q.source.grade !== "string") throw new Error("Invalid question record.");
    ids.add(q.id);
  }
  if (corpus.semantic) {
    const model = corpus.semantic;
    const finiteRow = (row: unknown, length: number) => Array.isArray(row) && row.length === length && row.every(n => typeof n === "number" && Number.isFinite(n));
    if (!Number.isInteger(model.dimensions) || model.dimensions < 1 || model.dimensions > 256 || !Array.isArray(model.vocabulary) || model.vocabulary.length > 20000 || new Set(model.vocabulary).size !== model.vocabulary.length || model.vocabulary.some(t => typeof t !== "string") ||
      !finiteRow(model.idf, model.vocabulary.length) || !Array.isArray(model.components) || model.components.length !== model.dimensions || model.components.some(row => !finiteRow(row, model.vocabulary.length)) ||
      !Array.isArray(model.vectors) || model.vectors.length !== corpus.questions.length || model.vectors.some(row => !finiteRow(row, model.dimensions))) throw new Error("Invalid semantic search model.");
  }
}

/** Deterministic fielded BM25. Every eligible record is scored; no hidden top-k cutoff. */
export class QuestionSearchIndex {
  readonly corpus: SearchCorpus;
  private text: TextField;
  private structure: TextField;
  private strategy: TextField;
  private semanticVocabulary: Map<string, number>;
  constructor(corpus: SearchCorpus) {
    validateCorpus(corpus);
    this.corpus = corpus;
    this.semanticVocabulary = new Map(corpus.semantic?.vocabulary.map((word, index) => [word, index]) ?? []);
    const topic = (q: SearchQuestion) => q.topics.map(id => corpus.facets.topics[id] ?? id).join(" ");
    const strategy = (q: SearchQuestion) => q.strategies.map(id => corpus.facets.strategies[id] ?? id).join(" ");
    this.text = new TextField(corpus.questions.map(q => `${q.prompt} ${q.originalPrompt} ${q.options.join(" ")} ${q.id}`));
    this.structure = new TextField(corpus.questions.map(q => `${q.description} ${q.structure} ${topic(q)}`));
    this.strategy = new TextField(corpus.questions.map(q => `${q.method} ${strategy(q)}`));
  }

  search(input: SearchQuery): SearchResponse {
    const query = parseSearchQuery(input);
    const expanded = terms(query.text, true);
    const text = this.text.score(terms(query.text, false));
    const structure = this.structure.score(expanded);
    const strategy = this.strategy.score(expanded);
    const semantic = this.semanticScores(query.text);
    const mode = query.mode ?? "hybrid";
    const excluded = new Set(query.excludeIds ?? []);
    const hasQuery = tokenize(query.text).length > 0 || Boolean(query.imageHash || query.dhash);
    const hits: SearchHit[] = [];
    this.corpus.questions.forEach((question, index) => {
      if (excluded.has(question.id) || (query.excludeFamily && question.family === query.excludeFamily) ||
          (query.grade && question.source.grade !== query.grade) || (query.source && question.source.label !== query.source) ||
          (query.topics?.length && !query.topics.some(id => question.topics.includes(id))) ||
          (query.strategies?.length && !query.strategies.some(id => question.strategies.includes(id)))) return;
      const reasons: string[] = [];
      let visual = 0;
      if (query.imageHash && query.imageHash === question.image.hash) { visual = 100; reasons.push("Exact image fingerprint"); }
      else if (query.dhash) {
        const distance = hashDistance(query.dhash, question.image.dhash);
        if (distance <= 12) { visual = (13 - distance) / 13 * 8; reasons.push("Similar image layout; inspect the details"); }
      }
      const latent = Math.max(0, semantic[index] - 0.18) * 10;
      let score = mode === "text" ? text[index] : mode === "strategy" ? strategy[index] * 1.8 + structure[index] + text[index] * 0.3 + latent : mode === "visual" ? visual : text[index] + structure[index] * 0.85 + strategy[index] * 1.2 + visual + latent;
      if (query.text.trim().toLowerCase() === question.id.toLowerCase()) { score += 200; reasons.push("Exact question ID"); }
      if (hasQuery && score <= 0) return;
      if (text[index] > 0) reasons.push("Question wording matches");
      if (structure[index] > 0) reasons.push("Type or structure description matches");
      if (strategy[index] > 0) reasons.push("Method description matches");
      if (latent > 0 && mode !== "text" && mode !== "visual") reasons.push("Related vocabulary in the question bank");
      if (query.topics?.length) reasons.push("Selected question type");
      if (query.strategies?.length) reasons.push("Selected method");
      if (!reasons.length) reasons.push("Browse the question bank");
      hits.push({ question, score, reasons, signals: { text: text[index], structure: structure[index], strategy: strategy[index], visual } });
    });
    hits.sort((a, b) => b.score - a.score || a.question.id.localeCompare(b.question.id, "en"));
    const offset = query.offset ?? 0;
    return { hits: hits.slice(offset, offset + (query.limit ?? 24)), total: hits.length, query };
  }

  private semanticScores(text: string): Float64Array {
    const result = new Float64Array(this.corpus.questions.length);
    const model = this.corpus.semantic;
    if (!model) return result;
    const projected = new Float64Array(model.dimensions);
    for (const [term, frequency] of terms(text, false)) {
      const position = this.semanticVocabulary.get(term);
      if (position === undefined) continue;
      const weight = (1 + Math.log(frequency)) * model.idf[position];
      for (let d = 0; d < model.dimensions; d++) projected[d] += model.components[d][position] * weight;
    }
    const norm = Math.sqrt(projected.reduce((sum, v) => sum + v * v, 0));
    if (!norm) return result;
    for (let i = 0; i < result.length; i++) {
      for (let d = 0; d < model.dimensions; d++) result[i] += model.vectors[i][d] * projected[d] / norm;
    }
    return result;
  }
}
