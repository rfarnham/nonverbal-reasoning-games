#!/usr/bin/env node

import {
  G1_SKILLS,
  getG1Skill,
  isG1SkillId,
} from "../lib/arithmetic-fluency/g1-curriculum.ts";
import {
  factUniverseForSkill,
  generateG1Question,
  requiredCoverageKeysForSkill,
  verifyG1GeneratorCorpus,
} from "../lib/arithmetic-fluency/generator.ts";
import { validateG1Curriculum } from "../lib/arithmetic-fluency/validator.ts";

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const [rawKey, inlineValue] = argument.slice(2).split("=", 2);
    const next = argv[index + 1];
    if (inlineValue !== undefined) options[rawKey] = inlineValue;
    else if (next && !next.startsWith("--")) {
      options[rawKey] = next;
      index += 1;
    } else options[rawKey] = true;
  }
  return options;
}

function requireSkill(value) {
  if (typeof value !== "string" || !isG1SkillId(value)) {
    throw new Error(`--skill must be one of: ${G1_SKILLS.map((skill) => skill.id).join(", ")}`);
  }
  return value;
}

function positiveInteger(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer.`);
  return parsed;
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function coverageReport() {
  const summary = { grade: {}, tier: {}, domain: {}, masteryProfile: {}, generatorKind: {}, difficultyBand: {}, structuralCoverageTag: {} };
  const rows = G1_SKILLS.map((skill) => {
    increment(summary.grade, `G${skill.grade}`);
    increment(summary.tier, skill.tier);
    increment(summary.domain, skill.domain);
    increment(summary.masteryProfile, skill.masteryProfile);
    increment(summary.generatorKind, skill.generator.kind);
    for (const band of skill.generator.difficultyBands) increment(summary.difficultyBand, String(band.band));
    for (const key of requiredCoverageKeysForSkill(skill.id)) increment(summary.structuralCoverageTag, key);
    return {
      id: skill.id,
      tier: skill.tier,
      domain: skill.domain,
      profile: skill.masteryProfile,
      generator: skill.generator.kind,
      bands: skill.generator.difficultyBands.map((band) => band.band),
      coverage: requiredCoverageKeysForSkill(skill.id),
      factUniverseSize: factUniverseForSkill(skill.id).length,
    };
  });
  return { summary, rows };
}

function graphReport() {
  const dependents = Object.fromEntries(G1_SKILLS.map((skill) => [skill.id, []]));
  for (const skill of G1_SKILLS) for (const prerequisite of skill.prerequisites) dependents[prerequisite].push(skill.id);
  const validation = validateG1Curriculum();
  return {
    valid: validation.valid,
    cycles: validation.errors.filter((entry) => entry.code === "prerequisite_cycle"),
    laterGradeViolations: validation.errors.filter((entry) => entry.code === "later_grade_prerequisite"),
    roots: G1_SKILLS.filter((skill) => skill.prerequisites.length === 0).map((skill) => skill.id),
    noDependents: G1_SKILLS.filter((skill) => dependents[skill.id].length === 0).map((skill) => skill.id),
    broadFanIn: G1_SKILLS.filter((skill) => skill.prerequisites.length > 4).map((skill) => ({ id: skill.id, prerequisites: skill.prerequisites })),
    edges: G1_SKILLS.flatMap((skill) => skill.prerequisites.map((prerequisite) => ({ from: prerequisite, to: skill.id }))),
  };
}

const [command = "help", ...rawOptions] = process.argv.slice(2);
const options = parseOptions(rawOptions);

try {
  switch (command) {
    case "validate": {
      const result = validateG1Curriculum();
      console.log(JSON.stringify(result, null, 2));
      if (!result.valid) process.exitCode = 1;
      break;
    }
    case "list":
      console.table(G1_SKILLS.map((skill) => ({ id: skill.id, tier: skill.tier, domain: skill.domain, profile: skill.masteryProfile, title: skill.title, prerequisites: skill.prerequisites.join(",") })));
      break;
    case "graph":
      console.log(JSON.stringify(graphReport(), null, 2));
      break;
    case "coverage":
      console.log(JSON.stringify(coverageReport(), null, 2));
      break;
    case "generate": {
      const skillId = requireSkill(options.skill);
      const count = positiveInteger(options.count, 1, "--count");
      const baseSeed = typeof options.seed === "string" ? options.seed : "demo";
      const difficultyBand = options.band === undefined ? undefined : positiveInteger(options.band, 1, "--band");
      if (difficultyBand !== undefined && difficultyBand > 4) throw new Error("--band must be from 1 through 4.");
      const orientation = options.orientation;
      if (orientation !== undefined && orientation !== "horizontal" && orientation !== "vertical") throw new Error("--orientation must be horizontal or vertical.");
      const questions = Array.from({ length: count }, (_, index) => generateG1Question({
        skillId,
        seed: count === 1 ? baseSeed : `${baseSeed}:${index}`,
        difficultyBand,
        orientation,
      }));
      console.log(JSON.stringify(count === 1 ? questions[0] : questions, null, 2));
      break;
    }
    case "explain": {
      const skillId = requireSkill(options.skill);
      const question = generateG1Question({ skillId, seed: typeof options.seed === "string" ? options.seed : "demo" });
      console.log(JSON.stringify({ skill: getG1Skill(skillId), question, explanation: question.solutionTrace }, null, 2));
      break;
    }
    case "verify-all": {
      const seeds = positiveInteger(options.seeds, 1_000, "--seeds");
      const validation = validateG1Curriculum();
      const generators = verifyG1GeneratorCorpus(seeds);
      const result = { curriculum: validation, generators };
      console.log(JSON.stringify(result, null, 2));
      if (!validation.valid || generators.coverageMissing.length > 0) process.exitCode = 1;
      break;
    }
    default:
      console.log(`Arithmetic curriculum developer commands:
  validate
  list
  graph
  coverage
  generate --skill G1-AS-10 [--count 20] [--seed demo] [--band 1..4] [--orientation horizontal|vertical]
  explain --skill G1-AS-10 [--seed demo]
  verify-all [--seeds 1000]`);
      if (command !== "help") process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
