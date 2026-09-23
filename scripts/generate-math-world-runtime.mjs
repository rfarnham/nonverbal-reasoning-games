#!/usr/bin/env node
/** Materialize the local runtime. Private corpus content is opt-in and never fetched by the browser. */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as legacy from '../app/math-world/legacy-world-data.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privatePreview = process.env.MATH_WORLD_PREVIEW === '1';
let payload;
const privateAssets = path.join(root, "public/math-world/spiral-questions");
await rm(privateAssets, { recursive: true, force: true });
if (privatePreview) {
  const input = process.env.MATH_WORLD_PREVIEW_MANIFEST || path.join(root, 'work/math-world-curriculum-20/runtime/manifest.json');
  payload = JSON.parse(await readFile(input, 'utf8'));
  if (payload.schemaVersion !== 2 || payload.mode !== 'spiral-preview' || payload.worlds?.length !== 20) {
    throw new Error('The private spiral preview requires a complete, validated 20-world manifest.');
  }
  await cp(path.join(path.dirname(input), "assets"), privateAssets, { recursive: true });
} else {
  const id = 'counting-coast-prototype';
  payload = {
    schemaVersion: 2, mode: 'prototype', contentVersion: legacy.WORLD_CONTENT_VERSION,
    ontologyVersion: legacy.WORLD_ONTOLOGY_VERSION,
    worlds: [{ id, number: 1, title: 'Counting Coast', concept: 'Counting', conceptId: 'counting', spiral: 1,
      theme: 0, description: 'A little curiosity. A whole island to discover.', stopIds: legacy.REQUIRED_STOPS.map(stop => stop.id) }],
    stops: legacy.REQUIRED_STOPS.map((stop, index) => ({ ...stop, worldId: id, mapSlot: index })),
    breaks: legacy.BREAK_STOPS.map(stop => ({ ...stop, worldId: id })),
    questions: legacy.WORLD_QUESTIONS.map(question => ({ ...question, worldId: id })),
  };
}
const output = path.join(root, 'app/math-world/data/runtime.generated.json');
await mkdir(path.dirname(output), { recursive: true });
const serialized = JSON.stringify(payload, null, 2) + '\n';
let old;
try { old = await readFile(output, 'utf8'); } catch {}
if (old !== serialized) await writeFile(output, serialized);
