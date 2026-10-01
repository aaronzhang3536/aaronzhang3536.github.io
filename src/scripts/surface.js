const canvas=document.getElementById('surface-canvas');
const wave=document.getElementById('surface-wave');
const angle=document.getElementById('surface-angle');
const stage=document.querySelector('[data-surface]');
if(canvas&&wave&&angle&&stage){
  let mode='lines';
  function draw(){
    const bounds=canvas.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
    const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(bounds.width*dpr);canvas.height=Math.round(bounds.height*dpr);
    const ctx=canvas.getContext('2d');if(!ctx)return;ctx.setTransform(dpr,0,0,dpr,0,0);
    const w=bounds.width,h=bounds.height,style=getComputedStyle(canvas);ctx.fillStyle=style.getPropertyValue('--surface-study-background').trim();ctx.fillRect(0,0,w,h);
    const ink=style.getPropertyValue('--as-accent').trim();const theta=Number(angle.value)*Math.PI/180,scale=Math.min(w*.32,h*.5),amp=Number(wave.value)/100;
    const project=(x,z)=>{const height=(Math.sin(x*2.4+z*.8)*.33+Math.cos(z*3.2-x)*.22)*amp;return [w*.5+(x*Math.cos(theta)-z*Math.sin(theta))*scale,h*.51+(x*Math.sin(theta)+z*Math.cos(theta))*scale*.35-height*scale*.7];};
    for(let row=0;row<=26;row++){ctx.beginPath();for(let col=0;col<=52;col++){const point=project(-1+col/26,-1+row/13);if(mode==='dots'){if(col%2===0){ctx.fillStyle=ink;ctx.globalAlpha=.35+row/52;ctx.beginPath();ctx.arc(point[0],point[1],1.8,0,Math.PI*2);ctx.fill();}}else col?ctx.lineTo(...point):ctx.moveTo(...point);}if(mode==='lines'){ctx.strokeStyle=ink;ctx.globalAlpha=.25+row/45;ctx.lineWidth=1;ctx.stroke();}}
    if(mode==='lines')for(let col=0;col<=18;col++){ctx.beginPath();for(let row=0;row<=52;row++){const point=project(-1+col/9,-1+row/26);row?ctx.lineTo(...point):ctx.moveTo(...point);}ctx.strokeStyle=ink;ctx.globalAlpha=.2;ctx.lineWidth=.7;ctx.stroke();}
    ctx.globalAlpha=1;
    document.getElementById('surface-wave-value').textContent=wave.value;
    document.getElementById('surface-angle-value').textContent=angle.value+'°';
  }
  wave.addEventListener('input',draw);angle.addEventListener('input',draw);
  stage.querySelectorAll('[data-surface-mode]').forEach(button=>button.addEventListener('click',()=>{mode=button.dataset.surfaceMode;stage.querySelectorAll('[data-surface-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));draw();}));
  stage.querySelector('[data-surface-reset]').addEventListener('click',()=>{wave.value='55';angle.value='35';mode='lines';stage.querySelectorAll('[data-surface-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.surfaceMode===mode)));draw();});
  new ResizeObserver(draw).observe(canvas);draw();
}
