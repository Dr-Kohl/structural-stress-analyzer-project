(function(root){
'use strict';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const text=bytes=>Array.from(bytes,b=>String.fromCharCode(b)).join('');
const visible=bytes=>Array.from(bytes,b=>b===13?'\\r':b===10?'\\n':b>=32&&b<127?String.fromCharCode(b):'\\x'+b.toString(16).padStart(2,'0')).join('');
const COMMANDS=Object.freeze({H:'Home request',V:'Version query',C:'Continuous selection request',I:'Incremental selection request',S:'Experimental stop request',T:'Start test request'});
class LiveSession{
 constructor({onUpdate=()=>{},save=()=>{},now=()=>performance.now(),utc=()=>new Date().toISOString()}={}){
  this.onUpdate=onUpdate;this.save=save;this.now=now;this.utc=utc;this.phase='disconnected';this.machine='Unknown';
  this.port=null;this.reader=null;this.readTask=null;this.closing=false;this.busy=false;this.starting=false;
  this.entries=[];this.samples=[];this.pending='';this.rxHex='';this.txHex='';this.version='';this.lastReceived=null;this.started=now();this.bytes=0;this.testIssued=false;this.lastTestResult=null;this.stopReturn=null;this.softwareStop=null;
  this.testIndex=0;this.testComplete=false;this.homing=false;this.requiresHome=false;
 }
 event(event,fields={}){
  const row={utc:this.utc(),elapsed_s:Math.max(0,(this.now()-this.started)/1000),test_index:this.testIndex,event,...fields};
  this.entries.push(row);this.save(this.log());return row;
 }
 log(){return this.entries.map(r=>JSON.stringify(r)).join('\n')+(this.entries.length?'\n':'');}
 get awaitingHome(){return !!this.stopReturn&&!this.stopReturn.homeReported;}
 get canStart(){return this.phase==='connected'&&!this.closing&&!this.busy&&!this.starting&&!this.awaitingHome&&!this.homing&&!this.requiresHome&&!['triggered','sending'].includes(this.softwareStop?.status)&&(!this.testIssued||this.testComplete);}
 get canPrepareTest(){return this.canStart&&(!this.samples.length||this.testComplete);}
 armSoftwareStop(value){
  if(!this.canPrepareTest)throw new Error('Arm only while idle before Start, or after the previous test has completed and any return has finished.');
  if(this.softwareStop?.status==='armed')throw new Error('Disarm before changing the threshold.');
  const threshold=Number(value);
  if(!Number.isInteger(threshold)||threshold<10||threshold>1000)throw new Error('Choose a whole-pound threshold from 10 to 1000. This is not a guaranteed maximum.');
  const next={thresholdLb:threshold,status:'armed',crossing:null,error:null,reason:null};
  try{this.event('software_stop_armed',{threshold_lb:threshold,hardware_setting_sent:false});}
  catch(error){this.softwareStop={...next,status:'failed',error:'Arming log failed: '+error.message};try{this.event('software_stop_failed',{message:this.softwareStop.error});}catch{}this.update();throw error;}
  this.softwareStop=next;this.update();
 }
 disarmSoftwareStop(){
  if(!this.canPrepareTest)throw new Error('The threshold cannot be changed or disarmed while a test or return is pending.');
  if(this.softwareStop?.status==='armed'){
   this.softwareStop.status='disarmed';this.event('software_stop_disarmed',{threshold_lb:this.softwareStop.thresholdLb});this.update();
  }
 }
 finishSoftwareStop(reason){
  const stop=this.softwareStop;
  if(stop&&['armed','triggered'].includes(stop.status)){
   stop.status='cancelled';stop.reason=reason;
   this.event('software_stop_cancelled',{threshold_lb:stop.thresholdLb,reason});
  }
 }
 checkSoftwareStop(sample){
  const stop=this.softwareStop;
  if(stop?.status==='armed'&&!this.starting){this.finishSoftwareStop('Unexpected measurement before Start; verify the instrument is idle');return;}
  if(this.phase!=='connected'||!this.starting||!this.testIssued||this.awaitingHome||stop?.status!=='armed'||sample.force_lb<stop.thresholdLb)return;
  // Latch BEFORE scheduling any write: coalesced records cannot queue repeats.
  stop.status='triggered';stop.crossing={...sample};
  this.event('software_stop_triggered',{threshold_lb:stop.thresholdLb,reading:{...sample}});
  void this.flushSoftwareStop();
 }
 async flushSoftwareStop(){
  const stop=this.softwareStop;
  if(stop?.status!=='triggered'||this.busy||this.closing||this.phase!=='connected')return;
  if(!this.starting||this.awaitingHome){this.finishSoftwareStop('Test/return ended before the queued stop write');return;}
  stop.status='sending';this.update();
  try{
   await this.send('S',{reason:'software-threshold'});
   if(stop.status==='failed'||this.phase!=='connected')throw new Error('Connection fault before automatic stop completion');
   stop.status='sent';this.event('software_stop_write_completed',{threshold_lb:stop.thresholdLb,stopped_state_verified:false});
  }catch(error){stop.status='failed';stop.error='Automatic stop not confirmed: '+error.message;try{this.event('software_stop_failed',{message:stop.error});}catch{}}
  this.update();
 }
 update(){this.onUpdate(this);}
 async connect(port,{dtr=true,rts=true}={}){
  if(this.phase!=='disconnected')throw new Error('Disconnect before choosing another port.');
  this.phase='connecting';this.port=port;this.started=this.now();this.update();
  try{
   this.event('session',{kind:'live',baud:9600,data_bits:8,parity:'none',stop_bits:1,flow_control:'none',dtr,rts,units:'SAE inches/pounds',...port.getInfo?.()});
   this.event('open_attempt');
   await port.open({baudRate:9600,dataBits:8,stopBits:1,parity:'none',flowControl:'none',bufferSize:65536});
   await port.setSignals({dataTerminalReady:dtr,requestToSend:rts});
   if(!port.readable||!port.writable)throw new Error('The selected port has no readable/writable stream.');
   this.reader=port.readable.getReader();this.phase='connected';this.machine='Unknown — no handshake sent';
   this.event('opened',{startup_bytes_sent:0});this.update();this.readTask=this.readLoop();
  }catch(error){await this.fail('Connection failed: '+error.message);throw error;}
 }
 async readLoop(){
  try{
   while(!this.closing){
    const {value,done}=await this.reader.read();
    if(done){if(!this.closing)throw new Error('Device stream ended.');break;}
    if(value?.length)this.receive(value);
   }
  }catch(error){if(!this.closing)await this.fail('Read/logging failed: '+error.message,true);}
  finally{try{this.reader?.releaseLock();}catch{}this.reader=null;}
 }
 receive(value){
  if(this.bytes+value.length>2*1024*1024||this.samples.length>=100000)throw new Error('Live recording limit reached; disconnect and save this session.');
  this.bytes+=value.length;this.rxHex+=hex(value);this.lastReceived=this.utc();
  this.event('rx',{hex:hex(value),text:visible(value),byte_count:value.length});
  for(const b of value){
   if(b===13){const line=this.pending;this.pending='';this.record(line);}
   else{this.pending+=String.fromCharCode(b);if(this.pending.length>4096)throw new Error('Unterminated device record exceeded 4 KB; raw bytes retained.');}
  }
  this.update();
 }
 record(line){
  const m=/^(\d{4}),(\d{4})$/.exec(line);
  if(m){
   this.samples.push({sample_index:this.samples.length+1,time_s:Math.max(0,(this.now()-this.started)/1000),displacement_in:Number(m[1])/1000,force_lb:Number(m[2]),raw_field_1:m[1],raw_field_2:m[2]});
   this.machine='Measurement received — motion unconfirmed';
  }else if(line==='D')this.machine='Test data marker received';
  else if(line==='TT'){this.machine='Test end marker received';this.starting=false;this.testComplete=true;this.finishSoftwareStop('TT end marker received');}
  else if(line==='TM'){
   // Correlated with the tester's maximum-force display in the saved wood trial.
   // This ends the pending request, not a claim of stopped motion or released load.
   this.machine='Maximum-force end marker received — motion unconfirmed; request Home before another test';this.starting=false;this.testIssued=true;this.testComplete=false;this.requiresHome=true;
   this.finishSoftwareStop('TM force-limit end marker received');
   this.lastTestResult={kind:'force-limit',marker:'TM',utc:this.utc(),sampleCount:this.samples.length,
    lastMeasurement:this.samples.length?{...this.samples.at(-1)}:null};
   this.event('test_result',this.lastTestResult);
  }
  else if(line==='TU'){
   // Observed after an active S, then followed by H without a host Home send.
   // Keep motion actions blocked while waiting for that separate Home report.
   this.starting=true;this.testIssued=true;this.testComplete=false;
   this.finishSoftwareStop('TU stop-return marker received');
   this.stopReturn={kind:'stop-return',marker:'TU',utc:this.utc(),homeReported:false,homeReportUtc:null};
   this.machine='Stop-return marker received — awaiting Home reply; keep clear';
   this.event('test_result',this.stopReturn);
  }
  else if(line==='H'){
   this.homing=false;this.requiresHome=false;
   if(!this.starting||this.awaitingHome)this.testComplete=true;
   this.machine='Last report: Home reply';
   if(this.stopReturn&&!this.stopReturn.homeReported){
    this.stopReturn.homeReported=true;this.stopReturn.homeReportUtc=this.utc();this.starting=false;
    this.machine='Home reply received after stop-return marker — verify physical position';
    this.event('home_report',{after_marker:'TU',physical_state_verified:false});
   }
  }
  else if(line==='U')this.machine='Last report: U (seen during homing)';
  else if(line==='S')this.machine='S reply received — stopped state unverified';
  else if(line==='C'||line==='I')this.machine=line+' reply received — settings unverified';
  else if(/^V[\x20-\x7e]{1,60}$/.test(line))this.version=line.slice(1);
  this.event('record',{text:visible(new Uint8Array(Array.from(line,c=>c.charCodeAt(0))))});
  if(m)this.checkSoftwareStop(this.samples.at(-1));
 }
 async send(command,{motionConfirmed=false,reason='manual'}={}){
  if(!Object.hasOwn(COMMANDS,command))throw new Error('Only the six observed command bytes are available.');
  if(this.phase!=='connected'||this.closing)throw new Error('Connect before sending a command.');
  if(this.busy)throw new Error('Another write is pending; no duplicate was sent.');
  if(['H','T'].includes(command)&&!motionConfirmed)throw new Error('An explicit motion confirmation is required.');
  if(command==='T'&&!this.canStart)throw new Error('A test is already requested or a test, force-limit event or return is pending. Wait for completion; a force-limit event requires Home.');
  if((this.starting||this.awaitingHome||this.homing)&&['H','C','I'].includes(command))throw new Error('A test or return is pending; only S or V may be sent.');
  this.busy=true;let writer;
  try{
   if(command==='S'&&reason!=='software-threshold'&&this.testIssued)this.finishSoftwareStop('Manual Stop request superseded automatic threshold');
   if(command==='T'){
    this.testIndex++;this.testComplete=false;this.samples=[];this.lastTestResult=null;this.stopReturn=null;
    if(this.softwareStop?.status!=='armed')this.softwareStop=null;
    this.event('test_started',{previous_recordings:'Retained in exact-byte log',software_stop_threshold_lb:this.softwareStop?.thresholdLb??null});
   }
   this.event('tx_attempt',{hex:hex([command.charCodeAt(0)]),text:command,byte_count:1,reason,
    ...(command==='T'?{software_stop_threshold_lb:this.softwareStop?.status==='armed'?this.softwareStop.thresholdLb:null}:{})});
   const pending=COMMANDS[command]+' pending — outcome unconfirmed';this.machine=pending;
   if(command==='T'){this.starting=true;this.testIssued=true;}
   if(command==='H')this.homing=true;
   writer=this.port.writable.getWriter();await writer.write(new Uint8Array([command.charCodeAt(0)]));
   this.txHex+=hex([command.charCodeAt(0)]);
   if(this.machine===pending)this.machine=COMMANDS[command]+' sent — outcome unconfirmed';
   this.event('tx_result',{hex:hex([command.charCodeAt(0)]),text:command,byte_count:1,reason,host_write_completed:true,acknowledged_by_tester:false});
  }catch(error){try{writer?.releaseLock();}catch{}writer=null;await this.fail('Write/logging failed; delivery may be unknown: '+error.message);throw error;}
  finally{try{writer?.releaseLock();}catch{}this.busy=false;this.update();void this.flushSoftwareStop();}
 }
 async fail(message,insideReader=false){
  this.error=message;this.machine='Unknown — communication fault';
  if(this.softwareStop&&['armed','triggered','sending'].includes(this.softwareStop.status)){
   this.softwareStop.status='failed';this.softwareStop.error='Software monitoring/stop not confirmed: '+message;
  }
  try{this.event('error',{message});}catch{}
  await this.disconnect({fault:true,insideReader});
 }
 async disconnect({fault=false,insideReader=false}={}){
  if(this.closing)return;
  this.closing=true;this.phase='disconnecting';this.update();
  try{this.finishSoftwareStop('Connection closed; software monitoring ended');}catch{}
  try{await this.reader?.cancel();}catch{}
  if(!insideReader){try{await this.readTask;}catch{}}
  else{try{this.reader?.releaseLock();}catch{}this.reader=null;}
  try{await this.port?.close();}catch(error){this.error=(this.error?this.error+'; ':'')+'Port close failed: '+error.message;fault=true;}
  this.port=null;this.phase=fault?'fault':'disconnected';this.machine='Unknown — disconnected';this.starting=false;
  try{this.event('closed',{pending_hex:hex(new Uint8Array(Array.from(this.pending,c=>c.charCodeAt(0)))),tx_bytes:this.txHex.length/2,rx_bytes:this.rxHex.length/2,fault});}catch{}
  this.closing=false;this.update();
 }
}
const api={LiveSession,COMMANDS,hex,visible};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SSALive=api;
})(typeof window!=='undefined'?window:globalThis);
