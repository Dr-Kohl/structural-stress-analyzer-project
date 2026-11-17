(function(){
'use strict';
const $=id=>document.getElementById(id);
try{
 const samples=window.SSA_CAPTURE.samples,model=window.SSAModel,summary=model.summarize(samples);
 const svg=$('chart'),NS='http://www.w3.org/2000/svg';
 let index=samples.length-1,playing=false,replayTime=summary.duration,lastClock=0,speed=1,hoverIndex=null;
 $('scrub').max=samples.length;$('scrub').value=samples.length;
 function el(tag,attrs={},text){
  const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);
  if(text!==undefined)n.textContent=text;return n;
 }
 let axes={};
 function draw(){
  svg.replaceChildren();svg.append(el('title',{},'Captured force versus displacement'));
  svg.append(el('desc',{},'Peak force 114 pounds at 0.043 inches. Reconstructed from 144 USB measurement records.'));
  const left=73,top=28,w=811,h=374,bottom=top+h;
  const showTail=$('tail').checked,visibleEnd=showTail?samples.length-1:summary.tailStart;
  const maxX=showTail?0.15:0.07,maxY=120,x=v=>left+v/maxX*w,y=v=>bottom-v/maxY*h;
  axes={left,top,w,h,maxX,maxY,x,y};
  svg.append(el('rect',{x:0,y:0,width:920,height:480,fill:'#ffffff'}));
  for(let v=0;v<=120;v+=20){
   svg.append(el('line',{x1:left,x2:left+w,y1:y(v),y2:y(v),stroke:'#e5ebe4','stroke-width':1}));
   svg.append(el('text',{x:left-14,y:y(v)+4,'text-anchor':'end',fill:'#87958a','font-size':12},v));
  }
  const steps=showTail?5:7;
  for(let i=0;i<=steps;i++){const v=maxX*i/steps;
   svg.append(el('line',{x1:x(v),x2:x(v),y1:top,y2:bottom,stroke:'#edf1eb','stroke-width':1}));
   svg.append(el('text',{x:x(v),y:bottom+25,'text-anchor':'middle',fill:'#87958a','font-size':12},v===0?'0':v.toFixed(2)));
  }
  svg.append(el('text',{x:left+w/2,y:465,'text-anchor':'middle',fill:'#718475','font-size':13},'Displacement (in)'));
  svg.append(el('text',{transform:'translate(20 215) rotate(-90)','text-anchor':'middle',fill:'#718475','font-size':13},'Force (lb)'));
  const end=Math.min(index,visibleEnd);
  const path=samples.slice(0,end+1).map((s,i)=>(i?'L':'M')+x(s.displacement_in).toFixed(2)+' '+y(s.force_lb).toFixed(2)).join(' ');
  if(end>0)svg.append(el('path',{d:path+' L'+x(samples[end].displacement_in)+' '+bottom+' L'+x(samples[0].displacement_in)+' '+bottom+' Z',fill:'#eaf3e8',opacity:.8}));
  const loadedEnd=Math.min(end,summary.tailStart);
  const loaded=samples.slice(0,loadedEnd+1).map((s,i)=>(i?'L':'M')+x(s.displacement_in)+' '+y(s.force_lb)).join(' ');
  svg.append(el('path',{d:loaded,fill:'none',stroke:'#32775e','stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'}));
  if(showTail&&end>summary.tailStart){
   const tail=samples.slice(summary.tailStart,end+1).map((s,i)=>(i?'L':'M')+x(s.displacement_in)+' '+y(s.force_lb)).join(' ');
   svg.append(el('path',{d:tail,fill:'none',stroke:'#91a38b','stroke-width':2,'stroke-dasharray':'5 5'}));
  }
  if(index>=summary.peak.sample_index-1){
   const px=x(summary.peak.displacement_in),py=y(summary.peak.force_lb);
   svg.append(el('circle',{cx:px,cy:py,r:5,fill:'#32775e',stroke:'white','stroke-width':2}));
   const bx=Math.min(px+12,left+w-160),by=Math.max(top+8,py+17);
   svg.append(el('rect',{x:bx,y:by,width:155,height:30,rx:6,fill:'#edf4e8',stroke:'#d8e6d1'}));
   svg.append(el('text',{x:bx+10,y:by+20,fill:'#356449','font-size':12,'font-weight':600},'114 lb · 0.043 in'));
  }
  const cursor=hoverIndex===null?index:hoverIndex,s=samples[cursor];
  if(s.displacement_in<=maxX){
   const cx=x(s.displacement_in),cy=y(s.force_lb);
   svg.append(el('line',{x1:cx,x2:cx,y1:top,y2:bottom,stroke:'#a2b6a1','stroke-width':1,'stroke-dasharray':'3 5'}));
   svg.append(el('circle',{cx,cy,r:5,fill:'#194d43',stroke:'white','stroke-width':2}));
  }
 }
 function update(){
  const s=samples[hoverIndex===null?index:hoverIndex];
  $('force').textContent=s.force_lb;$('displacement').textContent=s.displacement_in.toFixed(3);
  $('count').textContent=index+1;$('time').textContent=samples[index].time_s.toFixed(2)+' s of received data';
  $('sample-label').textContent=(index+1)+' of '+samples.length;$('scrub').value=index+1;
  $('play').textContent=playing?'Ⅱ Pause replay':index===samples.length-1?'▶ Replay test':'▶ Play replay';
  $('state').textContent=playing?'Playing captured data':index===samples.length-1?'Complete test':'Paused · reading '+(index+1);
  draw();
 }
 function pause(){playing=false;lastClock=0;}
 $('play').addEventListener('click',()=>{
  if(playing)pause();else{if(index===samples.length-1){index=0;replayTime=0;}playing=true;lastClock=0;}
  hoverIndex=null;update();
 });
 $('reset').addEventListener('click',()=>{pause();index=0;replayTime=0;hoverIndex=null;update();});
 $('scrub').addEventListener('input',()=>{pause();index=Number($('scrub').value)-1;replayTime=samples[index].time_s;hoverIndex=null;update();});
 $('speed').addEventListener('change',()=>{speed=Number($('speed').value);lastClock=0;});
 $('tail').addEventListener('change',()=>{hoverIndex=null;update();});
 $('jump-peak').addEventListener('click',()=>{pause();index=summary.peak.sample_index-1;replayTime=samples[index].time_s;hoverIndex=null;update();});
 svg.addEventListener('pointermove',event=>{
  const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
  const point=p.matrixTransform(svg.getScreenCTM().inverse());
  if(point.x<axes.left||point.x>axes.left+axes.w||point.y<axes.top||point.y>axes.top+axes.h)return;
  const target=(point.x-axes.left)/axes.w*axes.maxX;
  let best=0,bestDistance=Infinity;
  for(let i=0;i<=index;i++){
   const s=samples[i];if(s.displacement_in>axes.maxX)continue;
   const dx=(s.displacement_in-target)/axes.maxX*axes.w,dy=axes.y(s.force_lb)-point.y;
   const distance=dx*dx+dy*dy;if(distance<bestDistance){best=i;bestDistance=distance;}
  }
  hoverIndex=best;const s=samples[best];
  $('inspection').textContent='Reading '+(best+1)+' · '+s.force_lb+' lb at '+s.displacement_in.toFixed(3)+' in';update();
 });
 svg.addEventListener('pointerleave',()=>{hoverIndex=null;$('inspection').textContent='Hover over the curve to inspect a reading';update();});
 function download(name,type,content){
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 $('csv').addEventListener('click',()=>download('ssa1000-recovered-test.csv','text/csv;charset=utf-8',model.toCsv(samples)));
 $('svg-export').addEventListener('click',()=>{svg.setAttribute('xmlns',NS);download('ssa1000-force-displacement.svg','image/svg+xml;charset=utf-8',new XMLSerializer().serializeToString(svg));});
 function animate(clock){
  if(playing){
   if(lastClock){replayTime=Math.min(summary.duration,replayTime+(clock-lastClock)/1000*speed);const next=model.indexAtTime(samples,replayTime);if(next!==index){index=next;update();}}
   lastClock=clock;if(replayTime>=summary.duration){pause();index=samples.length-1;update();}
  }
  requestAnimationFrame(animate);
 }
 update();requestAnimationFrame(animate);
}catch(error){$('error').hidden=false;$('error').textContent='Could not load the captured test: '+error.message;console.error(error);}
})();