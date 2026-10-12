import assert from "node:assert/strict";
import test from "node:test";
import { createInitialProgress } from "../app/math-world/engine.ts";
import { WORLD_DEFINITIONS, WORLD_QUESTIONS, QUESTIONS_BY_STOP } from "../app/math-world/world-data.ts";
import { BOSS_CHALLENGES } from "../app/math-world/boss-challenges.ts";
import { createBossProgress, setBossAnswer, submitBossAnswers } from "../app/math-world/boss-progress.ts";
import { DANGERS, canNavigateDestination, dangerAfterWorld, dangerSceneryStages } from "../app/math-world/danger-definitions.ts";
import { createDangerReveal, DANGER_REVEAL_SECONDS } from "../app/math-world/danger-reveal.ts";
import { createSceneryClock } from "../app/math-world/scenery-clock.ts";
import {
  acknowledgeDangerBriefing, advanceDangerQuestion, answerDangerQuestion, createDangerState,
  dangerPacketQuestions, ensureDangerPacket, importLegacyDangerMisses, recordDangerMiss, startDangerPacket,
} from "../app/math-world/danger-engine.ts";

const NOW = "2026-09-30T20:00:00.000Z";
const state = createDangerState("visibility-reader");
const world = number => WORLD_DEFINITIONS.find(candidate => candidate.number === number);
const freshAttempt = () => ({ questionIndex: 0, phase: "answering", selectedIndex: null, firstTryCorrect: {}, solvedQuestionIds: [] });
const finishedThrough = number => ({
  ...createInitialProgress(),
  completedStopIds: WORLD_DEFINITIONS.filter(candidate => candidate.number <= number).flatMap(candidate => candidate.stopIds),
});
function assertVisible(progress, dangerState, expectedId, qa = false, activeId, bossState) {
  const stages = dangerSceneryStages(progress, dangerState, qa, activeId, bossState);
  assert.deepEqual(Object.keys(stages).sort(), DANGERS.map(danger => danger.id).sort(), "every reserved crossing has an explicit stage");
  assert.deepEqual(Object.entries(stages).filter(([, stage]) => stage > 0).map(([id]) => id), expectedId ? [expectedId] : []);
  for (const [id, stage] of Object.entries(stages)) assert.equal(stage, id === expectedId ? 1 : 0, "relevance supplies targets; animation belongs to the scenery clock");
}
function completedEmptyPacket(before, number) {
  const danger = dangerAfterWorld(number);
  const prepared = ensureDangerPacket(before, { dangerId: danger.id, afterWorldNumber: number, now: NOW });
  return startDangerPacket(acknowledgeDangerBriefing(prepared, danger.id), danger.id, NOW);
}

function dangersThrough(number) {
  return DANGERS.filter(danger => danger.afterWorld <= number).reduce((before, danger) => completedEmptyPacket(before, danger.afterWorld), state);
}
function bossesThrough(number) {
  return BOSS_CHALLENGES.filter(boss => boss.afterWorld <= number).reduce((before, boss) => {
    for (let index = 0; index < 24; index++) before = setBossAnswer(before, boss.id, index, 0);
    return submitBossAnswers(before, boss.id, NOW);
  }, createBossProgress("visibility-reader"));
}

test("each teaching boundary reveals only the next uncompleted reachable crossing", () => {
  for (let number = 0; number <= 32; number++) {
    const progress = finishedThrough(number);
    const expected = number > 0 && number % 2 === 0 ? dangerAfterWorld(number).id : undefined;
    const dangers = dangersThrough(number % 2 === 0 ? number - 2 : number - 1);
    const bosses = bossesThrough(number - 1);
    assertVisible(progress, dangers, expected, false, undefined, bosses);
    assertVisible(progress, dangers, expected, true, world(Math.min(32, number + 1)).id, bosses);
  }
});

test("the final stop must be completed, not merely entered or answered, before its danger gathers", () => {
  for (const danger of DANGERS) {
    const dangers = dangersThrough(danger.afterWorld - 2), bosses = bossesThrough(danger.afterWorld - 1);
    const finalStop = world(danger.afterWorld).stopIds.at(-1);
    const questions = QUESTIONS_BY_STOP.get(finalStop);
    const incomplete = {
      ...finishedThrough(danger.afterWorld),
      activeStopId: finalStop,
      completedStopIds: finishedThrough(danger.afterWorld).completedStopIds.filter(id => id !== finalStop),
    };
    for (const phase of ["answering", "wrong-review", "retry", "correct"]) {
      const progress = {
        ...incomplete,
        stopAttempts: { [finalStop]: {
          ...freshAttempt(), phase, questionIndex: questions.length - 1,
          selectedIndex: phase === "answering" ? null : questions.at(-1).correctIndex,
          firstTryCorrect: Object.fromEntries(questions.map(question => [question.id, true])),
          solvedQuestionIds: phase === "correct" ? questions.map(question => question.id) : questions.slice(0, -1).map(question => question.id),
        } },
      };
      assertVisible(progress, dangers, undefined, false, undefined, bosses);
    }
    assertVisible({ ...incomplete, completedStopIds: finishedThrough(danger.afterWorld).completedStopIds }, dangers, danger.id, false, undefined, bosses);
  }
});

test("stale destinations and later earned work never hide an outstanding earlier danger", () => {
  const progress = { ...finishedThrough(8), selectedWorldId: world(31).id };
  for (const danger of DANGERS) assertVisible(progress, state, "danger-02", false, danger.id);
  assertVisible({ ...createInitialProgress(), selectedWorldId: world(32).id }, state, undefined, false, "danger-32");
  for (const danger of DANGERS.filter(candidate => candidate.afterWorld < 32)) {
    const prior = dangersThrough(danger.afterWorld - 2), bosses = bossesThrough(danger.afterWorld - 1);
    const nextStop = world(danger.afterWorld + 1).stopIds[0];
    const completed = finishedThrough(danger.afterWorld);
    assertVisible({ ...completed, stopAttempts: { [nextStop]: freshAttempt() } }, prior, danger.id, false, undefined, bosses);
    assertVisible({ ...completed, completedStopIds: [...completed.completedStopIds, nextStop] }, prior, danger.id, false, undefined, bosses);
  }
});

test("sparse or out-of-order work does not expose a future crossing", () => {
  const sparse = { ...createInitialProgress(), completedStopIds: [2, 8, 16, 32].flatMap(number => world(number).stopIds) };
  assertVisible(sparse, state, undefined);
  const missingEarlyStop = {
    ...finishedThrough(16),
    completedStopIds: finishedThrough(16).completedStopIds.filter(id => id !== world(3).stopIds[0]),
  };
  assertVisible(missingEarlyStop, state, "danger-02", false);
  assertVisible(missingEarlyStop, dangersThrough(2), undefined);
  assertVisible({ ...missingEarlyStop, completedStopIds: [...missingEarlyStop.completedStopIds, world(3).stopIds[0]] }, dangersThrough(2), "danger-04");
});

test("importing an old mistake does not grant a crossing or skip its submission", () => {
  const original = WORLD_QUESTIONS.find(question => question.worldId === world(1).id);
  const progress = {
    ...finishedThrough(20),
    stopAttempts: { [original.stopId]: { ...freshAttempt(), firstTryCorrect: { [original.id]: false } } },
  };
  const imported = importLegacyDangerMisses(state, progress, NOW);
  assert.equal(imported.misses.length, 1);
  assertVisible(progress, imported, "danger-02");
  const prepared = ensureDangerPacket(imported, { dangerId: "danger-02", afterWorldNumber: 2, now: NOW });
  assert.ok(prepared.packets["danger-02"].questionIds.length > 0);
  assertVisible(progress, prepared, "danger-02");
});

test("briefing, print preparation and answering retain a relevant danger; completing it removes the threat", () => {
  const original = WORLD_QUESTIONS.find(question => question.worldId === world(1).id);
  const progress = finishedThrough(2);
  let dangerState = recordDangerMiss(state, {
    eventId: "visibility-miss", questionId: original.id, source: "archipelago", sourceId: original.stopId,
    worldNumber: 1, attemptOrdinal: 1, selectedIndex: (original.correctIndex + 1) % original.choices.length, at: NOW,
  });
  const expectedMisses = structuredClone(dangerState.misses);
  dangerState = ensureDangerPacket(dangerState, { dangerId: "danger-02", afterWorldNumber: 2, now: NOW });
  assertVisible(progress, dangerState, "danger-02");
  dangerState = acknowledgeDangerBriefing(dangerState, "danger-02");
  assertVisible(progress, dangerState, "danger-02");
  dangerState = startDangerPacket(dangerState, "danger-02", NOW);
  while (!dangerState.packets["danger-02"].completedAt) {
    const packet = dangerState.packets["danger-02"];
    const question = dangerPacketQuestions(packet)[packet.attempt.questionIndex];
    assertVisible(progress, dangerState, "danger-02");
    dangerState = answerDangerQuestion(dangerState, "danger-02", question.correctIndex, { eventId: `visibility-correct:${question.id}`, at: NOW });
    assertVisible(progress, dangerState, "danger-02");
    dangerState = advanceDangerQuestion(dangerState, "danger-02", NOW);
  }
  assertVisible(progress, dangerState, undefined, false, "danger-02");
  assert.equal(canNavigateDestination(progress, dangerState, world(3).id), true);
  assert.deepEqual(dangerState.misses, expectedMisses, "removing scenery cannot delete mistake history");
  assertVisible(finishedThrough(4), dangerState, "danger-04");
});

test("submitted empty passages disappear; prior storms still block later danger scenery", () => {
  for (const danger of DANGERS) {
    const completed = dangersThrough(danger.afterWorld), bosses = bossesThrough(danger.afterWorld - 1);
    assert.ok(completed.packets[danger.id].completedAt);
    assertVisible(finishedThrough(danger.afterWorld), completed, undefined, false, undefined, bosses);
  }
  assertVisible(finishedThrough(18), dangersThrough(16), undefined);
  assertVisible(finishedThrough(18), dangersThrough(16), "danger-18", false, undefined, bossesThrough(16));
});

test("QA previews only explicitly selected unfinished dangers and cannot revive a completed one", () => {
  const initial = createInitialProgress();
  for (const danger of DANGERS) {
    assert.equal(canNavigateDestination(initial, state, danger.id, true), true);
    assertVisible(initial, state, danger.id, true, danger.id);
    assertVisible(finishedThrough(8), state, danger.id, true, danger.id);
    assertVisible(finishedThrough(danger.afterWorld), dangersThrough(danger.afterWorld), undefined, true, danger.id, bossesThrough(danger.afterWorld));
  }
  for (const activeId of [undefined, "unknown-danger", "danger-99", world(1).id, BOSS_CHALLENGES[0].id]) {
    assertVisible(initial, state, undefined, true, activeId);
    assertVisible(finishedThrough(8), state, "danger-02", true, activeId);
  }
});

test("calculating visibility is pure and cannot mutate navigation, packet identity or saved answers", () => {
  const progress = finishedThrough(2);
  const dangerState = ensureDangerPacket(state, { dangerId: "danger-02", afterWorldNumber: 2, now: NOW });
  const before = structuredClone({ progress, dangerState });
  const packet = dangerState.packets["danger-02"];
  for (const qa of [false, true]) for (const activeId of [undefined, "danger-02", "danger-32", world(1).id]) dangerSceneryStages(progress, dangerState, qa, activeId);
  assert.deepEqual({ progress, dangerState }, before);
  assert.equal(dangerState.packets["danger-02"], packet);
});

test("a newly relevant danger gathers smoothly over four seconds of active scenery time", () => {
  assert.equal(DANGER_REVEAL_SECONDS, 4);
  const reveal = createDangerReveal();
  const targets = { "danger-02": 1, "danger-04": 0 };
  const options = { running: true, reducedMotion: false };
  assert.equal(reveal.sample(300, targets, options)["danger-02"], 0, "absolute globe age does not skip a new reveal");
  let previous = 0;
  for (let tick = 1; tick <= 40; tick++) {
    const stages = reveal.sample(300 + tick / 10, targets, options);
    assert.ok(stages["danger-02"] >= previous && stages["danger-02"] <= 1);
    if (tick < 40) assert.ok(stages["danger-02"] < 1);
    if (tick === 20) assert.ok(Math.abs(stages["danger-02"] - .5) < 1e-10);
    assert.equal(stages["danger-04"], 0);
    previous = stages["danger-02"];
  }
  assert.equal(previous, 1);
  assert.equal(reveal.sample(900, targets, options)["danger-02"], 1);
});

test("pausing an in-flight reveal freezes it and resuming uses only subsequent active time", () => {
  const reveal = createDangerReveal(), targets = { "danger-02": 1 };
  reveal.sample(0, targets, { running: true, reducedMotion: false });
  const before = reveal.sample(1, targets, { running: true, reducedMotion: false });
  assert.ok(before["danger-02"] > 0 && before["danger-02"] < 1);
  assert.deepEqual(reveal.sample(1, targets, { running: false, reducedMotion: false }), before);
  // Navigation can repaint repeatedly while the scenery clock remains stopped.
  for (let frame = 0; frame < 10; frame++) assert.deepEqual(reveal.sample(1, targets, { running: false, reducedMotion: false }), before);
  assert.deepEqual(reveal.sample(1, targets, { running: true, reducedMotion: false }), before);
  assert.equal(reveal.sample(2, targets, { running: true, reducedMotion: false })["danger-02"], .5);
});

test("hidden and offscreen wall time cannot advance the reveal through the shared scenery clock", () => {
  let wallTime = 0, sequence = 0, stage = 0;
  const frames = new Map(), reveal = createDangerReveal(), targets = { "danger-02": 1 };
  reveal.sample(0, targets, { running: true, reducedMotion: false });
  const clock = createSceneryClock({
    now: () => wallTime,
    request: callback => { frames.set(++sequence, callback); return sequence; },
    cancel: id => frames.delete(id),
    onFrame: seconds => { stage = reveal.sample(seconds, targets, { running: true, reducedMotion: false })["danger-02"]; },
  });
  const advance = ms => {
    wallTime += ms;
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(wallTime);
  };
  clock.setRunning(true);
  for (let tick = 0; tick < 10; tick++) advance(100);
  const before = stage;
  assert.ok(before > 0 && before < .5);
  for (const inactiveReason of ["hidden tab", "offscreen globe", "paused scenery"]) {
    clock.setRunning(false);
    assert.equal(frames.size, 0, inactiveReason);
    advance(60 * 60 * 1000);
    assert.equal(stage, before, inactiveReason);
    clock.setRunning(true);
  }
  for (let tick = 0; tick < 10; tick++) advance(100);
  assert.ok(Math.abs(stage - .5) < 1e-10, "two active seconds remain two seconds after three hidden hours");
  clock.dispose();
  assert.equal(frames.size, 0);
});

test("reduced motion and an initially paused scene display the complete static danger immediately", () => {
  for (const options of [
    { running: true, reducedMotion: true },
    { running: false, reducedMotion: true },
    { running: false, reducedMotion: false },
  ]) {
    const reveal = createDangerReveal();
    assert.equal(reveal.sample(8, { "danger-02": 1 }, options)["danger-02"], 1);
  }
  const reveal = createDangerReveal(), targets = { "danger-02": 1 };
  reveal.sample(0, targets, { running: true, reducedMotion: false });
  reveal.sample(1, targets, { running: true, reducedMotion: false });
  assert.equal(reveal.sample(1, targets, { running: false, reducedMotion: true })["danger-02"], 1);
  assert.equal(reveal.sample(1, targets, { running: true, reducedMotion: false })["danger-02"], 1, "returning to normal motion does not replay an already settled reveal");
});

test("irrelevant dangers disappear immediately, and the next danger gets its own reveal", () => {
  const reveal = createDangerReveal(), options = { running: true, reducedMotion: false };
  reveal.sample(0, { "danger-02": 1, "danger-04": 0 }, options);
  assert.equal(reveal.sample(2, { "danger-02": 1, "danger-04": 0 }, options)["danger-02"], .5);
  assert.deepEqual(reveal.sample(2, { "danger-02": 0, "danger-04": 1 }, options), { "danger-02": 0, "danger-04": 0 });
  assert.deepEqual(reveal.sample(4, { "danger-02": 0, "danger-04": 1 }, options), { "danger-02": 0, "danger-04": .5 });
  assert.deepEqual(reveal.sample(4, {}, options), {}, "removed IDs cannot linger in the render state");
  assert.deepEqual(reveal.sample(4, { "danger-02": 1 }, options), { "danger-02": 0 }, "a deliberate QA replay can reveal a removed danger afresh");
});
