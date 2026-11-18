const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const W=require('../workspace.js'),M=require('../model.js');
const root=path.join(__dirname,'..');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'capture-data.js'),'utf8'),context);
const capture=context.window.SSA_CAPTURE;
const raw=fs.readFileSync(path.join(root,'evidence/2026-11-17/ssa1000-device-to-host.txt'),'ascii');

test('original session reconstructs exact historical bytes and all measurements',()=>{
 const s=W.originalSession(capture);
 assert.equal(s.samples.length,144);assert.equal(W.textFromHex(s.raw.rxHex),raw);
 assert.equal(s.raw.txHex,'54');assert.equal(s.config.globalMax,500);
 assert.equal(M.summarize(s.samples).peak.force_lb,114);
 assert.equal(W.timeline(s.samples).duration,13.201946);
});
test('session archives round trip numeric data, raw bytes and local draft without device state',()=>{
 const s=W.originalSession(capture);s.metadata.title='Test <one>';s.metadata.notes='A note';
 s.config=W.validateConfig({...s.config,mode:'Cyclic',cycles:3});
 const restored=W.importText('test.session.json',W.serialize(s));
 assert.deepEqual(restored.samples,s.samples);assert.deepEqual(restored.raw,s.raw);
 assert.deepEqual(restored.config,s.config);assert.equal(restored.metadata.title,'Test <one>');
 assert.equal(Object.hasOwn(restored,'connected'),false);
});
test('configuration validates active force relationships and whole cycle counts',()=>{
 assert.equal(W.validateConfig({...W.DEFAULT_CONFIG,mode:'Incremental',increment:25}).increment,25);
 for(const draft of [{globalMax:0},{cycles:1.5},{mode:'bad'},{mode:'Incremental',increment:501},{mode:'Cyclic',cyclicForce:501}]){
  assert.throws(()=>W.validateConfig({...W.DEFAULT_CONFIG,...draft}));
 }
 assert.equal(W.validateConfig({...W.DEFAULT_CONFIG,globalMax:10}).globalMax,10);
});
test('CSV import handles actual evidence CSV and exported CSV with timing unchanged',()=>{
 const csv=fs.readFileSync(path.join(root,'evidence/2026-11-17/ssa1000-recovered-measurements.csv'),'utf8');
 const imported=W.importText('capture.csv',csv);
 assert.equal(imported.samples.length,144);
 assert.ok(Math.abs(imported.samples[1].time_s-3.023418)<1e-8);
 assert.equal(imported.samples[43].first_frame,873);
 const roundtrip=W.importText('export.csv',M.toCsv(W.originalSession(capture).samples));
 assert.deepEqual(roundtrip.samples,W.originalSession(capture).samples);
});
test('CSV malformed, unordered and nonnumeric inputs fail rather than replacing data silently',()=>{
 for(const csv of ['x,y\n1,2','displacement_in,force_lb\n,2','displacement_in,force_lb\n0,NaN',
 'displacement_in,force_lb\n"0,2','displacement_in,force_lb\n0,2,3',
 'displacement_in,force_lb,time_s\n0,1,2\n1,2,1'])assert.throws(()=>W.importText('bad.csv',csv));
 assert.throws(()=>W.importText('bad.json','{"schemaVersion":99}'));
 assert.throws(()=>W.normalizeSamples([{displacement_in:1,force_lb:2,raw_field_1:'=1+2'}]));
 assert.throws(()=>W.normalizeSamples([{displacement_in:0,force_lb:1,time_s:0},{displacement_in:1,force_lb:2,time_s:null}]),/missing timestamps/);
});
test('raw serial import preserves full stream without inventing receive timestamps',()=>{
 const s=W.importText('incoming.txt',raw);
 assert.equal(s.samples.length,144);assert.equal(W.textFromHex(s.raw.rxHex),raw);
 assert.ok(s.samples.every(row=>row.time_s===null));assert.equal(W.timeline(s.samples).timed,false);
 assert.ok(!M.toCsv(s.samples).includes('"null"'));
 assert.throws(()=>W.importText('incomplete.txt','D\r0043,0114'));
});
test('Python JSONL preserves chunks, partial tails, TX and receive timing',()=>{
 const events=[{event:'session',kind:'live'},{event:'rx',hex:'440d303034',elapsed_s:3},
 {event:'rx',hex:'332c303131340d303034',elapsed_s:4},
 {event:'tx_result',hex:'43'},{event:'rx',hex:'342c303130300d6162',elapsed_s:5}];
 const text=events.map(e=>JSON.stringify(e)).join('\n');
 const s=W.importText('probe.jsonl',text);
 assert.equal(s.samples.length,2);assert.equal(s.samples[0].force_lb,114);
 assert.equal(s.samples[1].time_s,1);assert.equal(s.raw.txHex,'43');
 assert.ok(W.textFromHex(s.raw.rxHex).endsWith('ab'));assert.equal(s.raw.logText,text);
 assert.throws(()=>W.importText('bad.jsonl','{"event":"rx","hex":"xyz"}'));
});
test('chart ranges contain every visible sample, including negative values and all-zero data',()=>{
 for(const samples of [[{displacement_in:0,force_lb:0}],[{displacement_in:-.1,force_lb:-2},{displacement_in:.1,force_lb:5}],W.originalSession(capture).samples]){
  const b=W.bounds(samples,true);
  for(const s of samples){assert.ok(s.displacement_in>=b.x.min-1e-9&&s.displacement_in<=b.x.max+1e-9);assert.ok(s.force_lb>=b.y.min&&s.force_lb<=b.y.max);}
 }
});
