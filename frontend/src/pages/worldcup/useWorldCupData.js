import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";

export function useWorldCupData() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api("/worldcup/overview").then((payload) => {
      if (!active) return;
      setData(payload);
      setError("");
    }).catch((err) => {
      if (!active) return;
      setError(err.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api("/teams").then((payload) => {
      if (active) setTeams(payload || []);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const teamIdByCode = useMemo(() => new Map(teams.map((team) => [team.fifa_code, team.id])), [teams]);

  return { data, error, loading, teams, teamIdByCode };
}
