import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";

export const gameInfo = {
  title: "Transformation Match",
  description:
    "Apply a rotation or reflection and find the exact transformed pattern.",
  skills: ["Mental transformation", "Visual comparison"],
  estimatedMinutes: 10,
  shelfOrder: 10,
  featured: true,
} satisfies GameInfo;

const tileColors = {
  empty: "#ece7dc",
  coral: "#f06f5f",
  gold: "#f3bd4e",
  teal: "#35a999",
  violet: "#7767d7",
} as const;

type ShelfTile = keyof typeof tileColors;

const clueTiles = [
  "coral",
  "empty",
  "teal",
  "gold",
  "violet",
  "empty",
  "empty",
  "coral",
  "gold",
] as const satisfies readonly ShelfTile[];

const reflectedTiles = [
  "coral",
  "gold",
  "empty",
  "empty",
  "violet",
  "coral",
  "teal",
  "empty",
  "gold",
] as const satisfies readonly ShelfTile[];

function TransformationBoard({
  x,
  tiles,
  capIndex,
  capDirection,
}: {
  x: number;
  tiles: readonly ShelfTile[];
  capIndex: number;
  capDirection: "up" | "left";
}) {
  return (
    <g>
      <rect x={x} y="47" width="92" height="92" rx="10" fill="#17213d" />
      {tiles.map((tile, index) => {
        const tileX = x + 6 + (index % 3) * 28;
        const tileY = 53 + Math.floor(index / 3) * 28;

        return (
          <g key={`${x}-${index}`}>
            <rect
              x={tileX}
              y={tileY}
              width="24"
              height="24"
              rx="3"
              fill={tileColors[tile]}
            />
            {index === capIndex ? (
              <rect
                x={tileX + (capDirection === "up" ? 7 : 4)}
                y={tileY + (capDirection === "up" ? 4 : 7)}
                width={capDirection === "up" ? 10 : 4}
                height={capDirection === "up" ? 4 : 10}
                rx="2"
                fill="#17213d"
              />
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#e5eee9", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#e5eee9" />
      <TransformationBoard
        x={22}
        tiles={clueTiles}
        capIndex={2}
        capDirection="up"
      />
      <TransformationBoard
        x={206}
        tiles={reflectedTiles}
        capIndex={6}
        capDirection="left"
      />
      <circle
        cx="160"
        cy="93"
        r="29"
        fill="#fffdf8"
        stroke="#cfcabd"
        strokeWidth="2"
      />
      <path
        d="m146 79 28 28"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path
        d="m174 79-28 28"
        fill="none"
        stroke="#1679d2"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path d="m174 79-9 2 7 7Z" fill="#1679d2" />
      <path d="m146 107 9-2-7-7Z" fill="#1679d2" />
    </svg>
  );
}
