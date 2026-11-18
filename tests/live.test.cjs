const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LiveSession}=require('../live.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
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
 await assert.rejects(s.send('T',{motionConfirmed:true}),/already requested/);assert.deepEqual(p.writes,[[84],[83]]);await s.disconnect();
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
