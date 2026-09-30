import { WORLD_CONTENT_VERSION, WORLD_QUESTIONS, type WorldQuestion } from "./world-data.ts";
import bossHoldouts from "../../content/math-world/boss-holdouts.json" with { type: "json" };

/** The indexing agent may export this shape after checking BOTH type and method.
 * Broad curriculum tags or embedding neighbours alone are not reviewed edges. */
export type DangerCandidateIndex = Readonly<{
  schemaVersion: 1;
  version: string;
  contentVersion: string;
  classifications: Readonly<Record<string, Readonly<{
    questionType: string;
    method: string;
    reviewed: true;
    evidence: string;
  }>>>;
  edges: readonly Readonly<{
    sourceQuestionId: string;
    candidateQuestionId: string;
    questionType: string;
    method: string;
    reviewed: true;
    evidence: string;
  }>[];
}>;

/** Small, explicitly reviewed bridge while the full corpus index is prepared.
 * Diagram review: the tally set contains visible countable units (circles,
 * animals, individual matches, spots), not implied legs or overlapping shapes.
 * Card flips each show two perpendicular edge flips. The number grids each
 * show a 6×6 sheet folded in half twice before one hole is punched. */
const BOOTSTRAP_COHORTS = [
  {
    questionType: "NUM.quantities.visible_units",
    method: "one_to_one_visual_tally",
    evidence: "Canonical diagrams inspected 2026-09-30: enumerate each visible target unit once; no hidden units, arithmetic-only totals, or compare-the-largest-box tasks.",
    ids: ["oasis-online-2023-grades-1-2-q01", "oasis-online-2012-grades-1-2-q01", "oasis-online-2016-grades-1-2-q03", "oasis-online-2015-grades-1-2-q03"],
  },
  {
    questionType: "GEO.symmetry_transformations.card_flips",
    method: "compose_two_perpendicular_edge_reflections",
    evidence: "Canonical diagrams inspected 2026-09-30: horizontal three-symbol card, flip over top edge then left/right edge; track both order and triangle orientation.",
    ids: ["think300-l1-2-4-points-q006", "think300-l1-2-4-points-q022"],
  },
  {
    questionType: "SPA.folding_cutting.number_grid_hole",
    method: "unfold_one_punch_across_two_perpendicular_midlines",
    evidence: "Canonical diagrams inspected 2026-09-30: numbered 6×6 grid, top-to-bottom half fold then left-to-right half fold, one punched cell; reflect that cell across both original fold lines.",
    ids: ["think300-l3-4-4-points-q091", "think300-l3-4-4-points-q095"],
  },
] as const;

export const DANGER_CANDIDATE_INDEX: DangerCandidateIndex = {
  schemaVersion: 1,
  version: "reviewed-bootstrap-2026-09-30-v1",
  contentVersion: WORLD_CONTENT_VERSION,
  classifications: Object.fromEntries(BOOTSTRAP_COHORTS.flatMap(cohort => cohort.ids.map(id => [id, {
    questionType: cohort.questionType, method: cohort.method, reviewed: true as const, evidence: cohort.evidence,
  }]))),
  edges: BOOTSTRAP_COHORTS.flatMap(cohort => cohort.ids.flatMap(sourceQuestionId => cohort.ids.filter(id => id !== sourceQuestionId).map(candidateQuestionId => ({
    sourceQuestionId, candidateQuestionId, questionType: cohort.questionType, method: cohort.method, reviewed: true as const, evidence: cohort.evidence,
  })))),
};

const QUESTIONS = new Map(WORLD_QUESTIONS.map(question => [question.id, question]));
const VERIFIED_ANSWERS = new Set(["official-verified", "provider-answer-page-verified", "provider-answer-edition-verified"]);
const HELD_OUT_IDS = new Set(bossHoldouts.challenges.flatMap(challenge => challenge.questions.flatMap(question => [question.sourceId, ...question.reservedReferences.map(reference => reference.id)])));
function heldOut(question: WorldQuestion): boolean {
  if (HELD_OUT_IDS.has(question.id)) return true;
  const rule = bossHoldouts.matchingPolicy.metadataFallback;
  const family = question.source.sourceFamily?.toLowerCase() ?? "";
  const markers = family.split(/[^a-z]+/);
  return family.startsWith(rule.sourceFamilyPrefix.toLowerCase())
    && !rule.excludedSourceKinds.includes(question.source.sourceKind ?? "contest")
    && !rule.excludedSourceMarkers.some(marker => markers.includes(marker))
    && bossHoldouts.challenges.some(challenge => challenge.year === question.source.year && challenge.gradeBand === question.source.gradeBand);
}

export function dangerQuestion(questionId: string): WorldQuestion | undefined {
  const question = QUESTIONS.get(questionId);
  if (!question || !VERIFIED_ANSWERS.has(question.source.answerStatus ?? "")
    || !/^\/math-world\/spiral-questions\/[A-Za-z0-9][A-Za-z0-9._-]*\.(webp|png|jpe?g)$/.test(question.asset.src)
    || !/^[a-f0-9]{64}$/.test(question.asset.sha256 ?? "")
    // Hold the two recent full tests out of ALL danger review paths, including
    // a future index that accidentally aliases a reserved question.
    || heldOut(question)) return undefined;
  return question;
}

function validClassification(index: DangerCandidateIndex, id: string) {
  const record = index.classifications[id];
  return index.schemaVersion === 1 && index.contentVersion === WORLD_CONTENT_VERSION
    && record?.reviewed === true && record.questionType?.trim() && record.method?.trim() && record.evidence?.trim()
    ? record : undefined;
}

/** Unclassified misses stay distinct; we do not collapse unrelated methods. */
export function dangerQuestionType(questionId: string, index = DANGER_CANDIDATE_INDEX): string {
  const record = validClassification(index, questionId);
  return record ? JSON.stringify([record.questionType, record.method]) : `question:${questionId}`;
}

export function dangerCandidates(questionId: string, index = DANGER_CANDIDATE_INDEX): readonly string[] {
  const original = dangerQuestion(questionId);
  const classification = validClassification(index, questionId);
  if (!original || !classification || !Array.isArray(index.edges)) return [];
  const candidates = new Set<string>();
  for (const edge of index.edges) {
    if (edge.sourceQuestionId !== questionId || edge.reviewed !== true || !edge.evidence?.trim()
      || edge.questionType !== classification.questionType || edge.method !== classification.method) continue;
    const candidate = dangerQuestion(edge.candidateQuestionId);
    const candidateClassification = validClassification(index, edge.candidateQuestionId);
    if (!candidate || candidate.id === original.id || !candidateClassification
      || candidateClassification.questionType !== classification.questionType || candidateClassification.method !== classification.method
      || candidate.source.gradeBand !== original.source.gradeBand
      || (candidate.source.pointTier ?? Infinity) > (original.source.pointTier ?? 0)
      || (candidate.curriculum.reasoningDemand ?? Infinity) > (original.curriculum.reasoningDemand ?? 0)) continue;
    candidates.add(candidate.id);
  }
  return [...candidates].sort((left, right) => dangerQuestion(right)!.source.year - dangerQuestion(left)!.source.year || left.localeCompare(right));
}
