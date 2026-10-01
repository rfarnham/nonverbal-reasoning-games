/** Authored first chapter. Later islands keep their book placeholders. */
export type StoryIllustration = "welcome" | "tideheart" | "peace" | "fracture" | "appeal";

export type StoryPageContent = {
  id: string;
  kicker: string;
  title: string;
  paragraphs: readonly string[];
  illustration: StoryIllustration;
};

export const FIRST_WORLD_STORY = {
  intro: {
    id: "oceania-welcome",
    kicker: "The voyage begins",
    title: "Welcome to Oceania",
    paragraphs: [
      "Beyond the farthest blue horizon lies Oceania, a world of islands, white sails, and winding sea paths. Here, every harbor has a story, and every voyage begins with a little curiosity.",
      "Your boat is ready. The gulls are calling. Ahead, green islands rise from the sparkling water, with places to explore and puzzles to solve.",
      "But before you sail farther, there is an old story you should hear. Follow the path and look for the two little books. They tell how these scattered islands first found their way back to one another.",
    ],
    illustration: "welcome",
  },
  book1: {
    id: "oceania-tideheart",
    kicker: "The first island chronicle · I",
    title: "A light against the storm",
    paragraphs: [
      "Long ago, fierce winds tore across Oceania. Towering waves broke apart the land, leaving scattered groups of islands called archipelagos. The seas between them grew so dangerous that neighbors could no longer visit one another.",
      "So the scientists of Oceania built something extraordinary: the Tideheart. It was a giant crystal computer shaped like an octahedron: two square pyramids joined at their bases. Its eight clear faces shone with a brilliant blue light.",
      "Inside the crystal, countless tiny signals raced like stars. The Tideheart studied the wind, the clouds, and the currents. At last, it began to understand the wild weather.",
    ],
    illustration: "tideheart",
  },
  book2: {
    id: "oceania-peace",
    kicker: "The first island chronicle · II",
    title: "The age of open sails",
    paragraphs: [
      "The Tideheart learned to predict where storms would gather. Then, with a gentle pulse of blue light, it could guide the winds and soften the roughest seas. Safe routes opened between the islands once more.",
      "Boats carried fresh fruit, bright cloth, and letters from faraway friends. Gardens flourished. Busy harbors rang with laughter, and children watched for familiar sails on the horizon.",
      "An age of peace and plenty had come to Oceania. Through every sunny day and quiet night, the great crystal kept its watch.",
    ],
    illustration: "peace",
  },
  fracture: {
    id: "oceania-fracture",
    kicker: "Far away, beneath the blue light…",
    title: "A crack in the quiet",
    paragraphs: [
      "As your first island adventure ends, a dark shadow slips close to the Tideheart. For a moment, its blue light flickers. No one sees what moves beside it.",
      "A spark leaps across one shining face. Then another. Thin cracks spread through the crystal, branching like lightning. A low, trembling hum fills the air.",
      "With a sudden flash, the Tideheart bursts apart. Glowing shards fly high above the clouds and scatter across Oceania. Below them, the winds begin to stir.",
    ],
    illustration: "fracture",
  },
  appeal: {
    id: "oceania-call",
    kicker: "A new voyage awaits",
    title: "Will you follow the light?",
    paragraphs: [
      "Thirty-two blue lights now glimmer across Oceania, one at the summit of each archipelago. Each light is a piece of the Tideheart, waiting at the end of an island trail. Its light is broken, but it has not gone out.",
      "Without the crystal, the seas will grow wild again. The people of Oceania need a brave, curious voyager to find the scattered shards and bring them home.",
      "That voyager could be you. Follow the island paths, solve the puzzles along the way, and gather the pieces of the Tideheart. Together, we can help Oceania find its peace again.",
    ],
    illustration: "appeal",
  },
} as const satisfies Record<string, StoryPageContent>;
