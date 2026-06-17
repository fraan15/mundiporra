import { useMemo, useState } from "react";
import { Search, Trash2, X } from "lucide-react";

const positionOrder = ["FW", "MF", "DF", "GK"];
const positionLabels = {
  GK: "Porteros",
  DF: "Defensas",
  MF: "Centrocampistas",
  FW: "Delanteros"
};

function PlayerRow({ player, selected, onSelect }) {
  return <button type="button" className={selected ? "scorer-player selected" : "scorer-player"} onClick={() => onSelect(player)}>
    <span>{player.number || "-"}</span>
    <strong>{player.name}</strong>
    <small>{player.team_name} · {player.position}</small>
  </button>;
}

function ScorerPickerSheet({ players, value, matchLabel, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const filteredPlayers = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("es");
    return text
      ? players.filter((player) => `${player.name} ${player.team_name} ${player.position}`.toLocaleLowerCase("es").includes(text))
      : players;
  }, [players, query]);
  const grouped = useMemo(() => {
    const groups = new Map();
    filteredPlayers.forEach((player) => {
      const key = positionOrder.includes(player.position) ? player.position : "OT";
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
      <label className="scorer-search">
        <Search size={17}/>
        <input autoFocus value={query} placeholder="Buscar por nombre o selección" onChange={(event) => setQuery(event.target.value)}/>
      </label>
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

export function ScorerPicker({ players = [], value = null, onChange, disabled = false, matchLabel = "" }) {
  const [open, setOpen] = useState(false);
  const selected = players.find((player) => String(player.id) === String(value));

  return <div className="scorer-picker">
    {selected ? <div className="scorer-selected-banner">
      <div>
        <span>Goleador elegido</span>
        <strong>{selected.name}</strong>
        <small>{selected.team_name} · {selected.position}</small>
      </div>
      <button type="button" aria-label={`Eliminar ${selected.name}`} onClick={() => onChange(null)}><Trash2 size={17}/></button>
    </div> : <button type="button" className="scorer-search-button" disabled={disabled || players.length === 0} onClick={() => setOpen(true)}>
      <Search size={18}/>
      <span>{players.length ? "Buscar jugador" : "Sin jugadores disponibles"}</span>
    </button>}
    {selected && <button type="button" className="scorer-search-again" onClick={() => setOpen(true)}><Search size={16}/>Buscar otro</button>}
    {open && <ScorerPickerSheet players={players} value={value} matchLabel={matchLabel} onSelect={(player) => onChange(player?.id || null)} onClose={() => setOpen(false)}/>}
  </div>;
}
