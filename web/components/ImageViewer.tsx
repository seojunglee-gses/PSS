import {useCallback, useEffect, useRef, useState} from 'react';
import type {PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import {useI18n} from '../lib/i18n';

type View = {zoom:number; x:number; y:number};
type Point = {x:number; y:number};
const fit:View = {zoom:1,x:0,y:0};
const distance = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.y-b.y);
const midpoint = (a:Point,b:Point) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});

export default function ImageViewer({src,alt,onClose}:{src:string;alt:string;onClose:()=>void}) {
 const {t}=useI18n();
 const dialog=useRef<HTMLDialogElement>(null),stage=useRef<HTMLDivElement>(null),image=useRef<HTMLImageElement>(null);
 const [view,setView]=useState<View>(fit),viewRef=useRef<View>(fit);
 const pointers=useRef(new Map<number,Point>());
 const gesture=useRef<{view:View; center:Point; distance:number}|null>(null);
 const apply=useCallback((next:View)=>{
  const node=stage.current,img=image.current;
  if(!node||!img)return;
  const zoom=Math.max(1,Math.min(5,next.zoom));
  // Clamp against the contained image, including any letterboxing in the stage.
  const aspect=img.naturalWidth && img.naturalHeight ? img.naturalWidth/img.naturalHeight : node.clientWidth/Math.max(1,node.clientHeight);
  const width=Math.min(node.clientWidth,node.clientHeight*aspect),height=width/aspect;
  const maxX=Math.max(0,(width*zoom-node.clientWidth)/2),maxY=Math.max(0,(height*zoom-node.clientHeight)/2);
  const value={zoom,x:Math.max(-maxX,Math.min(maxX,next.x)),y:Math.max(-maxY,Math.min(maxY,next.y))};
  viewRef.current=value;setView(value);
 },[]);
 const zoomAt=useCallback((zoom:number,point?:Point)=>{
  const bounds=stage.current?.getBoundingClientRect();if(!bounds)return;
  const previous=viewRef.current,next=Math.max(1,Math.min(5,zoom));
  const x=(point?.x??bounds.left+bounds.width/2)-bounds.left-bounds.width/2;
  const y=(point?.y??bounds.top+bounds.height/2)-bounds.top-bounds.height/2;
  apply({zoom:next,x:x-(x-previous.x)*next/previous.zoom,y:y-(y-previous.y)*next/previous.zoom});
 },[apply]);
 useEffect(()=>{
  const node=dialog.current,canvas=stage.current;if(!node||!canvas)return;
  const focused=document.activeElement as HTMLElement|null;
  const htmlOverflow=document.documentElement.style.overflow,bodyOverflow=document.body.style.overflow;
  document.documentElement.style.overflow='hidden';document.body.style.overflow='hidden';
  node.showModal();
  const wheel=(event:WheelEvent)=>{event.preventDefault();zoomAt(viewRef.current.zoom*Math.exp(-event.deltaY*.002),{x:event.clientX,y:event.clientY});};
  canvas.addEventListener('wheel',wheel,{passive:false});
  const resize=new ResizeObserver(()=>apply(viewRef.current));resize.observe(canvas);
  return()=>{
   resize.disconnect();canvas.removeEventListener('wheel',wheel);node.close();
   document.documentElement.style.overflow=htmlOverflow;document.body.style.overflow=bodyOverflow;
   if(focused?.isConnected)focused.focus({preventScroll:true});
  };
 },[apply,zoomAt]);
 const begin=()=>{
  const points=[...pointers.current.values()];
  gesture.current=points.length?{view:{...viewRef.current},center:points.length>1?midpoint(points[0],points[1]):points[0],distance:points.length>1?distance(points[0],points[1]):0}:null;
 };
 const end=(event:PointerEvent<HTMLDivElement>)=>{pointers.current.delete(event.pointerId);begin();};
 return createPortal(<dialog ref={dialog} className="image-viewer" aria-label={t('image.viewer')} aria-describedby="image-viewer-help" onCancel={event=>{event.preventDefault();onClose();}}>
  <div className="image-viewer-layout">
   <div className="image-viewer-toolbar">
    <button type="button" aria-label={t('image.zoomOut')} disabled={view.zoom<=1} onClick={()=>zoomAt(view.zoom/1.25)}>−</button>
    <span aria-live="polite" className="min-w-12 text-center tabular-nums">{Math.round(view.zoom*100)}%</span>
    <button type="button" aria-label={t('image.zoomIn')} disabled={view.zoom>=5} onClick={()=>zoomAt(view.zoom*1.25)}>+</button>
    <button type="button" onClick={()=>apply(fit)}>{t('image.resetZoom')}</button>
    <button type="button" className="image-viewer-close" onClick={onClose}>{t('image.closeViewer')} ×</button>
   </div>
   <p id="image-viewer-help" className="image-viewer-help">{t('image.viewerHelp')}</p>
   <div ref={stage} className="image-viewer-stage" onPointerDown={event=>{
    if(event.button!==0||pointers.current.size>=2)return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});begin();
   }} onPointerMove={event=>{
    if(!pointers.current.has(event.pointerId)||!gesture.current)return;
    pointers.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const points=[...pointers.current.values()],start=gesture.current;
    const center=points.length>1?midpoint(points[0],points[1]):points[0];
    const zoom=points.length>1&&start.distance>0?Math.max(1,Math.min(5,start.view.zoom*distance(points[0],points[1])/start.distance)):start.view.zoom;
    const bounds=event.currentTarget.getBoundingClientRect();
    // Keep the image point between the fingers anchored while pinch and pan combine.
    apply({zoom,x:center.x-bounds.left-bounds.width/2-(start.center.x-bounds.left-bounds.width/2-start.view.x)*zoom/start.view.zoom,y:center.y-bounds.top-bounds.height/2-(start.center.y-bounds.top-bounds.height/2-start.view.y)*zoom/start.view.zoom});
   }} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    <img ref={image} src={src} alt={alt} draggable={false} onLoad={()=>apply(viewRef.current)} style={{transform:`translate(${view.x}px, ${view.y}px) scale(${view.zoom})`}} />
   </div>
  </div>
 </dialog>,document.body);
}
