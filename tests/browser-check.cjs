/* Optional end-to-end checks. Requires Playwright via normal installation or NODE_PATH.
   Uses a fresh headless Edge profile; never accesses the instrument or user browser. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),work=path.join(root,'work','browser-check');
const url=pathToFileURL(path.join(root,'index.html')).href;
async function text(page,id){return (await page.locator('#'+id).textContent()).trim();}
async function expectText(page,id,value){await page.waitForFunction(({id,value})=>document.getElementById(id)?.textContent.trim()===value,{id,value});}
async function clickClose(page,id){await page.locator('#'+id+' [data-close]').first().click();}
async function exportFile(page,kind){const event=page.waitForEvent('download');await page.locator('[data-export="'+kind+'"]').click();const download=await event;const file=path.join(work,download.suggestedFilename());await download.saveAs(file);return file;}
(async()=>{
 await fs.mkdir(work,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.SSA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const errors=[],requests=[],results=[];
 try{
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:1000}});
  await context.addInitScript(()=>{Object.defineProperty(navigator,'serial',{configurable:true,get(){throw new Error('Hardware API accessed by offline page');}});});
  context.on('request',request=>{if(/^https?:/i.test(request.url()))requests.push(request.url());});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await expectText(page,'count','144');await expectText(page,'peak','114');
  assert.equal(await page.locator('.machine-button:enabled').count(),0);
  await page.screenshot({path:path.join(work,'desktop.png'),fullPage:true});
  results.push('Initial file:// load, original data, offline hardware lockout');
  await page.locator('#test-config').click();
  assert.equal(await page.locator('[name=increment]').isDisabled(),true);
  await page.getByLabel('Incremental',{exact:true}).check();
  assert.equal(await page.locator('[name=increment]').isEnabled(),true);
  assert.equal(await page.locator('[name=cyclicForce]').isDisabled(),true);
  await page.locator('[name=increment]').fill('25');
  await page.getByRole('button',{name:'Save local draft',exact:true}).click();
  await expectText(page,'config-inc','25');await expectText(page,'mode-summary','Incremental');
  await page.locator('#test-config').click();await page.getByLabel('Cyclic',{exact:true}).check();
  assert.equal(await page.locator('[name=increment]').isDisabled(),true);
  assert.equal(await page.locator('[name=cycles]').isEnabled(),true);
  await page.locator('[name=cycles]').fill('3');await page.getByRole('button',{name:'Save local draft',exact:true}).click();
  await expectText(page,'config-cycles','3');
  await page.locator('#settings').click();await page.locator('[name=title]').fill('Offline QA sample');
  await page.locator('[name=operator]').fill('Local QA');await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.reload();await expectText(page,'session-title','Offline QA sample');await expectText(page,'mode-summary','Cyclic');
  results.push('Mode-dependent fields, local drafts, metadata and browser recovery');
  await page.locator('#jump-peak').click();await expectText(page,'force','114');await expectText(page,'displacement','0.043');await expectText(page,'count','44');
  await page.locator('#fault-preview').click();assert.equal(await page.locator('#fault-banner').isVisible(),true);
  await page.locator('#save-data').click();
  const sessionFile=await exportFile(page,'session'),archive=JSON.parse(await fs.readFile(sessionFile,'utf8'));
  assert.equal(archive.samples.length,144);assert.equal(archive.config.cycles,3);assert.equal(archive.raw.rxHex.length/2,1445);
  const csv=await fs.readFile(await exportFile(page,'csv'),'utf8');assert.equal(csv.trim().split('\r\n').length,145);
  const svg=await fs.readFile(await exportFile(page,'svg'),'utf8');assert.ok(svg.includes('Displacement (in)'));assert.ok(svg.includes('114 lb'));
  const png=await fs.readFile(await exportFile(page,'png'));assert.equal(png.subarray(1,4).toString(),'PNG');
  await clickClose(page,'save-dialog');
  results.push('Peak selection; fault preview retains data; JSON/CSV/SVG/PNG downloads');
  await page.locator('#restore-capture').click();await page.locator('#file-input').setInputFiles(sessionFile);
  await expectText(page,'session-title','Offline QA sample');await expectText(page,'count','144');
  await page.locator('#file-input').setInputFiles(path.join(root,'evidence/2026-11-17/ssa1000-device-to-host.txt'));
  await expectText(page,'count','144');await expectText(page,'time','No receive timestamps');
  const bad=path.join(work,'bad.csv');await fs.writeFile(bad,'displacement_in,force_lb\n0,bad');
  await page.locator('#file-input').setInputFiles(bad);await expectText(page,'notice-title','Could not open recording');await expectText(page,'count','144');
  await page.locator('#file-input').setInputFiles(path.join(root,'evidence/2026-11-17/ssa1000-recovered-measurements.csv'));
  await expectText(page,'count','144');await expectText(page,'time','13.20 s from first reading');
  results.push('Session reopen, raw and CSV import, malformed-file retention');
  await page.locator('#restore-capture').click();await page.locator('#reset').click();await expectText(page,'count','1');
  await page.locator('#speed').selectOption('4');await page.locator('#play').click();await expectText(page,'count','144');
  results.push('Replay completes at selected speed');
  for(const width of [1366,768,375,320]){
   await page.setViewportSize({width,height:1000});
   await page.waitForTimeout(120);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
   assert.equal(overflow,false,'Horizontal overflow at '+width);
   await page.locator('#test-config').click();
   assert.equal(await page.locator('#config-dialog').isVisible(),true);
   const box=await page.locator('#config-dialog').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);
   if(width===375)await page.screenshot({path:path.join(work,'mobile-config.png'),fullPage:true});
   await clickClose(page,'config-dialog');
   if(width===375)await page.screenshot({path:path.join(work,'mobile.png'),fullPage:true});
  }
  results.push('Responsive layout and configuration dialog: 1366 / 768 / 375 / 320 px');
  const failureContext=await browser.newContext({viewport:{width:1100,height:900}});
  await failureContext.addInitScript(()=>{
   Storage.prototype.setItem=function(){throw new DOMException('Quota test','QuotaExceededError');};
   window.showSaveFilePicker=async()=>{throw new DOMException('Destination unavailable','NotAllowedError');};
  });
  const failurePage=await failureContext.newPage();failurePage.on('pageerror',e=>errors.push(e.message));
  await failurePage.goto(url);await expectText(failurePage,'count','144');
  assert.match(await text(failurePage,'recovery-state'),/unavailable/);
  await failurePage.locator('#save-data').click();await failurePage.locator('#save-method').selectOption('picker');
  await failurePage.locator('[data-export=session]').click();
  await failurePage.waitForFunction(()=>document.getElementById('save-result').textContent.startsWith('Save failed:'));
  assert.equal(await text(failurePage,'count'),'144');
  results.push('Storage failure and destination failure retain acquired data');
  await failureContext.close();
  const corruptContext=await browser.newContext();await corruptContext.addInitScript(()=>localStorage.setItem('ssa.workspace.v1','not-valid-json'));
  const corruptPage=await corruptContext.newPage();corruptPage.on('pageerror',e=>errors.push(e.message));
  await corruptPage.goto(url);await expectText(corruptPage,'count','144');
  assert.equal(await corruptPage.evaluate(()=>localStorage.getItem('ssa.workspace.v1')),'not-valid-json');
  results.push('Corrupt recovery copy is preserved rather than overwritten');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  results.push('No runtime exceptions, external requests or hardware API access');
  await fs.writeFile(path.join(work,'results.json'),JSON.stringify({passed:results,errors,externalRequests:requests},null,2));
  console.log(results.map(r=>'PASS '+r).join('\n'));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
