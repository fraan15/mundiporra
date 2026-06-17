import { useEffect, useMemo, useState } from "react";
import { Search, Trash2, X } from "lucide-react";

const positionOrder = ["DEL", "MED", "DEF", "POR"];
const positionLabels = {
  POR: "Porteros",
  GK: "Porteros",
  DF: "Defensas",
  DEF: "Defensas",
  MF: "Centrocampistas",
  MED: "Centrocampistas",
  FW: "Delanteros",
  DEL: "Delanteros"
};
const positionAliases = { FW: "DEL", DEL: "DEL", MF: "MED", MED: "MED", DF: "DEF", DEF: "DEF", GK: "POR", POR: "POR" };

const positionKey = (position) => positionAliases[String(position || "").toUpperCase()] || "OT";
const positionRank = (position) => {
  const index = positionOrder.indexOf(positionKey(position));
  return index === -1 ? positionOrder.length : index;
};
const playerSort = (a, b) => positionRank(a.position) - positionRank(b.position) ||
  (Number(a.number) || 999) - (Number(b.number) || 999) ||
  String(a.name || "").localeCompare(String(b.name || ""), "es");

function PlayerRow({ player, selected, onSelect }) {
  return <button type="button" className={selected ? "scorer-player selected" : "scorer-player"} onClick={() => onSelect(player)}>
    <span>{player.number || "-"}</span>
    <strong>{player.name}</strong>
    <small>{player.team_name} · {player.position}</small>
  </button>;
}

function ScorerPickerSheet({ players, value, matchLabel, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, []);
  const filteredPlayers = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("es");
    const matches = text
      ? players.filter((player) => `${player.name} ${player.team_name} ${player.position}`.toLocaleLowerCase("es").includes(text))
      : players;
    return [...matches].sort(playerSort);
  }, [players, query]);
  const grouped = useMemo(() => {
    const groups = new Map();
    filteredPlayers.forEach((player) => {
      const key = positionKey(player.position);
      groups.set(key, [...(groups.get(key) || []), player]);
    });
    return [...positionOrder, "OT"].filter((key) => groups.has(key)).map((key) => [key, groups.get(key)]);
  }, [filteredPlayers]);

  return <div className="scorer-picker-backdrop" role="presentation" onPointerDown={onClose}>
    <section className="scorer-picker-sheet" role="dialog" aria-modal="true" aria-label="Buscar goleador" onPointerDown={(event) => event.stopPropagation()}>
      <header>
        <div>
          <span>Goleador del partido</span>
          <h2>{matchLabel}</h2>
        </div>
        <button type="button" aria-label="Cerrar buscador" onClick={onClose}><X size={18}/></button>
      </header>
      <div className="scorer-search">
        <span className="scorer-search-icon"><Search size={17}/></span>
        <input className="scorer-search-input" aria-label="Buscar jugador" autoFocus value={query} placeholder="Buscar por nombre o selección" onChange={(event) => setQuery(event.target.value)}/>
      </div>
      <div className="scorer-position-list">
        {grouped.length ? grouped.map(([position, group]) => <section key={position}>
          <h3>{positionLabels[position] || "Otros jugadores"} <b>{group.length}</b></h3>
          <div>
            {group.map((player) => <PlayerRow key={player.id} player={player} selected={String(player.id) === String(value)} onSelect={(selectedPlayer) => { onSelect(selectedPlayer); onClose(); }}/>)}
          </div>
        </section>) : <p>Sin jugadores disponibles para ese marcador.</p>}
      </div>
    </section>
  </div>;
}

export function ScorerPicker({ players = [], value = null, onChange, disabled = false, matchLabel = "", buttonLabel = "Buscar jugador", selectedLabel = "Goleador elegido" }) {
  const [open, setOpen] = useState(false);
  const selected = players.find((player) => String(player.id) === String(value));

  return <div className="scorer-picker">
    {selected ? <div className="scorer-selected-banner">
      <div>
        <span>{selectedLabel}</span>
        <strong>{selected.name}</strong>
        <small>{selected.team_name} · {selected.position}</small>
      </div>
      <button type="button" aria-label={`Eliminar ${selected.name}`} onClick={() => onChange(null)}><Trash2 size={17}/></button>
    </div> : <button type="button" className="scorer-search-button" disabled={disabled || players.length === 0} onClick={() => setOpen(true)}>
      <Search size={18}/>
      <span>{players.length ? buttonLabel : "Sin jugadores disponibles"}</span>
    </button>}
    {selected && <button type="button" className="scorer-search-again" onClick={() => setOpen(true)}><Search size={16}/>Buscar otro</button>}
    {open && <ScorerPickerSheet players={players} value={value} matchLabel={matchLabel} onSelect={(player) => onChange(player?.id || null)} onClose={() => setOpen(false)}/>}
  </div>;
}
