import { Check, Info, Lock, X } from "lucide-react";
import { useState } from "react";

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

const levelStatusText = (value, threshold) => {
  const missing = Math.max(0, Number(threshold || 0) - Number(value || 0));
  return missing ? `Faltan ${missing}` : "Alcanzada";
};

const holdersText = (holders = []) => {
  if (!holders.length) return "Sin titular ahora mismo";
  if (holders.length === 1) return holders[0];
  return `${holders.slice(0, -1).join(", ")} y ${holders.at(-1)}`;
};

export function Badges({ badges = [], catalog = [], disputed = [] }) {
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const activeBadge = badges.find((badge) => badge.name === selectedBadge);
  const orderedBadges = [...badges].sort((a, b) =>
    Number(a.order ?? 99) - Number(b.order ?? 99) ||
    Number(b.level ?? 0) - Number(a.level ?? 0) ||
    String(a.name).localeCompare(String(b.name), "es")
  );
  const orderedCatalog = [...catalog].sort((a, b) => Number(a.order ?? 99) - Number(b.order ?? 99));
  const orderedDisputed = [...disputed].sort((a, b) =>
    Number(a.order ?? 99) - Number(b.order ?? 99) ||
    Number(b.level ?? 0) - Number(a.level ?? 0) ||
    String(a.name).localeCompare(String(b.name), "es")
  );
  const hasCatalog = orderedCatalog.some((group) => group.tiers?.length);

  return <div className="badges-wrap">
    {hasCatalog && <button
      type="button"
      className="badges-info-button"
      aria-label="Ver información de todas las medallas"
      title="Información de medallas"
      onClick={() => setCatalogOpen(true)}
    >
      <Info size={18} />
    </button>}
    <div className="badges" aria-label="Medallas del jugador">
      {orderedBadges.length ? orderedBadges.map((badge) => {
        const isActive = selectedBadge === badge.name;
        return <button
          type="button"
          className={`badge-card ${badge.kind || ""} ${isActive ? "active" : ""}`}
          key={badge.name}
          title={badge.description || badge.name}
          aria-haspopup="dialog"
          onClick={() => setSelectedBadge(badge.name)}
        >
          <span aria-hidden="true">{badge.icon}</span>
          <strong>{badge.name}</strong>
        </button>;
      }) : <p className="empty-state">Los logros se desbloquean jugando.</p>}
    </div>
    {activeBadge && <div className="badge-popup-overlay" role="presentation" onClick={() => setSelectedBadge(null)}>
      <div className={`badge-popup ${activeBadge.kind || ""}`} role="dialog" aria-modal="true" aria-labelledby="badge-popup-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="badge-popup-close" aria-label="Cerrar explicación de medalla" onClick={() => setSelectedBadge(null)}>
          <X size={18} />
        </button>
        <span aria-hidden="true">{activeBadge.icon}</span>
        <small className="badge-popup-type">
          {["record", "leader"].includes(activeBadge.kind) ? "Medalla en disputa" : "Medalla fija"}
        </small>
        <h3 id="badge-popup-title">{activeBadge.name}</h3>
        <p>{activeBadge.description || "Medalla desbloqueada por sus méritos en la porra."}</p>
        {activeBadge.tiers?.length > 1 && <div className="badge-levels" aria-label="Niveles de esta medalla">
          {activeBadge.tiers.map((tier) => <article className={tier.achieved ? "achieved" : ""} key={`${activeBadge.group}-${tier.level}`}>
            <span aria-hidden="true">{tier.icon}</span>
            <div>
              <strong>{tier.name}</strong>
              <small>{tier.threshold} · {levelStatusText(activeBadge.value, tier.threshold)}</small>
            </div>
            {tier.achieved ? <Check size={16} /> : <Lock size={15} />}
          </article>)}
        </div>}
      </div>
    </div>}
    {catalogOpen && <div className="badge-popup-overlay" role="presentation" onClick={() => setCatalogOpen(false)}>
      <div className="badge-popup badge-catalog-popup" role="dialog" aria-modal="true" aria-labelledby="badge-catalog-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="badge-popup-close" aria-label="Cerrar información de medallas" onClick={() => setCatalogOpen(false)}>
          <X size={18} />
        </button>
        <small className="badge-popup-type">Guía de medallas</small>
        <h3 id="badge-catalog-title">Todas las medallas</h3>
        <div className="badge-catalog-list">
          {orderedDisputed.length > 0 && <section className="badge-catalog-disputed">
            <h4>Medallas en disputa</h4>
            <div>
              {orderedDisputed.map((badge) => <article className={badge.kind || ""} key={`${badge.name}-${badge.description}`}>
                <span aria-hidden="true">{badge.icon}</span>
                <div>
                  <strong>{badge.name}</strong>
                  <small>{badge.description || "Medalla disputada durante la porra."}</small>
                  <em>Ahora: {holdersText(badge.holders)}</em>
                </div>
                <Check size={16} />
              </article>)}
            </div>
          </section>}
          {orderedCatalog.map((group) => <section key={group.group}>
            <h4>{group.title}</h4>
            <div>
              {group.tiers.map((tier) => <article className={tier.achieved ? "achieved" : ""} key={`${group.group}-${tier.level}`}>
                <span aria-hidden="true">{tier.icon}</span>
                <div>
                  <strong>{tier.name}</strong>
                  <small>{tier.description} Ahora: {group.value || 0}.</small>
                </div>
                {tier.achieved ? <Check size={16} /> : <Lock size={15} />}
              </article>)}
            </div>
          </section>)}
        </div>
      </div>
    </div>}
  </div>;
}
