export function EspnLiveScore({ data }) {
  if (!data?.available || !data.score) return null;
  const isLive = data.state === "in" && !data.completed;
  if (!isLive || data.stale) return null;
  return <span className={`espn-live-score ${isLive ? "is-live" : ""} ${data.completed ? "is-final" : ""} ${data.stale ? "is-stale" : ""}`}>
    <i/><b>Live</b>
  </span>;
}
