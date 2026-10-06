import {readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {randomBytes,pbkdf2Sync,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..','public','homework-arcade');
const sourcePath=resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('Provide an absolute source manifest path. Password is read from stdin.');
const sourceDir=dirname(sourcePath);
let input='';for await(const chunk of process.stdin)input+=chunk;
let password=input.replace(/\r?\n$/,'');input='';if(!password)throw new Error('A nonempty password is required on stdin.');
const salt=randomBytes(16),iterations=600000;
const key=pbkdf2Sync(password,salt,iterations,32,'sha256');password='';
const source=JSON.parse(await readFile(sourcePath,'utf8'));
const packs=await Promise.all(['verbal.json','memory-math.json','picture.json'].map(async name=>JSON.parse(await readFile(resolve(sourceDir,name),'utf8'))));
const extra=JSON.parse(await readFile(resolve(sourceDir,'external-links.json'),'utf8'));
const audio=JSON.parse(await readFile(resolve(sourceDir,'audio-manifest.json'),'utf8'));
if(!audio.complete&&!process.argv.includes('--allow-partial-audio'))throw new Error('Audio generation is not complete. Use --allow-partial-audio for a local preview only.');
const questions=packs.flatMap(p=>p.questions);
if(audio.complete&&questions.some(q=>q.type==='sequence')&&!audio.instructionsPath)throw new Error('Missing sequence introduction audio');
const ids=new Set();const allowed=new Set(['choice','open','sequence','recall','story','drawing']);
for(const q of questions){
 if(!q.id||ids.has(q.id))throw new Error('Missing or duplicate question ID');ids.add(q.id);
 if(!allowed.has(q.type)||!q.prompt||!q.source)throw new Error(`Invalid question ${q.id}`);
 if(q.type==='choice'&&(!q.options?.length||!q.options.includes(q.answer)))throw new Error(`Invalid choice answer ${q.id}`);
 if(q.type==='sequence'&&(!q.sequence?.length||!Array.isArray(q.answer)))throw new Error(`Invalid sequence ${q.id}`);
}
const vault=resolve(project,'vault');await mkdir(vault,{recursive:true});
const assets=[];
const fileCache=new Map();
async function encrypt(bytes,mime){
 const id=randomBytes(16).toString('hex'),nonce=randomBytes(12);
 const aad=Buffer.from(`homework-arcade-v1:${id}`);
 const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad);
 const encoded=Buffer.concat([nonce,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
 const file=`vault/${id}.bin`;await writeFile(resolve(project,file),encoded);
 // Verify authenticated round-trip for every output, including original PDFs.
 const back=createDecipheriv('aes-256-gcm',key,nonce);back.setAAD(aad);back.setAuthTag(encoded.subarray(-16));
 const plain=Buffer.concat([back.update(encoded.subarray(12,-16)),back.final()]);
 if(createHash('sha256').update(plain).digest('hex')!==createHash('sha256').update(bytes).digest('hex'))throw new Error('Encryption verification failed');
 const asset={id,file,mime};assets.push(asset);return asset;
}
const resources=[];
for(const f of source.files){
 resources.push({name:f.name,pages:f.pages,sourceLabel:f.source==='drive'?'Linked Drive worksheet':'Email attachment',asset:await encrypt(await readFile(f.path),'application/pdf')});
}
const mimeTypes={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
async function audioFile(path){if(fileCache.has(path))return fileCache.get(path);const asset=await encrypt(await readFile(path),extname(path)==='.wav'?'audio/wav':'audio/mpeg');fileCache.set(path,asset);return asset;}
const audioSymbols={};for(const [token,path] of Object.entries(audio.symbols))audioSymbols[token]=await audioFile(path);
const administration=packs.flatMap(p=>[...Object.values(p.administration?.sections||{}),...(p.administration?.protocols||[])]);
for(const q of questions){
 if(!q.administration&&q.administrationId)q.administration=administration.find(a=>a.id===q.administrationId)||{};
 if(q.shuffle===false)q.administration={...q.administration,ordered:true};
 if(q.administration?.id==='similarities-oral')q.category='spoken_similarities';
 if(q.category==='sequencing'&&q.type!=='sequence')q.category='discovery';
 const clips=audio.questions[q.id];
 if(clips){q.audio={};for(const [input,output] of [['promptPath','prompt'],['storyPath','story'],['listPath','list']])if(clips[input])q.audio[output]=await audioFile(clips[input]);for(const [input,output] of [['wordsPaths','words'],['stepsPaths','steps'],['canvasStepsPaths','canvasSteps'],['subquestionsPaths','subquestions']])if(clips[input])q.audio[output]=await Promise.all(clips[input].map(audioFile));}
 if(audio.complete&&q.auditory){
  if(q.type==='sequence'){if(q.sequence.some(t=>!audioSymbols[t]))throw new Error('Missing sequence symbol audio');}
  else if(q.type==='story'&&!q.audio?.story)throw new Error('Missing story audio');
  else if(q.type==='recall'&&!q.audio?.list)throw new Error('Missing recall audio');
  else if(q.type==='drawing'&&q.audio?.steps?.length!==q.steps?.length)throw new Error('Missing drawing audio');
  else if(!['sequence','story','recall','drawing'].includes(q.type)&&!q.audio?.prompt)throw new Error('Missing spoken question audio');
 }
 if(q.imagePath){q.imageAsset=await encrypt(await readFile(q.imagePath),mimeTypes[extname(q.imagePath)]||'image/jpeg');delete q.imagePath;}
 // Source IDs may contain material words. Persist only opaque stable IDs in the browser.
 q.id=createHash('sha256').update(`homework-arcade-v1:${q.id}`).digest('hex').slice(0,32);
}
const content={
 title:source.title||'Your homework arcade',questions,resources,emails:source.emails,administration,audioSymbols,
 narration:{engine:audio.engine,voice:audio.voice},sequenceInstructions:audio.instructionsPath?await audioFile(audio.instructionsPath):undefined,
 notes:packs.flatMap(p=>p.notes||[]),
 externalLinks:(extra.links||[]).map(l=>({label:l.source,url:l.url})),
 coverage:source.coverage||[]
};
const main=await encrypt(Buffer.from(JSON.stringify(content)),'application/json');
const manifest={version:1,algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA-256',iterations,salt:salt.toString('base64'),content:main};
await writeFile(resolve(vault,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const keep=new Set(['manifest.json',...assets.map(a=>a.file.split('/').pop())]);
for(const f of await readdir(vault)){if(!keep.has(f))await rm(resolve(vault,f));}
key.fill(0);
execFileSync('python3',[resolve(dirname(fileURLToPath(import.meta.url)),'homework-vault-archive.py'),'pack'],{stdio:['ignore','inherit','inherit']});
console.log(JSON.stringify({questions:questions.length,resources:resources.length,encryptedFiles:assets.length,roundTripVerified:true}));
