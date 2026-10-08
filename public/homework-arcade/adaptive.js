import { verbalLevels } from './adaptive-verbal-levels.js';

// This is a practice scheduler. Its tiers are curriculum priors, not ability scores.
const VERSION = 1;
const MAX_COUNT = 1_000_000_000;
const HISTORY_LIMIT = 64;
const CALIBRATION_TRIALS = 4;
const REVIEW_GAP = 3;
const OUTCOME = Object.freeze({ independent: 1, supported: 2, unmet: 3, pass: 4 });
const REASONS = [
  'Starting with a challenging practice item.',
  'Repeated independent answers moved the challenge up.',
  'Repeated independent answers moved the challenge up.',
  'An unmet answer moved the challenge down for another try.',
  'Supported practice keeps the current challenge; try a fresh item independently.',
  'Passing an item keeps the current challenge.',
  'Building independent evidence at the current challenge.',
  'You asked for a harder item.',
  'You asked for an easier item.',
  'Continuing practice at the highest available challenge.',
  'Continuing practice at the lowest available challenge.',
];

const integer = (value, fallback = 0, low = 0, high = MAX_COUNT) =>
  Number.isSafeInteger(value) && value >= low && value <= high ? value : fallback;
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)
  && !['__proto__', 'constructor', 'prototype'].includes(id);
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
const total = (record) => record.slice(0, 4).reduce((sum, n) => sum + n, 0);

function pool(track) {
  const seen = new Set();
  return Array.isArray(track?.items) ? track.items.filter((item) => {
    if (!validId(item?.id) || seen.has(item.id) || !Number.isSafeInteger(item.level) || item.level < 1) return false;
    seen.add(item.id);
    return true;
  }) : [];
}

function highest(track) {
  return Math.max(1, ...pool(track).map((item) => item.level));
}

function ordinal(q, index) {
  // sourceQuestion is local to a section; spoken similarities' global order starts at 86.
  return integer(q.sourceQuestion, integer(q.order, index + 1, 1), 1);
}

/** Build only tracks with a defensible difficulty basis. Other material remains browsable. */
export function buildTracks(questions) {
  if (!Array.isArray(questions)) return [];
  const seen = new Set();
  const input = questions.filter((q) => {
    if (!q || !validId(q.id) || seen.has(q.id)) return false;
    seen.add(q.id);
    return true;
  });
  const specs = [
    {
      id: 'picture-similarities', label: 'Picture similarities', category: 'similarities',
      basis: 'source-progressive', responseDemand: 'recognition',
      difficultyNote: 'Five approximate tiers follow the source’s broadly easier-to-harder picture order. Your independent answers adjust the practice target.',
    },
    {
      id: 'spoken-similarities', label: 'Spoken similarities', category: 'spoken_similarities',
      basis: 'source-progressive', responseDemand: 'spoken-category',
      difficultyNote: 'Five approximate tiers follow the source’s broadly easier-to-harder oral order. Spoken explanations are tracked separately from picture recognition.',
    },
    {
      id: 'vocabulary', label: 'Vocabulary', category: 'vocabulary',
      basis: 'provisional-order', responseDemand: 'spoken-definition',
      difficultyNote: 'Source-order tiers are provisional practice groups; the source does not verify word difficulty. Only an independently complete meaning counts as independent success.',
    },
    {
      id: 'letter-number-sequences', label: 'Letter-number sequences', category: 'sequencing',
      basis: 'span', responseDemand: 'reorder',
      difficultyNote: 'Difficulty follows the number of spoken tokens, from two through seven. Adaptive practice can step down and continue after misses; it does not apply the worksheet’s stopping rule.',
    },
    {
      id: 'analogies', label: 'Analogies', category: 'analogies',
      basis: 'editor-reviewed', responseDemand: 'relationship-completion',
      difficultyNote: 'Authored practice tiers consider relationship abstraction and plausible distractors. They are curriculum estimates, adjusted by independent performance.',
    },
    {
      id: 'classification', label: 'Word classification', category: 'classification',
      basis: 'editor-reviewed', responseDemand: 'category-membership',
      difficultyNote: 'Authored practice tiers consider category abstraction and plausible distractors. They are curriculum estimates, adjusted by independent performance.',
    },
  ];
  return specs.flatMap((spec) => {
    const qs = input.filter((q) => q.category === spec.category
      && (spec.basis !== 'span' || (q.type === 'sequence' && Array.isArray(q.sequence) && q.sequence.length >= 2 && q.sequence.length <= 7))
      && (spec.basis !== 'editor-reviewed' || integer(verbalLevels[q.id], 0, 1, 5) > 0));
    const ordered = qs.map((q, index) => ({ q, ordinal: ordinal(q, index), index }))
      .sort((a, b) => a.ordinal - b.ordinal || a.index - b.index);
    if (!ordered.length) return [];
    const items = ordered.map(({ q, ordinal: sourceOrdinal }, index) => ({
      id: q.id,
      question: q,
      level: spec.basis === 'span' ? q.sequence.length - 1
        : spec.basis === 'editor-reviewed' ? verbalLevels[q.id]
          : Math.min(5, Math.floor(index * 5 / ordered.length) + 1),
      sourceOrdinal,
      difficultyBasis: spec.basis,
      responseDemand: spec.responseDemand,
    }));
    const maxLevel = Math.max(...items.map((item) => item.level));
    return [{ ...spec, items, maxLevel, startLevel: spec.basis === 'span' ? Math.min(3, maxLevel) : Math.min(4, maxLevel),
      levelLabels: spec.basis === 'span' ? ['2 tokens', '3 tokens', '4 tokens', '5 tokens', '6 tokens', '7 tokens'] : undefined }];
  });
}

/** Validate storage against this one track and discard content, unknown IDs, and stale versions. */
export function createState(track, stored) {
  const maxLevel = highest(track);
  const initial = {
    version: VERSION,
    trackId: validId(track?.id) ? track.id : 'empty-track',
    level: integer(track?.startLevel, Math.min(4, maxLevel), 1, maxLevel),
    trial: 0, phase: 0, reason: 0, calibrationTrials: 0,
    runLevel: 0, independentRun: [], missRun: 0,
    evidence: {}, history: [], familiar: [],
  };
  if (typeof stored === 'string') {
    try { stored = JSON.parse(stored); } catch { return initial; }
  }
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)
    || stored.version !== VERSION || stored.trackId !== initial.trackId) return initial;
  const known = new Map(pool(track).map((item) => [item.id, item]));
  const evidence = {};
  let trial = 0;
  if (stored.evidence && typeof stored.evidence === 'object' && !Array.isArray(stored.evidence)) {
    for (const [id, raw] of Object.entries(stored.evidence)) {
      if (!known.has(id) || !Array.isArray(raw)) continue;
      const record = [0, 1, 2, 3].map((index) => integer(raw[index]));
      if (!total(record)) continue;
      trial += total(record);
      if (trial > MAX_COUNT) return initial;
      record.push(integer(raw[4]), integer(raw[5], 0, 1, 4), integer(raw[6]));
      evidence[id] = record;
    }
  }
  for (const record of Object.values(evidence)) {
    record[4] = Math.min(record[4], trial);
    // The last event cannot claim an outcome that was never observed.
    if (!record[5] || record[record[5] - 1] === 0) record[5] = 0;
    record[6] = record[1] + record[2] > 0 && record[5] !== 1
      ? Math.min(record[6], record[4] + REVIEW_GAP) : 0;
  }
  const history = [];
  let previous = 0;
  if (Array.isArray(stored.history)) {
    for (const raw of stored.history.slice(-HISTORY_LIMIT)) {
      if (!Array.isArray(raw) || !known.has(raw[0]) || !evidence[raw[0]]) continue;
      const code = integer(raw[1], 0, 1, 4);
      const at = integer(raw[2], 0, 1, trial);
      if (!code || at <= previous || !evidence[raw[0]][code - 1]) continue;
      const item = known.get(raw[0]);
      history.push([raw[0], code, at, item.level, raw[4] === 1 && code === 1 ? 1 : 0]);
      previous = at;
    }
  }
  const level = integer(stored.level, initial.level, 1, maxLevel);
  const runLevel = integer(stored.runLevel, 0, 1, maxLevel);
  const independentRun = [];
  if (runLevel === level && Array.isArray(stored.independentRun)) {
    for (const id of stored.independentRun.slice(-3)) {
      if (!known.has(id) || independentRun.includes(id) || !evidence[id]?.[0]
        || evidence[id][1] || evidence[id][2] || known.get(id).level < level
        || !history.some((event) => event[0] === id && event[1] === 1 && event[4] === 1)) continue;
      independentRun.push(id);
    }
  }
  const familiar = [...new Set([
    ...(Array.isArray(stored.familiar) ? stored.familiar.filter((id) => known.has(id)) : []),
    // Migrate older states: an explicit graded answer means the stimulus was practised.
    ...Object.keys(evidence).filter((id) => evidence[id][0] + evidence[id][1] + evidence[id][2] > 0),
  ])];
  return { ...initial, level, trial, evidence, history, familiar,
    phase: integer(stored.phase, 0, 0, 1),
    reason: integer(stored.reason, 0, 0, REASONS.length - 1),
    calibrationTrials: Math.min(integer(stored.calibrationTrials, 0, 0, CALIBRATION_TRIALS), trial),
    runLevel: independentRun.length ? level : 0, independentRun,
    missRun: Math.min(integer(stored.missRun), trial),
  };
}

/** Deterministic, non-mutating selection. Pool exhaustion means spaced reuse, never a lockout. */
export function chooseNext(track, stored) {
  const items = pool(track);
  if (!items.length) return null;
  const state = createState(track, stored);
  const lastId = state.history.at(-1)?.[0];
  const alternatives = items.filter((item) => item.id !== lastId);
  const noImmediateRepeat = alternatives.length ? alternatives : items;
  const record = (item) => state.evidence[item.id] || [0, 0, 0, 0, 0, 0, 0];
  const familiar = new Set(state.familiar);
  const distance = (item) => Math.abs(item.level - state.level);
  const spaced = noImmediateRepeat.filter((item) => {
    const r = record(item);
    return !r[6] || state.trial - r[4] >= REVIEW_GAP;
  });
  const available = spaced.length ? spaced : noImmediateRepeat;
  const order = new Map(items.map((item, index) => [item.id, index]));
  const sort = (list) => [...list].sort((a, b) => distance(a) - distance(b)
    || Number(familiar.has(a.id)) - Number(familiar.has(b.id))
    || total(record(a)) - total(record(b)) || record(a)[4] - record(b)[4]
    || order.get(a.id) - order.get(b.id));
  const due = available.filter((item) => record(item)[6] > 0
    && state.trial >= record(item)[6] && distance(item) <= 1);
  const freshNear = available.filter((item) => !familiar.has(item.id)
    && record(item)[0] + record(item)[1] + record(item)[2] === 0 && distance(item) <= 1);
  // A due review gets at most one regular slot in four while fresh transfer items exist.
  if (due.length && (state.trial % 4 === 0 || !freshNear.length)) {
    return [...due].sort((a, b) => record(a)[6] - record(b)[6]
      || distance(a) - distance(b) || order.get(a.id) - order.get(b.id))[0];
  }
  if (freshNear.length) return sort(freshNear)[0];
  const near = available.filter((item) => distance(item) <= 1);
  if (near.length) return sort(near)[0];
  return sort(available)[0];
}

/** An outcome describes the completed trial explicitly; partial scores imply no outcome here. */
export function recordOutcome(track, stored, itemId, outcome) {
  const state = createState(track, stored);
  const item = pool(track).find((candidate) => candidate.id === itemId);
  const code = typeof outcome === 'string' && Object.hasOwn(OUTCOME, outcome) ? OUTCOME[outcome] : 0;
  if (!item || !code) return state;
  const old = state.evidence[itemId] || [0, 0, 0, 0, 0, 0, 0];
  const eligible = code === 1 && old[0] + old[1] + old[2] === 0 && !state.familiar.includes(itemId);
  const trial = Math.min(MAX_COUNT, state.trial + 1);
  const record = [...old];
  record[code - 1] = Math.min(MAX_COUNT, record[code - 1] + 1);
  record[4] = trial;
  record[5] = code;
  record[6] = code === 2 || code === 3 ? trial + REVIEW_GAP
    : code === 4 && old[6] ? trial + REVIEW_GAP : 0;
  const next = { ...state, trial,
    evidence: { ...state.evidence, [itemId]: record },
    history: [...state.history, [itemId, code, trial, item.level, eligible ? 1 : 0]].slice(-HISTORY_LIMIT),
    independentRun: [...state.independentRun],
    familiar: code !== 4 && !state.familiar.includes(itemId) ? [...state.familiar, itemId] : [...state.familiar],
  };
  if (code === 4) { next.reason = 5; return next; }
  next.calibrationTrials = Math.min(CALIBRATION_TRIALS, state.calibrationTrials + 1);
  if (code === 1) {
    next.missRun = 0;
    if (eligible && item.level >= state.level) {
      if (next.runLevel !== state.level) next.independentRun = [];
      next.runLevel = state.level;
      next.independentRun.push(itemId);
      next.independentRun = next.independentRun.slice(-3);
    } else if (item.level < state.level) {
      next.independentRun = [];
      next.runLevel = 0;
    }
    const needed = state.phase === 0 ? 2 : 3;
    if (next.independentRun.length >= needed && state.level < highest(track)) {
      next.level = state.level + 1;
      next.reason = state.phase === 0 ? 1 : 2;
      next.independentRun = [];
      next.runLevel = 0;
    } else next.reason = state.level === highest(track) ? 9 : 6;
  } else {
    next.independentRun = [];
    next.runLevel = 0;
    if (code === 2) { next.missRun = 0; next.reason = 4; }
    else {
      next.missRun = state.missRun + 1;
      next.level = Math.max(1, Math.min(state.level - 1, item.level - 1));
      next.reason = next.level < state.level ? 3 : 10;
    }
  }
  if (next.calibrationTrials >= CALIBRATION_TRIALS) next.phase = 1;
  return next;
}

/** Parent steering changes the target, never the independent/support evidence. */
export function adjustLevel(track, stored, delta) {
  const state = createState(track, stored);
  if (!Number.isFinite(delta) || !Math.trunc(delta)) return state;
  const level = clamp(state.level + Math.trunc(delta), 1, highest(track));
  return { ...state, level, phase: 1, independentRun: [], runLevel: 0, missRun: 0,
    reason: level > state.level ? 7 : level < state.level ? 8 : level === 1 ? 10 : 9 };
}

export function describeState(track, stored) {
  const state = createState(track, stored);
  const records = Object.values(state.evidence);
  const count = (index) => records.reduce((sum, record) => sum + record[index], 0);
  const maxLevel = highest(track);
  return {
    phase: state.phase === 0 ? 'calibration' : 'practice',
    reason: REASONS[state.reason], reasonCode: state.reason,
    level: state.level, maxLevel,
    levelLabel: track?.levelLabels?.[state.level - 1] || `Level ${state.level}`,
    counts: { independent: count(0), supported: count(1), unmet: count(2) },
    passed: count(3), trial: state.trial,
    calibrationRemaining: state.phase === 0 ? Math.max(0, CALIBRATION_TRIALS - state.calibrationTrials) : 0,
    independentToRise: state.level < maxLevel ? Math.max(0, (state.phase === 0 ? 2 : 3) - state.independentRun.length) : 0,
    pendingReviews: records.filter((record) => record[6] > 0).length,
    availableNew: pool(track).filter((item) => !state.familiar.includes(item.id)).length,
    difficultyNote: track?.difficultyNote || '',
  };
}
