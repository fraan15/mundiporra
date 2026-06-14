const flags = {
  "Alemania":"🇩🇪","Arabia Saudí":"🇸🇦","Argelia":"🇩🇿","Argentina":"🇦🇷","Australia":"🇦🇺",
  "Austria":"🇦🇹","Bélgica":"🇧🇪","Bolivia":"🇧🇴","Bosnia":"🇧🇦","Brasil":"🇧🇷",
  "Cabo Verde":"🇨🇻","Camerún":"🇨🇲","Canadá":"🇨🇦","Canada":"🇨🇦","Catar":"🇶🇦",
  "Chile":"🇨🇱","Colombia":"🇨🇴","Corea del Sur":"🇰🇷","Costa de Marfil":"🇨🇮","Costa Rica":"🇨🇷",
  "Croacia":"🇭🇷","Curazao":"🇨🇼","Dinamarca":"🇩🇰","Ecuador":"🇪🇨","Egipto":"🇪🇬",
  "Escocia":"🏴","Eslovaquia":"🇸🇰","Eslovenia":"🇸🇮","España":"🇪🇸","Estados Unidos":"🇺🇸",
  "Francia":"🇫🇷","Gales":"🏴","Ghana":"🇬🇭","Grecia":"🇬🇷","Haití":"🇭🇹",
  "Honduras":"🇭🇳","Hungría":"🇭🇺","Inglaterra":"🏴","Irak":"🇮🇶","Irán":"🇮🇷",
  "Irlanda":"🇮🇪","Islandia":"🇮🇸","Italia":"🇮🇹","Jamaica":"🇯🇲","Japón":"🇯🇵",
  "Jordania":"🇯🇴","Macedonia del Norte":"🇲🇰","Malí":"🇲🇱","Marruecos":"🇲🇦","México":"🇲🇽",
  "Nigeria":"🇳🇬","Noruega":"🇳🇴","Nueva Caledonia":"🇳🇨","Nueva Zelanda":"🇳🇿","Países Bajos":"🇳🇱",
  "Panamá":"🇵🇦","Paraguay":"🇵🇾","Perú":"🇵🇪","Polonia":"🇵🇱","Portugal":"🇵🇹",
  "República Checa":"🇨🇿","República Democrática del Congo":"🇨🇩","Rumanía":"🇷🇴","Senegal":"🇸🇳","Serbia":"🇷🇸",
  "Sudáfrica":"🇿🇦","Suecia":"🇸🇪","Suiza":"🇨🇭","Surinam":"🇸🇷","Túnez":"🇹🇳",
  "Turquía":"🇹🇷","Ucrania":"🇺🇦","Uruguay":"🇺🇾","Uzbekistán":"🇺🇿","Venezuela":"🇻🇪"
};
export const Flag = ({ team }) => <span className="real-flag" aria-label={team}>{flags[team] || "🏴"}</span>;

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

export const Badges = ({ badges = [] }) => <div className="badges">
  {badges.length ? badges.map((badge) => <div className="badge-card" key={badge.name}><span>{badge.icon}</span><strong>{badge.name}</strong></div>) : <p className="empty-state">Los logros se desbloquean jugando.</p>}
</div>;
