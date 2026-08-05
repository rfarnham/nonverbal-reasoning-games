import type {
  MasteryPolicy,
  SkillDefinition,
  SkillId,
  SkillKind,
  SkillTrack,
} from "./types.ts";

export const SKILL_IDS = [
  "F01",
  "F02",
  "F03",
  "F04",
  "F05",
  "R01",
  "R02",
  "R03",
  "R04",
  "R05",
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "T01",
  "T02",
  "T03",
  "T04",
  "T05",
] as const satisfies readonly SkillId[];

export const FACT_AND_MICRO_STEP_MASTERY_POLICY: Readonly<MasteryPolicy> = Object.freeze({
  minIndependentAttempts: 8,
  minSessions: 2,
  weightedAccuracyThreshold: 0.88,
  recentWindowSize: 4,
  recentCorrectRequired: 3,
  maxRepeatedMisconceptionCount: 1,
});

export const FULL_PROBLEM_MASTERY_POLICY: Readonly<MasteryPolicy> = Object.freeze({
  minIndependentAttempts: 12,
  minSessions: 2,
  weightedAccuracyThreshold: 0.9,
  recentWindowSize: 5,
  recentCorrectRequired: 4,
  maxRepeatedMisconceptionCount: 1,
});

interface SkillInput {
  id: SkillId;
  title: string;
  childFacingTitle: string;
  description: string;
  track: SkillTrack;
  kind: SkillKind;
  prerequisites: readonly SkillId[];
  remediationSkillIds: readonly SkillId[];
  difficultyBands: readonly number[];
  tags: readonly string[];
  enabledByDefault?: boolean;
}

function defineSkill(input: SkillInput): SkillDefinition {
  return Object.freeze({
    ...input,
    prerequisites: Object.freeze([...input.prerequisites]),
    remediationSkillIds: Object.freeze([...input.remediationSkillIds]),
    difficultyBands: Object.freeze([...input.difficultyBands]),
    tags: Object.freeze([...input.tags]),
    masteryPolicy:
      input.kind === "fact" || input.kind === "micro_step"
        ? FACT_AND_MICRO_STEP_MASTERY_POLICY
        : FULL_PROBLEM_MASTERY_POLICY,
    enabledByDefault: input.enabledByDefault ?? true,
    generatorId: input.id,
  });
}

export const SKILL_DEFINITIONS = Object.freeze([
  defineSkill({
    id: "F01",
    title: "Complements to ten",
    childFacingTitle: "Partners to 10",
    description: "Recall the number pairs that combine to make ten.",
    track: "facts",
    kind: "fact",
    prerequisites: [],
    remediationSkillIds: [],
    difficultyBands: [1],
    tags: ["facts", "make-ten", "diagnostic"],
  }),
  defineSkill({
    id: "F02",
    title: "Subtraction within ten",
    childFacingTitle: "Subtract within 10",
    description: "Retrieve single-digit subtraction facts with answers at or above zero.",
    track: "facts",
    kind: "fact",
    prerequisites: [],
    remediationSkillIds: [],
    difficultyBands: [1],
    tags: ["facts", "within-ten", "diagnostic"],
  }),
  defineSkill({
    id: "F03",
    title: "Teen minus a digit without crossing ten",
    childFacingTitle: "Stay above 10",
    description: "Subtract a digit from a teen number without crossing ten.",
    track: "facts",
    kind: "fact",
    prerequisites: ["F02"],
    remediationSkillIds: ["F02"],
    difficultyBands: [1, 2],
    tags: ["facts", "teens", "no-bridge"],
  }),
  defineSkill({
    id: "F04",
    title: "Teen minus a digit across ten",
    childFacingTitle: "Bridge through 10",
    description: "Subtract from a teen number by crossing through ten.",
    track: "facts",
    kind: "fact",
    prerequisites: ["F01"],
    remediationSkillIds: ["F01", "F02"],
    difficultyBands: [2],
    tags: ["facts", "teens", "bridge-ten"],
  }),
  defineSkill({
    id: "F05",
    title: "Mixed subtraction facts through eighteen",
    childFacingTitle: "Mixed facts",
    description: "Choose and retrieve subtraction facts across the learned fact families.",
    track: "facts",
    kind: "fact",
    prerequisites: ["F02", "F03", "F04"],
    remediationSkillIds: ["F02", "F03", "F04"],
    difficultyBands: [2],
    tags: ["facts", "mixed", "integration"],
  }),
  defineSkill({
    id: "R01",
    title: "Decide whether regrouping is needed",
    childFacingTitle: "Do we need to trade?",
    description: "Inspect the ones digits and decide whether to trade one ten.",
    track: "regrouping",
    kind: "micro_step",
    prerequisites: [],
    remediationSkillIds: [],
    difficultyBands: [1],
    tags: ["regrouping", "decision", "diagnostic"],
  }),
  defineSkill({
    id: "R02",
    title: "Rename after trading one ten",
    childFacingTitle: "Rename tens and ones",
    description: "Keep track of the new tens and ones after one ten is traded.",
    track: "regrouping",
    kind: "micro_step",
    prerequisites: ["R01"],
    remediationSkillIds: ["R01"],
    difficultyBands: [1, 2],
    tags: ["regrouping", "place-value", "rename"],
  }),
  defineSkill({
    id: "R03",
    title: "Subtract the ones after regrouping",
    childFacingTitle: "Subtract the renamed ones",
    description: "Complete only the ones subtraction after the rename is shown.",
    track: "regrouping",
    kind: "micro_step",
    prerequisites: ["R02"],
    remediationSkillIds: ["F04", "R02"],
    difficultyBands: [2],
    tags: ["regrouping", "ones", "bridge-ten"],
  }),
  defineSkill({
    id: "R04",
    title: "Complete the tens subtraction after regrouping",
    childFacingTitle: "Subtract the changed tens",
    description: "Use the decremented tens value when completing the tens column.",
    track: "regrouping",
    kind: "micro_step",
    prerequisites: ["R02"],
    remediationSkillIds: ["R02"],
    difficultyBands: [2],
    tags: ["regrouping", "tens", "state-tracking"],
  }),
  defineSkill({
    id: "R05",
    title: "Assemble the result from tens and ones",
    childFacingTitle: "Put the answer together",
    description: "Combine a tens result and a ones result into one number.",
    track: "regrouping",
    kind: "micro_step",
    prerequisites: ["R03", "R04"],
    remediationSkillIds: ["R03", "R04"],
    difficultyBands: [2],
    tags: ["regrouping", "place-value", "assembly"],
  }),
  defineSkill({
    id: "A01",
    title: "Two-digit minus one-digit across ten",
    childFacingTitle: "Subtract one digit across 10",
    description: "Integrate regrouping with a one-digit subtrahend.",
    track: "application",
    kind: "full_problem",
    prerequisites: ["F04", "R02", "R03"],
    remediationSkillIds: ["F04", "R02", "R03"],
    difficultyBands: [2],
    tags: ["application", "regrouping", "one-digit-subtrahend"],
  }),
  defineSkill({
    id: "A02",
    title: "Two-digit subtraction without regrouping",
    childFacingTitle: "Subtract without trading",
    description: "Subtract two two-digit numbers when each column can be handled directly.",
    track: "application",
    kind: "full_problem",
    prerequisites: ["F02"],
    remediationSkillIds: ["F02"],
    difficultyBands: [2],
    tags: ["application", "no-regrouping", "two-digit"],
  }),
  defineSkill({
    id: "A03",
    title: "Standard two-digit subtraction with regrouping",
    childFacingTitle: "Subtract with one trade",
    description: "Complete a two-digit subtraction problem that needs one ten traded.",
    track: "application",
    kind: "full_problem",
    prerequisites: ["F05", "R05", "A01"],
    remediationSkillIds: ["F04", "R02", "R03", "R04", "R05"],
    difficultyBands: [3],
    tags: ["application", "regrouping", "two-digit", "core-target"],
  }),
  defineSkill({
    id: "A04",
    title: "Regrouping when the minuend ends in zero",
    childFacingTitle: "Trade from zero ones",
    description: "Rename a two-digit minuend whose ones digit is zero.",
    track: "application",
    kind: "full_problem",
    prerequisites: ["A03"],
    remediationSkillIds: ["R02", "R03", "R04"],
    difficultyBands: [3, 4],
    tags: ["application", "regrouping", "zero-ones"],
  }),
  defineSkill({
    id: "A05",
    title: "Regrouping with a result below ten",
    childFacingTitle: "One-digit answers",
    description: "Regroup when the tens cancel and the result is from one through nine.",
    track: "application",
    kind: "full_problem",
    prerequisites: ["A03"],
    remediationSkillIds: ["R02", "R03", "R04", "R05"],
    difficultyBands: [3, 4],
    tags: ["application", "regrouping", "result-under-ten"],
  }),
  defineSkill({
    id: "A06",
    title: "Mixed regrouping and non-regrouping",
    childFacingTitle: "Choose whether to trade",
    description: "Inspect each full problem before choosing a subtraction procedure.",
    track: "application",
    kind: "full_problem",
    prerequisites: ["A02", "A03"],
    remediationSkillIds: ["A02", "A03", "A04", "A05"],
    difficultyBands: [3, 4],
    tags: ["application", "mixed", "inspection"],
  }),
  defineSkill({
    id: "T01",
    title: "Missing-number subtraction",
    childFacingTitle: "Find the missing number",
    description: "Reason about a missing result, subtrahend, or minuend.",
    track: "transfer",
    kind: "transfer",
    prerequisites: ["A06"],
    remediationSkillIds: ["A06"],
    difficultyBands: [3, 4],
    tags: ["transfer", "missing-number", "inverse-reasoning"],
  }),
  defineSkill({
    id: "T02",
    title: "Find and repair an incorrect solution",
    childFacingTitle: "Repair the answer",
    description: "Recognize a plausible procedural mistake and give the corrected result.",
    track: "transfer",
    kind: "transfer",
    prerequisites: ["A03"],
    remediationSkillIds: ["R01", "R02", "R03", "R04", "A03"],
    difficultyBands: [4],
    tags: ["transfer", "error-awareness", "self-monitoring"],
  }),
  defineSkill({
    id: "T03",
    title: "Horizontal and vertical format transfer",
    childFacingTitle: "Read both layouts",
    description: "Solve equivalent subtraction in horizontal and vertical presentation.",
    track: "transfer",
    kind: "transfer",
    prerequisites: ["A02", "A03"],
    remediationSkillIds: ["A02", "A03"],
    difficultyBands: [3, 4],
    tags: ["transfer", "horizontal", "vertical", "alignment"],
  }),
  defineSkill({
    id: "T04",
    title: "Mixed addition and subtraction signs",
    childFacingTitle: "Check the operation sign",
    description: "Select the intended operation before calculating.",
    track: "transfer",
    kind: "transfer",
    prerequisites: ["A06"],
    remediationSkillIds: ["A06"],
    difficultyBands: [4],
    tags: ["transfer", "operation-selection", "addition", "subtraction"],
    enabledByDefault: false,
  }),
  defineSkill({
    id: "T05",
    title: "Optional challenge provider",
    childFacingTitle: "Challenge card",
    description: "Provide one interesting non-speed transfer problem without gating progression.",
    track: "transfer",
    kind: "transfer",
    prerequisites: [],
    remediationSkillIds: ["T01", "T02"],
    difficultyBands: [3, 4],
    tags: ["transfer", "challenge", "optional", "non-speed"],
  }),
]);

export const SKILLS_BY_ID: Readonly<Record<SkillId, SkillDefinition>> = Object.freeze(
  Object.fromEntries(SKILL_DEFINITIONS.map((skill) => [skill.id, skill])) as Record<
    SkillId,
    SkillDefinition
  >,
);

export const SKILL_PREREQUISITES: Readonly<Record<SkillId, readonly SkillId[]>> = Object.freeze(
  Object.fromEntries(SKILL_DEFINITIONS.map((skill) => [skill.id, skill.prerequisites])) as Record<
    SkillId,
    readonly SkillId[]
  >,
);

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === "string" && (SKILL_IDS as readonly string[]).includes(value);
}

export function skillDefinition(skillId: SkillId): SkillDefinition {
  return SKILLS_BY_ID[skillId];
}

export function enabledDefaultSkillIds(): SkillId[] {
  return SKILL_DEFINITIONS.filter((skill) => skill.enabledByDefault).map((skill) => skill.id);
}

export function skillPrerequisitesMet(
  skillId: SkillId,
  conceptMasteredSkillIds: ReadonlySet<SkillId>,
): boolean {
  return SKILLS_BY_ID[skillId].prerequisites.every((prerequisite) =>
    conceptMasteredSkillIds.has(prerequisite),
  );
}
