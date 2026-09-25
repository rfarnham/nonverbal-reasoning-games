export type GlobeBiomeId = "tropical" | "alpine" | "orchard" | "woodland" | "volcanic" | "lagoon" | "river" | "desert" | "rainforest" | "glacier" | "tundra" | "waterfalls" | "mangrove" | "autumn" | "terraces" | "basalt";
export type GlobeBiome = Readonly<{ id: GlobeBiomeId; label: string; variant: 1 | 2 }>;
const BIOME_IDS: readonly GlobeBiomeId[] = ["tropical", "alpine", "orchard", "woodland", "volcanic", "lagoon", "river", "desert", "rainforest", "glacier", "tundra", "waterfalls", "mangrove", "autumn", "terraces", "basalt"];
const BIOME_LABELS = [
  ["Palm coves & sea stacks", "Turquoise bays & limestone towers"], ["Alpine lakes & pine ridges", "Crystal lakes & snowy peaks"],
  ["Citrus orchards & rolling hills", "Blossom terraces & fruit groves"], ["Mushroom woods & mossy boulders", "Redwood groves & fern valleys"],
  ["Smoking volcanoes & lava craters", "Obsidian calderas & lava flows"], ["Coral atolls & turquoise lagoons", "Reef gardens & sheltered lagoons"],
  ["Winding rivers & green valleys", "Braided streams & river gardens"], ["Sand dunes & layered mesas", "Red-rock canyons & desert oases"],
  ["Lush rainforest & giant trees", "Cloud forest & jungle ridges"], ["Blue glaciers & frozen fjords", "Jagged icebergs & glacier tongues"],
  ["Snowy tundra & granite peaks", "Frozen plateaus & icy cliffs"], ["Cascading falls & emerald pools", "Highland rivers & waterfall steps"],
  ["Mangrove roots & tidal channels", "Marsh islands & reed lagoons"], ["Golden woods & mossy stones", "Crimson forests & pine clearings"],
  ["Green terraces & mountain springs", "Alpine meadows & stepped valleys"], ["Basalt columns & stone arches", "Rock bridges & basalt towers"],
] as const;

/** Geography changes on the second spiral without moving its authored landing sites. */
export function getWorldBiome(worldNumber: number): GlobeBiome {
  if (!Number.isInteger(worldNumber) || worldNumber < 1 || worldNumber > 32) throw new Error(`Unknown biome world: ${worldNumber}`);
  const index = (worldNumber - 1) % 16;
  const variant = worldNumber > 16 ? 2 : 1;
  return { id: BIOME_IDS[index], label: BIOME_LABELS[index][variant - 1], variant };
}

/** One skyline anchor per archipelago, with smaller foothills on the way there. */
export function getIslandRelief(worldNumber: number, stopIndex: number, stopCount: number): Readonly<{
  role: "landmark" | "foothill" | "outcrop"; scale: number; vegetationDensity: number;
}> {
  getWorldBiome(worldNumber);
  if (!Number.isInteger(stopCount) || stopCount < 2 || stopCount > 4 || !Number.isInteger(stopIndex) || stopIndex < 0 || stopIndex >= stopCount) throw new Error("Unknown island composition.");
  if (stopIndex === stopCount - 1) return { role: "landmark", scale: 1.06, vegetationDensity: 1 };
  const scale = stopCount === 2 ? 0.64 : stopIndex === 0 ? 0.72 : (stopIndex + worldNumber) % 2 ? 0.52 : 0.82;
  return { role: scale < 0.6 ? "outcrop" : "foothill", scale, vegetationDensity: scale < 0.6 ? 0.45 : 0.7 };
}
