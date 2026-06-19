import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
self.skipWaiting();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
self.addEventListener("push", event => {
  let data={}; try{data=event.data?.json()||{}}catch{data={body:event.data?.text()||""}}
  event.waitUntil(self.registration.showNotification(data.title||"MundiPorra",{body:data.body||"Tienes una nueva notificacion.",icon:"/icons/mundiporra-icon-192.png",badge:"/icons/mundiporra-icon-192.png",tag:data.tag||"mundiporra",data:{url:data.url?.startsWith("/")?data.url:"/"}}));
});
self.addEventListener("notificationclick",event=>{event.notification.close();const target=new URL(event.notification.data?.url||"/",self.location.origin).href;event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(windows=>{const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);return existing?existing.focus().then(()=>existing.navigate(target)):clients.openWindow(target)}))});
