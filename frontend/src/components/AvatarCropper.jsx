import { useCallback, useEffect, useState } from "react";
import Cropper from "react-easy-crop";
import { Check, Minus, Plus, X } from "lucide-react";

const loadImage=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=src});
async function croppedBlob(src,pixels){
  const image=await loadImage(src),canvas=document.createElement("canvas"),size=400;
  canvas.width=size;canvas.height=size;
  canvas.getContext("2d").drawImage(image,pixels.x,pixels.y,pixels.width,pixels.height,0,0,size,size);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("No se pudo preparar el recorte.")),"image/jpeg",.9));
}
export function AvatarCropper({file,onCancel,onConfirm}){
  const [source,setSource]=useState(""),[crop,setCrop]=useState({x:0,y:0}),[zoom,setZoom]=useState(1),[pixels,setPixels]=useState(null),[saving,setSaving]=useState(false);
  useEffect(()=>{const url=URL.createObjectURL(file);setSource(url);return()=>URL.revokeObjectURL(url)},[file]);
  useEffect(()=>{const close=e=>{if(e.key==="Escape"&&!saving)onCancel()};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close)},[onCancel,saving]);
  const complete=useCallback((_,area)=>setPixels(area),[]);
  const save=async()=>{if(!pixels||saving)return;setSaving(true);try{await onConfirm(await croppedBlob(source,pixels))}finally{setSaving(false)}};
  return <div className="avatar-crop-overlay" role="dialog" aria-modal="true" aria-labelledby="avatar-crop-title" onMouseDown={e=>{if(e.target===e.currentTarget&&!saving)onCancel()}}><section className="avatar-crop-dialog">
    <header><div><span className="eyebrow">FOTO DE PERFIL</span><h2 id="avatar-crop-title">Ajusta el encuadre</h2></div><button type="button" className="avatar-crop-close" onClick={onCancel} disabled={saving} aria-label="Cancelar"><X/></button></header>
    <p>Arrastra la imagen y usa el zoom hasta que quede exactamente como quieres.</p>
    <div className="avatar-crop-stage">{source&&<Cropper image={source} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={complete}/>}</div>
    <div className="avatar-crop-zoom"><Minus size={17}/><input type="range" min="1" max="3" step="0.01" value={zoom} onChange={e=>setZoom(Number(e.target.value))} aria-label="Zoom de la imagen"/><Plus size={17}/></div>
    <footer><button type="button" className="avatar-crop-cancel" onClick={onCancel} disabled={saving}>Cancelar</button><button type="button" className="primary" onClick={save} disabled={!pixels||saving}><Check size={17}/>{saving?"Guardando...":"Guardar foto"}</button></footer>
  </section></div>
}
