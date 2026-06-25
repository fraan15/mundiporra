import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, CornerUpLeft, ImagePlus, MessageCircle, Plus, Send, Smile, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]), [text, setText] = useState(""), [reply, setReply] = useState(null), [sending, setSending] = useState(false);
  const [media, setMedia] = useState(null), [viewer, setViewer] = useState(null), [mentions, setMentions] = useState([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [swipe, setSwipe] = useState({ id: null, offset: 0, ready: false });
  const [highlightedId, setHighlightedId] = useState(null);
  const [chatReady, setChatReady] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [gifOpen, setGifOpen] = useState(false), [gifQuery, setGifQuery] = useState(""), [gifType, setGifType] = useState("gif"), [gifItems, setGifItems] = useState([]), [gifError, setGifError] = useState(""), [gifLoading, setGifLoading] = useState(false);
  const streamRef = useRef(null), endRef = useRef(null), composerRef = useRef(null), textareaRef = useRef(null), fileRef = useRef(null);
  const initialLoad = useRef(true), scrollRequest = useRef("initial"), stickToBottom = useRef(true), initialScrollTimers = useRef([]), pointer = useRef(null), mentionRange = useRef(null);

  const isNearBottom = () => {
    const stream = streamRef.current;
    return !stream || stream.scrollHeight - stream.scrollTop - stream.clientHeight < 90;
  };
  const clearInitialScrollTimers = () => {
    initialScrollTimers.current.forEach((timer) => clearTimeout(timer));
    initialScrollTimers.current = [];
  };
  const applyBottomScroll = (behavior = "auto") => {
    const stream = streamRef.current;
    if (!stream) return;
    const top = Math.max(0, stream.scrollHeight - stream.clientHeight);
    if (behavior === "smooth") stream.scrollTo({ top, behavior: "smooth" });
    else stream.scrollTop = top;
    stickToBottom.current = true;
  };
  const scrollToLatest = (behavior = "auto") => {
    const applyScroll = () => {
      applyBottomScroll(behavior);
    };
    requestAnimationFrame(() => requestAnimationFrame(applyScroll));
  };
  const forceInitialScrollToLatest = () => {
    clearInitialScrollTimers();
    stickToBottom.current = true;
    scrollRequest.current = "initial";
    [0, 70, 160, 320, 620, 900].forEach((delay) => {
      const timer = setTimeout(() => {
        requestAnimationFrame(() => {
          applyBottomScroll("auto");
          if (delay === 900) {
            scrollRequest.current = "none";
            stickToBottom.current = isNearBottom();
            setChatReady(true);
          }
        });
      }, delay);
      initialScrollTimers.current.push(timer);
    });
  };
  const keepBottomIfNeeded = () => { if (scrollRequest.current !== "none" || stickToBottom.current || isNearBottom()) scrollToLatest("auto"); };
  const load = async () => {
    const wasInitial = initialLoad.current, shouldStick = wasInitial || scrollRequest.current !== "none" || stickToBottom.current || isNearBottom();
    const data = await api("/chat");
    if (shouldStick && scrollRequest.current === "none") scrollRequest.current = wasInitial ? "initial" : "auto";
    setMessages(data);
    if (wasInitial) {
      initialLoad.current = false;
      if (!data.length) setChatReady(true);
      if (!user.is_read_only) await api("/chat/read", { method: "POST" });
    }
  };

  useEffect(() => startVisiblePolling(load, 10000), []);
  useEffect(() => { if (fileRef.current) fileRef.current.accept = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"; }, []);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }, [text]);
  useLayoutEffect(() => {
    if (!messages.length || scrollRequest.current === "none") return;
    if (scrollRequest.current === "initial") {
      forceInitialScrollToLatest();
      return () => clearInitialScrollTimers();
    }
    scrollToLatest(scrollRequest.current === "smooth" ? "smooth" : "auto");
    const done = setTimeout(() => { scrollRequest.current = "none"; stickToBottom.current = isNearBottom(); }, scrollRequest.current === "smooth" ? 520 : 700);
    return () => clearTimeout(done);
  }, [messages.at(-1)?.id]);
  useEffect(() => () => clearInitialScrollTimers(), []);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (scrollRequest.current !== "none" || stickToBottom.current) scrollToLatest("auto");
    });
    if (streamRef.current) observer.observe(streamRef.current);
    if (composerRef.current) observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const updateStickiness = () => { stickToBottom.current = isNearBottom(); };
    stream.addEventListener("scroll", updateStickiness, { passive: true });
    updateStickiness();
    return () => stream.removeEventListener("scroll", updateStickiness);
  }, []);

  const getMentionMatch = () => {
    const input = textareaRef.current;
    const cursor = input?.selectionStart ?? text.length;
    const before = text.slice(0, cursor);
    const match = before.match(/(?:^|\s)@([\p{L}\p{N}_.-]{2,})$/u);
    if (!match) return null;
    const token = match[0], prefix = token.startsWith(" ") ? 1 : 0;
    return { query: match[1], start: cursor - token.length + prefix, end: cursor };
  };
  useEffect(() => {
    const match = getMentionMatch();
    mentionRange.current = match;
    setMentionIndex(0);
    if (!match) { setMentions([]); return; }
    const timer = setTimeout(() => api(`/chat/mentions?q=${encodeURIComponent(match.query)}`).then(setMentions).catch(() => setMentions([])), 180);
    return () => clearTimeout(timer);
  }, [text]);
  const chooseMention = (item) => {
    const input = textareaRef.current, range = mentionRange.current || getMentionMatch();
    if (!range) return;
    const mention = `@${item.display_name.replace(/\s+/g, "_")} `;
    const nextText = `${text.slice(0, range.start)}${mention}${text.slice(range.end)}`;
    const cursor = range.start + mention.length;
    setText(nextText);
    setMentions([]);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(cursor, cursor);
    });
  };
  const handleTextKeyDown = (event) => {
    if (mentions.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(index => (index + (event.key === "ArrowDown" ? 1 : -1) + mentions.length) % mentions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        chooseMention(mentions[mentionIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentions([]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form.requestSubmit();
    }
  };

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
      setAttachmentOpen(false);
    } catch (error) { alert(error.message || "No se pudo subir la imagen."); }
    finally { input.value = ""; setSending(false); }
  };
  const submit = async (event) => {
    event.preventDefault();
    if ((!text.trim() && !media) || sending) return;
    setSending(true);
    try {
      await api("/chat", { method: "POST", body: { message: text, reply_to_id: reply?.id || null, media } });
      setText("");
      setReply(null);
      setMedia(null);
      setGifOpen(false);
      setAttachmentOpen(false);
      scrollRequest.current = "smooth";
      await load();
    } finally { setSending(false); }
  };
  const removeMessage = async (message) => { if (!window.confirm("Estas seguro de que deseas borrar el mensaje?")) return; await api(`/chat/${message.id}`, { method: "DELETE" }); if (reply?.id === message.id) setReply(null); await load(); };
  const startSwipe = (event, message) => {
    if (event.pointerType === "mouse") return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, message, horizontal: null, ready: false };
  };
  const moveSwipe = (event) => {
    const state = pointer.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x, dy = event.clientY - state.y;
    const absDx = Math.abs(dx), absDy = Math.abs(dy);
    if (state.horizontal === null) {
      if (absDy > 10 && absDy > absDx) {
        state.horizontal = false;
        return;
      }
      if (absDx <= 20 || absDx <= absDy * 1.65) return;
      state.horizontal = dx > 0;
    }
    if (!state.horizontal) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    const distance = Math.max(0, dx), offset = Math.min(92, 92 * (1 - Math.exp(-distance / 76)));
    state.ready = distance > 82;
    setSwipe({ id: state.message.id, offset: distance > 16 ? offset : 0, ready: state.ready });
  };
  const endSwipe = (event) => {
    const state = pointer.current;
    if (!state || state.id !== event.pointerId) return;
    if (state.ready) setReply(state.message);
    pointer.current = null;
    setSwipe({ id: null, offset: 0, ready: false });
  };
  const goToMessage = async (id) => {
    try {
      let target = document.getElementById(`chat-message-${id}`);
      if (!target) {
        setMessages(await api(`/chat?around=${id}`));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        target = document.getElementById(`chat-message-${id}`);
      }
      setHighlightedId(id);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightedId((value) => value === id ? null : value), 1800);
    } catch (error) { alert(error.message); }
  };

  const renderReplyPreview = (message) => {
    if (message.reply_deleted) return <blockquote className="deleted-reply"><span>El mensaje citado ha sido eliminado</span></blockquote>;
    if (!message.reply_to_id) return null;
    return <blockquote role="button" tabIndex={0} onClick={() => goToMessage(message.reply_to_id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") goToMessage(message.reply_to_id); }}>
      <b>{message.reply_username}</b>
      {message.reply_media_type && <img src={message.reply_media_preview_url || message.reply_media_url} alt="Contenido citado" loading="lazy" onLoad={keepBottomIfNeeded}/>}
      <span>{message.reply_message || (message.reply_media_type === "image" ? "Imagen" : message.reply_media_type === "sticker" ? "Sticker" : "GIF")}</span>
    </blockquote>;
  };

  const renderMessage = (message) => {
    const activeSwipe = swipe.id === message.id;
    return <article
      id={`chat-message-${message.id}`}
      className={`chat-message ${message.user_id === user.id ? "mine" : ""} ${activeSwipe ? "swiping" : ""} ${activeSwipe && swipe.ready ? "reply-ready" : ""} ${highlightedId === message.id ? "highlighted" : ""}`}
      style={{ transform: `translate3d(${activeSwipe ? swipe.offset : 0}px,0,0)` }}
      key={message.id}
      onPointerDown={(event) => startSwipe(event, message)}
      onPointerMove={moveSwipe}
      onPointerUp={endSwipe}
      onPointerCancel={() => { pointer.current = null; setSwipe({ id: null, offset: 0, ready: false }); }}
    >
      <span className="chat-swipe-reply"><CornerUpLeft size={17}/></span>
      <Avatar user={message} className="chat-avatar"/>
      <div className="chat-bubble">
        <header><strong>{message.username}</strong><time>{new Date(message.created_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</time></header>
        {renderReplyPreview(message)}
        {message.message && <p>{mentionParts(message.message)}</p>}
        {message.media_type && <button type="button" className="chat-media-button" onClick={() => message.media_type === "image" && setViewer(message.media_url)}>
          <img src={message.media_preview_url || message.media_url} alt={message.media_type === "sticker" ? "Sticker" : message.media_type === "gif" ? "GIF" : "Imagen enviada"} loading="lazy" onLoad={keepBottomIfNeeded}/>
        </button>}
        {!user.is_read_only && <div className="chat-message-actions">
          <button type="button" onClick={() => setReply(message)}><CornerUpLeft size={14}/> Responder</button>
          {(message.user_id === user.id || user.role === "admin") && <button type="button" className="delete" onClick={() => removeMessage(message)}><Trash2 size={14}/> Borrar</button>}
        </div>}
      </div>
    </article>;
  };

  return <div className="page chat-page">
    <section className={`chat-shell ${chatReady ? "" : "chat-initializing"}`} aria-label="Chat de la porra" aria-busy={!chatReady}>
      <div className="chat-mini-bar">
        <button type="button" className="chat-back-button" onClick={() => navigate("/")} aria-label="Volver al inicio" title="Volver al inicio">
          <ArrowLeft size={18}/>
          <span>Volver</span>
        </button>
      </div>
      {!chatReady && <div className="chat-loading-screen" role="status" aria-live="polite">
        <MessageCircle/>
        <span>Cargando chat...</span>
      </div>}

      <div className="chat-stream" ref={streamRef}>
        {messages.length ? messages.map(renderMessage) : <div className="chat-empty"><MessageCircle/><strong>Abre la conversacion</strong><span>Se la primera persona en dejar un mensaje.</span></div>}
        <div className="chat-end" ref={endRef} aria-hidden="true"/>
      </div>

      {!user.is_read_only && <form className="chat-composer" ref={composerRef} onSubmit={submit}>
        {reply && <div className="chat-replying"><div><span>Respondiendo a <strong>{reply.username}</strong></span><small>{reply.message || "Contenido multimedia"}</small></div><button type="button" onClick={() => setReply(null)} aria-label="Cancelar respuesta"><X size={16}/></button></div>}
        {media && <div className="chat-selected-media"><img src={media.preview_url || media.url} alt="Archivo seleccionado"/><button type="button" onClick={() => discardMedia()} aria-label="Quitar archivo"><X size={15}/></button></div>}
        {mentions.length > 0 && <div className="chat-mentions" role="listbox">
          {mentions.map((item, index) => <button type="button" role="option" aria-selected={index === mentionIndex} className={index === mentionIndex ? "active" : ""} key={item.id} onMouseEnter={() => setMentionIndex(index)} onClick={() => chooseMention(item)}>
            <Avatar user={{ ...item, username: item.display_name }}/>
            <span><strong>{item.display_name}</strong><small>@{item.username}</small></span>
          </button>)}
        </div>}
        {gifOpen && <div className="chat-gif-picker">
          <div className="chat-gif-tabs"><button type="button" className={gifType === "gif" ? "active" : ""} onClick={() => setGifType("gif")}>GIF</button><button type="button" className={gifType === "sticker" ? "active" : ""} onClick={() => setGifType("sticker")}>Stickers</button><button type="button" className="chat-gif-close" onClick={() => setGifOpen(false)} aria-label="Cerrar selector"><X size={17}/></button></div>
          <div className="chat-gif-search"><input value={gifQuery} onChange={event => setGifQuery(event.target.value)} placeholder="Buscar..."/><button type="button" onClick={searchGiphy} disabled={gifLoading}>{gifLoading ? "..." : "Buscar"}</button></div>
          {gifError && <small className="chat-gif-error">{gifError}</small>}
          <div className="chat-gif-results">{gifItems.map(item => <button type="button" key={item.id} onClick={async () => { await discardMedia(media); setMedia(item); setGifOpen(false); }}><img src={item.preview_url || item.url} alt={item.title || item.type}/></button>)}</div>
        </div>}
        <div className="chat-compose-row">
          <div className="chat-attachment-control">
            <button type="button" className={`chat-add-trigger ${attachmentOpen ? "active" : ""}`} onClick={() => setAttachmentOpen(value => !value)} aria-label="Anadir contenido" aria-expanded={attachmentOpen}><Plus size={22}/></button>
            {attachmentOpen && <div className="chat-attachment-menu"><button type="button" onClick={() => { setAttachmentOpen(false); fileRef.current?.click(); }}><ImagePlus size={17}/><span>Foto</span></button><button type="button" onClick={() => { setAttachmentOpen(false); setGifOpen(true); }}><Smile size={17}/><span>GIF / sticker</span></button></div>}
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={uploadImage}/>
          </div>
          <textarea ref={textareaRef} maxLength={500} rows={1} value={text} onFocus={() => setAttachmentOpen(false)} onChange={event => { setAttachmentOpen(false); setText(event.target.value); }} placeholder="Escribe algo para toda la porra..." onKeyDown={handleTextKeyDown}/>
          <button className="primary chat-send-button" disabled={(!text.trim() && !media) || sending} aria-label="Enviar mensaje"><Send size={17}/></button>
        </div>
      </form>}
    </section>
    {viewer && <div className="chat-image-viewer" role="dialog" onClick={() => setViewer(null)}><button aria-label="Cerrar"><X/></button><img src={viewer} alt="Imagen ampliada"/></div>}
  </div>;
}
