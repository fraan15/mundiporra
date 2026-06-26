import { useState } from "react";
import { TeamDetailOverlay } from "./SocialPages";
import { KnockoutView, WorldCupPageShell } from "./WorldCupPage";
import { useWorldCupData } from "./worldcup/useWorldCupData";
import "../styles/worldcup.css";

export function KnockoutPage() {
  const { data, error, loading, teamIdByCode } = useWorldCupData();
  const [selectedTeamId, setSelectedTeamId] = useState(null);

  return <WorldCupPageShell
    className="knockout-page"
    title="Eliminatorias"
    text="Consulta el cuadro, los cruces y el origen de cada partido."
  >
    {selectedTeamId && <TeamDetailOverlay teamId={selectedTeamId} onClose={() => setSelectedTeamId(null)}/>}
    {error ? <div className="alert error">{error}</div> : loading ? <div className="page-loader"><span/></div> : <KnockoutView matches={data?.knockout_matches || []} teamIdByCode={teamIdByCode} onOpenTeam={setSelectedTeamId}/>}
  </WorldCupPageShell>;
}
