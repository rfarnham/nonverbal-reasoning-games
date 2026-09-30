import type { StoryPageProps } from "./StoryPage";

/** Authored hurricane chapters. The bundled paintings keep their full 3:2 proportions. */
export const BOSS_STORIES = {
  "boss-2025": {
    id: "oceania-hurricane-2025",
    kicker: "Beyond the sixteenth archipelago",
    title: "The great turning storm",
    paragraphs: [
      "Sixteen archipelagos lie behind you. Ahead, huge bands of cloud curl around a quiet center called the eye. This is a hurricane: a powerful storm that forms over warm ocean water. Its winds turn in a great spiral, driving rain and towering waves across the sea. The Tideheart once softened storms like this. Now your cyan lantern shines against the gathering dark.",
      "Your crew steadies the ship while you open the next chapter of your voyage. Print the whole 2025 test: all 24 questions belong in this packet. Work with pencil and paper, one question at a time. There is no need to hurry. Draw, think, and use the ideas you have gathered along the way.",
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
      "You have collected many ideas on your travels, and this crossing gives you room to bring them together. Print the whole 2026 test, with all 24 questions, and find a comfortable place for your pencil and paper. Take each question at your own pace. A careful sketch or a fresh look can help you see the next step.",
    ],
    illustration: {
      src: "/math-world/stories/hurricane-2026.webp",
      width: 1536,
      height: 1024,
      alt: "A wooden ship with cream sails and a cyan bow lantern approaches a vast violet-blue hurricane at dusk, with spiraling cloud walls, scattered lightning, and a warm open horizon beyond.",
    },
  },
} as const satisfies Record<"boss-2025" | "boss-2026", StoryPageProps["page"]>;
