export function EspnLiveScore({ data }) {
  if (!data?.available || !data.score) return null;
  const isFinal = Boolean(data.completed || data.espn_completed);
  const isLive = data.state === "in" && !isFinal;
  const provider = data.provider || "ESPN";
  const rawStatus = `${data.status || ""} ${data.clock || ""}`.toLowerCase();
  const moment = data.stale
    ? "guardado"
    : isFinal
      ? "FINAL"
      : /\bht\b|half|descanso|intermedio|status_halftime/.test(rawStatus)
        ? "Descanso"
        : data.clock || data.status || (isLive ? "En directo" : "");
  const score = `${data.score.team1 ?? 0}–${data.score.team2 ?? 0}`;
  return <span className={`espn-live-score ${isLive ? "is-live" : ""} ${isFinal ? "is-final" : ""} ${data.stale ? "is-stale" : ""}`}>
    {isLive && <i/>}<b>{isFinal ? `${provider} FINAL` : provider}</b>{moment && !isFinal && <em>{moment}</em>}<strong>{score}</strong>
  </span>;
}
