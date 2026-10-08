import assert from 'node:assert/strict';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after, test } from 'node:test';
import { chromium } from 'playwright';
import { activeRound, createSession } from '../../app/lab/think-academy/session.ts';
import { SESSION_KEY } from '../../app/lab/think-academy/storage.ts';
import { PROBLEM_TYPES } from '../../app/lab/think-academy/types.ts';
const base='/nonverbal-reasoning-games';
const shots=resolve(fileURLToPath(new URL('../../outputs/think-academy/',import.meta.url)));
const root=resolve(fileURLToPath(new URL('../../out/',import.meta.url)));
let server,browser,origin;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.txt':'text/x-component','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
before(async()=>{
  await mkdir(shots,{recursive:true});
  server=createServer(async(req,res)=>{try{
    const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);
    if(!pathname.startsWith(base+'/')) throw new Error();
    let file=resolve(root,pathname.slice(base.length+1));
    if(file!==root&&!file.startsWith(root+sep))throw new Error();
    if((await stat(file)).isDirectory())file=resolve(file,'index.html');
    res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'}).end(await readFile(file));
  }catch{res.writeHead(404).end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
async function saved(page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),SESSION_KEY);}
async function answer(page,correct=true){const s=await saved(page),q=activeRound(s);const i=q.choices.findIndex(c=>(c.id===q.correctId)===correct);await page.getByRole('button',{name:new RegExp(`^Answer ${i+1}:`)}).click();return i;}
async function advance(page){await page.getByRole('button',{name:/^(Next|Finish set|Finish review) →$/}).click();}

test('mixed test, retry, historical focus, reload and redemption preserve score',async()=>{
  const context=await browser.newContext({viewport:{width:1200,height:900},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+base+'/lab/think-academy/');
  await page.getByRole('button',{name:'Start test',exact:true}).waitFor();
  await page.screenshot({path:resolve(shots,'desktop.png'),fullPage:false});
  await page.getByRole('button',{name:'Start test',exact:true}).click();
  assert.equal(new Set((await saved(page)).questions.map(q=>q.type)).size,15);
  await answer(page,false);
  await page.getByRole('heading',{name:'× Try again'}).waitFor();
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await answer(page);
  await advance(page);
  const before=await saved(page);
  const marker=page.getByRole('button',{name:'Question 1: missed first try. Open review'});
  await marker.click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(await saved(page),before);
  assert.equal(await marker.evaluate(el=>el===document.activeElement),true);
  await page.reload();
  await page.getByRole('button',{name:/Resume saved test/}).click();
  assert.deepEqual(await saved(page),before);
  for(let i=1;i<15;i++){await answer(page);await advance(page);}
  await page.getByRole('button',{name:'Review Mistakes →'}).click();
  assert.equal((await saved(page)).stage,'review');
  await answer(page);await advance(page);
  await page.getByRole('button',{name:'Results →',exact:true}).click();
  const final=await saved(page);
  assert.equal(final.stage,'results');assert.equal(final.firstAnswers.filter(a=>a.correct).length,14);assert.equal(final.redeemed[0],true);
  assert.deepEqual(errors,[]);
  await context.close();
});

test('all 15 types and four challenges fit 390px, with desktop breakpoints and keyboard answers',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+base+'/lab/think-academy/');
  for(const type of PROBLEM_TYPES)for(let level=0;level<4;level++){
    const s=createSession('practice',type,level,20261008+level);
    await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:SESSION_KEY,value:s});
    await page.reload();await page.getByRole('button',{name:/Resume saved practice/}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${type} ${level} overflows phone`);
    const buttons=page.locator('button[aria-keyshortcuts]');
    assert.equal(await buttons.count(),4);
    for(const box of await buttons.evaluateAll(elements=>elements.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))))assert.ok(box.width>=44&&box.height>=44);
    if(['solid-views','balance','partition','turns'].includes(type)&&[0,3].includes(level))await page.screenshot({path:resolve(shots,`${type}-${level}-phone.png`),fullPage:true});
    const q=activeRound(s),i=q.choices.findIndex(c=>c.id===q.correctId);
    await page.keyboard.press(String(i+1));await page.getByRole('heading',{name:'✓ Correct',exact:true}).waitFor();
    assert.equal((await saved(page)).completed[0],true);
  }
  for(const width of [620,820,1200]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  assert.deepEqual(errors,[]);await context.close();
});

test('corrupt and blocked storage are recoverable and setup follows the requested mode',async()=>{
  const context=await browser.newContext();const page=await context.newPage();
  await page.addInitScript(key=>localStorage.setItem(key,'broken json'),SESSION_KEY);
  await page.goto(origin+base+'/lab/think-academy/');
  await page.getByRole('button',{name:/^Practice\s*12 questions/}).click();
  await page.getByLabel('Problem type',{exact:true}).selectOption('cube-net');
  await page.getByRole('button',{name:/^Junior\s*Challenge 1/}).click();
  await page.getByRole('button',{name:'Start practice',exact:true}).click();
  const s=await saved(page);assert.equal(s.mode,'practice');assert.equal(s.level,1);assert.ok(s.questions.every(q=>q.type==='cube-net'));
  await context.close();
  const blocked=await browser.newContext();await blocked.addInitScript(()=>{Object.defineProperty(Storage.prototype,'getItem',{value(){throw new Error('blocked');}});Object.defineProperty(Storage.prototype,'setItem',{value(){throw new Error('blocked');}});});
  const p=await blocked.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(origin+base+'/lab/think-academy/');await p.getByRole('button',{name:'Start test',exact:true}).click();
  assert.equal(await p.locator('button[aria-keyshortcuts]').count(),4);assert.deepEqual(errors,[]);await blocked.close();
});
