import type {
  GameInfo,
  ShelfIconProps,
} from "@/lib/game-catalog-types";
import { progressionMetadata } from "./progression-metadata";

export const gameInfo = {
  title: "Braids",
  description:
    "Track interwoven ribbons through space and find their true view from the other side.",
  skills: ["Spatial perspective", "Depth tracking"],
  estimatedMinutes: 10,
  progression: progressionMetadata,
  shelfOrder: 40,
} satisfies GameInfo;

export function ShelfIcon({ style, ...props }: ShelfIconProps) {
  return (
    <svg
      {...props}
      viewBox="0 0 320 186"
      style={{ backgroundColor: "#dcefe9", ...style }}
    >
      <rect width="320" height="186" rx="13" fill="#dcefe9" />
      <defs>
        <marker
          id="braids-orbit-arrow"
          markerWidth="12"
          markerHeight="12"
          refX="10"
          refY="6"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0 0 12 6 0 12Z" fill="#657087" />
        </marker>
        <mask
          id="braids-teal-strand"
          x="48"
          y="18"
          width="224"
          height="150"
          maskUnits="userSpaceOnUse"
        >
          <rect x="48" y="18" width="224" height="150" fill="white" />
          <rect x="106" y="102" width="28" height="28" fill="black" />
        </mask>
        <mask
          id="braids-coral-strand"
          x="48"
          y="18"
          width="224"
          height="150"
          maskUnits="userSpaceOnUse"
        >
          <rect x="48" y="18" width="224" height="150" fill="white" />
          <rect x="182" y="56" width="28" height="28" fill="black" />
        </mask>
        <mask
          id="braids-gold-strand"
          x="48"
          y="18"
          width="224"
          height="150"
          maskUnits="userSpaceOnUse"
        >
          <rect x="48" y="18" width="224" height="150" fill="white" />
          <rect x="106" y="56" width="28" height="28" fill="black" />
        </mask>
        <mask
          id="braids-violet-strand"
          x="48"
          y="18"
          width="224"
          height="150"
          maskUnits="userSpaceOnUse"
        >
          <rect x="48" y="18" width="224" height="150" fill="white" />
          <rect x="182" y="102" width="28" height="28" fill="black" />
        </mask>
      </defs>
      <path
        d="M286 105C301 62 271 34 224 37 190 40 169 30 160 14"
        fill="none"
        stroke="#657087"
        strokeDasharray="7 7"
        strokeLinecap="round"
        strokeWidth="4"
        markerEnd="url(#braids-orbit-arrow)"
      />
      <rect
        x="56"
        y="25"
        width="224"
        height="150"
        rx="17"
        fill="#b8ddd3"
        stroke="#17213d"
        strokeWidth="3"
      />
      <rect
        x="48"
        y="18"
        width="224"
        height="150"
        rx="17"
        fill="#fffdf8"
        stroke="#17213d"
        strokeWidth="3"
      />
      <path
        d="M54 83h10v20H54"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3"
      />

      <g fill="none" strokeLinecap="round">
        <g mask="url(#braids-teal-strand)">
          <path d="M120 34v118" stroke="#17213d" strokeWidth="18" />
          <path d="M120 34v118" stroke="#35a999" strokeWidth="13" />
        </g>
        <g mask="url(#braids-coral-strand)">
          <path d="M196 34v118" stroke="#17213d" strokeWidth="18" />
          <path d="M196 34v118" stroke="#f06f5f" strokeWidth="13" />
        </g>
        <g mask="url(#braids-gold-strand)">
          <path d="M68 70h184" stroke="#17213d" strokeWidth="18" />
          <path d="M68 70h184" stroke="#f3bd4e" strokeWidth="13" />
        </g>
        <g mask="url(#braids-violet-strand)">
          <path d="M68 116h184" stroke="#17213d" strokeWidth="18" />
          <path d="M68 116h184" stroke="#7767d7" strokeWidth="13" />
        </g>
      </g>

      <path
        d="M173 174C238 178 296 151 286 105"
        fill="none"
        stroke="#17213d"
        strokeLinecap="round"
        strokeWidth="4"
      />
      <path
        d="M146 174q12-10 24 0-12 10-24 0Z"
        fill="#fffdf8"
        stroke="#17213d"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <circle cx="158" cy="174" r="3.5" fill="#17213d" />
    </svg>
  );
}
