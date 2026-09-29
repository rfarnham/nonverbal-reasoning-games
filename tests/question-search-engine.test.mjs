import assert from "node:assert/strict";
import test from "node:test";
import { QuestionSearchIndex, hashDistance, parseSearchQuery, validateCorpus } from "../lib/question-search/engine.ts";
import { deriveSearchKey, encryptSearchBytes, decryptSearchBytes, sha256, validateManifest } from "../lib/question-search/crypto.ts";

function question(id, prompt, overrides={}) {
  return { id, version:"version-1",prompt,originalPrompt:prompt,options:[],answer:null,answerStatus:"unknown",source:{label:"Invented fixture",year:2026,grade:"1-2",question:1,language:"en"}, image:{path:`assets/${"a".repeat(64)}.bin`,mime:"image/png",width:100,height:100,hash:"a".repeat(64),dhash:"0000000000000000"},topics:[],strategies:[],description:"",structure:"",method:"",annotationStatus:"fixture",evidence:[],family:id,...overrides };
}
function corpus(questions, semantic) {return {schemaVersion:1,version:"a".repeat(64),createdAt:"2026-01-01",questions,facets:{topics:{rotation:"Rotation"},strategies:{backward:"Work backward"}},stats:{},...(semantic?{semantic}:{})};}

test("structured retrieval finds a different story, and never rewrites metadata",()=>{
  const data=corpus([
    question("transfer","A box contains counters.",{method:"Undo transfers in reverse order to find the initial quantity.",strategies:["backward"]}),
    question("mirror","Which reflection matches this mirror?",{topics:["rotation"]}),
    question("journey","A traveler reaches the final town.",{method:"Work backward and undo each operation.",strategies:["backward"]}),
  ]);
  const saved=JSON.stringify(data);const engine=new QuestionSearchIndex(data);
  const results=engine.search({text:"reverse operations original quantity",mode:"strategy"});
  assert.equal(results.hits[0].question.id,"transfer");
  assert.ok(results.hits.some(h=>h.question.id==="journey"));
  assert.equal(JSON.stringify(data),saved);
  assert.equal(engine.search({text:"qzxwplunk"}).total,0);
});

test("leave-one-out exclusions apply before pagination and never leak a variant",()=>{
  const engine=new QuestionSearchIndex(corpus([
    question("a","Count triangles",{family:"variant"}),question("b","Count triangles",{family:"variant"}),
    question("c","Count triangles"),question("d","Count triangles"),
  ]));
  const result=engine.search({text:"triangles",excludeIds:["a"],excludeFamily:"variant",limit:1,offset:1});
  assert.equal(result.total,2);assert.equal(result.hits.length,1);assert.equal(result.hits[0].question.id,"d");
  assert.equal(engine.search({text:"",strategies:["backward"]}).total,0);
});

test("semantic projection is normalized independently of query length",()=>{
  const data=corpus([question("a","Unrelated words"),question("b","Different words")],{dimensions:2,vocabulary:["apple","banana"],idf:[1,1],components:[[1,0],[0,1]],vectors:[[1,0],[0,1]]});
  const engine=new QuestionSearchIndex(data);
  assert.equal(engine.search({text:"apple"}).hits[0].question.id,"a");
  assert.equal(engine.search({text:"banana"}).hits[0].question.id,"b");
  assert.equal(engine.search({text:"banana",mode:"text"}).total,0);
  assert.equal(engine.search({text:"neverinthemodel"}).total,0);
  assert.throws(()=>validateCorpus({...data,semantic:{...data.semantic,vectors:[[NaN,0],[0,1]]}}),/semantic/);
});

test("visual scores use exact bytes or bounded layout distance without asserting methods",()=>{
  const engine=new QuestionSearchIndex(corpus([question("a","A visual puzzle")]));
  const result=engine.search({text:"",imageHash:"a".repeat(64),mode:"visual"});
  assert.equal(result.hits[0].score,100);assert.match(result.hits[0].reasons[0],/Exact image/);
  assert.equal(hashDistance("0000000000000000","ffffffffffffffff"),64);
  assert.equal(engine.search({text:"",dhash:"ffffffffffffffff",mode:"visual"}).total,0);
});

test("AI recipes are bounded data and reject executable or malformed fields",()=>{
  assert.deepEqual(parseSearchQuery({text:"folding",limit:12}).text,"folding");
  for(const recipe of [{text:[]},{sql:"select *"},{text:"x",limit:-1},{dhash:"bad"},{topics:[{}]},{text:"x",mode:"execute"}]) assert.throws(()=>parseSearchQuery(recipe));
});

test("encrypted bytes require correct password, asset context, and untampered ciphertext",async()=>{
  const encryption={name:"AES-GCM",kdf:"PBKDF2",hash:"SHA-256",iterations:100000,salt:btoa("0123456789abcdef")};
  const key=await deriveSearchKey("invented-test-password",encryption);
  const plaintext=new TextEncoder().encode("Invented fixture private prompt");
  const encrypted=await encryptSearchBytes(plaintext,key,"fixture/index");
  assert.equal(new TextDecoder().decode(await decryptSearchBytes(encrypted,key,"fixture/index")),new TextDecoder().decode(plaintext));
  assert.equal(Buffer.from(encrypted).includes(Buffer.from(plaintext)),false);
  const wrong=await deriveSearchKey("different-test-password",encryption);
  await assert.rejects(decryptSearchBytes(encrypted,wrong,"fixture/index"));
  await assert.rejects(decryptSearchBytes(encrypted,key,"fixture/image"));
  encrypted[20]^=1;await assert.rejects(decryptSearchBytes(encrypted,key,"fixture/index"));
  const digest=await sha256(plaintext);assert.match(digest,/^[a-f0-9]{64}$/);
  const manifest={schemaVersion:1,version:"a".repeat(64),count:1,index:{path:`index-${"a".repeat(64)}.bin`,sha256:digest,bytes:100},encryption};
  validateManifest(manifest);
  assert.throws(()=>validateManifest({...manifest,index:{...manifest.index,path:"../../escape"}}));
  assert.throws(()=>validateManifest({...manifest,encryption:{...encryption,iterations:1}}));
});
