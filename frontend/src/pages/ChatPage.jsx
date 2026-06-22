import { useEffect, useRef, useState } from "react";
import { CornerUpLeft, ImagePlus, MessageCircle, Plus, Send, Smile, Trash2, X } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../App";
import { Avatar } from "../components/Avatar";
import { startVisiblePolling } from "../utils/visiblePolling";

const mentionParts = (text) => text.split(/(@[\p{L}\p{N}_.-]+)/gu).map((part, index) => part.startsWith("@") ? <mark key={index}>{part}</mark> : part);

const optimizeImageForUpload = async (file, allowHeicConversion = true) => {
  let source, objectUrl;
  try {
    if (typeof createImageBitmap === "function") source = await createImageBitmap(file, { imageOrientation: "from-image" });
    else throw new Error("createImageBitmap no disponible");
  } catch {
    objectUrl = URL.createObjectURL(file);
    try {
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = objectUrl;
      });
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      const heic = /\.(heic|heif)$/i.test(file.name || "") || /image\/hei[cf]/i.test(file.type || "");
      if (!allowHeicConversion || !heic) throw error;
      const { default: convertHeic } = await import("heic2any");
      const converted = await convertHeic({ blob: file, toType: "image/jpeg", quality: 0.86 });
      const jpeg = Array.isArray(converted) ? converted[0] : converted;
      return optimizeImageForUpload(jpeg, false);
    }
  }
  try {
    const width = source.width || source.naturalWidth, height = source.height || source.naturalHeight;
    const scale = Math.min(1, 2400 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("No se pudo convertir la imagen.")), "image/jpeg", 0.86));
    return blob;
  } finally {
    source?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
};

const sendChatImage = async (file, contentType) => {
  const chunkSize = 600 * 1024;
  if (file.size <= chunkSize) return fetch(new URL("/api/chat/image", window.location.origin).href, { method: "PUT", credentials: "include", headers: { "Content-Type": contentType }, body: file });
  const uploadId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const total = Math.ceil(file.size / chunkSize);
  let response;
  for (let index = 0; index < total; index += 1) {
    response = await fetch(new URL("/api/chat/image-chunk", window.location.origin).href, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/octet-stream", "X-Upload-Id": uploadId, "X-Chunk-Index": String(index), "X-Chunk-Total": String(total), "X-File-Type": contentType },
      body: file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize))
    });
    if (!response.ok) return response;
  }
  return response;
};

export function ChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]), [text, setText] = useState(""), [reply, setReply] = useState(null), [sending, setSending] = useState(false);
  const [media, setMedia] = useState(null), [viewer, setViewer] = useState(null), [mentions, setMentions] = useState([]);
  const [swipe, setSwipe] = useState({ id: null, offset: 0 });
  const [highlightedId, setHighlightedId] = useState(null);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false), [gifQuery, setGifQuery] = useState(""), [gifType, setGifType] = useState("gif"), [gifItems, setGifItems] = useState([]), [gifError, setGifError] = useState(""), [gifLoading, setGifLoading] = useState(false);
  const streamRef = useRef(null), initialLoad = useRef(true), scrollRequest = useRef("initial"), fileRef = useRef(null), touch = useRef(null);
  const scrollToLatest = (behavior = "auto", includePage = false) => requestAnimationFrame(() => requestAnimationFrame(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior });
    if (includePage) window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
  }));
  const load = async () => { const data = await api("/chat"); setMessages(data); if (initialLoad.current) { initialLoad.current = false; if (!user.is_read_only) await api("/chat/read", { method: "POST" }); } };
  useEffect(() => startVisiblePolling(load, 10000), []);
  useEffect(() => { if (fileRef.current) fileRef.current.accept = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"; }, []);
  useEffect(() => {
    if (!messages.length || scrollRequest.current === "none") return;
    const mode = scrollRequest.current, behavior = mode === "smooth" ? "smooth" : "auto";
    scrollToLatest(behavior, mode === "initial");
    const timers = mode === "initial" ? [120, 400, 900].map(delay => setTimeout(() => scrollToLatest("auto", true), delay)) : [];
    const done = setTimeout(() => { scrollRequest.current = "none"; }, mode === "initial" ? 1100 : 250);
    return () => { timers.forEach(clearTimeout); clearTimeout(done); };
  }, [messages.at(-1)?.id]);

  const currentMention = () => text.slice(0, document.activeElement?.selectionStart ?? text.length).match(/(?:^|\s)@([^\s@]{2,})$/)?.[1];
  useEffect(() => { const query = currentMention(); if (!query) { setMentions([]); return; } const timer = setTimeout(() => api(`/chat/mentions?q=${encodeURIComponent(query)}`).then(setMentions).catch(() => setMentions([])), 180); return () => clearTimeout(timer); }, [text]);
  const chooseMention = (item) => { setText((value) => value.replace(/(?:^|\s)@([^\s@]*)$/, (match) => `${match.startsWith(" ") ? " " : ""}@${item.display_name.replace(/\s+/g, "_")} `)); setMentions([]); };
  const discardMedia = async (item = media) => { if (item?.type === "image" && item?.id) await api(`/chat/image/${encodeURIComponent(item.id)}`, { method: "DELETE" }).catch(() => {}); if (item === media) setMedia(null); };
  const searchGiphy = async (event) => { event.preventDefault(); if (gifQuery.trim().length < 2) return; setGifLoading(true); setGifError(""); try { const result = await api(`/giphy/search?q=${encodeURIComponent(gifQuery.trim())}&type=${gifType}`); setGifItems(result.items); } catch (error) { setGifError(error.message); } finally { setGifLoading(false); } };
  const uploadImage = async (event) => {
    const input = event.currentTarget, file = input.files?.[0];
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase(), inferredType = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" })[extension];
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"], originalType = allowedTypes.includes(file.type?.toLowerCase()) ? file.type.toLowerCase() : inferredType;
    if (!originalType) { input.value = ""; alert("Este formato de imagen no es compatible."); return; }
    setSending(true);
    try {
      let uploadFile = file, contentType = originalType;
      try { uploadFile = await optimizeImageForUpload(file); contentType = "image/jpeg"; } catch { /* El servidor conserva soporte HEIC como respaldo. */ }
      const response = await sendChatImage(uploadFile, contentType);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `No se pudo procesar la imagen (HTTP ${response.status}).`);
      await discardMedia(media);
      setMedia(data);
    } catch (error) { alert(error.message || "No se pudo subir la imagen."); }
    finally { input.value = ""; setSending(false); }
  };
  const submit = async (event) => { event.preventDefault(); if ((!text.trim() && !media) || sending) return; setSending(true); try { await api("/chat", { method: "POST", body: { message: text, reply_to_id: reply?.id || null, media } }); setText(""); setReply(null); setMedia(null); setGifOpen(false); setAttachmentOpen(false); scrollRequest.current = "smooth"; await load(); } finally { setSending(false); } };
  const removeMessage = async (message) => { if (!window.confirm("¿Estás seguro de que deseas borrar el mensaje?")) return; await api(`/chat/${message.id}`, { method: "DELETE" }); if (reply?.id === message.id) setReply(null); await load(); };
  const startSwipe = (event, message) => { touch.current = { id: message.id, x: event.touches[0].clientX, y: event.touches[0].clientY, message, horizontal: null }; setSwipe({ id: message.id, offset: 0 }); };
  const moveSwipe = (event) => { if (!touch.current) return; const point = event.touches[0], dx = point.clientX - touch.current.x, dy = point.clientY - touch.current.y; if (touch.current.horizontal === null && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) touch.current.horizontal = dx > 0 && Math.abs(dx) > Math.abs(dy); if (!touch.current.horizontal) return; const distance = Math.max(0, dx), offset = 84 * (1 - Math.exp(-distance / 72)); setSwipe({ id: touch.current.id, offset }); };
  const endSwipe = (event) => { if (!touch.current) return; const point = event.changedTouches[0], dx = point.clientX - touch.current.x, dy = point.clientY - touch.current.y; if (dx > 65 && Math.abs(dy) < 45) setReply(touch.current.message); touch.current = null; setSwipe({ id: null, offset: 0 }); };
  const goToMessage = async (id) => { try { let target = document.getElementById(`chat-message-${id}`); if (!target) { setMessages(await api(`/chat?around=${id}`)); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))); target = document.getElementById(`chat-message-${id}`); } setHighlightedId(id); target?.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => setHighlightedId((value) => value === id ? null : value), 1800); } catch (error) { alert(error.message); } };

  return <div className="page chat-page"><section className="page-heading chat-heading"><span className="eyebrow"><MessageCircle size={14}/> VESTUARIO MUNDIALISTA</span><h1>Chat de la porra</h1><p>Comenta la jornada, celebra tus aciertos y responde a los demás jugadores.</p></section><section className="chat-card">
    <div className="chat-stream" ref={streamRef}>{messages.length ? messages.map(message => <article id={`chat-message-${message.id}`} className={`chat-message ${message.user_id === user.id ? "mine" : ""} ${swipe.id === message.id ? "swiping" : ""} ${highlightedId === message.id ? "highlighted" : ""}`} style={{ transform: `translate3d(${swipe.id === message.id ? swipe.offset : 0}px,0,0)` }} key={message.id} onTouchStart={(event) => startSwipe(event, message)} onTouchMove={moveSwipe} onTouchEnd={endSwipe} onTouchCancel={() => { touch.current = null; setSwipe({ id: null, offset: 0 }); }}><span className="chat-swipe-reply"><CornerUpLeft size={17}/></span><Avatar user={message} className="chat-avatar"/><div className="chat-bubble"><header><strong>{message.username}</strong><time>{new Date(message.created_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</time></header>{message.reply_to_id && <blockquote role="button" tabIndex={0} onClick={() => goToMessage(message.reply_to_id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") goToMessage(message.reply_to_id); }}><b>{message.reply_username}</b>{message.reply_media_type && <img src={message.reply_media_preview_url || message.reply_media_url} alt="Contenido citado" loading="lazy"/>}<span>{message.reply_message || (message.reply_media_type === "image" ? "Imagen" : message.reply_media_type === "sticker" ? "Sticker" : "GIF")}</span></blockquote>}{message.message && <p>{mentionParts(message.message)}</p>}{message.media_type && <button type="button" className="chat-media-button" onClick={() => message.media_type === "image" && setViewer(message.media_url)}><img src={message.media_preview_url || message.media_url} alt={message.media_type === "sticker" ? "Sticker" : message.media_type === "gif" ? "GIF" : "Imagen enviada"} loading="lazy"/></button>} {!user.is_read_only && <div className="chat-message-actions"><button type="button" onClick={() => setReply(message)}><CornerUpLeft size={14}/> Responder</button>{(message.user_id === user.id || user.role === "admin") && <button type="button" className="delete" onClick={() => removeMessage(message)}><Trash2 size={14}/> Borrar</button>}</div>}</div></article>) : <div className="chat-empty"><MessageCircle/><strong>Abre la conversación</strong><span>Sé la primera persona en dejar un mensaje.</span></div>}</div>
    {!user.is_read_only && <form className="chat-composer" onSubmit={submit}>{reply && <div className="chat-replying"><div><span>Respondiendo a <strong>{reply.username}</strong></span><small>{reply.message || "Contenido multimedia"}</small></div><button type="button" onClick={() => setReply(null)}><X size={16}/></button></div>}{media && <div className="chat-selected-media"><img src={media.preview_url || media.url} alt="Archivo seleccionado"/><button type="button" onClick={() => discardMedia()}><X size={15}/></button></div>}{mentions.length > 0 && <div className="chat-mentions">{mentions.map(item => <button type="button" key={item.id} onClick={() => chooseMention(item)}><Avatar user={{ ...item, username: item.display_name }}/><span><strong>{item.display_name}</strong><small>@{item.username}</small></span></button>)}</div>}{gifOpen && <div className="chat-gif-picker"><div><button type="button" className={gifType === "gif" ? "active" : ""} onClick={() => setGifType("gif")}>GIF</button><button type="button" className={gifType === "sticker" ? "active" : ""} onClick={() => setGifType("sticker")}>Stickers</button><button type="button" className="chat-gif-close" onClick={() => setGifOpen(false)} aria-label="Cerrar selector"><X size={17}/></button></div><div className="chat-gif-search"><input value={gifQuery} onChange={event => setGifQuery(event.target.value)} placeholder="Buscar…"/><button type="button" onClick={searchGiphy} disabled={gifLoading}>{gifLoading ? "…" : "Buscar"}</button></div>{gifError && <small>{gifError}</small>}<div className="chat-gif-results">{gifItems.map(item => <button type="button" key={item.id} onClick={async () => { await discardMedia(media); setMedia(item); setGifOpen(false); }}><img src={item.preview_url || item.url} alt={item.title || item.type}/></button>)}</div></div>}<div className="chat-compose-row"><div className="chat-attachment-control"><button type="button" className={`chat-add-trigger ${attachmentOpen ? "active" : ""}`} onClick={() => setAttachmentOpen(value => !value)} aria-label="Añadir contenido" aria-expanded={attachmentOpen}><Plus size={22}/></button>{attachmentOpen && <div className="chat-attachment-menu"><button type="button" onClick={() => { setAttachmentOpen(false); fileRef.current?.click(); }}><ImagePlus size={17}/><span>Foto</span></button><button type="button" onClick={() => { setAttachmentOpen(false); setGifOpen(true); }}><Smile size={17}/><span>GIF / sticker</span></button></div>}<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={uploadImage}/></div><textarea maxLength={500} rows={1} value={text} onChange={event => setText(event.target.value)} placeholder="Escribe algo para toda la porra..." onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }}/><button className="primary chat-send-button" disabled={(!text.trim() && !media) || sending} aria-label="Enviar mensaje"><Send size={17}/></button></div></form>}
  </section>{viewer && <div className="chat-image-viewer" role="dialog" onClick={() => setViewer(null)}><button aria-label="Cerrar"><X/></button><img src={viewer} alt="Imagen ampliada"/></div>}</div>;
}
