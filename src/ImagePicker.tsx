import {ImageCropper} from './ImageCropper';
import {useEffect,useRef,useState} from 'react';
import {useAction,useMutation} from 'convex/react';
import {api} from '../convex/_generated/api';
import type {Id} from '../convex/_generated/dataModel';
import {LoaderCircle} from 'lucide-react';

type Choice={title:string;url:string;sourceUrl:string;previewUrl:string};
const cache=new Map<string,Promise<Choice[]>>();
export function ImagePicker({access,item,draftId,close}:{access:{slug:string;key:string};item:{id:string;label:string;imageUrl?:string|null};draftId?:Id<'aiDrafts'>;close:()=>void}){
 const search=useAction(api.imageChoices.search),apply=useMutation(api.imageSelection.apply),upload=useMutation(api.rooms.uploadUrl);
 const [choices,setChoices]=useState<Choice[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [crop,setCrop]=useState<Blob|string|null>(null);
 const [query,setQuery]=useState(item.label),[searching,setSearching]=useState(false);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const input=useRef<HTMLInputElement>(null),dialog=useRef<HTMLElement>(null);
 const args={...access,itemId:item.id,...(draftId?{draftId}:{})};
 useEffect(()=>{const old=document.activeElement as HTMLElement;dialog.current?.focus();return()=>old?.focus();},[]);
 const runSearch=async()=>{
  const term=query.trim();if(!term||searching||busy)return;
  setSearching(true);setError('');setChoices(null);
  const key=JSON.stringify([access.slug,access.key,item.id,item.label,draftId,term]);
  let request=cache.get(key);
  if(!request){request=search({...args,query:term});if(cache.size>=50)cache.delete(cache.keys().next().value!);cache.set(key,request);request.catch(()=>cache.delete(key));}
  try{const result=await request;if(!result.length)cache.delete(key);if(mounted.current)setChoices(result);}
  catch{if(mounted.current){setChoices([]);setError('Search unavailable. Try another query or upload an image.');}}
  finally{if(mounted.current)setSearching(false);}
 };

 return <div className="modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget&&!busy)close();}}><section className="library-modal image-choice-modal" role="dialog" aria-modal="true" aria-label={`Choose image for ${item.label}`} tabIndex={-1} ref={dialog} onKeyDown={e=>{
 if(e.key==='Escape'&&!busy)close();
 if(e.key==='Tab'){const nodes=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type=file])'));const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog.current)){e.preventDefault();first?.focus();}}
 }}>
 <div className="modal-top"><h2>{item.label}</h2><button className="icon-button" disabled={busy} aria-label="Close image picker" onClick={close}>×</button></div>
 {item.imageUrl && <button className="secondary" onClick={()=>setCrop(item.imageUrl!)}>Crop current image</button>}
 <form className="web-image-search" onSubmit={e=>{e.preventDefault();void runSearch();}}>
 <label htmlFor="web-image-query">Web search</label>
 <div><input id="web-image-query" value={query} maxLength={300} disabled={busy} onChange={e=>setQuery(e.target.value)} placeholder="Search for an image" autoComplete="off"/><button className="secondary" disabled={busy||searching||!query.trim()} type="submit">Search</button></div>
 </form>
 {searching?<p role="status" className="image-search-loading"><LoaderCircle aria-hidden="true" className="image-search-spinner" size={18}/>Searching images…</p>:<div className="image-choices">{choices?.map(c=><button key={c.url} disabled={busy} aria-label={`Use ${c.title}`} onClick={()=>setCrop(c.previewUrl)}><img src={c.previewUrl} alt={c.title} referrerPolicy="no-referrer"/><span>{new URL(c.sourceUrl).hostname}</span></button>)}</div>}
 {choices?.length===0&&!error&&<p>No images found.</p>}
 {error&&<p role="alert" className="panel-error">{error}</p>}
 <button className="secondary add-button" disabled={busy} onClick={()=>input.current?.click()}>{busy?'Saving…':'Upload image'}</button>
 <input ref={input} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>8*1024*1024){setError('Choose an image under 8 MB.');return;}setCrop(file);}}/>
 {crop && <ImageCropper source={crop} onCancel={()=>setCrop(null)} onSave={async file=>{
 const r=await fetch(await upload(access),{method:'POST',headers:{'Content-Type':file.type},body:file,signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('Upload failed');
 const {storageId}=await r.json();await apply({...args,expectedLabel:item.label,imageId:storageId});close();
 }}/>}
 </section></div>;
}
