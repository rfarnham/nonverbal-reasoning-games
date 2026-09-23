import questionManifest from "./data/world-01.questions.json" with { type: "json" };

export type RealmId =
  | "number_arithmetic"
  | "geometry_spatial"
  | "measurement_time";

export type WorldQuestion = Readonly<{
  id: string;
  stopId: string;
  prompt: string;
  choices: readonly Readonly<{
    label: string;
    accessibleLabel: string;
    visualOnly: boolean;
  }>[];
  correctIndex: number;
  presentation: "semantic" | "source-card";
  asset: Readonly<{
    src: string;
    width: number;
    height: number;
    alt: string;
  }>;
  source: Readonly<{
    year: number;
    gradeBand: string;
    questionNumber: number;
    sourceLabel: string;
  }>;
  curriculum: Readonly<{
    realmId: RealmId;
    districtId: string;
    skillIds: readonly string[];
    placementVersion: string;
    placementStatus: "provisional-playtest";
    proposalConfidence: number | null;
  }>;
}>;

export type MathStop = Readonly<{
  id: string;
  kind: "math-kangaroo" | "culmination";
  label: string;
  shortLabel: string;
  description: string;
  realmId: RealmId | "mixed";
  districtLabel: string;
  x: number;
  y: number;
  mobileX: number;
  mobileY: number;
}>;

export type BreakStop = Readonly<{
  id: string;
  kind: "turbo" | "minigame";
  label: string;
  shortLabel: string;
  description: string;
  href: string;
  afterStopId: string;
  x: number;
  y: number;
  mobileX: number;
  mobileY: number;
}>;

export type WorldStop = MathStop | BreakStop;

export const REALMS = {
  number_arithmetic: {
    label: "Number & Operations",
    shortLabel: "Number Coast",
    color: "#f3bd4e",
    icon: "123",
  },
  geometry_spatial: {
    label: "Shape & Space",
    shortLabel: "Shape Cliffs",
    color: "#7767d7",
    icon: "◇",
  },
  measurement_time: {
    label: "Measurement & Modeling",
    shortLabel: "Clockwork Harbor",
    color: "#35a999",
    icon: "◷",
  },
} as const;

export const REQUIRED_STOPS: readonly MathStop[] = [
  {
    id: "counting-cove",
    kind: "math-kangaroo",
    label: "Counting Cove",
    shortLabel: "Cove",
    description: "Count, compare, and notice what belongs together.",
    realmId: "number_arithmetic",
    districtLabel: "Count & Compare",
    x: 10,
    y: 73,
    mobileX: 27,
    mobileY: 89,
  },
  {
    id: "number-bridge",
    kind: "math-kangaroo",
    label: "Number Bridge",
    shortLabel: "Bridge",
    description: "Use number relationships to cross the inlet.",
    realmId: "number_arithmetic",
    districtLabel: "Join & Separate",
    x: 23,
    y: 56,
    mobileX: 70,
    mobileY: 80,
  },
  {
    id: "digit-dunes",
    kind: "math-kangaroo",
    label: "Digit Dunes",
    shortLabel: "Dunes",
    description: "Read the hidden structure inside numbers and digits.",
    realmId: "number_arithmetic",
    districtLabel: "Number & Digit Structure",
    x: 35,
    y: 76,
    mobileX: 29,
    mobileY: 70,
  },
  {
    id: "orchard-market",
    kind: "math-kangaroo",
    label: "Orchard Market",
    shortLabel: "Market",
    description: "Join, separate, trade, and reason with quantities.",
    realmId: "number_arithmetic",
    districtLabel: "Join & Separate",
    x: 45,
    y: 51,
    mobileX: 68,
    mobileY: 60,
  },
  {
    id: "shape-shore",
    kind: "math-kangaroo",
    label: "Shape Shore",
    shortLabel: "Shore",
    description: "Inspect corners, outlines, and shape properties.",
    realmId: "geometry_spatial",
    districtLabel: "Shape Properties",
    x: 59,
    y: 65,
    mobileX: 27,
    mobileY: 50,
  },
  {
    id: "puzzle-cliffs",
    kind: "math-kangaroo",
    label: "Puzzle Cliffs",
    shortLabel: "Cliffs",
    description: "Compose, dissect, and turn visual pieces.",
    realmId: "geometry_spatial",
    districtLabel: "Compose, Dissect & Tile",
    x: 68,
    y: 44,
    mobileX: 69,
    mobileY: 40,
  },
  {
    id: "coin-harbor",
    kind: "math-kangaroo",
    label: "Coin Harbor",
    shortLabel: "Harbor",
    description: "Compare value and make quantities meet.",
    realmId: "measurement_time",
    districtLabel: "Money & Value",
    x: 80,
    y: 54,
    mobileX: 28,
    mobileY: 30,
  },
  {
    id: "clock-tower",
    kind: "math-kangaroo",
    label: "Clock Tower",
    shortLabel: "Tower",
    description: "Reason about clocks, calendars, and intervals.",
    realmId: "measurement_time",
    districtLabel: "Clock & Calendar",
    x: 78,
    y: 24,
    mobileX: 68,
    mobileY: 20,
  },
  {
    id: "lighthouse-crossroads",
    kind: "culmination",
    label: "Kangaroo Lighthouse",
    shortLabel: "Lighthouse",
    description: "Bring the whole coast together in one final crossing.",
    realmId: "mixed",
    districtLabel: "Coastal Crossroads",
    x: 90,
    y: 21,
    mobileX: 44,
    mobileY: 10,
  },
] as const;

export const BREAK_STOPS: readonly BreakStop[] = [
  {
    id: "turbo-wharf",
    kind: "turbo",
    label: "Turbo Wharf",
    shortLabel: "Turbo",
    description: "Optional fact-fluency sprint at the wharf.",
    href: "/lab/subtraction-flash/",
    afterStopId: "number-bridge",
    x: 22,
    y: 27,
    mobileX: 23,
    mobileY: 80,
  },
  {
    id: "pattern-picnic",
    kind: "minigame",
    label: "Pattern Picnic",
    shortLabel: "Minigame",
    description: "Optional visual-pattern break beneath the palms.",
    href: "/games/pattern-matrix/",
    afterStopId: "shape-shore",
    x: 51,
    y: 23,
    mobileX: 73,
    mobileY: 50,
  },
] as const;

export const WORLD_STOPS: readonly WorldStop[] = [
  REQUIRED_STOPS[0],
  REQUIRED_STOPS[1],
  BREAK_STOPS[0],
  REQUIRED_STOPS[2],
  REQUIRED_STOPS[3],
  REQUIRED_STOPS[4],
  BREAK_STOPS[1],
  REQUIRED_STOPS[5],
  REQUIRED_STOPS[6],
  REQUIRED_STOPS[7],
  REQUIRED_STOPS[8],
] as const;

type RawManifest = Readonly<{
  schemaVersion: number;
  contentVersion: string;
  catalogueRunId: string;
  ontologyVersion: string;
  questions: readonly WorldQuestion[];
}>;

const manifest = questionManifest as unknown as RawManifest;

if (manifest.schemaVersion !== 1 || !manifest.contentVersion.trim()) {
  throw new Error("Invalid Math World question manifest.");
}

const requiredStopIds = new Set(REQUIRED_STOPS.map(({ id }) => id));
const seenQuestionIds = new Set<string>();
for (const question of manifest.questions) {
  if (!requiredStopIds.has(question.stopId)) {
    throw new Error(`Unknown Math World stop for ${question.id}.`);
  }
  if (seenQuestionIds.has(question.id)) {
    throw new Error(`Duplicate Math World question: ${question.id}.`);
  }
  if (question.choices.length !== 5 || question.correctIndex < 0 || question.correctIndex > 4) {
    throw new Error(`Invalid answer choices for ${question.id}.`);
  }
  seenQuestionIds.add(question.id);
}

export const WORLD_CONTENT_VERSION = manifest.contentVersion;
export const WORLD_ONTOLOGY_VERSION = manifest.ontologyVersion;
export const WORLD_QUESTIONS = manifest.questions;
export const QUESTIONS_BY_STOP = new Map(
  REQUIRED_STOPS.map((stop) => [
    stop.id,
    WORLD_QUESTIONS.filter((question) => question.stopId === stop.id),
  ]),
);

for (const stop of REQUIRED_STOPS) {
  if ((QUESTIONS_BY_STOP.get(stop.id)?.length ?? 0) === 0) {
    throw new Error(`Math World stop ${stop.id} has no questions.`);
  }
}
