import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
test('the focused experiment is linked and exported with the Pages base path',async()=>{
  const home=await readFile(new URL('../out/index.html',import.meta.url),'utf8');
  const lab=await readFile(new URL('../out/lab/think-academy/index.html',import.meta.url),'utf8');
  assert.match(home,/href="\/nonverbal-reasoning-games\/lab\/think-academy\/"/);
  assert.match(home,/Think Academy Lab/);
  assert.match(lab,/Think Academy Lab/);
  for(const word of ['Test','Practice','Starter','Junior','Expert','Wizard','Example']) assert.ok(lab.includes(word));
  assert.match(lab,/Questions extracted from the recording/);
  assert.doesNotMatch(lab,/<(?:img|audio|source|script)\b[^>]*\bsrc="https?:/);
});
