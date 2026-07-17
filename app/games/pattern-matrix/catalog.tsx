import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";

const patterns = [
  [true, false, false, false],
  [false, true, false, false],
  [true, true, false, false],
  [false, false, true, false],
  [false, false, false, true],
  [false, false, true, true],
  [true, false, false, false],
  [false, false, false, true],
] as const;

export const gameInfo = {
  title: "Pattern Matrix",
  description:
    "Find the rule repeated across the solved rows, then choose the one tile that completes the matrix.",
  skills: ["Rule finding", "Pattern completion"],
  estimatedMinutes: 10,
  shelfOrder: 20,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#f7e7c8", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#f7e7c8" />
      {Array.from({ length: 9 }, (_, tileIndex) => {
        const column = tileIndex % 3;
        const row = Math.floor(tileIndex / 3);
        const x = 85 + column * 52;
        const y = 18 + row * 52;
        const pattern = patterns[tileIndex];

        if (!pattern) {
          return (
            <g key={tileIndex}>
              <rect
                x={x}
                y={y}
                width="44"
                height="44"
                rx="8"
                fill="#fffdf8"
                stroke="#657087"
                strokeDasharray="5 4"
                strokeWidth="2"
              />
              <text
                x={x + 22}
                y={y + 30}
                fill="#17213d"
                fontFamily="Inter, sans-serif"
                fontSize="22"
                fontWeight="900"
                textAnchor="middle"
              >
                ?
              </text>
            </g>
          );
        }

        return (
          <g key={tileIndex}>
            <rect
              x={x}
              y={y}
              width="44"
              height="44"
              rx="8"
              fill="#fffdf8"
              stroke="#cfcabd"
            />
            {pattern.map((filled, dotIndex) => (
              <circle
                key={dotIndex}
                cx={x + 13 + (dotIndex % 2) * 18}
                cy={y + 13 + Math.floor(dotIndex / 2) * 18}
                r="5"
                fill={filled ? "#f06f5f" : "#e8e3d9"}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
