/* Uses only a simulated port in a fresh headless browser. Never accesses hardware. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {pathToFileURL}=require('node:url');const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),work=path.join(root,'work/live-browser-check');
(async()=>{
 await fs.mkdir(work,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.SSA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const errors=[];
 try{
  const context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:1000}});
  await context.addInitScript(()=>{
   let input;const state={writes:[],opens:0,requests:0,closes:0,signals:[],failWrite:false,failRead:false};
   const port={getInfo:()=>({usbVendorId:0x067b,usbProductId:0x23a3}),
    async open(options){state.opens++;state.options=options;this.readable=new ReadableStream({start(c){input=c;}});this.writable=new WritableStream({write(bytes){if(state.failWrite)throw new Error('mock write failure');state.writes.push([...bytes]);}});},
    async setSignals(signals){state.signals.push(signals);},async close(){state.closes++;}};
   state.rx=value=>input.enqueue(new Uint8Array(Array.from(value,c=>c.charCodeAt(0))));state.unplug=()=>input.error(new Error('mock unplug'));
   window.__ssaFake=state;
   Object.defineProperty(navigator,'serial',{configurable:true,value:{requestPort:async options=>{state.requests++;state.filter=options;return port;}}});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.SSA_TEST_URL||pathToFileURL(path.join(root,'index.html')).href);
  assert.deepEqual(await page.evaluate(()=>[__ssaFake.requests,__ssaFake.opens,__ssaFake.writes.length]),[0,0,0]);
  await page.locator('#connection').click();await page.locator('#live-connect').click();assert.equal(await page.locator('#live-connect-error').isVisible(),true);
  assert.equal(await page.evaluate(()=>__ssaFake.requests),0);
  for(const id of ['live-ready','live-units','live-data-ready'])await page.locator('#'+id).check();
  await page.locator('#live-connect').click();await page.waitForFunction(()=>document.getElementById('live-phase').textContent==='connected');
  assert.deepEqual(await page.evaluate(()=>[__ssaFake.opens,__ssaFake.writes.length]),[1,0]);
  assert.equal(await page.locator('#force').textContent(),'—');assert.equal(await page.locator('#count').textContent(),'0');
  assert.equal(await page.locator('#open-data').isDisabled(),true);
  await page.locator('#live-version-query').click();await page.waitForFunction(()=>__ssaFake.writes.length===1);
  await page.evaluate(()=>{__ssaFake.rx('V4');__ssaFake.rx('.0\r');});await page.waitForFunction(()=>document.getElementById('live-version').textContent==='4.0');
  await page.locator('#machine-start').click();assert.equal(await page.locator('#motion-send').isDisabled(),true);
  await page.locator('#motion-dialog [data-close]').first().click();assert.deepEqual(await page.evaluate(()=>__ssaFake.writes),[[86]]);
  await page.locator('#machine-start').click();await page.locator('#motion-ready').check();await page.locator('#motion-send').click();
  await page.waitForFunction(()=>__ssaFake.writes.length===2);assert.equal(await page.locator('#machine-start').isDisabled(),true);
  await page.evaluate(()=>{__ssaFake.rx('D\r004');__ssaFake.rx('3,0114\r0043,0113\r');});
  await page.waitForFunction(()=>document.getElementById('count').textContent==='2');assert.equal(await page.locator('#force').textContent(),'113');assert.equal(await page.locator('#peak').textContent(),'114');
  await page.locator('#machine-stop').click();await page.waitForFunction(()=>__ssaFake.writes.length===3);
  await page.evaluate(()=>__ssaFake.rx('S\r'));await page.waitForFunction(()=>document.getElementById('live-status').textContent.includes('stopped state unverified'));
  await page.evaluate(()=>__ssaFake.rx('TT\r'));await page.waitForFunction(()=>document.getElementById('live-status').textContent.includes('end marker'));
  assert.equal(await page.locator('#machine-start').isDisabled(),true);
  const logEvent=page.waitForEvent('download');await page.locator('#live-save-log').click();const dl=await logEvent;const logFile=path.join(work,dl.suggestedFilename());await dl.saveAs(logFile);
  const log=await fs.readFile(logFile,'utf8');assert.match(log,/"hex":"54"/);assert.match(log,/"text":"S"/);
  await page.locator('#save-data').click();const sessionEvent=page.waitForEvent('download');await page.locator('[data-export=session]').click();const sessionDownload=await sessionEvent;
  const sessionPath=path.join(work,sessionDownload.suggestedFilename());await sessionDownload.saveAs(sessionPath);const session=JSON.parse(await fs.readFile(sessionPath,'utf8'));
  assert.equal(session.samples.length,2);assert.equal(session.raw.txHex,'565453');assert.match(session.raw.logText,/TT/);
  await page.locator('#save-dialog [data-close]').first().click();
  for(const width of [1366,768,375,320]){
   await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(work,'live-'+width+'.png'),fullPage:true});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'horizontal overflow '+width);
  }
  await page.setViewportSize({width:1366,height:1000});
  await page.locator('#disconnect').click();await page.waitForFunction(()=>document.getElementById('live-phase').textContent==='disconnected');
  assert.deepEqual(await page.evaluate(()=>__ssaFake.writes),[[86],[84],[83]]);
  await page.locator('#live-review').click();assert.equal(await page.locator('#count').textContent(),'2');assert.equal(await page.locator('#open-data').isDisabled(),false);
  await page.reload();assert.equal(await page.locator('#count').textContent(),'2');assert.equal(await page.locator('#live-recovered-log').isVisible(),true);
  assert.deepEqual(await page.evaluate(()=>[__ssaFake.opens,__ssaFake.writes.length]),[0,0]);
  // A fresh session, error on RX, and retention of recoverable exact bytes.
  await page.locator('#connection').click();for(const id of ['live-ready','live-units','live-data-ready'])await page.locator('#'+id).check();await page.locator('#live-connect').click();
  await page.waitForFunction(()=>document.getElementById('live-phase').textContent==='connected');
  await page.evaluate(()=>{__ssaFake.rx('0001,0002\r');});await page.waitForFunction(()=>document.getElementById('count').textContent==='1');
  await page.evaluate(()=>__ssaFake.unplug());await page.waitForFunction(()=>document.getElementById('live-phase').textContent==='fault');
  assert.equal(await page.locator('#machine-start').isDisabled(),true);assert.equal(await page.locator('#machine-stop').isDisabled(),true);assert.equal(await page.locator('#count').textContent(),'1');
  assert.equal(await page.evaluate(()=>__ssaFake.opens),1);assert.deepEqual(errors,[]);
  // Replay the actual wood-trial RX chunks in a fresh mock session, not hardware.
  await page.locator('#connection').click();await page.locator('#live-connect').click();
  await page.waitForFunction(()=>document.getElementById('live-phase').textContent==='connected');
  await page.locator('#machine-start').click();await page.locator('#motion-ready').check();await page.locator('#motion-send').click();
  await page.waitForFunction(()=>document.getElementById('machine-start').disabled);
  const wood=await fs.readFile(path.join(root,'evidence/2026-11-18/ssa-wood-maximum-force-snapshot.jsonl'),'utf8');
  const woodChunks=wood.trim().split('\n').map(JSON.parse).filter(e=>e.event==='rx').map(e=>Buffer.from(e.hex,'hex').toString('latin1'));
  const before=await page.evaluate(()=>__ssaFake.writes.length);
  await page.evaluate(chunks=>{for(const chunk of chunks)__ssaFake.rx(chunk);},woodChunks);
  await page.waitForFunction(()=>document.getElementById('live-limit-notice').hidden===false);
  assert.equal(await page.locator('#count').textContent(),'37');assert.equal(await page.locator('#peak').textContent(),'994');
  assert.match(await page.locator('#live-limit-reading').textContent(),/994 lb at 0.035 in/);
  assert.match(await page.locator('#live-limit-reading').textContent(),/not the exact trip force/);
  assert.equal(await page.locator('#machine-home').isDisabled(),false);assert.equal(await page.locator('#machine-start').isDisabled(),true);
  assert.equal(await page.evaluate(()=>__ssaFake.writes.length),before,'TM must not automatically send Home/Stop or retry');
  await page.locator('#live-version-query').click();await page.evaluate(()=>__ssaFake.rx('V4.0\r'));assert.equal(await page.locator('#live-limit-notice').isVisible(),true);
  await page.locator('#machine-home').click();assert.equal(await page.locator('#motion-send').isDisabled(),true);await page.locator('#motion-dialog [data-close]').first().click();
  await page.locator('#save-data').click();const limitExportEvent=page.waitForEvent('download');await page.locator('[data-export=session]').click();
  const limitDl=await limitExportEvent,limitFile=path.join(work,'force-limit.session.json');await limitDl.saveAs(limitFile);
  const limitArchive=JSON.parse(await fs.readFile(limitFile,'utf8'));assert.equal(limitArchive.samples.length,37);
  assert.match(limitArchive.source.description,/maximum force exceeded/);assert.match(limitArchive.raw.logText,/"event":"test_result"/);assert.match(limitArchive.raw.logText,/"marker":"TM"/);
  await page.locator('#save-dialog [data-close]').first().click();
  await page.screenshot({path:path.join(work,'force-limit-desktop.png'),fullPage:true});
  await page.setViewportSize({width:375,height:1000});await page.screenshot({path:path.join(work,'force-limit-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.setViewportSize({width:1366,height:1000});await page.locator('#disconnect').click();
  await page.waitForFunction(()=>document.getElementById('live-phase').textContent==='disconnected');assert.equal(await page.locator('#live-limit-notice').isVisible(),true);
  await page.locator('#live-review').click();await page.reload();assert.match(await page.locator('#source-label').textContent(),/maximum force exceeded/);
  assert.equal(await page.evaluate(()=>__ssaFake.opens),0);assert.deepEqual(errors,[]);
  console.log('PASS: actual wood RX replay recognizes TM; persistent force warning; confirmed Home available; Start stays locked; no auto-send; alarm provenance survives session export/recovery; desktop/mobile layout.');
  console.log('PASS: simulated serial connect without writes; version; confirmed single Start; unverified S; fragmented live plot; exact log/session export; 4 layouts; clean disconnect; recovery; no auto-reconnect; unplug data retention.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
