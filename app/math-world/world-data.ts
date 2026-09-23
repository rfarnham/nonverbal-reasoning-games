import { getWorldMapLayout } from "./map-layouts.ts";
import runtimeManifest from "./data/runtime.generated.json" with { type: "json" };

export type RealmId = "number_arithmetic" | "geometry_spatial" | "measurement_time" | "logic_constraints";
export type WorldDefinition = Readonly<{
  id: string; number: number; title: string; concept: string; conceptId: string;
  spiral: 1 | 2; theme: number; description: string; stopIds: readonly string[];
}>;
export type WorldQuestion = Readonly<{
  id: string; worldId: string; stopId: string; prompt: string;
  choices: readonly Readonly<{ label: string; accessibleLabel: string; visualOnly: boolean }>[];
  correctIndex: number; presentation: "semantic" | "source-card"; showPrompt?: boolean;
  asset: Readonly<{ src: string; width: number; height: number; alt: string; sha256?: string }>;
  source: Readonly<{
    year: number; gradeBand: string; questionNumber: number; sourceLabel: string;
    pointTier?: 3 | 4 | 5; sourceFamily?: string; tierBasis?: string;
    sourceKind?: "contest" | "practice" | "mock"; answerStatus?: string; contentVersion?: string;
  }>;
  curriculum: Readonly<{
    realmId: RealmId; districtId: string; skillIds: readonly string[];
    placementVersion: string; placementStatus: "provisional-playtest" | "agent-reviewed";
    proposalConfidence: number | null; primaryTopic?: string;
    secondaryTopics?: readonly string[]; strategies?: readonly string[];
    reasoningDemand?: number;
  }>;
}>;
export type MathStop = Readonly<{
  id: string; worldId: string; mapSlot: number;
  kind: "math-kangaroo" | "culmination";
  label: string; shortLabel: string; description: string;
  realmId: RealmId | "mixed"; districtLabel: string;
  x: number; y: number; mobileX: number; mobileY: number;
}>;
export type BreakStop = Readonly<{
  id: string; worldId: string; kind: "turbo" | "minigame";
  label: string; shortLabel: string; description: string; href: string; afterStopId: string;
  x: number; y: number; mobileX: number; mobileY: number;
}>;
export type WorldStop = MathStop | BreakStop;
export const REALMS = {
  number_arithmetic: { label: "Number & Operations", shortLabel: "Number Coast", color: "#f3bd4e", icon: "123" },
  geometry_spatial: { label: "Shape & Space", shortLabel: "Shape Cliffs", color: "#7767d7", icon: "◇" },
  measurement_time: { label: "Measurement & Modeling", shortLabel: "Clockwork Harbor", color: "#35a999", icon: "◷" },
  logic_constraints: { label: "Logic & Relationships", shortLabel: "Logic Lagoon", color: "#f06f5f", icon: "?" },
} as const;

type RuntimeManifest = Readonly<{
  schemaVersion: number; mode: "prototype" | "spiral-preview";
  contentVersion: string; ontologyVersion: string;
  worlds: readonly WorldDefinition[]; stops: readonly MathStop[];
  breaks: readonly BreakStop[]; questions: readonly WorldQuestion[];
}>;
const manifest = runtimeManifest as unknown as RuntimeManifest;
if (manifest.schemaVersion !== 2 || !manifest.contentVersion.trim()) throw new Error("Invalid Math Worlds manifest.");
export const WORLD_CONTENT_VERSION = manifest.contentVersion;
export const WORLD_ONTOLOGY_VERSION = manifest.ontologyVersion;
export const WORLD_MODE = manifest.mode;
export const WORLD_DEFINITIONS = manifest.worlds;
// Map presentation can evolve without invalidating the child's saved questions.
// Prototype data retains its original nine-stop coordinates and detours.
export const REQUIRED_STOPS: readonly MathStop[] = manifest.mode === "spiral-preview"
  ? manifest.stops.map(stop => {
    const world = manifest.worlds.find(candidate => candidate.id === stop.worldId);
    if (!world) throw new Error(`Unknown map world: ${stop.worldId}.`);
    const mapSlot = world.stopIds.indexOf(stop.id);
    const layout = getWorldMapLayout(world.number);
    const desktop = layout.desktop.stopPoints[mapSlot];
    const mobile = layout.mobile.stopPoints[mapSlot];
    if (!desktop || !mobile) throw new Error(`Missing map position: ${stop.id}.`);
    return { ...stop, mapSlot, x: desktop.x, y: desktop.y, mobileX: mobile.x, mobileY: mobile.y };
  })
  : manifest.stops;
export const BREAK_STOPS = manifest.breaks;
export const WORLD_STOPS: readonly WorldStop[] = [...REQUIRED_STOPS, ...BREAK_STOPS];
export const WORLD_QUESTIONS = manifest.questions;
export const QUESTIONS_BY_STOP = new Map(REQUIRED_STOPS.map(stop => [stop.id, WORLD_QUESTIONS.filter(question => question.stopId === stop.id)]));
export function stopsForWorld(worldId: string): readonly MathStop[] { return REQUIRED_STOPS.filter(stop => stop.worldId === worldId); }
export function breaksForWorld(worldId: string): readonly BreakStop[] { return BREAK_STOPS.filter(stop => stop.worldId === worldId); }
export function worldForStop(stopId: string | null): WorldDefinition | undefined {
  const stop = WORLD_STOPS.find(candidate => candidate.id === stopId);
  return WORLD_DEFINITIONS.find(world => world.id === stop?.worldId);
}
const worldIds = new Set(WORLD_DEFINITIONS.map(world => world.id));
const stopIds = new Set(REQUIRED_STOPS.map(stop => stop.id));
const questionIds = new Set<string>();
if (worldIds.size !== WORLD_DEFINITIONS.length || stopIds.size !== REQUIRED_STOPS.length || !worldIds.size) throw new Error("Duplicate or missing Math Worlds membership.");
for (const world of WORLD_DEFINITIONS) {
  const stops = stopsForWorld(world.id);
  if (!stops.length || stops.map(stop => stop.id).join() !== world.stopIds.join()) throw new Error(`Invalid world path: ${world.id}.`);
  if (new Set(stops.map(stop => stop.mapSlot)).size !== stops.length || stops.some(stop => !Number.isInteger(stop.mapSlot) || stop.mapSlot < 0 || stop.mapSlot > 8)) throw new Error(`Invalid map anchors: ${world.id}.`);
  const count = stops.reduce((sum, stop) => sum + (QUESTIONS_BY_STOP.get(stop.id)?.length ?? 0), 0);
  if (manifest.mode === "spiral-preview" && (count !== 24 || stops.length !== 4 || stops.some(stop => QUESTIONS_BY_STOP.get(stop.id)?.length !== 6))) throw new Error(`World must contain four stops of six questions: ${world.id}.`);
}
for (const question of WORLD_QUESTIONS) {
  if (!stopIds.has(question.stopId) || worldForStop(question.stopId)?.id !== question.worldId || questionIds.has(question.id)) throw new Error(`Invalid question membership: ${question.id}.`);
  if (![4,5].includes(question.choices.length) || !Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex >= question.choices.length) throw new Error(`Invalid choices: ${question.id}.`);
  if (manifest.mode === "spiral-preview" && !((question.source.gradeBand === "1-2" && [3,4,5].includes(question.source.pointTier ?? 0)) || (question.source.gradeBand === "3-4" && [3,4].includes(question.source.pointTier ?? 0)))) throw new Error(`Question outside curriculum scope: ${question.id}.`);
  questionIds.add(question.id);
}
for (const stop of REQUIRED_STOPS) {
  if (!worldIds.has(stop.worldId) || !(QUESTIONS_BY_STOP.get(stop.id)?.length)) throw new Error(`Empty Math World stop: ${stop.id}.`);
}
