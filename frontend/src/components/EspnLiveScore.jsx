export function EspnLiveScore({ data }) {
  if (!data?.available || !data.score) return null;
  const label = data.stale ? "ESPN · guardado" : data.completed ? "ESPN FINAL" : data.state === "in" ? "ESPN EN VIVO" : "ESPN";
  const moment = !data.completed && (data.clock || data.status);
  return <span className={`espn-live-score ${data.state === "in" ? "is-live" : ""} ${data.completed ? "is-final" : ""} ${data.stale ? "is-stale" : ""}`}>
    {data.state === "in" && !data.stale && <i/>}<b>{label}</b><strong>{data.score.team1}–{data.score.team2}</strong>{moment && <small>{moment}</small>}
  </span>;
}
