import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";
import { progressionMetadata } from "./progression-metadata";

const panels = [
  { mask: [true, false, false, false], shape: "triangle", color: "#7767d7" },
  { mask: [false, true, false, false], shape: "triangle", color: "#7767d7" },
  { mask: [true, true, false, false], shape: "triangle", color: "#7767d7" },
  { mask: [false, false, true, false], shape: "circle", color: "#35a999" },
  { mask: [false, false, false, true], shape: "circle", color: "#35a999" },
  { mask: [false, false, true, true], shape: "circle", color: "#35a999" },
  { mask: [true, false, false, false], shape: "bar", color: "#f06f5f" },
  { mask: [false, false, false, true], shape: "bar", color: "#f06f5f" },
] as const;

export const gameInfo = {
  title: "Pattern Matrix",
  description:
    "Track visual rules across rows, columns, and the whole grid, then choose the tile that completes the matrix.",
  skills: ["Rule finding", "Pattern completion"],
  estimatedMinutes: 10,
  progression: progressionMetadata,
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
        const panel = panels[tileIndex];

        if (!panel) {
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
            {panel.mask.map((filled, motifIndex) => {
              const motifX = x + 13 + (motifIndex % 2) * 18;
              const motifY =
                y + 13 + Math.floor(motifIndex / 2) * 18;

              if (!filled) {
                return (
                  <rect
                    key={motifIndex}
                    x={motifX - 5}
                    y={motifY - 5}
                    width="10"
                    height="10"
                    rx="3"
                    fill="#eee9df"
                  />
                );
              }
              if (panel.shape === "circle") {
                return (
                  <circle
                    key={motifIndex}
                    cx={motifX}
                    cy={motifY}
                    r="5"
                    fill={panel.color}
                  />
                );
              }
              if (panel.shape === "bar") {
                return (
                  <rect
                    key={motifIndex}
                    x={motifX - 2.5}
                    y={motifY - 6}
                    width="5"
                    height="12"
                    rx="2.5"
                    fill={panel.color}
                    transform={`rotate(90 ${motifX} ${motifY})`}
                  />
                );
              }
              return (
                <path
                  key={motifIndex}
                  d={`M ${motifX} ${motifY - 6} L ${
                    motifX + 6
                  } ${motifY + 5} L ${motifX - 6} ${
                    motifY + 5
                  } Z`}
                  fill="none"
                  stroke={panel.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
