export function EspnLiveScore({ data }) {
  if (!data?.available || !data.score) return null;
  const isLive = data.state === "in" && !data.completed;
  const moment = isLive && !data.stale ? data.clock : "";
  return <span className={`espn-live-score ${isLive ? "is-live" : ""} ${data.completed ? "is-final" : ""} ${data.stale ? "is-stale" : ""}`}>
    <i/><b>{data.completed ? "FIN" : ""}</b><strong>{data.score.team1}–{data.score.team2}</strong>{moment && <small>{moment}</small>}
  </span>;
}
