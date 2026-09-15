import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  advanceQuestion,
  allowRetry,
  answerQuestion,
  canOpenRequiredStop,
  createInitialProgress,
  nextRequiredStopId,
  startStop,
} from "../app/math-world/engine.ts";
import {
  BREAK_STOPS,
  QUESTIONS_BY_STOP,
  REQUIRED_STOPS,
  WORLD_QUESTIONS,
  WORLD_STOPS,
} from "../app/math-world/world-data.ts";

test("the approved map ontology has six realms and 27 stable districts", async () => {
  const ontology = JSON.parse(
    await readFile(
      new URL("../content/math-world/mk-map-ontology.v1.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(ontology.status, "approved-static-placement");
  assert.equal(ontology.realms.length, 6);
  const districts = ontology.realms.flatMap((realm) => realm.districts);
  assert.equal(districts.length, 27);
  assert.equal(new Set(ontology.realms.map(({ id }) => id)).size, 6);
  assert.equal(new Set(districts.map(({ id }) => id)).size, 27);
  assert.equal(ontology.placementPolicy.reviewFlagsBlockRelease, false);
  assert.equal(ontology.placementPolicy.prerequisiteEdgesGateProgress, false);

  const knownDistricts = new Set(districts.map(({ id }) => id));
  for (const question of WORLD_QUESTIONS) {
    if (question.curriculum.districtId !== "mixed-expedition") {
      assert.equal(knownDistricts.has(question.curriculum.districtId), true);
    }
  }
});

test("Counting Coast is mostly Math Kangaroo and every required stop has content", () => {
  assert.equal(REQUIRED_STOPS.length, 9);
  assert.equal(BREAK_STOPS.length, 2);
  assert.ok(REQUIRED_STOPS.length / WORLD_STOPS.length >= 0.7);
  assert.equal(WORLD_QUESTIONS.length, 38);

  for (const stop of REQUIRED_STOPS) {
    const questions = QUESTIONS_BY_STOP.get(stop.id) ?? [];
    assert.equal(
      questions.length,
      stop.kind === "culmination" ? 6 : 4,
      `${stop.id} has its authored static question count`,
    );
  }
});

test("the frozen world package contains unique, mechanically playable questions", async () => {
  const ids = new Set();
  for (const question of WORLD_QUESTIONS) {
    assert.equal(ids.has(question.id), false, question.id);
    ids.add(question.id);
    assert.equal(question.choices.length, 5);
    assert.ok(question.correctIndex >= 0 && question.correctIndex < 5);
    assert.ok(question.prompt.trim());
    assert.equal(question.curriculum.placementStatus, "provisional-playtest");
    assert.ok(question.curriculum.realmId);
    assert.ok(question.source.year >= 2000);
    await access(
      new URL(`../public${question.asset.src}`, import.meta.url),
    );
  }

  const runtime = await readFile(
    new URL("../app/math-world/data/world-01.questions.json", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(runtime, /protected_payload|answer_key_ref|local_ref|\/Users\//);
  assert.doesNotMatch(runtime, /archive_url|source_pdf/);
});

test("wrong answers retry in place and only a solved final question completes a stop", () => {
  const stop = REQUIRED_STOPS[0];
  const questions = QUESTIONS_BY_STOP.get(stop.id) ?? [];
  const question = questions[0];
  let progress = startStop(createInitialProgress(), stop.id);

  assert.equal(nextRequiredStopId(progress), stop.id);
  assert.equal(canOpenRequiredStop(progress, REQUIRED_STOPS[1].id), false);

  const wrongIndex = (question.correctIndex + 1) % 5;
  progress = answerQuestion(progress, stop.id, question, wrongIndex);
  assert.equal(progress.stopAttempts[stop.id].phase, "wrong-review");
  assert.equal(progress.stopAttempts[stop.id].questionIndex, 0);
  assert.equal(progress.stopAttempts[stop.id].firstTryCorrect[question.id], false);

  progress = allowRetry(progress, stop.id);
  progress = answerQuestion(progress, stop.id, question, question.correctIndex);
  assert.equal(progress.stopAttempts[stop.id].phase, "correct");
  assert.equal(progress.stopAttempts[stop.id].firstTryCorrect[question.id], false);

  progress = advanceQuestion(progress, stop.id, questions.length);
  assert.equal(progress.stopAttempts[stop.id].questionIndex, 1);
  assert.deepEqual(progress.completedStopIds, []);
});

test("QA mode may inspect future stops without changing the authored unlock path", () => {
  const progress = createInitialProgress();
  const finalStop = REQUIRED_STOPS.at(-1);
  assert.equal(canOpenRequiredStop(progress, finalStop.id), false);
  assert.equal(canOpenRequiredStop(progress, finalStop.id, true), true);
  assert.equal(nextRequiredStopId(progress), REQUIRED_STOPS[0].id);
});
