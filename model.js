(function(root){
'use strict';
function summarize(samples){
 if(!samples.length) throw new Error('No measurements loaded');
 const peak=samples.reduce((best,s)=>s.force_lb>best.force_lb?s:best,samples[0]);
 const lastPositive=samples.reduce((last,s,i)=>s.force_lb!==0?i:last,-1);
 return {peak,tailStart:lastPositive<0?0:Math.min(lastPositive+1,samples.length-1),duration:samples.at(-1).time_s};
}
function indexAtTime(samples,time){
 let lo=0,hi=samples.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(samples[mid].time_s<=time)lo=mid+1;else hi=mid;}
 return Math.max(0,lo-1);
}
class SerialParser{
 constructor(){this.pending='';this.records=[];this.markers=[];this.unknown=[];}
 push(chunk){
  for(const c of chunk){
   if(c==='\r'){
    const line=this.pending;this.pending='';
    const m=/^(\d{4}),(\d{4})$/.exec(line);
    if(m)this.records.push({raw_field_1:m[1],raw_field_2:m[2],displacement_in:Number(m[1])/1000,force_lb:Number(m[2])});
    else if(['D','ID','TT','TM','TU','U','H'].includes(line))this.markers.push(line);
    else this.unknown.push(line);
   }else this.pending+=c;
  }
  return this;
 }
}
function toCsv(samples){
 const keys=['sample_index','time_s','displacement_in','force_lb','raw_field_1','raw_field_2','first_frame','last_frame'];
 return keys.join(',')+'\r\n'+samples.map(s=>keys.map(k=>'"'+String(s[k]??'').replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
}
const api={summarize,indexAtTime,SerialParser,toCsv};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SSAModel=api;
})(typeof window!=='undefined'?window:globalThis);
