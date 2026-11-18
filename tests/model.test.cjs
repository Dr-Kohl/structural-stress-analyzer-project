const{test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const model=require('../model.js');
const root=path.join(__dirname,'..');
const raw=fs.readFileSync(path.join(root,'evidence/2026-11-17/ssa1000-device-to-host.txt'),'ascii');
const context={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'capture-data.js'),'utf8'),context);
const samples=context.window.SSA_CAPTURE.samples;
test('captured serial stream and replay fixture match all measurements',()=>{
 const p=new model.SerialParser().push(raw);
 assert.equal(p.records.length,144);assert.deepEqual(p.markers,['D','TT']);assert.deepEqual(p.unknown,[]);assert.equal(p.pending,'');
 p.records.forEach((r,i)=>{assert.equal(r.displacement_in,samples[i].displacement_in);assert.equal(r.force_lb,samples[i].force_lb);assert.equal(r.raw_field_1,samples[i].raw_field_1);assert.equal(r.raw_field_2,samples[i].raw_field_2);});
});
test('parser survives every possible split in the actual byte stream',()=>{
 for(let split=0;split<=raw.length;split++){const p=new model.SerialParser().push(raw.slice(0,split)).push(raw.slice(split));assert.equal(p.records.length,144);assert.deepEqual(p.markers,['D','TT']);assert.equal(p.pending,'');}
 const p=new model.SerialParser();for(const byte of raw)p.push(byte);assert.equal(p.records.length,144);
});
test('unexpected and incomplete records remain available instead of being lost',()=>{
 const p=new model.SerialParser().push('U\rH\rbad\r0043,0114\r123');
 assert.deepEqual(p.markers,['U','H']);assert.deepEqual(p.unknown,['bad']);assert.equal(p.pending,'123');assert.equal(p.records[0].force_lb,114);
});
test('offline parsing recognizes TM while keeping measurements and near-match unknown records',()=>{
 const p=new model.SerialParser().push('D\r0035,0994\rT').push('M\rTMX\r');
 assert.deepEqual(p.markers,['D','TM']);assert.deepEqual(p.unknown,['TMX']);assert.equal(p.records.length,1);assert.equal(p.records[0].force_lb,994);assert.equal(p.pending,'');
});
test('peak, zero-force tail and receive timing match capture',()=>{
 const s=model.summarize(samples);assert.equal(s.peak.sample_index,44);assert.equal(s.peak.force_lb,114);assert.equal(s.peak.displacement_in,.043);
 assert.equal(s.tailStart,71);assert.equal(samples[s.tailStart].displacement_in,.07);assert.ok(Math.abs(s.duration-13.201946)<1e-8);
 assert.equal(model.indexAtTime(samples,2),0);assert.equal(model.indexAtTime(samples,3.023417),0);assert.equal(model.indexAtTime(samples,3.023418),1);
 assert.equal(model.indexAtTime(samples,999),143);
});
test('exports include all readings, repeated positions and zero-force tail',()=>{
 const csv=model.toCsv(samples),lines=csv.trim().split('\r\n');assert.equal(lines.length,145);assert.ok(lines[44].includes('"0043","0114"'));assert.ok(lines.at(-1).includes('"0143","0000"'));
 assert.equal(samples.filter(s=>s.displacement_in===.002).length,2);assert.equal(samples.filter(s=>s.force_lb===0).length,74);
});
