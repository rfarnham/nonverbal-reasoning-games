import assert from 'node:assert/strict';
import test from 'node:test';
import { PROBLEM_TYPES } from '../app/lab/think-academy/types.ts';
import { SOURCE_QUESTIONS } from '../app/lab/think-academy/source-questions.ts';
import { generateRound, TYPE_INFO, validateRound } from '../app/lab/think-academy/engine.ts';
import { activeRound, createSession, finishSession, nextQuestion, outstandingMistakes, retryQuestion, sessionStats, startReview, submitAnswer } from '../app/lab/think-academy/session.ts';
import { isValidSession, readSession, SESSION_KEY, writeSession } from '../app/lab/think-academy/storage.ts';

test('the extracted recording maps all 15 panels to independent generators', () => {
  assert.equal(SOURCE_QUESTIONS.length, 15);
  assert.deepEqual(SOURCE_QUESTIONS.map(q => q.number), Array.from({length:15}, (_,i) => i+1));
  assert.deepEqual(new Set(SOURCE_QUESTIONS.map(q => q.type)), new Set(PROBLEM_TYPES));
  assert.deepEqual(new Set(TYPE_INFO.map(q => q.id)), new Set(PROBLEM_TYPES));
  assert.ok(SOURCE_QUESTIONS.find(q => q.number === 12).answerEvidence.includes('below the captured viewport'));
  assert.ok(SOURCE_QUESTIONS.find(q => q.number === 13).answerEvidence.includes('below the captured viewport'));
});

test('mixed sets contain every family once, with reproducible references', () => {
  for (let level=0;level<4;level++) {
    for (let seed=0;seed<8;seed++) {
      const s=createSession('test','arithmetic',level,seed);
      assert.equal(s.questions.length,15);
      assert.deepEqual(new Set(s.questions.map(q=>q.type)),new Set(PROBLEM_TYPES));
      assert.equal(new Set(s.questions.map(q=>q.fingerprint)).size,15);
      assert.deepEqual(createSession('test','arithmetic',level,seed),s);
      assert.ok(isValidSession(s));
    }
  }
});

test('practice stays on its type and has twelve unique verified questions in every challenge', () => {
  for (const type of PROBLEM_TYPES) for (let level=0;level<4;level++) {
    for (let seed=1;seed<=4;seed++) {
      const s=createSession('practice',type,level,seed*34523);
      assert.equal(s.questions.length,12);
      assert.equal(new Set(s.questions.map(q=>q.fingerprint)).size,12,`${type} level ${level}`);
      assert.ok(s.questions.every(q=>q.type===type && q.level===level));
      assert.ok(isValidSession(s),`${type} level ${level}`);
    }
  }
});

test('retries and redemption never rewrite first answers; checkpoints are explicit', () => {
  let s=createSession('test','arithmetic',0,42);
  assert.deepEqual(nextQuestion(s),s);
  assert.deepEqual(submitAnswer(s,'bogus'),s);
  const firstRound=activeRound(s);
  const wrong=firstRound.choices.find(c=>c.id!==firstRound.correctId).id;
  s=submitAnswer(s,wrong);
  assert.equal(s.feedback,'wrong');
  assert.deepEqual(nextQuestion(s),s);
  assert.deepEqual(submitAnswer(s,firstRound.correctId),s,'input is locked during feedback');
  assert.ok(isValidSession(s));
  s=retryQuestion(s);
  s=submitAnswer(s,firstRound.correctId);
  assert.equal(s.firstAnswers[0].correct,false);
  assert.equal(s.completed[0],true);
  assert.ok(isValidSession(s));
  s=nextQuestion(s);
  while(s.stage==='play') { s=submitAnswer(s,activeRound(s).correctId); s=nextQuestion(s); }
  assert.equal(s.stage,'checkpoint');
  assert.equal(sessionStats(s).correct,14);
  assert.deepEqual(outstandingMistakes(s),[0]);
  assert.deepEqual(finishSession(s),s);
  const original=structuredClone(s.firstAnswers);
  s=startReview(s);
  assert.equal(s.stage,'review');
  assert.deepEqual(activeRound(s),firstRound);
  s=submitAnswer(s,wrong);
  s=retryQuestion(s);
  s=submitAnswer(s,firstRound.correctId);
  assert.ok(isValidSession(s));
  s=nextQuestion(s);
  assert.equal(s.stage,'checkpoint');
  assert.deepEqual(outstandingMistakes(s),[]);
  assert.deepEqual(s.firstAnswers,original);
  s=finishSession(s);
  assert.equal(s.stage,'results');
  assert.equal(sessionStats(s).correct,14);
  assert.ok(isValidSession(s));
});

test('storage round-trips every answer and transition and rejects corrupt or stale data', () => {
  const data=new Map();
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  let s=createSession('practice','arithmetic',0,421);
  const save=()=>{assert.equal(writeSession(storage,s),true);assert.deepEqual(readSession(storage).session,s);};
  save();
  for(let i=0;i<12;i++) {
    const q=activeRound(s);
    if(i%3===0) {s=submitAnswer(s,q.choices.find(c=>c.id!==q.correctId).id);save();s=retryQuestion(s);save();}
    s=submitAnswer(s,q.correctId);save();s=nextQuestion(s);save();
  }
  s=startReview(s);save();
  while(s.stage==='review') {s=submitAnswer(s,activeRound(s).correctId);save();s=nextQuestion(s);save();}
  s=finishSession(s);save();
  for(const value of ['{bad', 'null', '{}', JSON.stringify({...s,version:-1}),JSON.stringify({...s,index:999}),JSON.stringify({...s,questions:s.questions.slice(1)})]) {storage.setItem(SESSION_KEY,value); assert.equal(readSession(storage).session,null);assert.ok(readSession(storage).notice);}
  const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('quota');},removeItem(){}};
  assert.equal(readSession(blocked).session,null);
  assert.equal(writeSession(blocked,s),false);
});

test('hostile generator arguments fail clearly and altered answers do not validate', () => {
  for (const seed of [NaN,Infinity,-1,1.2,0x100000000]) assert.throws(()=>generateRound('arithmetic',0,seed));
  assert.throws(()=>generateRound('missing',0,5));
  assert.throws(()=>generateRound('arithmetic',4,5));
  const q=generateRound('arithmetic',0,100);
  assert.equal(validateRound({...q,correctId:q.choices.find(c=>c.id!==q.correctId).id}),false);
  assert.equal(validateRound({...q,choices:[q.choices[0],q.choices[0],q.choices[0],q.choices[0]]}),false);
});


test('inconsistent saved feedback cannot erase a first attempt or skip redemption',()=>{
  const s=createSession('test','arithmetic',0,73);
  const q=activeRound(s),wrong=q.choices.find(c=>c.id!==q.correctId).id;
  assert.equal(isValidSession({...s,feedback:'wrong',selected:wrong}),false);
  assert.equal(isValidSession({...s,selected:wrong}),false);
  let review=s;
  while(review.stage==='play') {const r=activeRound(review);review=submitAnswer(review,r.choices.find(c=>c.id!==r.correctId).id);review=retryQuestion(review);review=submitAnswer(review,r.correctId);review=nextQuestion(review);}
  review=startReview(review);
  assert.ok(isValidSession(review));
  assert.equal(isValidSession({...review,redeemed:review.redeemed.map((v,i)=>i===0?true:v)}),false);
});
