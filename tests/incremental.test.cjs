const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LiveSession}=require('../live.js');
const {SerialParser}=require('../model.js');
const tick=()=>new Promise(r=>setImmediate(r));
const settle=async()=>{for(let i=0;i<5;i++)await tick();};
function fake({ack=true,failParameter=false}={}){
 let input;const p={writes:[],opens:0,closes:0,getInfo:()=>({}),async open(){this.opens++;},async setSignals(){},async close(){this.closes++;},rx(t){input.enqueue(new Uint8Array(Buffer.from(t,'latin1')));},unplug(){input.error(new Error('unplugged'));}};
 p.readable=new ReadableStream({start(c){input=c;}});
 p.writable=new WritableStream({write(b){const t=Buffer.from(b).toString('latin1');p.writes.push(t);if(t==='I'&&ack)p.rx('I\r');if(t==='MI010\r'&&failParameter)throw new Error('parameter write failed');}});
 return p;
}
test('captured setup waits for I CR then writes only MI010 CR, never Start',async()=>{
 const p=fake({ack:false}),s=new LiveSession();await s.connect(p);const setup=s.configureIncremental();await settle();
 assert.deepEqual(p.writes,['I']);assert.equal(s.canStart,false);
 await assert.rejects(s.send('T',{motionConfirmed:true}),/setup is pending/);await assert.rejects(s.send('C'),/setup is pending/);
 p.rx('I');await settle();assert.deepEqual(p.writes,['I']);p.rx('\r');await setup;
 assert.deepEqual(p.writes,['I','MI010\r']);assert.equal(s.mode,'incremental');assert.equal(s.canStart,true);
 assert.equal(s.entries.find(e=>e.event==='incremental_setup_sent').parameter_acknowledged,false);
 await assert.rejects(s.send('MI020\r'),/six observed/);await s.disconnect();
});
test('no mode acknowledgment times out without parameter, retries, or Start',async()=>{
 const p=fake({ack:false}),s=new LiveSession();await s.connect(p);
 await assert.rejects(s.configureIncremental(),/No I reply/);assert.deepEqual(p.writes,['I']);
 assert.equal(s.setupState,'failed');assert.equal(s.canStart,false);await s.disconnect();
});
test('Stop or disconnect during setup cancels the pending parameter',async()=>{
 for(const action of ['stop-before-ack','stop-after-ack','disconnect']){
  const p=fake({ack:action!=='stop-before-ack'}),s=new LiveSession();await s.connect(p);
  const setup=s.configureIncremental();const outcome=assert.rejects(setup,/interrupted|Disconnected/);await settle();
  if(action==='disconnect')await s.disconnect();else await s.send('S');
  await outcome;assert.equal(p.writes.includes('MI010\r'),false);assert.equal(s.canStart,false);if(s.phase==='connected')await s.disconnect();
 }
});
test('parameter write failure closes connection and is never retried',async()=>{
 const p=fake({failParameter:true}),s=new LiveSession();await s.connect(p);
 await assert.rejects(s.configureIncremental(),/parameter write failed/);assert.equal(s.phase,'fault');assert.deepEqual(p.writes,['I','MI010\r']);assert.equal(s.canStart,false);
});
test('actual successful incremental tail replays with manual resume, one graph and no automatic T',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {records}=JSON.parse(fs.readFileSync(path.join(__dirname,'../evidence/2026-11-18/ssa-incremental-working-decoded.json'),'utf8'));
 const p=fake(),s=new LiveSession();await s.connect(p);await s.configureIncremental();
 for(const row of records){
  if(row.direction==='TX'&&row.text==='T'){
   if(!s.testIssued)await s.send('T',{motionConfirmed:true});
   else{assert.equal(s.canResume,true);await assert.rejects(s.resumeIncrement({motionConfirmed:true}),/confirmation/);await s.resumeIncrement({motionConfirmed:true,pauseConfirmed:true});}
  }else if(row.direction==='RX'){
   const count=p.writes.length;p.rx(row.text+'\r');await settle();assert.equal(p.writes.length,count);
   if(row.text==='ID'){assert.equal(s.canResume,false);assert.equal(s.incrementalStep.phase,'pending');}
  }
 }
 assert.equal(s.testIndex,1);assert.equal(s.incrementalStep.number,7);assert.equal(s.canStart,false);assert.equal(s.canResume,true);
 assert.deepEqual(s.samples.map(x=>x.force_lb),[0,57,132,176,214,249,286,320]);assert.equal(s.samples.at(-1).displacement_in,.009);
 assert.equal(s.entries.filter(e=>e.event==='test_started').length,1);assert.equal(s.entries.filter(e=>e.event==='incremental_pause_confirmed').length,6);
 assert.deepEqual(p.writes,['I','MI010\r',...Array(7).fill('T')]);assert.equal(p.opens,1);
 const parser=new SerialParser().push(Buffer.from(s.rxHex,'hex').toString('latin1'));assert.equal(parser.markers.filter(m=>m==='ID').length,6);
 await s.disconnect();assert.equal(s.canResume,false);
});
test('a new marker and nonzero reading are required each step; Stop disables Continue immediately',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);await s.configureIncremental();await s.send('T',{motionConfirmed:true});
 p.rx('D\r0000,0000\r');await settle();assert.equal(s.canResume,false);p.rx('0001,0047\r');await settle();assert.equal(s.canResume,true);
 await s.resumeIncrement({motionConfirmed:true,pauseConfirmed:true});assert.equal(s.canResume,false);
 p.rx('0002,0070\rID');await settle();assert.equal(s.canResume,false);p.rx('\r');await settle();assert.equal(s.canResume,false);
 p.rx('0003,0094\r');await settle();assert.equal(s.canResume,true);await s.send('S');assert.equal(s.canResume,false);
 p.rx('S\r0004,0118\r');await settle();assert.equal(s.canResume,false);p.rx('TU\rH\r');await settle();assert.equal(s.canStart,true);assert.equal(s.canResume,false);await s.disconnect();
});
test('one software stop monitors across incremental resumes without resetting readings or threshold',async()=>{
 const p=fake(),s=new LiveSession();await s.connect(p);await s.configureIncremental();s.armSoftwareStop(60);await s.send('T',{motionConfirmed:true});
 p.rx('D\r0001,0047\r');await settle();await s.resumeIncrement({motionConfirmed:true,pauseConfirmed:true});
 p.rx('ID\r0002,0070\r0003,0094\r');await settle();assert.deepEqual(p.writes,['I','MI010\r','T','T','S']);
 assert.equal(s.canResume,false);assert.equal(s.softwareStop.crossing.force_lb,70);assert.equal(s.testIndex,1);assert.equal(s.samples.length,3);
 p.rx('TU\rH\r');await settle();assert.equal(s.canResume,false);assert.equal(s.canStart,true);await s.disconnect();
});
test('terminal markers, unexpected setup activity, and unplug never enable Continue',async()=>{
 for(const marker of ['TT','TM','TU']){
  const p=fake(),s=new LiveSession();await s.connect(p);await s.configureIncremental();await s.send('T',{motionConfirmed:true});p.rx('D\r0001,0057\r'+marker+'\r0002,0070\r');await settle();assert.equal(s.canResume,false);await s.disconnect();
 }
 const p=fake({ack:false}),s=new LiveSession();await s.connect(p);const setup=s.configureIncremental();const outcome=assert.rejects(setup,/Unexpected device activity/);await settle();p.rx('D\r');await outcome;assert.deepEqual(p.writes,['I']);await s.disconnect();
 const q=fake(),z=new LiveSession();await z.connect(q);await z.configureIncremental();await z.send('T',{motionConfirmed:true});q.rx('D\r0001,0057\r');await settle();q.unplug();await settle();assert.equal(z.phase,'fault');assert.equal(z.canResume,false);assert.equal(z.samples.length,1);
});
test('Home from a completed increment requires operator pause confirmation and waits for H without retry',async()=>{
 for(const stopFirst of [false,true]){
  const p=fake(),s=new LiveSession();await s.connect(p);await s.configureIncremental();await s.send('T',{motionConfirmed:true});
  assert.equal(s.canHome,false);p.rx('D\r0000,0000\r');await settle();assert.equal(s.canHome,false);
  p.rx('0001,0066\r');await settle();assert.equal(s.canHome,true);
  if(stopFirst){await s.send('S');p.rx('S\r');await settle();assert.equal(s.canResume,false);assert.equal(s.canHome,true);}
  await assert.rejects(s.send('H',{motionConfirmed:true}),/physical-pause confirmation/);
  await s.send('H',{motionConfirmed:true,pauseConfirmed:true});assert.equal(s.homing,true);assert.equal(s.canStart,false);assert.equal(s.canResume,false);assert.equal(s.canHome,false);
  const count=p.writes.length;await assert.rejects(s.send('H',{motionConfirmed:true,pauseConfirmed:true}),/pending/);assert.equal(p.writes.length,count);
  await s.send('V');p.rx('V4.0\r');await settle();assert.equal(s.homing,true);assert.equal(s.canStart,false);
  p.rx('H\r');await settle();assert.equal(s.homing,false);assert.equal(s.starting,false);assert.equal(s.testComplete,true);assert.equal(s.canStart,true);
  assert.deepEqual(s.samples.map(x=>x.force_lb),[0,66]);assert.equal(p.writes.filter(x=>x==='H').length,1);
  assert.equal(s.entries.find(e=>e.event==='incremental_home_requested').unloaded_state_verified,false);await s.disconnect();
 }
});
test('real paused-S browser recording enables a Home request while retaining all five increments',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const archive=JSON.parse(fs.readFileSync(path.join(__dirname,'../evidence/2026-11-18/ssa-browser-incremental-paused-stop-without-home.session.json'),'utf8'));
 const rows=archive.raw.logText.trim().split('\n').map(JSON.parse);const first=rows.findIndex(e=>e.event==='tx_attempt'&&e.text==='T');
 const p=fake(),s=new LiveSession();await s.connect(p);await s.configureIncremental();
 for(const row of rows.slice(first)){
  if(row.event==='tx_attempt'&&row.text==='T'){
   if(!s.testIssued)await s.send('T',{motionConfirmed:true});else await s.resumeIncrement({motionConfirmed:true,pauseConfirmed:true});
  }else if(row.event==='tx_attempt'&&row.text==='S')await s.send('S');
  else if(row.event==='rx'){p.rx(Buffer.from(row.hex,'hex').toString('latin1'));await settle();}
 }
 assert.deepEqual(s.samples.map(x=>x.force_lb),[0,66,145,189,226,264]);assert.equal(s.machine,'S reply received — stopped state unverified');
 assert.equal(s.canHome,true);assert.equal(s.canResume,false);assert.equal(s.canStart,false);assert.equal(p.writes.includes('H'),false);
 await s.send('H',{motionConfirmed:true,pauseConfirmed:true});assert.equal(p.writes.at(-1),'H');assert.equal(s.homing,true);await s.disconnect();
});
