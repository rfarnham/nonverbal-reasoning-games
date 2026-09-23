#!/usr/bin/env node
/** Generate the runtime from the approved bank without modifying published assets. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const approvedInput = path.join(root, 'content/math-world/spiral-20.runtime.json');
const output = path.join(root, 'app/math-world/data/runtime.generated.json');
const assetPrefix = '/math-world/spiral-questions/';

function requireValid(condition, message) {
  if (!condition) throw new Error(`Invalid Math Worlds bank: ${message}`);
}

async function readManifest(input, label) {
  try {
    return JSON.parse(await readFile(input, 'utf8'));
  } catch (cause) {
    throw new Error(`Cannot read ${label} Math Worlds manifest: ${input}`, { cause });
  }
}

function uniqueById(records, label) {
  const result = new Map();
  for (const record of records) {
    requireValid(typeof record?.id === 'string' && record.id.trim() && !result.has(record.id), `duplicate or missing ${label} ID.`);
    result.set(record.id, record);
  }
  return result;
}

function validateBank(payload) {
  requireValid(payload?.schemaVersion === 2 && payload.mode === 'spiral-preview', 'expected schema 2 and spiral-preview mode.');
  requireValid(typeof payload.contentVersion === 'string' && payload.contentVersion.trim(), 'missing content version.');
  requireValid(typeof payload.ontologyVersion === 'string' && payload.ontologyVersion.trim(), 'missing ontology version.');
  requireValid(Array.isArray(payload.worlds) && payload.worlds.length === 20, 'expected 20 worlds.');
  requireValid(Array.isArray(payload.stops) && payload.stops.length === 80, 'expected 80 stops.');
  requireValid(Array.isArray(payload.questions) && payload.questions.length === 480, 'expected 480 questions.');
  requireValid(Array.isArray(payload.breaks) && payload.breaks.length === 0, 'expected no optional break stops.');
  const worlds = uniqueById(payload.worlds, 'world');
  const stops = uniqueById(payload.stops, 'stop');
  uniqueById(payload.questions, 'question');
  const assets = new Map();
  const counts = new Map(payload.stops.map(stop => [stop.id, 0]));

  for (const world of worlds.values()) {
    const members = payload.stops.filter(stop => stop.worldId === world.id);
    requireValid(Array.isArray(world.stopIds) && world.stopIds.length === 4 && members.length === 4
      && world.stopIds.every((id, index) => members[index].id === id), `world ${world.id} must have four ordered stops.`);
    requireValid(new Set(members.map(stop => stop.mapSlot)).size === 4
      && members.every(stop => Number.isInteger(stop.mapSlot) && stop.mapSlot >= 0 && stop.mapSlot <= 8), `invalid map anchors in ${world.id}.`);
  }
  for (const stop of stops.values()) requireValid(worlds.has(stop.worldId), `unknown world for ${stop.id}.`);
  for (const question of payload.questions) {
    requireValid(stops.has(question.stopId) && stops.get(question.stopId).worldId === question.worldId, `invalid question membership for ${question.id}.`);
    counts.set(question.stopId, counts.get(question.stopId) + 1);
    requireValid(Array.isArray(question.choices) && [4, 5].includes(question.choices.length)
      && Number.isInteger(question.correctIndex) && question.correctIndex >= 0
      && question.correctIndex < question.choices.length, `invalid answer choices for ${question.id}.`);
    requireValid((question.source?.gradeBand === '1-2' && [3, 4, 5].includes(question.source.pointTier))
      || (question.source?.gradeBand === '3-4' && [3, 4].includes(question.source.pointTier)), `question outside approved grades and point tiers: ${question.id}.`);
    const asset = question.asset;
    requireValid(typeof asset?.src === 'string' && asset.src.startsWith(assetPrefix)
      && /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:webp|png|jpe?g)$/.test(asset.src.slice(assetPrefix.length)), `invalid asset reference for ${question.id}.`);
    requireValid(/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') && Number.isFinite(asset.width)
      && asset.width > 0 && Number.isFinite(asset.height) && asset.height > 0, `invalid asset metadata for ${question.id}.`);
    requireValid(!assets.has(asset.src), `repeated question asset: ${asset.src}.`);
    assets.set(asset.src, asset.sha256);
  }
  for (const [id, count] of counts) requireValid(count === 6, `stop ${id} must contain six questions, found ${count}.`);
  return assets;
}

const approved = await readManifest(approvedInput, 'approved');
const approvedAssets = validateBank(approved);
await Promise.all([...approvedAssets].map(async ([src, expected]) => {
  const filename = path.join(root, 'public', src.slice(1));
  let bytes;
  try { bytes = await readFile(filename); }
  catch (cause) { throw new Error(`Missing or unreadable approved Math Worlds asset: ${src}`, { cause }); }
  requireValid(createHash('sha256').update(bytes).digest('hex') === expected, `asset hash mismatch: ${src}.`);
}));

let payload = approved;
// An optional local wording/order variant can reuse approved images. It never
// copies unpublished assets into the public tree or changes the approved bank.
if (process.env.MATH_WORLD_PREVIEW === '1' && process.env.MATH_WORLD_PREVIEW_MANIFEST) {
  const input = path.resolve(root, process.env.MATH_WORLD_PREVIEW_MANIFEST);
  payload = await readManifest(input, 'preview');
  for (const [src, hash] of validateBank(payload)) {
    requireValid(approvedAssets.get(src) === hash, `preview asset is not in the approved bank: ${src}.`);
  }
}

const serialized = JSON.stringify(payload, null, 2) + '\n';
let old;
try { old = await readFile(output, 'utf8'); } catch {}
if (old !== serialized) {
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, serialized);
  await rename(temporary, output);
}
