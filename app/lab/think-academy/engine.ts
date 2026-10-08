import { generateNumberRound, NUMBER_TYPES, validateNumberRound } from './number-generators.ts';
import { generateSpatialRound, SPATIAL_TYPES, validateSpatialRound } from './spatial-generators.ts';
import { PROBLEM_TYPES, type ChallengeLevel, type ProblemType, type Round } from './types.ts';

export const CONTENT_VERSION = 1;
export const TYPE_INFO = [...NUMBER_TYPES, ...SPATIAL_TYPES].sort((a, b) => a.sourceNumber - b.sourceNumber);
export function generateRound(type: ProblemType, level: ChallengeLevel, seed: number): Round {
  if (!PROBLEM_TYPES.includes(type) || !Number.isInteger(level) || level < 0 || level > 3 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Invalid question settings.');
  const round = NUMBER_TYPES.some(info => info.id === type)
    ? generateNumberRound(type, level, seed)
    : generateSpatialRound(type, level, seed);
  if (!validateRound(round)) throw new Error('A question could not be verified. Please try a new set.');
  return round;
}
export function validateRound(round: Round): boolean {
  try {
    if (round.choices.length !== 4 || new Set(round.choices.map(choice => choice.id)).size !== 4 || !round.fingerprint || !round.explanation || round.choices.filter(choice => choice.id === round.correctId).length !== 1) return false;
    return NUMBER_TYPES.some(info => info.id === round.type) ? validateNumberRound(round) : validateSpatialRound(round);
  } catch { return false; }
}
