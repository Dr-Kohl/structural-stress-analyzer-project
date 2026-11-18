(function(root){
'use strict';
const M=typeof module!=='undefined'&&module.exports?require('./model.js'):root.SSAModel;
const DEFAULT_CONFIG=Object.freeze({mode:'Continuous',globalMax:500,increment:20,cyclicForce:15,cycles:1});
const MAX_SAMPLES=100000,MAX_FILE_BYTES=10*1024*1024;
const text=(value,max=120)=>String(value??'').slice(0,max);
function validateConfig(value){
 if(!value||!['Continuous','Incremental','Cyclic'].includes(value.mode))throw new Error('Choose a valid test mode.');
 const result={mode:value.mode};
 for(const key of ['globalMax','increment','cyclicForce','cycles']){
  const n=Number(value[key]);if(!Number.isFinite(n)||n<=0)throw new Error('Forces and cycle count must be positive numbers.');
  result[key]=n;
 }
 if(!Number.isSafeInteger(result.cycles))throw new Error('Number of cycles must be a whole number.');
 if(result.mode==='Incremental'&&result.increment>result.globalMax)throw new Error('Incremental force must not exceed the draft global maximum.');
 if(result.mode==='Cyclic'&&result.cyclicForce>result.globalMax)throw new Error('Cyclic force must not exceed the draft global maximum.');
 return result;
}
function metadata(value={}){
 const result={};for(const key of ['title','operator','material','specimen','notes'])result[key]=text(value[key],key==='notes'?4000:120);
 if(!result.title.trim())result.title='Untitled recording';
 return result;
}
function normalizeSamples(input){
 if(!Array.isArray(input)||input.length===0||input.length>MAX_SAMPLES)throw new Error('A recording must contain 1–100,000 readings.');
 const hasTiming=input.every(s=>s.time_s!==null&&s.time_s!==undefined&&s.time_s!=='');
 if(!hasTiming&&input.some(s=>s.time_s!==null&&s.time_s!==undefined&&s.time_s!==''))throw new Error('Some readings are missing timestamps. Supply all timestamps or omit the timing column.');
 let previous=-Infinity;
 const firstTime=hasTiming?Number(input[0].time_s):0;
 return Array.from(input,(s,i)=>{
  if(!s||typeof s!=='object')throw new Error('Invalid measurement at reading '+(i+1));
  function numeric(value,label){if(value===null||value===undefined||String(value).trim()==='')throw new Error('Missing '+label+' at reading '+(i+1));const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>1e12)throw new Error('Invalid '+label+' at reading '+(i+1));return n;}
  const displacement=numeric(s.displacement_in,'displacement'),force=numeric(s.force_lb,'force');
  let time=null;
  if(hasTiming){time=numeric(s.time_s,'time')-firstTime;if(time<previous)throw new Error('Reading timestamps must be in nondecreasing order.');previous=time;}
  const record={sample_index:i+1,time_s:time,displacement_in:displacement,force_lb:force,
   raw_field_1:text(s.raw_field_1??'',40),raw_field_2:text(s.raw_field_2??'',40)};
  for(const key of ['raw_field_1','raw_field_2'])if(record[key]&&!/^[+-]?\d+(\.\d+)?$/.test(record[key]))throw new Error('Raw numeric fields must contain numbers only. Original input is unchanged.');
  for(const key of ['first_frame','last_frame'])record[key]=Number.isSafeInteger(Number(s[key]))&&Number(s[key])>0?Number(s[key]):null;
  return record;
 });
}
function timeline(samples){
 const timed=samples.every(s=>typeof s.time_s==='number'&&Number.isFinite(s.time_s));
 const times=timed?samples.map(s=>s.time_s):samples.map((_,i)=>i*.1);
 return {times,duration:times.at(-1)||0,timed};
}
function indexAt(times,time){let lo=0,hi=times.length;while(lo<hi){const mid=(lo+hi)>>1;if(times[mid]<=time)lo=mid+1;else hi=mid;}return Math.max(0,lo-1);}
function hexFromText(value){return Array.from(value,c=>{const n=c.charCodeAt(0);if(n>255)throw new Error('Raw capture must contain byte-valued text.');return n.toString(16).padStart(2,'0');}).join('');}
function textFromHex(value){if(typeof value!=='string'||value.length%2||!/^[0-9a-f]*$/i.test(value))throw new Error('Invalid raw byte hexadecimal data.');let out='';for(let i=0;i<value.length;i+=2)out+=String.fromCharCode(parseInt(value.slice(i,i+2),16));return out;}
function sanitizeRaw(raw={}){
 const rxHex=String(raw.rxHex??''),txHex=String(raw.txHex??'');
 textFromHex(rxHex);textFromHex(txHex);
 return {rxHex,txHex,kind:text(raw.kind||'not supplied',200),logText:text(raw.logText||'',MAX_FILE_BYTES)};
}
function makeSession(samples,options={}){
 return {schemaVersion:1,metadata:metadata(options.metadata),
  config:validateConfig(options.config||DEFAULT_CONFIG),
  source:{name:text(options.source?.name||'Imported data',200),
   description:text(options.source?.description||'',1000),timing:text(options.source?.timing||'Unknown',200),
   originalCapture:options.source?.originalCapture===true},
  samples:normalizeSamples(samples),raw:sanitizeRaw(options.raw),
  activity:Array.isArray(options.activity)?options.activity.slice(-1000).map(e=>({utc:text(e.utc,60),message:text(e.message,500)})):[]};
}
function originalSession(capture){
 const samples=normalizeSamples(capture.samples);
 const rx='D\r'+samples.map(s=>s.raw_field_1+','+s.raw_field_2+'\r').join('')+'TT\r';
 return makeSession(samples,{metadata:{title:'Captured sample test',material:'',specimen:'November 17 sample'},
  source:{name:capture.source,description:'Recovered from the original USB recording · November 17, 2026',
   timing:'USB receive timing',originalCapture:true},
  raw:{rxHex:hexFromText(rx),txHex:'54',kind:'Exact historical test serial stream (verified against evidence)'}});
}
function parseCsv(input){
 const rows=[];let row=[],field='',quoted=false;
 input=input.replace(/^\uFEFF/,'');
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){if(c==='"'){if(input[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=c;}
  else if(c==='"'){if(field)throw new Error('Unexpected CSV quote.');quoted=true;}
  else if(c===','){row.push(field);field='';}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&input[i+1]==='\n')i++;row.push(field);if(row.some(v=>v!==''))rows.push(row);row=[];field='';}
  else field+=c;
 }
 if(quoted)throw new Error('CSV contains an unfinished quoted field.');
 if(field!==''||row.length){row.push(field);if(row.some(v=>v!==''))rows.push(row);}
 if(rows.length<2)throw new Error('CSV needs a header and at least one reading.');
 const header=rows.shift().map(v=>v.trim());
 if(new Set(header).size!==header.length)throw new Error('CSV has duplicate column names.');
 if(!header.includes('displacement_in')||!header.includes('force_lb'))throw new Error('CSV needs displacement_in and force_lb columns.');
 return rows.map((cells,i)=>{if(cells.length!==header.length)throw new Error('CSV column count differs on row '+(i+2));return Object.fromEntries(header.map((h,j)=>[h,cells[j]]));});
}
function recordsFromText(input){
 const parser=new M.SerialParser().push(input);
 if(parser.pending)throw new Error('Raw stream ends with an incomplete record. No data replaced.');
 if(!parser.records.length)throw new Error('No dddd,ffff records ending in CR were found.');
 return parser;
}
function importText(name,input){
 if(typeof input!=='string'||new TextEncoder().encode(input).length>MAX_FILE_BYTES)throw new Error('Choose a text recording smaller than 10 MB.');
 const clean=input.replace(/^\uFEFF/,'');
 if(/\.jsonl$/i.test(name)){
  const events=clean.split(/\r?\n/).filter(l=>l.trim()).map((l,i)=>{try{return JSON.parse(l);}catch{throw new Error('Invalid JSON on log line '+(i+1));}});
  let rx='',tx='',pending='',records=[],unknown=0,offline=false;
  for(const event of events){
   if(event.kind==='offline'||event.event==='offline_rx')offline=true;
   if(event.event==='tx_result'){tx+=textFromHex(event.hex||'');continue;}
   if(event.event!=='rx'&&event.event!=='offline_rx')continue;
   const chunk=textFromHex(event.hex);
   rx+=chunk;
   for(const c of chunk){
    if(c==='\r'){
     const match=/^(\d{4}),(\d{4})$/.exec(pending);
     if(match)records.push({displacement_in:Number(match[1])/1000,force_lb:Number(match[2]),raw_field_1:match[1],raw_field_2:match[2],time_s:typeof event.elapsed_s==='number'?event.elapsed_s:null});
     else if(!['D','TT','U','H','C','I'].includes(pending))unknown++;
     pending='';
    }else pending+=c;
   }
  }
  if(!records.length)throw new Error('This log has no measurement records. Its bytes remain in the original file.');
  return makeSession(records,{metadata:{title:name.replace(/\.[^.]+$/,'')},source:{name,description:'Imported Python '+(offline?'offline replay':'serial')+' log'+(pending?' · unfinished tail preserved':'')+(unknown?' · '+unknown+' unrecognized records preserved':''),timing:offline?'Offline demo arrival times (accelerated)':'Serial-log receive times'},raw:{rxHex:hexFromText(rx),txHex:hexFromText(tx),kind:'Exact imported log bytes; transmit delivery follows log status',logText:input}});
 }
 if(/\.json$/i.test(name)){
  let parsed;try{parsed=JSON.parse(clean);}catch{throw new Error('The session JSON could not be read.');}
  if(parsed.schemaVersion!==1)throw new Error('Unsupported session schema. Expected version 1.');
  const session=makeSession(parsed.samples,parsed);
  session.source.originalCapture=false;session.source.description='Reopened session · '+session.source.description;
  return session;
 }
 if(/\.csv$/i.test(name)||clean.startsWith('"sample_index"')||clean.startsWith('sample_index,')){
  const rows=parseCsv(clean);
  const hasRelative=rows.every(r=>r.first_time_relative_s!==undefined&&r.first_time_relative_s!=='');
  const session=makeSession(rows.map(r=>({...r,time_s:r.time_s??(hasRelative?r.first_time_relative_s:null)})),{
   metadata:{title:name.replace(/\.[^.]+$/,'')},
   source:{name,description:'Imported measurement table; raw input file retained',timing:hasRelative?'USB receive timing from CSV':'CSV timestamps when supplied; otherwise sample order'},
   raw:{kind:'CSV source text; no exact serial stream supplied',logText:input}});
  return session;
 }
 const parser=recordsFromText(clean);
 return makeSession(parser.records,{metadata:{title:name.replace(/\.[^.]+$/,'')},source:{name,description:'Imported CR-delimited serial stream'+(parser.unknown.length?' · unrecognized records preserved':''),timing:'No receive timestamps; replay paced by reading'},raw:{rxHex:hexFromText(clean),kind:'Exact imported text-stream bytes'}});
}
function serialize(session){return JSON.stringify(makeSession(session.samples,session),null,2);}
function filename(title){return String(title).normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,70)||'ssa-recording';}
function bounds(samples,tail=true){
 const summary=M.summarize(samples),end=tail?samples.length:summary.tailStart+1;
 const points=samples.slice(0,end);let minX=0,maxX=0,minY=0,maxY=0;
 for(const s of points){minX=Math.min(minX,s.displacement_in);maxX=Math.max(maxX,s.displacement_in);minY=Math.min(minY,s.force_lb);maxY=Math.max(maxY,s.force_lb);}
 function nice(lo,hi){if(lo===hi)hi=lo+1;const span=hi-lo,power=Math.pow(10,Math.floor(Math.log10(span/5))),error=span/5/power,step=(error<=1.5?1:error<=3?2:error<=7?5:10)*power;return {min:Math.floor(lo/step)*step,max:Math.ceil(hi/step)*step,step};}
 return {x:nice(minX,maxX),y:nice(minY,maxY),end:end-1};
}
const api={DEFAULT_CONFIG,MAX_FILE_BYTES,validateConfig,metadata,normalizeSamples,timeline,indexAt,hexFromText,textFromHex,makeSession,originalSession,parseCsv,importText,serialize,filename,bounds};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SSAWorkspace=api;
})(typeof window!=='undefined'?window:globalThis);
