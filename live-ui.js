(function(){
'use strict';
const $=id=>document.getElementById(id),KEY='ssa.live.recovery.v1';
let live=null,opening=false,renderTimer=null,lastSampleCount=0,lastEntryCount=0,lastTestIndex=0,recovered='';
try{recovered=localStorage.getItem(KEY)||'';}catch{}
const download=(value,name,type='application/x-ndjson')=>{
 const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
function render(){
 if(!live)return;
 const connected=live.phase==='connected',free=connected&&!live.busy&&!live.closing;
 $('live-panel').hidden=false;$('live-phase').textContent=live.phase;
 $('rail-connection').textContent=connected?'Serial port open':live.phase==='connecting'?'Connecting':'No device connected';
 $('rail-machine').textContent=live.machine;$('live-status').textContent=live.error?live.error+' Connection state is unknown; physical motion may continue.':live.machine;
 if(lastTestIndex!==live.testIndex){lastTestIndex=live.testIndex;lastSampleCount=0;lastEntryCount=0;window.SSAView.beginLive();}
 const stop=live.softwareStop,canArm=live.canPrepareTest;
 $('software-stop-value').disabled=!canArm||stop?.status==='armed';
 $('software-stop-arm').disabled=!canArm||stop?.status==='armed';
 $('software-stop-disarm').disabled=!canArm||stop?.status!=='armed';
 let stopStatus='Not armed — no automatic force-triggered Stop.';
 if(stop){
  const at=stop.crossing?' at reading '+stop.crossing.sample_index+' ('+stop.crossing.force_lb+' lb)':'';
  if(stop.status==='armed')stopStatus='Armed at '+stop.thresholdLb+' lb for the next Start. This requests a stop; it does not set a hardware maximum.';
  else if(stop.status==='triggered')stopStatus='Threshold reached'+at+'. One Stop is queued behind the pending write; motion is unconfirmed.';
  else if(stop.status==='sending')stopStatus='Threshold reached'+at+'. Sending one S request; stopping is not confirmed.';
  else if(stop.status==='sent')stopStatus='Threshold '+stop.thresholdLb+' lb reached'+at+'. S host write completed; check the device reports below. Stopping force may be higher.';
  else if(stop.status==='failed')stopStatus='Software stop FAILED or unconfirmed: '+stop.error+'. Physical motion may continue; use physical controls.';
  else if(stop.status==='cancelled')stopStatus='Software monitoring ended: '+stop.reason+'. No further automatic S will be sent.';
  else stopStatus='Disarmed — no automatic force-triggered Stop.';
 }
 if($('software-stop-status').textContent!==stopStatus)$('software-stop-status').textContent=stopStatus;
 $('software-stop-controls').dataset.status=stop?.status||'unarmed';
 const limit=live.lastTestResult?.kind==='force-limit';$('live-limit-notice').hidden=!limit;
 if(limit){
  const point=live.lastTestResult.lastMeasurement;
  const message=point?'Last transmitted reading before the marker: '+point.force_lb+' lb at '+point.displacement_in.toFixed(3)+' in. This is not the exact trip force.':'No measurement preceded the marker.';
  if($('live-limit-reading').textContent!==message)$('live-limit-reading').textContent=message;
 }
 $('live-stop-notice').hidden=!live.stopReturn;
 if(live.stopReturn){
  const message=!connected&&!live.stopReturn.homeReported?
   'The connection closed before a Home reply was received. Position and load are unknown. No automatic Home or reconnect was sent.':live.stopReturn.homeReported?
   'The tester sent a Home reply after the stop-return marker. Confirm its physical position before touching the setup. No automatic Home or Start was sent by this page.':
   'Stop-return marker received; waiting for a separate Home reply. Keep clear: the mechanism may be returning. No automatic Home command was sent by this page.';
  if($('live-stop-state').textContent!==message)$('live-stop-state').textContent=message;
 }
 $('live-version').textContent=live.version||'Not queried';$('live-last').textContent=live.lastReceived?new Date(live.lastReceived).toLocaleTimeString():'No received bytes';
 const step=live.incrementalStep;
 $('live-mode-status').textContent=live.configuring?'Setting Incremental 10 lb: '+live.setupState+'; no Start sent.':live.setupState==='failed'?'Incremental setup incomplete: '+live.setupError+' No automatic retry. Reconnect before trying setup again.':live.mode==='incremental'?'Incremental 10 lb requested (parameter acceptance unconfirmed). '+(step?(step.phase==='verify-pause'?'Step '+step.number+' reading received. Continue or Home available; specimen may remain loaded.':step.phase==='pending'?'Step '+step.number+' pending; waiting for reply and a nonzero force reading.':step.phase==='stopping'?'Stop requested; an S reply does not confirm unloading. If the mechanism has physically paused, you can request Home.':step.phase==='homing'?'Home request sent; waiting for a reply. Position and load remain unconfirmed.':'Incremental test/return ended. Last plotted values are retained test readings, not current load.'):'Ready for Start.'):'Instrument mode: '+(live.mode==='continuous'?'Continuous reply received':'unknown; select a mode before testing')+'.';
 $('machine-continue').disabled=!live.canResume;
 $('live-bytes').textContent='TX '+live.txHex.length/2+' · RX '+live.rxHex.length/2;
 $('connection').disabled=opening||!['disconnected','fault'].includes(live.phase);
 $('disconnect').disabled=!connected||live.busy;
 $('machine-home').disabled=!live.canHome;$('machine-start').disabled=!live.canStart;
 $('machine-stop').disabled=!free;$('machine-stop').title='Send S once. Stopping behavior is unverified.';
 $('live-version-query').disabled=!free;
 for(const id of ['live-continuous','live-incremental'])$(id).disabled=!free||live.configuring||live.starting||live.awaitingHome||live.homing;
 $('live-review').disabled=!['disconnected','fault'].includes(live.phase);
 $('machine-help').textContent=connected?'Buttons send immediately. See session status for replies.':'Connect to enable instrument controls.';
 $('live-transcript').textContent=live.entries.slice(-60).map(e=>Number(e.elapsed_s).toFixed(3)+' '+e.event+(e.text!==undefined?' '+e.text:'')+(e.message?' '+e.message:'')).join('\n');
 $('live-recovered-log').hidden=!recovered;
 if(live.samples.length&&(lastSampleCount!==live.samples.length||lastEntryCount!==live.entries.length)){lastSampleCount=live.samples.length;lastEntryCount=live.entries.length;window.SSAView.receiveLive(live);}
}
function update(){if(!renderTimer)renderTimer=setTimeout(()=>{renderTimer=null;render();},80);}
async function issue(command,motionConfirmed=false){
 try{const sending=command==='R'?live.resumeIncrement({motionConfirmed,pauseConfirmed:motionConfirmed,interaction:'button-click'}):live.send(command,{motionConfirmed,pauseConfirmed:command==='H'&&motionConfirmed,interaction:'button-click'});render();await sending;}
 catch(error){$('live-log-status').textContent=error.message;}
 render();
}
$('connection').addEventListener('click',async()=>{
 if(opening)return;
 const error=$('live-connect-error');error.hidden=true;
 if(live&&!['disconnected','fault'].includes(live.phase))return;
 if(!window.isSecureContext||!('serial' in navigator)){error.textContent='Web Serial requires Chrome or Edge on a secure page (HTTPS or localhost).';error.hidden=false;$('live-panel').hidden=false;return;}
 opening=true;$('connection').disabled=true;
 try{
  // A fresh device picker is required for every connection. Never auto-reconnect.
  const port=await navigator.serial.requestPort({filters:[{usbVendorId:0x067b,usbProductId:0x23a3}]});
  if(live?.entries.length)recovered=live.log();
  // Test storage BEFORE opening the physical port. Do not silently overwrite the previous recovery.
  if(recovered)localStorage.setItem(KEY+'.previous',recovered);
  localStorage.setItem(KEY,'');
  live=new SSALive.LiveSession({save:log=>{localStorage.setItem(KEY,log);$('live-log-status').textContent='Browser recovery updated; download the live log for a portable copy. Recovery is not a disk-write guarantee.';},onUpdate:update});
  $('software-stop-error').hidden=true;
  lastSampleCount=0;lastEntryCount=0;lastTestIndex=0;window.SSAView.beginLive();
  await live.connect(port,{dtr:true,rts:true});
 }catch(e){
  if(e.name!=='NotFoundError'&&e.name!=='AbortError'){error.textContent=e.message;error.hidden=false;$('live-panel').hidden=false;$('live-log-status').textContent='Connection failed: '+e.message;}
 }finally{opening=false;$('connection').disabled=false;if(live)render();}
});
$('disconnect').addEventListener('click',async()=>{if(!live||live.busy)return;await live.disconnect();render();});
$('live-review').addEventListener('click',()=>{window.SSAView.finishLive(live);$('live-review').disabled=true;});
$('live-version-query').addEventListener('click',()=>issue('V'));
$('live-continuous').addEventListener('click',()=>issue('C'));
$('live-incremental').addEventListener('click',async()=>{try{await live.configureIncremental({interaction:'button-click'});}catch(error){$('live-log-status').textContent=error.message;}render();});
$('machine-stop').addEventListener('click',()=>issue('S'));
$('software-stop-arm').addEventListener('click',()=>{
 try{live.armSoftwareStop($('software-stop-value').value);$('software-stop-error').hidden=true;}
 catch(error){$('software-stop-error').textContent=error.message;$('software-stop-error').hidden=false;}render();
});
$('software-stop-disarm').addEventListener('click',()=>{
 try{live.disarmSoftwareStop();}
 catch(error){$('software-stop-error').textContent=error.message;$('software-stop-error').hidden=false;}render();
});
// Each deliberate button click is the operator's command; no confirmation dialog.
for(const [id,command] of [['machine-home','H'],['machine-start','T'],['machine-continue','R']]){
 $(id).addEventListener('click',event=>{if(event.detail>1)return;issue(command,true);});
}
$('live-save-log').addEventListener('click',()=>{
 if(!live)return;download(live.log(),'ssa-browser-live-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jsonl');
 $('live-log-status').textContent='Live log download requested. Check your browser downloads; the connection is unchanged.';
});
try{recovered=localStorage.getItem(KEY)||localStorage.getItem(KEY+'.previous')||'';}catch{}
if(recovered){$('live-panel').hidden=false;$('live-recovered-log').hidden=false;$('live-log-status').textContent='A previous live log is recoverable. Download it before replacing browser data. No device is connected.';}
$('live-recovered-log').addEventListener('click',()=>download(recovered,'ssa-browser-recovered.jsonl'));
})();
