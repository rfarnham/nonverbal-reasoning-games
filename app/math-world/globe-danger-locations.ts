/** Fixed sea encounters, independent of profile progress and question selection.
 * The complete scenic disks clear continents, archipelagos, polar ice, both
 * hurricane passages, and one another. They preserve every existing harbor. */
export type GlobeDangerKind = "squall" | "kraken" | "maelstrom" | "fog" | "icebergs" | "reef";
const coordinates = [
  [36.839791, -56.742080], [39.086874, 53.117142],
  [-7.940326, 26.174832], [-2.016623, 90.732496],
  [7.169722, 59.373285], [9.444234, 81.621695],
  [10.815104, 152.926612], [64.720003, 177.151935],
  [-35.364271, 127.134136], [-39.124776, -128.790985],
  [15.249544, 178.839492], [-7.328583, -117.209823],
  [8.348212, -88.156221], [-6.299957, -98.700361],
  [6.296879, -62.026648], [-45.337098, -1.045150],
] as const;
// Iceberg crossings use the northern passage and the two southern ocean pockets.
const kinds: readonly GlobeDangerKind[] = [
  "squall", "kraken", "maelstrom", "fog", "reef", "squall", "kraken", "icebergs",
  "maelstrom", "icebergs", "fog", "reef", "squall", "kraken", "maelstrom", "icebergs",
];

export const GLOBE_DANGER_LOCATIONS = coordinates.map(([latitude, longitude], index) => ({
  id: `danger-${String((index + 1) * 2).padStart(2, "0")}`,
  afterWorld: (index + 1) * 2,
  kind: kinds[index],
  latitude, longitude, angularRadius: .09,
}));
