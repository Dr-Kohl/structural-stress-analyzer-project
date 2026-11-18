(function(){
'use strict';
const $=id=>document.getElementById(id),W=window.SSAWorkspace,M=window.SSAModel;
const NS='http://www.w3.org/2000/svg',RECOVERY_KEY='ssa.workspace.v1';
let session,summary,clock,index=0,playing=false,replayTime=0,lastClock=0,speed=1,hoverIndex=null,axes=null,recoveryBlocked=false;
const svg=$('chart');
function notify(title,body='',error=false){$('notice-title').textContent=title;$('notice-body').textContent=body;$('notice').classList.toggle('error',error);$('notice').hidden=false;}
function activity(message){session.activity.push({utc:new Date().toISOString(),message});session.activity=session.activity.slice(-1000);}
function persist(){
 if(recoveryBlocked)return false;
 try{localStorage.setItem(RECOVERY_KEY,W.serialize(session));$('recovery-state').textContent='Browser recovery: up to date';$('recovery-state').classList.remove('failed');return true;}
 catch(error){$('recovery-state').textContent='Browser recovery unavailable — export your session';$('recovery-state').classList.add('failed');return false;}
}
function changed(message){activity(message);$('export-state').textContent='File export: changes not yet exported';return persist();}
function pause(){playing=false;lastClock=0;}
function loadSession(next,message){
 pause();session=next;summary=M.summarize(session.samples);clock=W.timeline(session.samples);
 index=session.samples.length-1;replayTime=clock.duration;hoverIndex=null;
 $('scrub').max=session.samples.length;$('scrub').value=index+1;
 $('session-title').textContent=session.metadata.title;document.title=session.metadata.title+' · Structural Stress Analyzer';
 $('source-label').textContent=session.source.description||session.source.name;
 $('recording-date').textContent=session.source.originalCapture?'CAPTURED TEST · NOVEMBER 17, 2026':'IMPORTED RECORDING · OFFLINE';
 $('count-total').textContent='/ '+session.samples.length;
 $('peak').textContent=number(summary.peak.force_lb);$('jump-peak').textContent='at '+position(summary.peak.displacement_in)+' in →';
 $('timing-note').textContent=clock.timed?session.source.timing+' · arrival times':'No receive timing · replay paced by reading';
 $('recording-note').textContent=session.source.originalCapture?
  'The 114 lb peak at 0.043 inches matches the original SSA display. All 144 readings are retained. Force/displacement data are not specimen stress/strain.':
  'Imported data are displayed as supplied; units are inches and pounds. All readings are retained, including repeated positions. Force/displacement data are not specimen stress/strain.';
 renderConfig();update();if(message)notify(message,'No instrument connection or commands were used.');
}
function number(n){if(n!==0&&(Math.abs(n)<.001||Math.abs(n)>=1e6))return n.toExponential(3).replace('e+','e');return Number.isInteger(n)?String(n):Number(n.toPrecision(6)).toString();}
function position(n){return Math.abs(n*1000-Math.round(n*1000))<1e-9?n.toFixed(3):number(n);}
function axisNumber(n,step){if(Math.abs(n)<Math.abs(step)/100)return '0';if(Math.abs(n)>=10000||Math.abs(n)<.001)return n.toExponential(1).replace('e+','e');return n.toFixed(Math.max(0,Math.min(6,-Math.floor(Math.log10(step)))));}
function node(tag,attrs={},text){const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
function draw(){
 if(!session)return;
 const width=Math.max(240,svg.clientWidth||750),height=svg.clientHeight||350;
 const left=54,right=20,top=35,bottom=height-47,w=width-left-right,h=bottom-top;
 const view=W.bounds(session.samples,$('tail').checked);
 const x=v=>left+(v-view.x.min)/(view.x.max-view.x.min)*w;
 const y=v=>bottom-(v-view.y.min)/(view.y.max-view.y.min)*h;
 axes={left,right,top,bottom,width,height,x,y,minX:view.x.min,maxX:view.x.max};
 svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('xmlns',NS);
 svg.replaceChildren();
 svg.append(node('title',{},session.metadata.title+' — force versus displacement'));
 svg.append(node('desc',{},'Peak '+number(summary.peak.force_lb)+' pounds at '+position(summary.peak.displacement_in)+' inches. Showing '+(index+1)+' of '+session.samples.length+' recorded readings.'));
 svg.append(node('rect',{width,height,fill:'#ffffff'}));
 let stepX=view.x.step,stepY=view.y.step;
 while((view.x.max-view.x.min)/stepX>(width<500?3:7))stepX*=2;
 while((view.y.max-view.y.min)/stepY>5)stepY*=2;
 for(let v=view.y.min;v<=view.y.max+stepY/100;v+=stepY){
  svg.append(node('line',{x1:left,x2:width-right,y1:y(v),y2:y(v),stroke:'#e3eadf','stroke-width':1}));
  svg.append(node('text',{x:left-10,y:y(v)+4,'text-anchor':'end',fill:'#708368','font-size':11},axisNumber(v,stepY)));
 }
 for(let v=view.x.min;v<=view.x.max+stepX/100;v+=stepX){
  svg.append(node('line',{x1:x(v),x2:x(v),y1:top,y2:bottom,stroke:'#eef2eb','stroke-width':1}));
  svg.append(node('text',{x:x(v),y:bottom+21,'text-anchor':'middle',fill:'#708368','font-size':11},axisNumber(v,stepX)));
 }
 svg.append(node('text',{x:left,y:18,fill:'#5f7756','font-size':11},'Force (lb)'));
 svg.append(node('text',{x:left+w/2,y:height-5,'text-anchor':'middle',fill:'#5f7756','font-size':11},'Displacement (in)'));
 const end=Math.min(index,view.end);
 const path=arr=>arr.map((s,i)=>(i?'L':'M')+x(s.displacement_in).toFixed(2)+' '+y(s.force_lb).toFixed(2)).join(' ');
 const visible=session.samples.slice(0,end+1),baseline=y(0);
 if(end>0)svg.append(node('path',{d:path(visible)+' L'+x(visible.at(-1).displacement_in)+' '+baseline+' L'+x(visible[0].displacement_in)+' '+baseline+' Z',fill:'#eaf3e6',opacity:.9}));
 const loaded=session.samples.slice(0,Math.min(end,summary.tailStart)+1);
 svg.append(node('path',{d:path(loaded),fill:'none',stroke:'#397a55','stroke-width':2.5,'stroke-linejoin':'round','stroke-linecap':'round'}));
 if(end>summary.tailStart)svg.append(node('path',{d:path(session.samples.slice(summary.tailStart,end+1)),fill:'none',stroke:'#8e9e84','stroke-width':2,'stroke-dasharray':'5 5'}));
 const peakIndex=session.samples.indexOf(summary.peak);
 if(index>=peakIndex&&peakIndex<=view.end){
  const px=x(summary.peak.displacement_in),py=y(summary.peak.force_lb);
  svg.append(node('circle',{cx:px,cy:py,r:4.5,fill:'#397a55',stroke:'white','stroke-width':2}));
  const label=number(summary.peak.force_lb)+' lb · '+position(summary.peak.displacement_in)+' in';
  const boxW=Math.min(176,w),bx=Math.max(left,Math.min(px+12,width-right-boxW)),by=Math.min(bottom-33,Math.max(top+5,py+12));
  svg.append(node('rect',{x:bx,y:by,width:boxW,height:28,rx:5,fill:'#edf4e7',stroke:'#d6e4cc'}));
  svg.append(node('text',{x:bx+8,y:by+18,fill:'#376347','font-size':11},label));
 }
 const selected=session.samples[hoverIndex===null?index:hoverIndex];
 if(selected.displacement_in>=view.x.min&&selected.displacement_in<=view.x.max){
  svg.append(node('line',{x1:x(selected.displacement_in),x2:x(selected.displacement_in),y1:top,y2:bottom,stroke:'#a5b69d','stroke-width':1,'stroke-dasharray':'3 5'}));
  svg.append(node('circle',{cx:x(selected.displacement_in),cy:y(selected.force_lb),r:4.5,fill:'#214f39',stroke:'white','stroke-width':2}));
 }
}
function update(){
 const selected=session.samples[hoverIndex===null?index:hoverIndex];
 $('force').textContent=number(selected.force_lb);$('displacement').textContent=position(selected.displacement_in);
 $('count').textContent=index+1;$('sample-label').textContent=(index+1)+' of '+session.samples.length;$('scrub').value=index+1;
 $('time').textContent=clock.timed?clock.times[index].toFixed(2)+' s from first reading':'No receive timestamps';
 $('play').textContent=playing?'Ⅱ Pause replay':index===session.samples.length-1?'▶ Replay test':'▶ Play replay';
 $('state').textContent=playing?'Playing captured data':index===session.samples.length-1?'Complete recording':'Paused · reading '+(index+1);
 $('inspection').textContent=hoverIndex!==null?
  'Reading '+(hoverIndex+1)+' · '+number(selected.force_lb)+' lb at '+position(selected.displacement_in)+' in':
  !$('tail').checked&&index>summary.tailStart?'Cursor is in the hidden zero-force tail':'Hover or use the reading slider to inspect';
 draw();
}
function renderConfig(){
 const c=session.config;
 $('mode-summary').textContent=c.mode;$('config-global').textContent=number(c.globalMax);$('config-inc').textContent=number(c.increment);
 $('config-cyc').textContent=number(c.cyclicForce);$('config-cycles').textContent=c.cycles;
 $('inc-summary').classList.toggle('inactive',c.mode!=='Incremental');
 for(const id of ['cyc-summary','cycles-summary'])$(id).classList.toggle('inactive',c.mode!=='Cyclic');
}
function showDialog(id){pause();update();$(id).showModal();}
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('dismiss-notice').addEventListener('click',()=>$('notice').hidden=true);
$('connection').addEventListener('click',()=>showDialog('connection-dialog'));
$('settings').addEventListener('click',()=>{
 const form=$('settings-form');for(const key of Object.keys(session.metadata))form.elements[key].value=session.metadata[key];showDialog('settings-dialog');
});
$('settings-form').addEventListener('submit',event=>{
 event.preventDefault();const fields=Object.fromEntries(new FormData(event.currentTarget));
 session.metadata=W.metadata(fields);$('session-title').textContent=session.metadata.title;document.title=session.metadata.title+' · Structural Stress Analyzer';
 $('settings-dialog').close();const saved=changed('Session descriptions updated.');notify(saved?'Session settings saved in this browser':'Session settings updated in memory',saved?'Export a complete session to keep a portable copy.':'Browser recovery is unavailable. Export a session before closing the page.');draw();
});
function syncConfigFields(){
 const form=$('config-form'),mode=form.elements.mode.value;
 form.elements.increment.disabled=mode!=='Incremental';
 form.elements.cyclicForce.disabled=mode!=='Cyclic';form.elements.cycles.disabled=mode!=='Cyclic';
 $('config-error').hidden=true;
}
function openConfig(){
 const form=$('config-form');for(const[key,value]of Object.entries(session.config))form.elements[key].value=value;
 syncConfigFields();showDialog('config-dialog');
}
$('test-config').addEventListener('click',openConfig);$('edit-config').addEventListener('click',openConfig);
$('config-form').addEventListener('change',syncConfigFields);
$('config-form').addEventListener('submit',event=>{
 event.preventDefault();
 try{const form=event.currentTarget,draft={};for(const key of Object.keys(W.DEFAULT_CONFIG))draft[key]=form.elements[key].value;
  session.config=W.validateConfig(draft);renderConfig();$('config-dialog').close();const saved=changed('Local '+session.config.mode+' configuration draft updated; no device command sent.');
  notify('Local configuration draft updated','The recorded test is unchanged. Nothing was applied to an instrument.'+(saved?'':' Browser recovery is unavailable; export before closing.'));
 }catch(error){$('config-error').textContent=error.message;$('config-error').hidden=false;}
});
$('play').addEventListener('click',()=>{if(playing)pause();else{if(index===session.samples.length-1){index=0;replayTime=0;}playing=true;lastClock=0;}hoverIndex=null;update();});
$('reset').addEventListener('click',()=>{pause();index=0;replayTime=0;hoverIndex=null;update();});
$('scrub').addEventListener('input',()=>{pause();index=Number($('scrub').value)-1;replayTime=clock.times[index];hoverIndex=null;update();});
$('speed').addEventListener('change',()=>{speed=Number($('speed').value);lastClock=0;});
$('tail').addEventListener('change',()=>{hoverIndex=null;update();});
$('fit').addEventListener('click',()=>{pause();$('tail').checked=true;index=session.samples.length-1;replayTime=clock.duration;hoverIndex=null;update();});
$('jump-peak').addEventListener('click',()=>{pause();index=session.samples.indexOf(summary.peak);replayTime=clock.times[index];hoverIndex=null;update();});
svg.addEventListener('pointermove',event=>{
 if(!axes)return;const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const ctm=svg.getScreenCTM();if(!ctm)return;
 const point=p.matrixTransform(ctm.inverse());
 if(point.x<axes.left||point.x>axes.width-axes.right||point.y<axes.top||point.y>axes.bottom)return;
 let best=null,distance=Infinity;
 for(let i=0;i<=index;i++){const s=session.samples[i];if(s.displacement_in<axes.minX||s.displacement_in>axes.maxX)continue;const d=(axes.x(s.displacement_in)-point.x)**2+(axes.y(s.force_lb)-point.y)**2;if(d<distance){best=i;distance=d;}}
 if(best!==hoverIndex){hoverIndex=best;update();}
});
svg.addEventListener('pointerleave',()=>{if(hoverIndex!==null){hoverIndex=null;update();}});
new ResizeObserver(draw).observe(svg.parentElement);
$('fault-preview').addEventListener('click',()=>{$('fault-banner').hidden=false;activity('Communication fault preview opened; no live device involved.');persist();});
$('end-fault').addEventListener('click',()=>$('fault-banner').hidden=true);
$('diagnostics').addEventListener('click',()=>{
 const details=$('session-details');details.replaceChildren();
 const values={Source:session.source.name,Readings:session.samples.length,'Peak force':number(summary.peak.force_lb)+' lb at '+position(summary.peak.displacement_in)+' in',
  Timing:clock.timed?session.source.timing:'Not supplied; paced replay only',Duration:clock.timed?clock.duration.toFixed(3)+' s':'Unknown',
  'Raw receive bytes':session.raw.rxHex.length/2,'Raw transmit bytes':session.raw.txHex.length/2,'Raw provenance':session.raw.kind,
  'Machine connection':'None — offline workspace','Configuration':'Local draft only; not acknowledged by any device'};
 for(const[k,v]of Object.entries(values)){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=v;row.append(dt,dd);details.append(row);}
 const list=$('activity-list');list.replaceChildren();
 for(const entry of session.activity.slice(-25).reverse()){const li=document.createElement('li');li.textContent=entry.utc+' — '+entry.message;list.append(li);}
 showDialog('details-dialog');
});
$('open-data').addEventListener('click',()=>{$('file-input').value='';$('file-input').click();});
$('file-input').addEventListener('change',async event=>{
 const file=event.target.files[0];if(!file)return;
 try{
  if(file.size>W.MAX_FILE_BYTES)throw new Error('Choose a file smaller than 10 MB.');
  const next=W.importText(file.name,await file.text());
  recoveryBlocked=false;loadSession(next,'Recording opened');changed('Opened local file: '+file.name);
 }catch(error){notify('Could not open recording',error.message+' The current recording is still available.',true);}
});
$('restore-capture').addEventListener('click',()=>{
 recoveryBlocked=false;loadSession(W.originalSession(window.SSA_CAPTURE),'Original captured test loaded');
 changed('Loaded the original 144-reading test.');$('fault-banner').hidden=true;
});
function openSave(){showDialog('save-dialog');}
$('save-data').addEventListener('click',openSave);$('export-chart').addEventListener('click',openSave);
$('save-method').querySelector('[value=picker]').disabled=typeof window.showSaveFilePicker!=='function'||!window.isSecureContext;
function svgBlob(){draw();return new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'});}
async function pngBlob(){
 const blob=svgBlob(),url=URL.createObjectURL(blob);
 try{
  const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Could not render graph image.'));image.src=url;});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(axes.width*2);canvas.height=Math.ceil(axes.height*2);
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image export is unavailable. Try SVG.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  return await new Promise((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(new Error('PNG export failed.')),'image/png'));
 }finally{URL.revokeObjectURL(url);}
}
async function makeExport(kind){
 const base=W.filename(session.metadata.title);
 if(kind==='session')return {name:base+'.session.json',mime:'application/json',blob:new Blob([W.serialize(session)],{type:'application/json'})};
 if(kind==='csv')return {name:base+'.csv',mime:'text/csv',blob:new Blob([M.toCsv(session.samples)],{type:'text/csv;charset=utf-8'})};
 if(kind==='svg')return {name:base+'.svg',mime:'image/svg+xml',blob:svgBlob()};
 if(kind==='png')return {name:base+'.png',mime:'image/png',blob:await pngBlob()};
 if(kind==='raw')return {name:base+'.raw.json',mime:'application/json',blob:new Blob([JSON.stringify({source:session.source,raw:session.raw,activity:session.activity},null,2)],{type:'application/json'})};
 throw new Error('Unknown export format.');
}
let exporting=false;
document.querySelectorAll('[data-export]').forEach(button=>button.addEventListener('click',async()=>{
 if(exporting)return;exporting=true;
 const kind=button.dataset.export;button.disabled=true;
 try{
  const file=await makeExport(kind);
  if($('save-method').value==='picker'){
   if(typeof window.showSaveFilePicker!=='function')throw new Error('Choose Browser downloads instead.');
   const extension='.'+file.name.split('.').at(-1);
   const handle=await window.showSaveFilePicker({suggestedName:file.name,types:[{description:kind==='session'?'Complete session':kind,accept:{[file.mime]:[extension]}}]});
   const writer=await handle.createWritable();
   try{await writer.write(file.blob);await writer.close();}
   catch(error){try{await writer.abort();}catch{}throw error;}
   $('save-result').textContent='File saved: '+handle.name;
   $('export-state').textContent='File saved: '+handle.name;
   activity('Confirmed completed file write: '+handle.name);
  }else{
   const url=URL.createObjectURL(file.blob),anchor=document.createElement('a');anchor.href=url;anchor.download=file.name;
   document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
   $('save-result').textContent='Download requested: '+file.name+'. Check your browser downloads to confirm.';
   $('export-state').textContent='Download requested: '+file.name;
   activity('Download requested (disk save unconfirmed): '+file.name);
  }
  persist();
 }catch(error){
  if(error.name==='AbortError'){$('save-result').textContent='Save canceled. Your recording is unchanged.';}
  else{$('save-result').textContent='Save failed: '+error.message+' Data remain available. Try Browser downloads or another format.';$('export-state').textContent='File export failed — data retained';activity('Export failed: '+error.message);persist();}
 }finally{button.disabled=false;exporting=false;}
}));
function animate(now){
 if(playing){
  if(lastClock){replayTime=Math.min(clock.duration,replayTime+(now-lastClock)/1000*speed);const next=W.indexAt(clock.times,replayTime);if(next!==index){index=next;update();}}
  lastClock=now;if(replayTime>=clock.duration){pause();index=session.samples.length-1;update();}
 }
 requestAnimationFrame(animate);
}
try{
 let initial;
 try{
  const saved=localStorage.getItem(RECOVERY_KEY);
  if(saved){const parsed=JSON.parse(saved);if(parsed.schemaVersion!==1)throw new Error('Unsupported browser snapshot');initial=W.makeSession(parsed.samples,parsed);}
 }catch(error){recoveryBlocked=true;notify('Browser recovery could not be read','The saved browser copy has not been overwritten. Original capture is displayed; export it or explicitly open data to replace browser recovery.',true);$('recovery-state').textContent='Browser recovery unreadable — original saved copy retained';$('recovery-state').classList.add('failed');}
 loadSession(initial||W.originalSession(window.SSA_CAPTURE));
 if(initial)notify('Recovered your local workspace','Descriptions and draft settings were restored. No device connection was opened.');
 if(!initial)activity('Original capture opened in offline workspace.');
 persist();requestAnimationFrame(animate);
}catch(error){notify('Could not load workspace',error.message+' Original source files are unchanged in the evidence folder.',true);console.error(error);}
})();
