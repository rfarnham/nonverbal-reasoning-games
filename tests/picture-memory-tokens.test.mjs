import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeSelectionFromAnswerToken,
  encodeSelectionAnswerToken,
} from "../app/games/picture-memory/selection-tokens.ts";

test("Picture Memory selection tokens round-trip every subset without tap-order dependence", () => {
  const options = ["apple", "key", "fish", "book", "bell", "leaf", "cup", "car"];
  for (let mask = 0; mask < 2 ** options.length; mask += 1) {
    const selected = options.filter((_, index) => mask & (1 << index));
    const token = encodeSelectionAnswerToken(selected, options);
    assert.equal(encodeSelectionAnswerToken([...selected].reverse(), options), token);
    assert.deepEqual(decodeSelectionFromAnswerToken(token, options), selected);
  }
  assert.equal(encodeSelectionAnswerToken(["fish", "apple"], options), "selection:0,2");
  assert.deepEqual(decodeSelectionFromAnswerToken("selection:2,0", options), ["apple", "fish"]);
});

test("Picture Memory selection tokens reject malformed, repeated, or unavailable options", () => {
  const options = ["apple", "key", "fish"];
  for (const token of [
    null, undefined, "", "option-1", "selection:1,1", "selection:3", "selection:-1",
    "selection:1.5", "selection:01", "selection:1,", "selection: 1", "selection:NaN",
    "selection:9007199254740992", "selection:0\n",
  ]) {
    assert.equal(decodeSelectionFromAnswerToken(token, options), null, String(token));
  }
  assert.equal(decodeSelectionFromAnswerToken("selection:0", ["apple", "apple"]), null);
  assert.throws(() => encodeSelectionAnswerToken(["apple", "apple"], options), /twice/);
  assert.throws(() => encodeSelectionAnswerToken(["boat"], options), /not an answer option/);
  assert.throws(() => encodeSelectionAnswerToken(["apple"], ["apple", "apple"]), /distinct/);
});
