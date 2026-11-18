const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LiveSession}=require('../live.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const settle=async()=>{for(let i=0;i<4;i++)await tick();};
test('multiple tests reuse one port, reset graph samples, and retain exact bytes with test boundaries',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);
 await s.send('T',{motionConfirmed:true});p.rx('D\r0001,0047\rTT\r');await settle();
 assert.equal(s.canStart,true);assert.equal(s.samples.length,1);
 await s.send('T',{motionConfirmed:true});assert.equal(s.samples.length,0);assert.equal(s.testIndex,2);
 await assert.rejects(s.send('T',{motionConfirmed:true}),/pending/);
 p.rx('D\r0002,0070\r');await settle();await s.send('S');p.rx('S\r');await settle();assert.equal(s.canStart,false);
 p.rx('TU\r');await settle();assert.equal(s.canStart,false);p.rx('H\r');await settle();assert.equal(s.canStart,true);
 assert.deepEqual(s.samples.map(x=>x.force_lb),[70]);assert.equal(p.opens.length,1);assert.equal(p.closes,0);
 assert.deepEqual(s.entries.filter(e=>e.event==='test_started').map(e=>e.test_index),[1,2]);
 assert.match(Buffer.from(s.rxHex,'hex').toString(),/0047/);assert.match(Buffer.from(s.rxHex,'hex').toString(),/0070/);
 assert.deepEqual(p.writes,[[84],[84],[83]]);await s.disconnect();
});
test('each test must arm its own threshold and terminal state permits rearming without reconnect',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);s.armSoftwareStop(60);await s.send('T',{motionConfirmed:true});
 p.rx('0001,0070\r');await settle();p.rx('TU\rH\r');await settle();assert.equal(s.canPrepareTest,true);
 s.armSoftwareStop(100);await s.send('T',{motionConfirmed:true});p.rx('0001,0070\r0002,0118\r');await settle();
 assert.deepEqual(p.writes,[[84],[83],[84],[83]]);p.rx('TU\rH\r');await settle();
 await s.send('T',{motionConfirmed:true});assert.equal(s.softwareStop,null);p.rx('0001,0200\rTT\r');await settle();
 assert.deepEqual(p.writes,[[84],[83],[84],[83],[84]]);assert.equal(p.opens.length,1);await s.disconnect();
});
test('maximum-force ending requires explicit Home completion before another Start',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);await s.send('T',{motionConfirmed:true});p.rx('TM\r');await settle();
 assert.equal(s.canStart,false);assert.equal(s.canPrepareTest,false);await s.send('H',{motionConfirmed:true});
 assert.equal(s.canStart,false);await assert.rejects(s.send('T',{motionConfirmed:true}),/pending/);
 p.rx('TU\rH\r');await settle();assert.equal(s.canStart,true);await s.send('T',{motionConfirmed:true});
 assert.equal(s.lastTestResult,null);assert.equal(s.stopReturn,null);assert.deepEqual(p.writes,[[84],[72],[84]]);await s.disconnect();
});
function fake(){
 const writes=[];let input;
 const port={writes,opens:[],signals:[],closes:0,getInfo:()=>({usbVendorId:0x067b,usbProductId:0x23a3}),
  readable:new ReadableStream({start(c){input=c;}}),writable:new WritableStream({write(bytes){writes.push([...bytes]);}}),
  async open(options){this.opens.push(options);},async setSignals(value){this.signals.push(value);},async close(){this.closes++;},
  rx(value){input.enqueue(new Uint8Array(Buffer.from(value,'latin1')));},fail(){input.error(new Error('unplugged'));}};
 return port;
}
test('connect is listening-only, explicit signals/settings, and clean disconnect releases reader',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);
 assert.equal(p.opens[0].baudRate,9600);assert.equal(p.opens[0].flowControl,'none');assert.deepEqual(p.signals,[{dataTerminalReady:true,requestToSend:true}]);
 assert.deepEqual(p.writes,[]);await s.disconnect();assert.equal(p.readable.locked,false);assert.equal(s.phase,'disconnected');assert.equal(p.closes,1);
});
test('fragmented/coalesced bytes preserve exact stream, unknown data, markers, and repeated positions',async()=>{
 const p=fake();let now=0;const s=new LiveSession({now:()=>now});await s.connect(p);
 for(const chunk of ['V4','.0\rD\r004','3,0114\r0043,0113\rTT\r\x00partial']){now+=10;p.rx(chunk);await tick();}
 assert.equal(s.version,'4.0');assert.equal(s.samples.length,2);assert.equal(s.samples[0].force_lb,114);assert.equal(s.samples[1].displacement_in,.043);
 assert.equal(s.pending,'\x00partial');assert.equal(Buffer.from(s.rxHex,'hex').toString('latin1'),'V4.0\rD\r0043,0114\r0043,0113\rTT\r\x00partial');
 assert.equal(s.machine,'Test end marker received');await s.disconnect();assert.equal(s.entries.at(-1).pending_hex,'007061727469616c');
});
test('motion requires confirmation, start has one-write guard, S remains unverified',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);
 await assert.rejects(s.send('H'),/confirmation/);await assert.rejects(s.send('T'),/confirmation/);assert.equal(p.writes.length,0);
 await s.send('T',{motionConfirmed:true});await assert.rejects(s.send('T',{motionConfirmed:true}),/already requested/);
 await assert.rejects(s.send('I'),/pending/);await s.send('S');p.rx('S\r');await tick();
 assert.match(s.machine,/unverified/);assert.equal(s.starting,true);p.rx('TT\r');await tick();assert.equal(s.starting,false);
 assert.equal(s.canStart,true);await s.send('T',{motionConfirmed:true});assert.deepEqual(p.writes,[[84],[83],[84]]);await s.disconnect();
});
test('only observed single-byte commands are available; all have no implicit terminator',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);
 for(const c of ['V','C','I','S','H'])await s.send(c,{motionConfirmed:true});
 for(const c of ['MI020\r','t','A','TT','S\r'])await assert.rejects(s.send(c),/six observed/);
 assert.deepEqual(p.writes,[[86],[67],[73],[83],[72]]);assert.equal(s.entries.filter(e=>e.event==='tx_result').every(e=>e.acknowledged_by_tester===false),true);await s.disconnect();
});
test('read fault closes without retry/reconnect and retains prior exact RX',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);p.rx('0043,0114\r');await tick();p.fail();await tick();await tick();
 assert.equal(s.phase,'fault');assert.equal(p.closes,1);assert.equal(p.opens.length,1);assert.equal(s.samples[0].force_lb,114);assert.equal(p.writes.length,0);
});
test('logging failure before a send prevents the write and closes the port',async()=>{
 let fail=false;const p=fake(),s=new LiveSession({save(){if(fail)throw new Error('storage full');}});await s.connect(p);fail=true;
 await assert.rejects(s.send('V'),/storage full/);assert.equal(p.writes.length,0);assert.equal(s.phase,'fault');assert.equal(p.closes,1);
});
test('write rejection is not retried and delivery is labeled unknown',async()=>{
 const p=fake();p.writable=new WritableStream({write(){throw new Error('write failed');}});const s=new LiveSession();await s.connect(p);
 await assert.rejects(s.send('V'),/write failed/);assert.equal(s.phase,'fault');assert.match(s.error,/delivery may be unknown/);assert.equal(s.entries.filter(e=>e.event==='tx_attempt').length,1);assert.equal(s.entries.some(e=>e.event==='tx_result'),false);
});
test('in-flight write rejects another send; disconnect follows completion',async()=>{
 const p=fake();let finish;p.writable=new WritableStream({write(){return new Promise(resolve=>finish=resolve);}});const s=new LiveSession();await s.connect(p);
 const one=s.send('V');await tick();await assert.rejects(s.send('V'),/pending/);finish();await one;assert.equal(s.entries.filter(e=>e.event==='tx_attempt').length,1);await s.disconnect();
});
test('an immediate end marker during Start write does not get overwritten by write completion',async()=>{
 const p=fake();p.writable=new WritableStream({async write(){p.rx('D\r0001,0002\rTT\r');await tick();}});
 const s=new LiveSession();await s.connect(p);await s.send('T',{motionConfirmed:true});
 assert.equal(s.starting,false);assert.equal(s.testIssued,true);assert.equal(s.machine,'Test end marker received');await s.disconnect();
});
test('recorded wood RX chunks identify a force-limit end, preserve every byte, and send no recovery command',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const rows=fs.readFileSync(path.join(__dirname,'../evidence/2026-11-18/ssa-wood-maximum-force-snapshot.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const chunks=rows.filter(e=>e.event==='rx').map(e=>e.hex),p=fake(),s=new LiveSession();await s.connect(p);await s.send('T',{motionConfirmed:true});
 assert.equal(s.starting,true);
 for(const chunk of chunks){p.rx(Buffer.from(chunk,'hex').toString('latin1'));await tick();}
 assert.equal(s.samples.length,37);assert.equal(s.lastTestResult.marker,'TM');assert.equal(s.lastTestResult.kind,'force-limit');
 assert.equal(s.lastTestResult.lastMeasurement.force_lb,994);assert.equal(s.lastTestResult.lastMeasurement.displacement_in,.035);
 assert.equal(s.starting,false);assert.equal(s.testIssued,true);assert.equal(s.phase,'connected');
 assert.equal(s.machine,'S reply received — stopped state unverified');assert.equal(s.rxHex,chunks.join(''));assert.deepEqual(p.writes,[[84]]);
 assert.equal(s.entries.filter(e=>e.event==='test_result').length,1);
 await assert.rejects(s.send('T',{motionConfirmed:true}),/already requested/);
 await assert.rejects(s.send('H'),/confirmation/);await s.send('H',{motionConfirmed:true});
 assert.deepEqual(p.writes,[[84],[72]]);assert.equal(s.lastTestResult.kind,'force-limit');await s.disconnect();assert.equal(s.lastTestResult.kind,'force-limit');
});
test('TM requires an exact complete CR record; a fast force-limit response is not overwritten by Start completion',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);await s.send('T',{motionConfirmed:true});
 p.rx('TMX\rT');await tick();assert.equal(s.lastTestResult,null);assert.equal(s.starting,true);
 p.rx('M');await tick();assert.equal(s.lastTestResult,null);p.rx('\r');await tick();
 assert.equal(s.lastTestResult.marker,'TM');assert.equal(s.lastTestResult.lastMeasurement,null);assert.equal(s.starting,false);await s.disconnect();
 const q=fake();q.writable=new WritableStream({async write(){q.rx('0035,0994\rTM\r');await tick();}});
 const fast=new LiveSession();await fast.connect(q);await fast.send('T',{motionConfirmed:true});
 assert.equal(fast.starting,false);assert.match(fast.machine,/Maximum-force end/);assert.equal(fast.lastTestResult.marker,'TM');await fast.disconnect();
});
test('an unsolicited TM locks Start without a host write or a claim that load is released',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);p.rx('TM\r');await tick();
 assert.equal(s.testIssued,true);assert.equal(s.starting,false);assert.match(s.machine,/motion unconfirmed/);assert.deepEqual(p.writes,[]);
 await assert.rejects(s.send('T',{motionConfirmed:true}),/force-limit event/);await s.disconnect();
});
test('recorded T/S/TU/H exchange waits for Home, preserves exact bytes, and never sends host Home',async()=>{
 const rows=require('node:fs').readFileSync(require('node:path').join(__dirname,'../evidence/2026-11-18/ssa-observed-active-stop-return-home.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const p=fake(),s=new LiveSession();await s.connect(p);
 for(const row of rows){
  if(row.event==='tx_attempt')await s.send(row.text,{motionConfirmed:row.text==='T'});
  if(row.event==='rx'){p.rx(Buffer.from(row.hex,'hex').toString('latin1'));await tick();}
  if(row.event==='record'&&row.text==='TU'){
   assert.equal(s.stopReturn.homeReported,false);assert.equal(s.starting,true);
   await assert.rejects(s.send('H',{motionConfirmed:true}),/pending/);
  }
 }
 assert.equal(s.stopReturn.marker,'TU');assert.equal(s.stopReturn.homeReported,true);assert.equal(s.starting,false);assert.equal(s.testIssued,true);
 assert.equal(s.samples.length,1);assert.equal(s.samples[0].force_lb,0);
 assert.equal(s.rxHex,rows.filter(r=>r.event==='rx').map(r=>r.hex).join(''));assert.deepEqual(p.writes,[[84],[83],[83]]);
 assert.equal(s.entries.filter(r=>r.event==='home_report').length,1);assert.match(s.machine,/S reply/);
 assert.equal(s.canStart,true);await s.disconnect();assert.equal(s.stopReturn.homeReported,true);
});
test('TU framing and return state are separate from an idle S reply, and preserve earlier force-limit evidence',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);await s.send('T',{motionConfirmed:true});
 p.rx('S\rTUX\rTU');await tick();assert.equal(s.stopReturn,null);assert.equal(s.starting,true);
 p.rx('\r');await tick();assert.equal(s.stopReturn.homeReported,false);p.rx('TT\rS\rH');await tick();assert.equal(s.awaitingHome,true);
 await assert.rejects(s.send('H',{motionConfirmed:true}),/return is pending/);
 p.rx('\r');await tick();assert.equal(s.stopReturn.homeReported,true);assert.equal(s.starting,false);await s.disconnect();
 const q=fake();q.writable=new WritableStream({async write(){q.rx('0035,0994\rTM\rTU\rH\r');await tick();}});
 const fast=new LiveSession();await fast.connect(q);await fast.send('T',{motionConfirmed:true});
 assert.equal(fast.starting,false);assert.equal(fast.stopReturn.homeReported,true);assert.equal(fast.lastTestResult.kind,'force-limit');
 assert.match(fast.machine,/Home reply received after/);assert.equal(fast.testIssued,true);await fast.disconnect();
});
test('software threshold requires explicit pretest arming, validates range, and sends no setup bytes',async()=>{
 const p=fake(),s=new LiveSession();assert.throws(()=>s.armSoftwareStop(60),/while idle/);await s.connect(p);
 for(const n of [0,9,1001,60.5,NaN,Infinity,''])assert.throws(()=>s.armSoftwareStop(n),/whole-pound/);
 s.armSoftwareStop(60);assert.deepEqual(p.writes,[]);assert.throws(()=>s.armSoftwareStop(80),/Disarm/);
 s.disarmSoftwareStop();s.armSoftwareStop(80);await s.send('T',{motionConfirmed:true});
 assert.throws(()=>s.disarmSoftwareStop(),/while a test/);assert.throws(()=>s.armSoftwareStop(100),/before Start/);assert.equal(s.softwareStop.thresholdLb,80);await s.disconnect();
});
test('one automatic S is latched on the first complete qualifying reading, with reason and exact reading logged',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);s.armSoftwareStop(60);await s.send('T',{motionConfirmed:true});
 p.rx('D\r0001,0044\r0002,006');await tick();assert.deepEqual(p.writes,[[84]]);
 p.rx('4\r0003,0080\r0004,0100\r');await settle();
 assert.deepEqual(p.writes,[[84],[83]]);assert.equal(s.softwareStop.status,'sent');assert.equal(s.softwareStop.crossing.force_lb,64);assert.equal(s.softwareStop.crossing.sample_index,2);
 assert.equal(s.entries.filter(e=>e.event==='software_stop_triggered').length,1);
 assert.equal(s.entries.find(e=>e.event==='tx_attempt'&&e.text==='S').reason,'software-threshold');
 assert.equal(s.entries.find(e=>e.event==='tx_attempt'&&e.text==='T').software_stop_threshold_lb,60);
 p.rx('TU\rH\r');await settle();assert.equal(s.stopReturn.homeReported,true);assert.deepEqual(p.writes,[[84],[83]]);await s.disconnect();
});
test('unarmed, disarmed, pre-Start and post-end readings cannot cause automatic writes',async()=>{
 for(const state of ['unarmed','disarmed','before-start','ended']){
  const p=fake(),s=new LiveSession();await s.connect(p);
  if(state!=='unarmed')s.armSoftwareStop(60);
  if(state==='disarmed')s.disarmSoftwareStop();
  if(state!=='before-start')await s.send('T',{motionConfirmed:true});
  if(state==='ended'){p.rx('TT\r');await tick();}
  p.rx('0001,0090\r');await settle();assert.deepEqual(p.writes,state==='before-start'?[]:[[84]],state);
  if(state==='before-start')assert.equal(s.softwareStop.status,'cancelled');await s.disconnect();
 }
});
test('a crossing during the Start write queues exactly one S until that write releases its lock',async()=>{
 const p=fake();let release;p.writable=new WritableStream({write(b){p.writes.push([...b]);if(b[0]===84)return new Promise(resolve=>release=resolve);}});
 const s=new LiveSession();await s.connect(p);s.armSoftwareStop(60);const start=s.send('T',{motionConfirmed:true});await tick();p.rx('0001,0064\r0002,0080\r');await tick();
 assert.equal(s.softwareStop.status,'triggered');assert.deepEqual(p.writes,[[84]]);release();await start;await settle();assert.deepEqual(p.writes,[[84],[83]]);assert.equal(s.softwareStop.status,'sent');await s.disconnect();
});
test('an end marker cancels a queued threshold stop instead of sending after the test ended',async()=>{
 const p=fake();let release;p.writable=new WritableStream({write(b){p.writes.push([...b]);if(b[0]===84)return new Promise(resolve=>release=resolve);}});
 const s=new LiveSession();await s.connect(p);s.armSoftwareStop(60);const start=s.send('T',{motionConfirmed:true});await tick();p.rx('0001,0064\rTT\r');await tick();
 release();await start;await settle();assert.deepEqual(p.writes,[[84]]);assert.equal(s.softwareStop.status,'cancelled');assert.match(s.softwareStop.reason,/TT/);await s.disconnect();
});
test('manual Stop supersedes an armed threshold; later high samples do not produce a duplicate',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);s.armSoftwareStop(60);await s.send('T',{motionConfirmed:true});await s.send('S');p.rx('0001,0080\r');await settle();
 assert.deepEqual(p.writes,[[84],[83]]);assert.equal(s.softwareStop.status,'cancelled');assert.match(s.softwareStop.reason,/Manual Stop/);await s.disconnect();
});
test('automatic write failure is reported and never retried',async()=>{
 const p=fake();p.writable=new WritableStream({write(b){p.writes.push([...b]);if(b[0]===83)throw new Error('auto write failed');}});
 const s=new LiveSession();await s.connect(p);s.armSoftwareStop(60);await s.send('T',{motionConfirmed:true});p.rx('0001,0064\r0002,0080\r');await settle();
 assert.equal(s.phase,'fault');assert.equal(s.softwareStop.status,'failed');assert.match(s.softwareStop.error,/not confirmed/);assert.deepEqual(p.writes,[[84],[83]]);
 assert.equal(s.entries.filter(e=>e.event==='tx_attempt'&&e.text==='S').length,1);
});
test('logging failure at threshold closes monitoring without falsely claiming S was sent',async()=>{
 const p=fake(),s=new LiveSession({save(log){if(JSON.parse(log.trim().split('\n').at(-1)).event==='software_stop_triggered')throw new Error('quota');}});
 await s.connect(p);s.armSoftwareStop(60);await s.send('T',{motionConfirmed:true});p.rx('0001,0064\r');await settle();
 assert.equal(s.phase,'fault');assert.equal(s.softwareStop.status,'failed');assert.deepEqual(p.writes,[[84]]);
});
test('saved aluminum and wood streams produce one threshold decision without changing original measurements',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const [file,force,count] of [['ssa-first-complete-browser-test.jsonl',70,148],['ssa-wood-maximum-force-snapshot.jsonl',64,37]]){
  const rows=fs.readFileSync(path.join(__dirname,'../evidence/2026-11-18',file),'utf8').trim().split('\n').map(JSON.parse),chunks=rows.filter(e=>e.event==='rx').map(e=>e.hex);
  const p=fake(),s=new LiveSession();await s.connect(p);s.armSoftwareStop(60);await s.send('T',{motionConfirmed:true});
  for(const chunk of chunks){p.rx(Buffer.from(chunk,'hex').toString('latin1'));await tick();}await settle();
  assert.equal(s.softwareStop.crossing.force_lb,force);assert.equal(s.samples.length,count);assert.equal(s.rxHex,chunks.join(''));assert.deepEqual(p.writes,[[84],[83]]);await s.disconnect();
 }
});
