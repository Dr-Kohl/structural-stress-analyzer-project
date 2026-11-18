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
  this.entries=[];this.samples=[];this.pending='';this.rxHex='';this.txHex='';this.version='';this.lastReceived=null;this.started=now();this.bytes=0;this.testIssued=false;
 }
 event(event,fields={}){
  const row={utc:this.utc(),elapsed_s:Math.max(0,(this.now()-this.started)/1000),event,...fields};
  this.entries.push(row);this.save(this.log());return row;
 }
 log(){return this.entries.map(r=>JSON.stringify(r)).join('\n')+(this.entries.length?'\n':'');}
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
  else if(line==='TT'){this.machine='Test end marker received';this.starting=false;}
  else if(line==='H')this.machine='Last report: Home reply';
  else if(line==='U')this.machine='Last report: U (seen during homing)';
  else if(line==='S')this.machine='S reply received — stopped state unverified';
  else if(line==='C'||line==='I')this.machine=line+' reply received — settings unverified';
  else if(/^V[\x20-\x7e]{1,60}$/.test(line))this.version=line.slice(1);
  this.event('record',{text:visible(new Uint8Array(Array.from(line,c=>c.charCodeAt(0))))});
 }
 async send(command,{motionConfirmed=false}={}){
  if(!Object.hasOwn(COMMANDS,command))throw new Error('Only the six observed command bytes are available.');
  if(this.phase!=='connected'||this.closing)throw new Error('Connect before sending a command.');
  if(this.busy)throw new Error('Another write is pending; no duplicate was sent.');
  if(['H','T'].includes(command)&&!motionConfirmed)throw new Error('An explicit motion confirmation is required.');
  if(command==='T'&&this.testIssued)throw new Error('A test start was already requested in this connection. Save and reconnect for another test.');
  if(this.starting&&['H','C','I'].includes(command))throw new Error('A test start is pending; only S or V may be sent.');
  this.busy=true;let writer;
  try{
   this.event('tx_attempt',{hex:hex([command.charCodeAt(0)]),text:command,byte_count:1});
   const pending=COMMANDS[command]+' pending — outcome unconfirmed';this.machine=pending;
   if(command==='T'){this.starting=true;this.testIssued=true;}
   writer=this.port.writable.getWriter();await writer.write(new Uint8Array([command.charCodeAt(0)]));
   this.txHex+=hex([command.charCodeAt(0)]);
   if(this.machine===pending)this.machine=COMMANDS[command]+' sent — outcome unconfirmed';
   this.event('tx_result',{hex:hex([command.charCodeAt(0)]),text:command,byte_count:1,host_write_completed:true,acknowledged_by_tester:false});
  }catch(error){try{writer?.releaseLock();}catch{}writer=null;await this.fail('Write/logging failed; delivery may be unknown: '+error.message);throw error;}
  finally{try{writer?.releaseLock();}catch{}this.busy=false;this.update();}
 }
 async fail(message,insideReader=false){
  this.error=message;this.machine='Unknown — communication fault';
  try{this.event('error',{message});}catch{}
  await this.disconnect({fault:true,insideReader});
 }
 async disconnect({fault=false,insideReader=false}={}){
  if(this.closing)return;
  this.closing=true;this.phase='disconnecting';this.update();
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
