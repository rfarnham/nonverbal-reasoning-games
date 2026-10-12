import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialProgress } from '../app/math-world/engine.ts';
import { WORLD_DEFINITIONS } from '../app/math-world/world-data.ts';
import { createStoryProgress, automaticStoryPage, advanceStoryPage, markStoryBookRead, markEncounterRead, readStoryProgress, writeStoryProgress, pendingFirstWorldEnding, nextVoyageChapter, markVoyageChapterRead, recoveredShardWorlds, WORLD_STORY_STORAGE_KEY, WORLD_STORY_PLAYTEST_KEY } from '../app/math-world/story-progress.ts';
import { VOYAGE_CHAPTERS } from '../app/math-world/voyage-story-content.ts';
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

test('legacy first-world saves retain their exact story shape and opening behavior',()=>{
 const s=storage();
 for(const ending of ['unseen','shattering','appeal','complete']){
  const old={version:1,introSeen:true,readBooks:[0,1],readEncounters:['danger-02'],ending};
  s.setItem(WORLD_STORY_STORAGE_KEY,JSON.stringify(old));
  const loaded=readStoryProgress(false,s);
  assert.deepEqual(loaded,old);
  assert.equal(Object.hasOwn(loaded,'readChapters'),false);
  assert.equal(automaticStoryPage(loaded,complete,first.id),ending==='unseen'?'fracture':ending==='complete'?null:ending);
  assert.equal(nextVoyageChapter(loaded)?.id,ending==='complete'?'oceania-voyage-01':undefined);
  assert.deepEqual(recoveredShardWorlds(loaded),[],'old math or story completion does not award new story shards');
 }
});

test('the optional voyage waits for the existing sundering without advancing it',()=>{
 const s=storage();
 for(const ending of ['unseen','shattering','appeal']){
  const story={...createStoryProgress(),introSeen:true,ending};
  assert.equal(nextVoyageChapter(story),undefined);
  assert.equal(markVoyageChapterRead(story,'oceania-voyage-01'),story);
  assert.deepEqual(recoveredShardWorlds({...story,readChapters:['oceania-voyage-01']}),[]);
  s.setItem(WORLD_STORY_STORAGE_KEY,JSON.stringify({...story,readChapters:['oceania-voyage-01','oceania-voyage-ascent']}));
  assert.deepEqual(readStoryProgress(false,s).readChapters,[],'an incomplete opening cannot preload later reading flags');
 }
});

test('individual optional chapters acknowledge only known pages and do not skip the next unread story',()=>{
 const original={...createStoryProgress(),introSeen:true,readBooks:[0,1],ending:'complete'};
 const story=markVoyageChapterRead(original,'oceania-voyage-08');
 assert.equal(markVoyageChapterRead(story,'oceania-voyage-08'),story);
 for(const id of ['oceania-voyage-00','oceania-voyage-1','oceania-voyage-33','oceania-call','danger-08','unknown']){
  assert.equal(markVoyageChapterRead(story,id),story);
 }
 assert.equal(nextVoyageChapter(story).id,'oceania-voyage-01');
 assert.deepEqual(recoveredShardWorlds(story),[8]);
 assert.deepEqual(story.readBooks,[0,1]);assert.equal(story.ending,'complete');
 assert.equal(Object.hasOwn(original,'readChapters'),false,'the previous snapshot stays unchanged');
});

test('all shards and the two finale chapters progress solely through reading, independently of any math',()=>{
 const math=createInitialProgress(),before=structuredClone(math);
 Object.freeze(math.completedStopIds);Object.freeze(math.stopAttempts);Object.freeze(math);
 let story={...createStoryProgress(),introSeen:true,ending:'complete'};
 for(let number=1;number<=32;number++){
  const chapter=nextVoyageChapter(story);
  assert.equal(chapter.id,`oceania-voyage-${String(number).padStart(2,'0')}`);
  assert.equal(chapter.shardWorld,number);
  story=markVoyageChapterRead(story,chapter.id);
  assert.deepEqual(recoveredShardWorlds(story),Array.from({length:number},(_,index)=>index+1));
 }
 assert.equal(nextVoyageChapter(story).id,'oceania-voyage-reforging');
 assert.equal(markVoyageChapterRead(story,'oceania-voyage-ascent'),story,'ascent needs the acknowledged reforge');
 story=markVoyageChapterRead(story,'oceania-voyage-reforging');
 assert.equal(nextVoyageChapter(story).id,'oceania-voyage-ascent');
 story=markVoyageChapterRead(story,'oceania-voyage-ascent');
 assert.equal(nextVoyageChapter(story),undefined);
 assert.equal(story.readChapters.length,34);
 assert.equal(recoveredShardWorlds(story).length,32,'the finale adds no invented shard');
 assert.deepEqual(math,before,'reading the complete voyage never solves, scores, selects or unlocks math');
 assert.equal(math.completedStopIds.length,0);
});

test('premature finale markers cannot claim the restored Tideheart, including on reload',()=>{
 const s=storage(),original={...createStoryProgress(),introSeen:true,ending:'complete'};
 for(const id of ['oceania-voyage-reforging','oceania-voyage-ascent'])assert.equal(markVoyageChapterRead(original,id),original);
 const shardIds=VOYAGE_CHAPTERS.filter(chapter=>chapter.shardWorld!==undefined).map(chapter=>chapter.id);
 const writeRaw=readChapters=>{s.setItem(WORLD_STORY_STORAGE_KEY,JSON.stringify({...original,readChapters}));return readStoryProgress(false,s);};
 const incomplete=writeRaw([...shardIds.slice(0,-1),'oceania-voyage-reforging','oceania-voyage-ascent']);
 assert.deepEqual(incomplete.readChapters,shardIds.slice(0,-1));
 assert.equal(nextVoyageChapter(incomplete).id,'oceania-voyage-32');
 const unreforged=writeRaw([...shardIds,'oceania-voyage-ascent']);
 assert.deepEqual(unreforged.readChapters,shardIds);
 assert.equal(nextVoyageChapter(unreforged).id,'oceania-voyage-reforging');
 const malformed={...original,readChapters:['oceania-voyage-reforging','oceania-voyage-ascent']};
 assert.equal(nextVoyageChapter(malformed).id,'oceania-voyage-01');
 assert.deepEqual(recoveredShardWorlds(malformed),[]);
});

test('voyage acknowledgements validate saved IDs and keep normal and QA histories separate',()=>{
 const s=storage(),original={...createStoryProgress(),introSeen:true,ending:'complete'};
 const normal=markVoyageChapterRead(original,'oceania-voyage-03');
 const qa=markVoyageChapterRead(original,'oceania-voyage-17');
 writeStoryProgress(normal,false,s);writeStoryProgress(qa,true,s);
 assert.deepEqual(readStoryProgress(false,s),normal);assert.deepEqual(readStoryProgress(true,s),qa);
 assert.deepEqual([...s.values.keys()].sort(),[WORLD_STORY_STORAGE_KEY,WORLD_STORY_PLAYTEST_KEY].sort());
 s.setItem(WORLD_STORY_STORAGE_KEY,JSON.stringify({...normal,readChapters:['oceania-voyage-03','oceania-voyage-03','oceania-voyage-99',null,3,{},'oceania-call','danger-02']}));
 assert.deepEqual(readStoryProgress(false,s).readChapters,['oceania-voyage-03']);
 for(const value of [null,3,{},'oceania-voyage-01']){
  s.setItem(WORLD_STORY_STORAGE_KEY,JSON.stringify({...original,readChapters:value}));
  assert.deepEqual(readStoryProgress(false,s),original,'malformed optional fields preserve the old save shape');
 }
 assert.deepEqual(readStoryProgress(true,s),qa);
});
