import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

const FALLBACK_EMOJIS = ["😂", "🔥", "🤡", "👀", "😭", "👏"];
const emptyReactions = (emojis = FALLBACK_EMOJIS) => Object.fromEntries(
  emojis.map((emoji) => [emoji, { count: 0, reacted: false }]),
);

export function ReactionBar({ targetType, targetId, children, disabled = false, own = false, className = "" }) {
  const [emojis, setEmojis] = useState(FALLBACK_EMOJIS);
  const [reactions, setReactions] = useState(emptyReactions());
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const timerRef = useRef(null);
  const rootRef = useRef(null);
  const canReact = !disabled && !own;

  useEffect(() => {
    if (!targetId) return;
    let active = true;
    api(`/reactions?target_type=${encodeURIComponent(targetType)}&target_ids=${targetId}`)
      .then((data) => {
        if (!active) return;
        setEmojis(data.allowed_emojis || FALLBACK_EMOJIS);
        setReactions(data.reactions?.[`${targetType}:${targetId}`] || emptyReactions(data.allowed_emojis));
      })
      .catch((requestError) => active && setError(requestError.message));
    return () => { active = false; };
  }, [targetType, targetId]);

  useEffect(() => {
    if (!open && !viewing) return;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) { setOpen(false); setViewing(false); }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, viewing]);

  const cancelHold = () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const startHold = (event) => {
    if (open && !event.target.closest(".reaction-picker")) {
      cancelHold();
      setOpen(false);
      return;
    }
    if (viewing && !event.target.closest(".reaction-users,.reaction-counts")) setViewing(false);
    if (!canReact || event.button > 0) return;
    if (event.pointerType === "touch") event.preventDefault();
    cancelHold();
    setViewing(false);
    timerRef.current = setTimeout(() => {
      setOpen(true);
      navigator.vibrate?.(25);
    }, 500);
  };
  const select = async (emoji) => {
    if (!canReact || pending) return;
    setPending(true);
    setError("");
    try {
      const data = await api("/reactions/toggle", {
        method: "POST",
        body: { target_type: targetType, target_id: targetId, emoji },
      });
      setReactions(data.reactions);
      setOpen(false);
      setViewing(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending(false);
    }
  };
  const visible = emojis.filter((emoji) => reactions[emoji]?.count > 0);

  return <div
    ref={rootRef}
    className={`reaction-target ${canReact ? "can-react" : ""} ${className}`.trim()}
    onPointerDown={startHold}
    onPointerUp={cancelHold}
    onPointerCancel={cancelHold}
    onPointerLeave={cancelHold}
    onContextMenu={(event) => { if (canReact) { event.preventDefault(); cancelHold(); setOpen(true); } }}
  >
    {children}
    {open && <div className="reaction-picker" role="menu" aria-label="Elige una reacción">
      {emojis.map((emoji) => <button
        type="button"
        role="menuitem"
        key={emoji}
        className={reactions[emoji]?.reacted ? "active" : ""}
        disabled={pending}
        aria-label={`Reaccionar con ${emoji}`}
        onClick={() => select(emoji)}
      >{emoji}</button>)}
    </div>}
    {viewing && <div className="reaction-users" role="dialog" aria-label="Personas que reaccionaron">
      <header><strong>Reacciones</strong><small>{visible.reduce((total, emoji) => total + reactions[emoji].count, 0)}</small></header>
      <div>{visible.map((emoji) => <section key={emoji}>
        <b className="reaction-users-emoji">{emoji}</b>
        <div>{reactions[emoji].users.map((person) => <span key={person.id}>
          {person.avatar_url ? <img src={person.avatar_url} alt="" /> : <i>{person.username.slice(0, 1).toUpperCase()}</i>}
          <b>{person.username}</b>
        </span>)}</div>
      </section>)}</div>
    </div>}
    {visible.length > 0 && <div className="reaction-counts" aria-label="Reacciones recibidas">
      <button
        type="button"
        className={visible.some((emoji) => reactions[emoji].reacted) ? "active" : ""}
        disabled={pending}
        onClick={() => { setOpen(false); setViewing((current) => !current); }}
        aria-label="Ver quién ha reaccionado"
      >{visible.map((emoji) => <span key={emoji}>{emoji}</span>)}</button>
    </div>}
    {error && <small className="reaction-error" role="status">{error}</small>}
  </div>;
}
