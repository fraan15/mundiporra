import { useEffect, useRef, useState } from "react";
import { CornerUpLeft, MessageCircle, Send, X } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../App";

export function ChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [reply, setReply] = useState(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);
  const initialLoad = useRef(true);

  const load = async () => {
    const data = await api("/chat");
    setMessages(data);
    if (initialLoad.current) {
      initialLoad.current = false;
      await api("/chat/read", { method: "POST" });
      requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({ block: "end" });
        setTimeout(() => endRef.current?.scrollIntoView({ block: "end" }), 100);
      });
    }
  };
  useEffect(() => {
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api("/chat", { method: "POST", body: { message: text, reply_to_id: reply?.id || null } });
      setText("");
      setReply(null);
      await load();
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    } finally {
      setSending(false);
    }
  };

  return <div className="page chat-page">
    <section className="page-heading chat-heading">
      <span className="eyebrow"><MessageCircle size={14}/> VESTUARIO MUNDIALISTA</span>
      <h1>Chat de la porra</h1>
      <p>Comenta la jornada, celebra tus aciertos y responde a los demás jugadores.</p>
    </section>
    <section className="chat-card">
      <div className="chat-stream">
        {messages.length ? messages.map(message => <article className={`chat-message ${message.user_id === user.id ? "mine" : ""}`} key={message.id}>
          <span className="chat-avatar">{message.username[0].toUpperCase()}</span>
          <div className="chat-bubble">
            <header><strong>{message.username}</strong><time>{new Date(message.created_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</time></header>
            {message.reply_to_id && <blockquote><b>{message.reply_username}</b><span>{message.reply_message}</span></blockquote>}
            <p>{message.message}</p>
            <button onClick={() => setReply(message)}><CornerUpLeft size={14}/> Responder</button>
          </div>
        </article>) : <div className="chat-empty"><MessageCircle/><strong>Abre la conversación</strong><span>Sé la primera persona en dejar un mensaje.</span></div>}
        <div ref={endRef}/>
      </div>
      <form className="chat-composer" onSubmit={submit}>
        {reply && <div className="chat-replying"><div><span>Respondiendo a <strong>{reply.username}</strong></span><small>{reply.message}</small></div><button type="button" onClick={() => setReply(null)}><X size={16}/></button></div>}
        <div><textarea maxLength={500} rows={2} value={text} onChange={event => setText(event.target.value)} placeholder="Escribe algo para toda la porra..." onKeyDown={event => {
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); }
        }}/><button className="primary" disabled={!text.trim() || sending}><Send size={17}/><span>Enviar</span></button></div>
      </form>
    </section>
  </div>;
}
