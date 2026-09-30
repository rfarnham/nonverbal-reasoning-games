import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialProgress } from '../app/math-world/engine.ts';
import { WORLD_DEFINITIONS } from '../app/math-world/world-data.ts';
import { createStoryProgress, automaticStoryPage, advanceStoryPage, markStoryBookRead, markEncounterRead, readStoryProgress, writeStoryProgress, pendingFirstWorldEnding, WORLD_STORY_STORAGE_KEY, WORLD_STORY_PLAYTEST_KEY } from '../app/math-world/story-progress.ts';
const first=WORLD_DEFINITIONS[0], second=WORLD_DEFINITIONS[1];
const complete={...createInitialProgress(),completedStopIds:first.stopIds};
function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),values};}
test('first chapter advances only through acknowledged pages and the earned first-world ending',()=>{
 let story=createStoryProgress();const original=structuredClone(complete);
 assert.equal(automaticStoryPage(story,createInitialProgress(),first.id),'intro');
 assert.equal(automaticStoryPage(story,complete,second.id),null);
 assert.equal(automaticStoryPage(story,complete,first.id,true),null);
 story=advanceStoryPage(story,'intro');
 assert.equal(automaticStoryPage(story,createInitialProgress(),first.id),null);
 assert.equal(automaticStoryPage(story,{...complete,completedStopIds:first.stopIds.slice(0,-1)},first.id),null);
 assert.equal(automaticStoryPage(story,complete,first.id),'fracture');
 assert.equal(pendingFirstWorldEnding(story,complete),true);
 assert.equal(pendingFirstWorldEnding(story,{...complete,selectedWorldId:second.id}),false);
 assert.equal(advanceStoryPage(story,'appeal'),story,'out-of-order acknowledgements cannot skip the sequence');
 for(const [page,next] of [['fracture','shattering'],['shattering','appeal'],['appeal',null]]){story=advanceStoryPage(story,page);assert.equal(automaticStoryPage(story,complete,first.id),next);}
 assert.equal(pendingFirstWorldEnding(story,complete),false);
 assert.equal(advanceStoryPage(story,'fracture'),story,'finished chapters cannot accidentally restart');
 assert.deepEqual(complete,original,'reading never mutates question progress');
});
test('every acknowledged stage survives reload and playtest stories never touch adventure saves',()=>{
 const s=storage();let story=advanceStoryPage(createStoryProgress(),'intro');
 story=markStoryBookRead(markStoryBookRead(story,1),0);assert.equal(markStoryBookRead(story,0),story);assert.equal(markStoryBookRead(story,3),story);
 for(const page of ['fracture','shattering','appeal']){story=advanceStoryPage(story,page);writeStoryProgress(story,false,s);assert.deepEqual(readStoryProgress(false,s),story);}
 writeStoryProgress(createStoryProgress(),true,s);
 assert.notEqual(s.getItem(WORLD_STORY_STORAGE_KEY),s.getItem(WORLD_STORY_PLAYTEST_KEY));
 assert.deepEqual(readStoryProgress(false,s),story);
 assert.deepEqual(readStoryProgress(true,s),createStoryProgress());
 assert.deepEqual([...s.values.keys()].sort(),[WORLD_STORY_STORAGE_KEY,WORLD_STORY_PLAYTEST_KEY].sort());
});
test('story storage handles corrupt, future, blocked and unavailable storage without changing the in-memory story',()=>{
 const s=storage();for(const raw of ['{','null','[]',JSON.stringify({version:2,introSeen:true,ending:'complete'}),JSON.stringify({version:1,introSeen:'yes',ending:'complete'}),JSON.stringify({version:1,introSeen:true,ending:'wrong'})]){s.setItem(WORLD_STORY_STORAGE_KEY,raw);assert.deepEqual(readStoryProgress(false,s),createStoryProgress());}
 s.setItem(WORLD_STORY_STORAGE_KEY,JSON.stringify({version:1,introSeen:true,ending:'appeal',readBooks:[1,1,0,99,'0']}));assert.deepEqual(readStoryProgress(false,s).readBooks,[0,1]);
 const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('quota')}};
 assert.deepEqual(readStoryProgress(false,blocked),createStoryProgress());
 const story=advanceStoryPage(createStoryProgress(),'intro');assert.doesNotThrow(()=>writeStoryProgress(story,false,blocked));assert(story.introSeen);
 assert.doesNotThrow(()=>writeStoryProgress(story,false,null));
});

test('encounter reading migrates old saves, validates IDs and persists without advancing the first chapter',()=>{
 const s=storage();
 s.setItem(WORLD_STORY_STORAGE_KEY,JSON.stringify({version:1,introSeen:true,ending:'unseen',readBooks:[0]}));
 const old=readStoryProgress(false,s);
 assert.deepEqual(old.readEncounters,[]);
 let story=markEncounterRead(old,'boss-2025');
 story=markEncounterRead(story,'danger-08');
 assert.equal(markEncounterRead(story,'boss-2025'),story);
 for(const invalid of ['boss-2027','danger-01','danger-34','unknown'])assert.equal(markEncounterRead(story,invalid),story);
 assert.deepEqual(story.readBooks,[0]);assert.equal(story.ending,'unseen');
 writeStoryProgress(story,false,s);assert.deepEqual(readStoryProgress(false,s),story);
 writeStoryProgress(markEncounterRead(createStoryProgress(),'boss-2026'),true,s);
 assert.deepEqual(readStoryProgress(false,s).readEncounters,['boss-2025','danger-08']);
 assert.deepEqual(readStoryProgress(true,s).readEncounters,['boss-2026']);
 s.setItem(WORLD_STORY_STORAGE_KEY,JSON.stringify({...story,readEncounters:['danger-08','danger-08','boss-2025','danger-01',null,2,{}]}));
 assert.deepEqual(readStoryProgress(false,s).readEncounters,['danger-08','boss-2025']);
 assert.deepEqual(old.readEncounters,[],'marking a read never mutates the previous snapshot');
});
