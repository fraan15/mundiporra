import { useEffect, useState } from "react";
import { api } from "../api/client";

const FALLBACK_EMOJIS = ["😂", "🔥", "🤡", "👀", "😭", "👏"];
const emptyReactions = (emojis = FALLBACK_EMOJIS) => Object.fromEntries(
  emojis.map((emoji) => [emoji, { count: 0, reacted: false }]),
);

export function ReactionBar({ targetType, targetId, initialReactions, compact = false, disabled = false }) {
  const [emojis, setEmojis] = useState(FALLBACK_EMOJIS);
  const [reactions, setReactions] = useState(initialReactions || emptyReactions());
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!targetId) return;
    let active = true;
    if (initialReactions) {
      setReactions(initialReactions);
      return () => { active = false; };
    }
    api(`/reactions?target_type=${encodeURIComponent(targetType)}&target_ids=${targetId}`)
      .then((data) => {
        if (!active) return;
        setEmojis(data.allowed_emojis || FALLBACK_EMOJIS);
        setReactions(data.reactions?.[`${targetType}:${targetId}`] || emptyReactions(data.allowed_emojis));
      })
      .catch((requestError) => active && setError(requestError.message));
    return () => { active = false; };
  }, [targetType, targetId, initialReactions]);

  const toggle = async (emoji) => {
    if (disabled || pending) return;
    setPending(emoji);
    setError("");
    try {
      const data = await api("/reactions/toggle", {
        method: "POST",
        body: { target_type: targetType, target_id: targetId, emoji },
      });
      setReactions(data.reactions);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setPending("");
    }
  };

  return <div className={`reaction-bar${compact ? " compact" : ""}`}>
    <div className="reaction-chips" role="group" aria-label="Reacciones">
      {emojis.map((emoji) => {
        const state = reactions[emoji] || { count: 0, reacted: false };
        return <button
          type="button"
          key={emoji}
          className={state.reacted ? "active" : ""}
          disabled={disabled || Boolean(pending)}
          aria-pressed={state.reacted}
          aria-label={`${state.reacted ? "Quitar" : "Añadir"} reacción ${emoji}`}
          onClick={() => toggle(emoji)}
        ><span>{emoji}</span><small>{state.count}</small></button>;
      })}
    </div>
    {error && <small className="reaction-error" role="status">{error}</small>}
  </div>;
}
