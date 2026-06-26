import { useState } from "react";
import { TeamDetailOverlay } from "./SocialPages";
import { GroupsView, WorldCupPageShell } from "./WorldCupPage";
import { useWorldCupData } from "./worldcup/useWorldCupData";
import "../styles/worldcup.css";

export function GroupsPage() {
  const { data, error, loading, teamIdByCode } = useWorldCupData();
  const [selectedTeamId, setSelectedTeamId] = useState(null);

  return <WorldCupPageShell
    className="groups-page"
    title="Fase de grupos"
    text="Consulta los grupos, la clasificacion provisional y el detalle de cada seleccion."
  >
    {selectedTeamId && <TeamDetailOverlay teamId={selectedTeamId} onClose={() => setSelectedTeamId(null)}/>}
    {error ? <div className="alert error">{error}</div> : loading ? <div className="page-loader"><span/></div> : <GroupsView groups={data?.groups || []} teamIdByCode={teamIdByCode} onOpenTeam={setSelectedTeamId}/>}
  </WorldCupPageShell>;
}
