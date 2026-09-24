#!/usr/bin/env node
/** Generate the runtime from the approved bank without modifying published assets. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const approvedInput = path.join(root, 'content/math-world/spiral-32.runtime.json');
const output = path.join(root, 'app/math-world/data/runtime.generated.json');
const assetPrefix = '/math-world/spiral-questions/';
const bossHoldouts = JSON.parse(await readFile(path.join(root, 'content/math-world/boss-holdouts.json'), 'utf8'));

/** Match source identity before consulting provenance; renamed copies still stay held out. */
export function findBossHoldout(question) {
  const source = question.source ?? question;
  const ids = [question.id, question.itemId, question.item_id, question.sourceId,
    source.id, source.itemId, source.item_id, source.sourceId, source.canonicalId, source.occurrenceId];
  const exact = bossHoldouts.challenges.find(challenge => challenge.questions.some(reference =>
    ids.includes(reference.sourceId) || reference.reservedReferences.some(alias => ids.includes(alias.id))));
  if (exact) return exact;

  const rule = bossHoldouts.matchingPolicy.metadataFallback;
  const family = String(source.sourceFamily ?? source.source_family ?? '');
  const sourceKind = source.sourceKind ?? source.source_kind ?? 'contest';
  const paperPart = source.paperPart ?? source.paper_part ?? '';
  const markers = `${family} ${paperPart}`.toLowerCase().split(/[^a-z]+/);
  if (!family.toLowerCase().startsWith(rule.sourceFamilyPrefix.toLowerCase())
    || rule.excludedSourceKinds.includes(sourceKind)
    || rule.excludedSourceMarkers.some(marker => markers.includes(marker))) return undefined;
  return bossHoldouts.challenges.find(challenge => Number(source.year) === challenge.year
    && (source.gradeBand ?? source.grade_band) === challenge.gradeBand);
}

export function assertNotBossHoldout(question) {
  const challenge = findBossHoldout(question);
  if (challenge) throw new Error(`Math Worlds boss holdout: ${question.id ?? question.itemId ?? question.item_id} is reserved for the ${challenge.year} Grades ${challenge.gradeBand} challenge after world ${challenge.afterWorldNumber}. Remove it from the teaching worlds; keep the complete test separate (content/math-world/boss-holdouts.json).`);
}

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
  requireValid(Array.isArray(payload.worlds) && payload.worlds.length === 32, 'expected 32 worlds.');
  requireValid(Array.isArray(payload.stops) && payload.stops.length >= 64 && payload.stops.length <= 128, 'expected two to four stops per world.');
  requireValid(Array.isArray(payload.questions), 'expected the authored question bank.');
  requireValid(new Set(payload.worlds.slice(0,16).map(world => world.conceptId)).size === 16
    && payload.worlds.every((world,index) => typeof world.conceptId === 'string' && world.conceptId.trim()
      && world.number === index + 1 && world.spiral === (index < 16 ? 1 : 2)
      && world.conceptId === payload.worlds[index % 16].conceptId), 'expected two ordered passes through sixteen concepts.');
  requireValid(Array.isArray(payload.breaks) && payload.breaks.length === 0, 'expected no optional break stops.');
  const worlds = uniqueById(payload.worlds, 'world');
  const stops = uniqueById(payload.stops, 'stop');
  uniqueById(payload.questions, 'question');
  const assets = new Map();
  const counts = new Map(payload.stops.map(stop => [stop.id, 0]));

  for (const world of worlds.values()) {
    const members = payload.stops.filter(stop => stop.worldId === world.id);
    requireValid(Array.isArray(world.stopIds) && world.stopIds.length >= 2 && world.stopIds.length <= 4 && members.length === world.stopIds.length
      && world.stopIds.every((id, index) => members[index].id === id), `world ${world.id} must have two to four ordered stops.`);
    requireValid(Number.isInteger(world.questionCount) && world.questionCount >= 10 && world.questionCount <= 24, `invalid authored question count for ${world.id}.`);
    requireValid(new Set(members.map(stop => stop.mapSlot)).size === members.length
      && members.every(stop => Number.isInteger(stop.mapSlot) && stop.mapSlot >= 0 && stop.mapSlot <= 8), `invalid map anchors in ${world.id}.`);
  }
  for (const stop of stops.values()) requireValid(worlds.has(stop.worldId), `unknown world for ${stop.id}.`);
  for (const question of payload.questions) {
    assertNotBossHoldout(question);
    requireValid(stops.has(question.stopId) && stops.get(question.stopId).worldId === question.worldId, `invalid question membership for ${question.id}.`);
    counts.set(question.stopId, counts.get(question.stopId) + 1);
    requireValid(Array.isArray(question.choices) && [2, 3, 4, 5].includes(question.choices.length)
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
  for (const [id, count] of counts) requireValid([5,6].includes(count), `stop ${id} must contain five or six questions, found ${count}.`);
  for (const world of worlds.values()) requireValid(world.stopIds.reduce((sum,id) => sum + counts.get(id), 0) === world.questionCount, `world ${world.id} does not match its authored question count.`);
  return assets;
}

/** Compatibility is granted only while every previously playable question stays identical. */
async function validateProgressCompatibility(payload) {
  const versions = payload.compatibleProgressVersions ?? [];
  requireValid(Array.isArray(versions) && new Set(versions).size === versions.length, 'invalid progress compatibility versions.');
  if (!versions.length) return;
  const previous = await readManifest(path.join(root, 'content/math-world/spiral-20.runtime.json'), 'previous curriculum');
  requireValid(versions.length === 1 && versions[0] === previous.contentVersion, 'unknown progress compatibility version.');
  const questions = new Map(payload.questions.map(question => [question.id, question]));
  const worlds = new Map(payload.worlds.map(world => [world.id, world]));
  for (const question of previous.questions) requireValid(JSON.stringify(questions.get(question.id)) === JSON.stringify(question), `progress compatibility requires unchanged question ${question.id}.`);
  for (const world of previous.worlds) {
    const current = worlds.get(world.id);
    requireValid(current && current.conceptId === world.conceptId && current.spiral === world.spiral
      && JSON.stringify(current.stopIds) === JSON.stringify(world.stopIds), `progress compatibility requires unchanged stops for ${world.id}.`);
    for (const id of world.stopIds) requireValid(JSON.stringify(payload.questions.filter(question => question.stopId === id).map(question => question.id))
      === JSON.stringify(previous.questions.filter(question => question.stopId === id).map(question => question.id)), `progress compatibility requires unchanged order in ${id}.`);
  }
}

async function generateRuntime() {
  const approved = await readManifest(approvedInput, 'approved');
  const approvedAssets = validateBank(approved);
  await validateProgressCompatibility(approved);
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
    await validateProgressCompatibility(payload);
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
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) await generateRuntime();
