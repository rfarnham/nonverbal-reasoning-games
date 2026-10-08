export const PROBLEM_TYPES = ['arithmetic', 'length', 'place-value', 'fractions', 'multiplication', 'fruit-equations', 'triangles', 'sharing', 'tree-gaps', 'queue', 'cube-net', 'turns', 'solid-views', 'partition', 'balance'] as const;
export type ProblemType = typeof PROBLEM_TYPES[number];
export type ChallengeLevel = 0 | 1 | 2 | 3;
export const LEVELS = [
  { name: 'Starter', detail: 'Recorded difficulty' },
  { name: 'Junior', detail: 'Challenge 1' },
  { name: 'Expert', detail: 'Challenge 2' },
  { name: 'Wizard', detail: 'Challenge 3' },
] as const;
export type Point = [number, number];
export type Mark =
  | { kind: 'line'; points: Point[]; color?: string; width?: number; dash?: boolean }
  | { kind: 'polygon'; points: Point[]; fill?: string; stroke?: string }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill?: string; stroke?: string }
  | { kind: 'circle'; x: number; y: number; radius: number; fill?: string; stroke?: string }
  | { kind: 'text'; x: number; y: number; text: string; size?: number; color?: string };
export interface Diagram { width: number; height: number; description: string; marks: Mark[] }
export interface Choice { id: string; label: string; diagram?: Diagram; feedback: string }
export interface Round {
  type: ProblemType;
  level: ChallengeLevel;
  seed: number;
  prompt: string;
  diagram?: Diagram;
  choices: Choice[];
  correctId: string;
  explanation: string;
  hint: string;
  fingerprint: string;
  model: unknown;
}
export interface TypeInfo { id: ProblemType; title: string; sourceNumber: number; description: string; challenges: readonly [string, string, string, string] }
