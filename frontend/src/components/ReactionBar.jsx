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
  const [viewing, setViewing] = useState("");
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
    if (!open) return;
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) { setOpen(false); setViewing(""); }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const cancelHold = () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const startHold = (event) => {
    if (!canReact || event.button > 0) return;
    cancelHold();
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
      setViewing("");
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
    {viewing && <div className="reaction-users" role="dialog" aria-label={`Personas que reaccionaron con ${viewing}`}>
      <header><span>{viewing}</span><strong>{reactions[viewing]?.count} {reactions[viewing]?.count === 1 ? "persona" : "personas"}</strong></header>
      <div>{(reactions[viewing]?.users || []).map((person) => <span key={person.id}>
        {person.avatar_url ? <img src={person.avatar_url} alt="" /> : <i>{person.username.slice(0, 1).toUpperCase()}</i>}
        <b>{person.username}</b>
      </span>)}</div>
    </div>}
    {visible.length > 0 && <div className="reaction-counts" aria-label="Reacciones recibidas">
      {visible.map((emoji) => <button
        type="button"
        key={emoji}
        className={reactions[emoji].reacted ? "active" : ""}
        disabled={pending}
        onClick={() => { setOpen(false); setViewing((current) => current === emoji ? "" : emoji); }}
        aria-label={`Ver quién reaccionó con ${emoji}`}
      ><span>{emoji}</span></button>)}
    </div>}
    {error && <small className="reaction-error" role="status">{error}</small>}
  </div>;
}
