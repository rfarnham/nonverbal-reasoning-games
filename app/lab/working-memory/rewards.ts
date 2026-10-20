/** Cosmetic practice rewards. Difficulty and first-attempt scoring stay in the engine. */
import { AUDIO_TASK_IDS, TASK_IDS, VISUAL_TASK_IDS } from "./engine.ts";
import { taskTotals, type Saved, type TaskTotals } from "./progress.ts";

// Keep this policy stable: existing first-attempt history receives the same XP
// after reloads, schema migrations, new games, or changes of play conditions.
export const MEMORY_XP_PER_ATTEMPT = 10;
export const MEMORY_XP_PER_STOP = 80;
export const MEMORY_STOPS_PER_HABITAT = 5;

export const MEMORY_HABITATS = [
  { id: "acorn-grove", title: "Acorn Grove", description: "Follow the acorn path.", accent: "gold" },
  { id: "pebble-brook", title: "Pebble Brook", description: "Hop along the stepping stones.", accent: "blue" },
  { id: "fern-hollow", title: "Fern Hollow", description: "Explore the leafy woodland.", accent: "teal" },
  { id: "moonlit-meadow", title: "Moonlit Meadow", description: "Find a path beneath the moon.", accent: "violet" },
  { id: "starry-summit", title: "Starry Summit", description: "Reach the trail among the stars.", accent: "coral" },
] as const;
export type MemoryHabitat = (typeof MEMORY_HABITATS)[number];

type TrophyMetric = "attempts" | "visualAttempts" | "audioAttempts" | "families";

export const MEMORY_TROPHIES = [
  { id: "first-footsteps", title: "First footsteps", description: "Try 8 memory challenges.", goal: 8, metric: "attempts" },
  { id: "trail-explorer", title: "Trail explorer", description: "Try 40 memory challenges.", goal: 40, metric: "attempts" },
  { id: "expedition-explorer", title: "Expedition explorer", description: "Try 200 memory challenges.", goal: 200, metric: "attempts" },
  { id: "bright-eyes", title: "Bright eyes", description: "Try 8 visual challenges.", goal: 8, metric: "visualAttempts" },
  { id: "listening-ears", title: "Listening ears", description: "Try 8 listening challenges.", goal: 8, metric: "audioAttempts" },
  { id: "curious-explorer", title: "Curious explorer", description: "Play all 9 games.", goal: 9, metric: "families" },
] as const satisfies readonly { id: string; title: string; description: string; goal: number; metric: TrophyMetric }[];

export type MemoryTrophyId = (typeof MEMORY_TROPHIES)[number]["id"];
export interface MemoryTrophy {
  id: MemoryTrophyId;
  title: string;
  description: string;
  goal: number;
  /** Display progress is capped at the goal; earned trophies never lose progress. */
  progress: number;
  earned: boolean;
}

export interface MemoryRewards {
  xp: number;
  attempts: number;
  correct: number;
  completedStops: number;
  /** One-based expedition; every expedition keeps all earlier XP and trophies. */
  expedition: number;
  habitatIndex: number;
  stopIndex: number;
  stopXp: number;
  trophies: MemoryTrophy[];
}

export interface MemorySessionRewards {
  xp: number;
  attempts: number;
  correct: number;
  xpBefore: number;
  before: MemoryRewards;
  after: MemoryRewards;
  earnedTrophies: MemoryTrophy[];
}

function rewardsFromTotals(totals: TaskTotals): MemoryRewards {
  const attempts = TASK_IDS.reduce((sum, task) => sum + totals[task].attempts, 0);
  const correct = TASK_IDS.reduce((sum, task) => sum + totals[task].correct, 0);
  const visualAttempts = VISUAL_TASK_IDS.reduce((sum, task) => sum + totals[task].attempts, 0);
  const audioAttempts = AUDIO_TASK_IDS.reduce((sum, task) => sum + totals[task].attempts, 0);
  // Audio task IDs are compatibility aliases for one Digits game, not three
  // opportunities to earn the game-variety trophy from the same mechanic.
  const families = VISUAL_TASK_IDS.filter((task) => totals[task].attempts > 0).length + (audioAttempts > 0 ? 1 : 0);
  const metrics = { attempts, visualAttempts, audioAttempts, families };
  const xp = attempts * MEMORY_XP_PER_ATTEMPT;
  const completedStops = Math.floor(xp / MEMORY_XP_PER_STOP);
  const stopsPerExpedition = MEMORY_STOPS_PER_HABITAT * MEMORY_HABITATS.length;
  const expeditionStop = completedStops % stopsPerExpedition;
  return {
    xp, attempts, correct, completedStops,
    expedition: Math.floor(completedStops / stopsPerExpedition) + 1,
    habitatIndex: Math.floor(expeditionStop / MEMORY_STOPS_PER_HABITAT),
    stopIndex: expeditionStop % MEMORY_STOPS_PER_HABITAT,
    stopXp: xp % MEMORY_XP_PER_STOP,
    trophies: MEMORY_TROPHIES.map(({ id, title, description, goal, metric }) => ({
      id, title, description, goal, progress: Math.min(goal, metrics[metric]), earned: metrics[metric] >= goal,
    })),
  };
}

/** Every recorded first attempt is worth 10 XP, regardless of correctness or span. */
export function getMemoryRewards(saved: Saved): MemoryRewards {
  // taskTotals includes each independent condition/legacy bank once. The active
  // session and its history are already represented there and must not be added.
  return rewardsFromTotals(taskTotals(saved));
}

/** Session summaries show earned XP without another award, claim, or storage write. */
export function getSessionRewards(saved: Saved): MemorySessionRewards {
  const afterTotals = taskTotals(saved);
  const beforeTotals = Object.fromEntries(TASK_IDS.map((task) => [task, { ...afterTotals[task] }])) as TaskTotals;
  const history = saved.session?.history ?? [];
  for (const result of history) {
    const total = beforeTotals[result.round.task];
    total.attempts = Math.max(0, total.attempts - 1);
    total.correct = Math.max(0, total.correct - (result.correct ? 1 : 0));
  }
  const before = rewardsFromTotals(beforeTotals);
  const after = rewardsFromTotals(afterTotals);
  const previouslyEarned = new Set(before.trophies.filter((trophy) => trophy.earned).map((trophy) => trophy.id));
  return {
    xp: history.length * MEMORY_XP_PER_ATTEMPT,
    attempts: history.length,
    correct: history.filter((result) => result.correct).length,
    xpBefore: before.xp,
    before, after,
    earnedTrophies: after.trophies.filter((trophy) => trophy.earned && !previouslyEarned.has(trophy.id)),
  };
}
