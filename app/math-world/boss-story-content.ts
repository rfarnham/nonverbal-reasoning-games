import type { StoryPageProps } from "./StoryPage";

/** Authored hurricane chapters. The bundled paintings keep their full 3:2 proportions. */
export const BOSS_STORIES = {
  "boss-2025": {
    id: "oceania-hurricane-2025",
    kicker: "Beyond the sixteenth archipelago",
    title: "The great turning storm",
    paragraphs: [
      "Sixteen archipelagos lie behind you. Ahead, huge bands of cloud curl around a quiet center called the eye. This is a hurricane: a powerful storm that forms over warm ocean water. Its winds turn in a great spiral, driving rain and towering waves across the sea. The Tideheart once softened storms like this. Now your cyan lantern shines against the gathering dark.",
      "Your crew shelters the ship while you chart a safe course around the hurricane. Print the whole 2025 test: all 24 questions belong in this packet. Work with pencil and paper, then enter and submit your workbook answers in the game. The passage opens after you submit the completed workbook. There is no need to hurry: draw, think, and check each step.",
    ],
    illustration: {
      src: "/math-world/stories/hurricane-2025.webp",
      width: 1536,
      height: 1024,
      alt: "A cream-sailed wooden ship with a cyan lantern rides turquoise waves beside an enormous spiral hurricane, with branching lightning, sweeping rain bands, and golden light in its eye.",
    },
  },
  "boss-2026": {
    id: "oceania-hurricane-2026",
    kicker: "Beyond the thirty-second archipelago",
    title: "The storm on the horizon",
    paragraphs: [
      "The thirty-second archipelago fades behind the stern. Far ahead, another hurricane spreads across the open sea. Lightning lights its curving cloud walls, and long bands of rain sweep around the eye, the storm’s calmer center. The wind and waves outside that eye remain fierce. Your lantern glows steadily as the ship approaches this great turning storm; beyond it, the horizon is still unknown.",
      "Your crew finds shelter while you chart the final passage around the hurricane. Print the whole 2026 test, with all 24 questions, and work through it on paper at your own pace. Then enter and submit your workbook answers in the game to open the passage. A careful sketch or a fresh look can help you see the next step.",
    ],
    illustration: {
      src: "/math-world/stories/hurricane-2026.webp",
      width: 1536,
      height: 1024,
      alt: "A wooden ship with cream sails and a cyan bow lantern approaches a vast violet-blue hurricane at dusk, with spiraling cloud walls, scattered lightning, and a warm open horizon beyond.",
    },
  },
} as const satisfies Record<"boss-2025" | "boss-2026", StoryPageProps["page"]>;
