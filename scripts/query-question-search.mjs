import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BOOLEAN_ARGS = new Set(["help", "details", "exclude-family"]);
const VALUE_ARGS = new Set(["corpus", "manifest", "password-file", "query", "query-file", "question", "ids", "limit", "offset", "mode", "judgments", "split"]);

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (!argument.startsWith("--")) throw new Error("Use --query for search text. Run with --help for usage.");
    const key = argument.slice(2);
    if (BOOLEAN_ARGS.has(key)) args[key] = true;
    else if (VALUE_ARGS.has(key)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`--${key} needs a value.`);
      args[key] = value;
    } else throw new Error(`Unknown option --${key}.`);
  }
  return args;
}

/** Read only an index or the sibling benchmark; authenticated bytes stay in memory. */
export async function loadEncryptedSearchFile(args, purpose = "index") {
    if (!args.manifest) throw new Error("--manifest is required for encrypted data.");
    if (!["index", "benchmark"].includes(purpose)) throw new Error("Unknown encrypted resource.");
    const manifestPath = path.resolve(args.manifest);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const { validateManifest, deriveSearchKey, decryptSearchBytes } = await import("../lib/question-search/crypto.ts");
    validateManifest(manifest);
    const resource = purpose === "index" ? manifest.index.path : "benchmark.bin";
    const indexPath = path.resolve(path.dirname(manifestPath), resource);
    const relative = path.relative(path.dirname(manifestPath), indexPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Index must be inside the manifest directory.");
    const encrypted = await readFile(indexPath);
    if (purpose === "index" && (encrypted.byteLength !== manifest.index.bytes || createHash("sha256").update(encrypted).digest("hex") !== manifest.index.sha256)) {
      throw new Error("Encrypted index failed its size or SHA-256 check.");
    }
    const password = args["password-file"]
      ? (await readFile(args["password-file"], "utf8")).trimEnd()
      : process.env.QUESTION_SEARCH_PASSWORD;
    if (!password) throw new Error("Supply --password-file or QUESTION_SEARCH_PASSWORD for encrypted input.");
    const key = await deriveSearchKey(password, manifest.encryption);
    try {
      return await decryptSearchBytes(encrypted, key, `question-search/v1/${manifest.version}/${resource}`);
    } catch {
      throw new Error("Unable to unlock the resource. Check the password and bundle version.");
    }
}

/** Never accepts a password on the command line or writes decrypted content. */
export async function loadSearchCorpus(args) {
  if (Boolean(args.corpus) === Boolean(args.manifest)) throw new Error("Supply exactly one of --corpus or --manifest.");
  const bytes = args.corpus ? await readFile(args.corpus) : await loadEncryptedSearchFile(args);
  const corpus = JSON.parse(new TextDecoder().decode(bytes));
  if (corpus.schemaVersion !== 1 || typeof corpus.version !== "string" || !Array.isArray(corpus.questions)) {
    throw new Error("Unsupported search corpus.");
  }
  return corpus;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.corpus && !args.manifest)) {
    console.log(`Usage: node scripts/query-question-search.mjs --corpus <private.json> --query "search text"
  --manifest <manifest.json> --password-file <private-file>  Read an encrypted pack instead
  --query-file <recipe.json>                               Read a validated structured query
  --question <id>                                         Search using a known question; exclude itself
  --ids <id1,id2>                                         Inspect exact records without ranking
  --limit <1-100> --offset <n> --mode hybrid|text|strategy|visual
  --details                                              Include complete question records
Use QUESTION_SEARCH_PASSWORD instead of --password-file if preferred. Passwords are never printed.
Output is JSON. Decrypted output can contain private questions; save it only in a private location.`);
    return;
  }
  const corpus = await loadSearchCorpus(args);
  if (args.ids) {
    const ids = [...new Set(args.ids.split(",").filter(Boolean))];
    const lookup = new Map(corpus.questions.map((question) => [question.id, question]));
    console.log(JSON.stringify({ schemaVersion: 1, corpusVersion: corpus.version,
      questions: ids.flatMap((id) => lookup.has(id) ? [lookup.get(id)] : []),
      missingIds: ids.filter((id) => !lookup.has(id)) }, null, 2));
    return;
  }
  const { QuestionSearchIndex, parseSearchQuery } = await import("../lib/question-search/engine.ts");
  let recipe = args["query-file"] ? JSON.parse(await readFile(args["query-file"], "utf8")) : { text: args.query ?? "" };
  if (args.question) {
    const question = corpus.questions.find((item) => item.id === args.question);
    if (!question) throw new Error("Question ID was not found in this corpus version.");
    recipe = { ...recipe, text: [question.prompt, question.structure, question.method].filter(Boolean).join(" "),
      excludeIds: [question.id], ...(args["exclude-family"] && question.family ? { excludeFamily: question.family } : {}) };
  }
  if (args.mode) recipe.mode = args.mode;
  if (args.limit) recipe.limit = Number(args.limit);
  if (args.offset) recipe.offset = Number(args.offset);
  const query = parseSearchQuery(recipe);
  const index = new QuestionSearchIndex(corpus);
  const response = index.search(query);
  const hits = args.details ? response.hits : response.hits.map(({ question, ...hit }) => ({ ...hit,
    id: question.id, version: question.version, prompt: question.prompt,
    source: question.source, image: question.image, topics: question.topics,
    strategies: question.strategies, annotationStatus: question.annotationStatus }));
  console.log(JSON.stringify({ schemaVersion: 1, corpusVersion: corpus.version, ...response, hits }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
