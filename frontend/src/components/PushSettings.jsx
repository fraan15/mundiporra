import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { api } from "../api/client";
import { pushSupported, repairPushSubscription } from "../utils/pushSubscription";

const decodeKey=value=>{const padding="=".repeat((4-value.length%4)%4),raw=atob((value+padding).replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))};
export function PushSettings(){
  const supported=pushSupported();
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent),standalone=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
  const [server,setServer]=useState(null),[subscription,setSubscription]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const refresh=async()=>{let status=await api("/push/status");if(supported){const synced=await repairPushSubscription(status);setSubscription(synced.subscription||await(await navigator.serviceWorker.ready).pushManager.getSubscription());if(synced.repaired)status=await api("/push/status")}setServer(status)};
  useEffect(()=>{refresh().catch(error=>setMessage(error.message))},[]);
  const enable=async()=>{setBusy(true);setMessage("");try{if(Notification.permission==="denied")throw new Error("El permiso esta bloqueado. Activalo desde los ajustes del sistema.");if(await Notification.requestPermission()!=="granted")throw new Error("No se concedio el permiso para mostrar notificaciones.");const registration=await navigator.serviceWorker.ready,created=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(server.public_key)});await api("/push/subscribe",{method:"POST",body:{subscription:created.toJSON()}});setSubscription(created);setMessage("Notificaciones activadas en este dispositivo.");await refresh()}catch(error){setMessage(error.message)}finally{setBusy(false)}};
  const disable=async()=>{setBusy(true);setMessage("");try{const endpoint=subscription?.endpoint;if(subscription)await subscription.unsubscribe();if(endpoint)await api("/push/unsubscribe",{method:"DELETE",body:{endpoint}});setSubscription(null);setMessage("Notificaciones desactivadas en este dispositivo.");await refresh()}catch(error){setMessage(error.message)}finally{setBusy(false)}};
  const updatePreference=async(key,checked)=>{const preferences=await api("/push/preferences",{method:"PATCH",body:{[key]:checked}});setServer(current=>({...current,preferences}))};
  if(!server)return <section className="content-card push-settings"><h2>Notificaciones push</h2><p>Comprobando disponibilidad...</p></section>;
  const statusText=subscription?"Activadas en este dispositivo":server.configured?"Desactivadas en este dispositivo":"Configuracion pendiente";
  return <section className="content-card push-settings"><div className="push-settings-head"><span className="push-status-icon">{subscription?<Bell size={22}/>:<BellOff size={22}/>}</span><span className="push-settings-title"><strong>Notificaciones push</strong><small>{statusText}</small></span></div><div className="push-settings-body"><p>Recibe avisos aunque MundiPorra no este abierta.</p>
    {!server.configured&&<div className="alert error">El servidor aun no tiene configuradas las claves VAPID.</div>}{!supported&&<div className="alert error">Este navegador no admite notificaciones push web.</div>}
    {ios&&!standalone&&<div className="push-ios-help"><strong>En iPhone o iPad</strong><p>Abre esta web en Safari, pulsa Compartir, elige "Anadir a pantalla de inicio" y abre MundiPorra desde el nuevo icono.</p></div>}
    {supported&&server.configured&&!(ios&&!standalone)&&<button className={subscription?"secondary":"primary"} disabled={busy} onClick={subscription?disable:enable}>{subscription?"Desactivar en este dispositivo":"Activar en este dispositivo"}</button>}
    {supported&&Notification.permission==="denied"&&<small className="error-text">Has bloqueado el permiso. Debes habilitarlo en los ajustes del sistema.</small>}{message&&<small className={message.includes("activadas")?"success-text":"error-text"}>{message}</small>}
    <fieldset disabled={!supported||!server.configured} className="push-preferences"><legend>Quiero recibir</legend>{[["match_updates","Partidos y recordatorios"],["points","Puntos y ajustes obtenidos"],["ranking","Cambios importantes de clasificacion"],["social","Comentarios y actividad social"]].map(([key,label])=><label key={key}><input type="checkbox" checked={Boolean(server.preferences[key])} onChange={event=>updatePreference(key,event.target.checked)}/><span>{label}</span></label>)}</fieldset><small>La activacion se aplica solamente a este navegador y dispositivo.</small></div>
  </section>}

export function PushSettingsPage(){return <div className="page"><section className="page-heading"><span className="eyebrow">PREFERENCIAS</span><h1>Notificaciones</h1><p>Configura los avisos push de este dispositivo.</p></section><PushSettings/></div>}
