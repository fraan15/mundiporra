const flags = {
  "Alemania": "🇩🇪", "Arabia Saudí": "🇸🇦", "Argelia": "🇩🇿", "Argentina": "🇦🇷", "Australia": "🇦🇺",
  "Austria": "🇦🇹", "Bélgica": "🇧🇪", "Bosnia y Herzegovina": "🇧🇦", "Brasil": "🇧🇷", "Cabo Verde": "🇨🇻",
  "Canadá": "🇨🇦", "Catar": "🇶🇦", "Colombia": "🇨🇴", "Corea del Sur": "🇰🇷", "Costa de Marfil": "🇨🇮",
  "Croacia": "🇭🇷", "Curazao": "🇨🇼", "Ecuador": "🇪🇨", "Egipto": "🇪🇬", "Escocia": "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
  "España": "🇪🇸", "Estados Unidos": "🇺🇸", "Francia": "🇫🇷", "Ghana": "🇬🇭", "Haití": "🇭🇹",
  "Inglaterra": "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}", "Irak": "🇮🇶", "Irán": "🇮🇷", "Japón": "🇯🇵", "Jordania": "🇯🇴",
  "Marruecos": "🇲🇦", "México": "🇲🇽", "Noruega": "🇳🇴", "Nueva Zelanda": "🇳🇿", "Países Bajos": "🇳🇱",
  "Panamá": "🇵🇦", "Paraguay": "🇵🇾", "Portugal": "🇵🇹", "RD del Congo": "🇨🇩", "República Checa": "🇨🇿",
  "Senegal": "🇸🇳", "Sudáfrica": "🇿🇦", "Suecia": "🇸🇪", "Suiza": "🇨🇭", "Túnez": "🇹🇳",
  "Turquía": "🇹🇷", "Uruguay": "🇺🇾", "Uzbekistán": "🇺🇿"
};

export const Flag = ({ team, teamData }) => (
  <span className="real-flag" aria-label={team}>{teamData?.flag_icon || flags[team] || "⚽"}</span>
);

export function MiniChart({ data = [], field = "points", inverse = false }) {
  const values = data.map((item) => Number(item[field]) || 0);
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  return <div className="mini-chart">
    {data.length ? data.map((item, index) => {
      const value = Number(item[field]) || 0;
      const height = inverse ? 22 + ((max - value) / Math.max(max - min, 1)) * 68 : 22 + (value / max) * 68;
      return <div key={`${item.date}-${index}`} title={`${item.date}: ${value}`}><i style={{height:`${height}%`}}/><small>{new Date(`${item.date}T12:00:00`).toLocaleDateString("es-ES",{day:"numeric",month:"short"})}</small></div>;
    }) : <p className="empty-state">La evolución aparecerá cuando haya jornadas finalizadas.</p>}
  </div>;
}

export const Badges = ({ badges = [] }) => <div className="badges" aria-label="Medallas del jugador">
  {badges.length ? badges.map((badge) => <div className={`badge-card ${badge.kind || ""}`} key={badge.name} title={badge.name}><span aria-hidden="true">{badge.icon}</span><strong>{badge.name}</strong></div>) : <p className="empty-state">Los logros se desbloquean jugando.</p>}
</div>;
