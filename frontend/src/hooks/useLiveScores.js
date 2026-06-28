import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { startVisiblePolling } from "../utils/visiblePolling";

export function useLiveScores(matches = []) {
  const ids = useMemo(() => [...new Set(matches
    .filter((match) => match && match.status !== "finished" && (
      match.status === "closed" || match.in_play || match.live_test_enabled || match.live_updated_at
    ))
    .map((match) => match.id))], [matches]);
  const key = ids.join(",");
  const [scores, setScores] = useState({});

  useEffect(() => {
    if (!key) {
      setScores({});
      return undefined;
    }
    return startVisiblePolling(
      () => api(`/matches/live-scores?ids=${encodeURIComponent(key)}`, { cache: "no-store" })
        .then((response) => setScores(response.items || {}))
        .catch(() => {}),
      30000,
    );
  }, [key]);

  return scores;
}
