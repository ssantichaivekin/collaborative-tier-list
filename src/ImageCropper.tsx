import {resizeCrop} from './cropGeometry';
import {useEffect,useRef,useState} from 'react';

export function ImageCropper({source,onSave,onCancel}:{source:Blob|string;onSave:(file:File)=>Promise<void>|void;onCancel:()=>void}){
 const canvas=useRef<HTMLCanvasElement>(null),dialog=useRef<HTMLElement>(null);
 const drag=useRef<{id:number;px:number;py:number;x:number;y:number}|null>(null);
 const clamp=(n:number)=>Math.max(0,Math.min(100,n));
 const frame=useRef<HTMLDivElement>(null);
 const cornerDrag=useRef<{id:number;corner:string;px:number;py:number;size:number;rect:{x:number;y:number;side:number}}|null>(null);
 const selectionRef=useRef<{left:number;top:number;size:number}|null>(null);
 const [selection,setSelection]=useState<{left:number;top:number;size:number}|null>(null);
 const [image,setImage]=useState<HTMLImageElement|null>(null);
 const [zoom,setZoom]=useState(1),[x,setX]=useState(50),[y,setY]=useState(50);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement;dialog.current?.focus();
  let active=true;const url=typeof source==='string'?source:URL.createObjectURL(source);
  const img=new Image();img.crossOrigin='anonymous';
  img.onload=()=>{if(active)setImage(img);};img.onerror=()=>{if(active)setError('Could not load this image.');};img.src=url;
  return()=>{active=false;if(typeof source!=='string')URL.revokeObjectURL(url);previous?.focus();};
 },[source]);
 useEffect(()=>{
  if(!image||!canvas.current)return;
  const context=canvas.current.getContext('2d');if(!context)return;
  let side=Math.min(image.naturalWidth,image.naturalHeight)/zoom;
  let left=(image.naturalWidth-side)*x/100,top=(image.naturalHeight-side)*y/100;
  if(selection && selection.size>1 && cornerDrag.current){const r=cornerDrag.current.rect;left=r.x+selection.left*r.side;top=r.y+selection.top*r.side;side=r.side*selection.size;}
  context.clearRect(0,0,384,384);
  context.drawImage(image,left,top,side,side,0,0,384,384);
 },[image,zoom,x,y,selection]);
 return <div className="modal-backdrop crop-backdrop"><section ref={dialog} tabIndex={-1} className="share-modal crop-modal" role="dialog" aria-modal="true" aria-label="Crop image" onKeyDown={e=>{
  e.stopPropagation();if(e.key==='Escape'&&!busy)onCancel();
  if(e.key==='Tab'){const controls=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), canvas[tabindex]'));const first=controls[0],last=controls.at(-1);if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){e.preventDefault();first?.focus();}}
 }}>
 <h2>Crop image</h2>
 <div className="crop-frame" ref={frame}>
 <canvas ref={canvas} width={384} height={384} tabIndex={0} aria-label="Crop preview. Drag to reposition, or use arrow keys." aria-describedby="crop-hint"
 onPointerDown={e=>{
  if(!image||busy||e.button!==0||drag.current)return;
  e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
  drag.current={id:e.pointerId,px:e.clientX,py:e.clientY,x,y};
 }}
 onPointerMove={e=>{
  const start=drag.current;if(!start||start.id!==e.pointerId||!image||busy)return;
  const side=Math.min(image.naturalWidth,image.naturalHeight)/zoom;
  const scale=side/e.currentTarget.getBoundingClientRect().width;
  const horizontal=image.naturalWidth-side,vertical=image.naturalHeight-side;
  setX(horizontal>0?clamp(start.x-(e.clientX-start.px)*scale/horizontal*100):50);
  setY(vertical>0?clamp(start.y-(e.clientY-start.py)*scale/vertical*100):50);
 }}
 onPointerUp={e=>{if(drag.current?.id===e.pointerId){drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}}}
 onPointerCancel={()=>{drag.current=null;}}
 onLostPointerCapture={()=>{drag.current=null;}}
 onKeyDown={e=>{
  if(busy||!image)return;
  const step=e.shiftKey?10:2;
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();
   if(e.key==='ArrowLeft')setX(v=>clamp(v+step));if(e.key==='ArrowRight')setX(v=>clamp(v-step));
   if(e.key==='ArrowUp')setY(v=>clamp(v+step));if(e.key==='ArrowDown')setY(v=>clamp(v-step));
  }
 }}/>
 <div className="crop-grid" aria-hidden="true" style={selection && selection.size<=1?{inset:'auto',left:selection.left*100+'%',top:selection.top*100+'%',width:selection.size*100+'%',height:selection.size*100+'%',boxShadow:'0 0 0 384px #0007'}:undefined}/>
 {['nw','ne','sw','se'].map(corner=><button key={corner} type="button" className={'crop-corner crop-corner-'+corner} aria-label={'Resize crop '+({nw:'top left',ne:'top right',sw:'bottom left',se:'bottom right'}[corner])} disabled={busy||!image}
 style={selection && selection.size<=1?{left:(selection.left+(corner.endsWith('e')?selection.size:0))*100+'%',top:(selection.top+(corner.startsWith('s')?selection.size:0))*100+'%',right:'auto',bottom:'auto'}:undefined}
 onPointerDown={e=>{
 if(!image||e.button!==0||cornerDrag.current)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
 const side=Math.min(image.naturalWidth,image.naturalHeight)/zoom;
 cornerDrag.current={id:e.pointerId,corner,px:e.clientX,py:e.clientY,size:frame.current!.getBoundingClientRect().width,rect:{x:(image.naturalWidth-side)*x/100,y:(image.naturalHeight-side)*y/100,side}};
 selectionRef.current={left:0,top:0,size:1};setSelection(selectionRef.current);
 }}
 onPointerMove={e=>{
 const d=cornerDrag.current;if(!d||d.id!==e.pointerId||!image)return;
 const dx=(e.clientX-d.px)/d.size,dy=(e.clientY-d.py)/d.size;
 const change=((d.corner.endsWith('e')?dx:-dx)+(d.corner.startsWith('s')?dy:-dy))/2;
 selectionRef.current=resizeCrop(d.rect,image.naturalWidth,image.naturalHeight,d.corner,change);
 setSelection(selectionRef.current);
 }}
 onPointerUp={e=>{
 const d=cornerDrag.current;if(!d||d.id!==e.pointerId||!image)return;
 const selection=selectionRef.current;
 if(selection){const side=d.rect.side*selection.size;const left=d.rect.x+selection.left*d.rect.side,top=d.rect.y+selection.top*d.rect.side;
 setZoom(Math.min(image.naturalWidth,image.naturalHeight)/side);
 setX(image.naturalWidth>side?clamp(left/(image.naturalWidth-side)*100):50);
 setY(image.naturalHeight>side?clamp(top/(image.naturalHeight-side)*100):50);}
 cornerDrag.current=null;selectionRef.current=null;setSelection(null);e.currentTarget.releasePointerCapture(e.pointerId);
 }}
 onPointerCancel={()=>{cornerDrag.current=null;selectionRef.current=null;setSelection(null);}}
 onLostPointerCapture={()=>{cornerDrag.current=null;selectionRef.current=null;setSelection(null);}}
 onKeyDown={e=>{if(!image||busy)return;if(e.key==='ArrowUp'||e.key==='ArrowRight'){e.preventDefault();setZoom(z=>Math.min(4,z+.1));}if(e.key==='ArrowDown'||e.key==='ArrowLeft'){e.preventDefault();setZoom(z=>Math.max(1,z-.1));}}}
 />)}

 </div>
 <small id="crop-hint">Drag corners inward to crop or outward to restore. Drag photo to reposition.</small>
 {!image&&!error&&<p role="status">Loading image…</p>}
 <button className="quiet" disabled={busy||!image} onClick={()=>{setZoom(1);setX(50);setY(50);}}>Reset crop</button>
 {error&&<p role="alert" className="panel-error">{error}</p>}
 <div className="crop-actions"><button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="primary" disabled={busy||!image} onClick={async()=>{
 setBusy(true);setError('');
 try{const blob=await new Promise<Blob>((resolve,reject)=>canvas.current!.toBlob(b=>b?resolve(b):reject(Error()),'image/webp',.82));await onSave(new File([blob],'cropped-image.webp',{type:'image/webp'}));}catch{setError('Could not save this crop. Please try again.');}finally{setBusy(false);}
 }}>{busy?'Saving…':'Use crop'}</button></div>
 </section></div>;
}
