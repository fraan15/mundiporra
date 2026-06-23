import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Calculator,
  CalendarSearch,
  Check,
  Download,
  Eye,
  Megaphone,
  MessageSquareText,
  Plus,
  Settings,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "../api/client";
import { SearchSelect } from "../components/SearchSelect";
import { ScorerPicker } from "../components/ScorerPicker";
import { HorizontalScoreControl } from "../components/MatchCard";
import { NO_SCORER, NO_SCORER_ID } from "../constants/scorers";
import "../styles/json-sync.css";

export function AdminPage() {
  const [tab, setTab] = useState("matches");
  const changeTab = (id) => {
    if (id === tab) return;
    setTab(id);
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
  };
  const tabs = [
    ["matches", "Partidos", Shield],
    ["messages", "Mensajes y encuestas", MessageSquareText],
    ["news", "Novedades", Megaphone],
    ["users", "Usuarios", Users],
    ["points", "Ajustes", Plus],
    ["recalculate", "Recálculo", Calculator],
    ["settings", "Configuración", Settings],
    ["logs", "Actividad", Activity],
  ];
  return (
    <div className="page">
      <section className="page-heading compact">
        <span className="eyebrow">CENTRO DE CONTROL</span>
        <h1>Gestión de la porra</h1>
      </section>
      <div className="admin-tabs">
        {tabs.map(([id, label, Icon]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => changeTab(id)}
            key={id}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      {tab === "matches" && <AdminMatches />}
      {tab === "messages" && <AdminMessages />}
      {tab === "news" && <AdminNews />}
      {tab === "users" && <AdminUsers />}
      {tab === "points" && <AdminPoints />}
      {tab === "recalculate" && <AdminRecalculate />}
      {tab === "settings" && <AdminSettings />}
      {tab === "logs" && <AdminLogs />}
    </div>
  );
}
const Notice = ({ text, notice }) => {
  const source = notice ?? text;
  if (!source) return null;
  const value = typeof source === "string" ? { type: "success", text: source } : source;
  return value.text ? <div className={`alert ${value.type || "success"}`}>{value.text}</div> : null;
};

function AdminNews() {
  const blank = { title: "", body: "", published: true };
  const [form, setForm] = useState(blank);
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");
  const load = () => api("/admin/news").then(setItems);
  useEffect(() => { load(); }, []);
  const save = async (event) => {
    event.preventDefault();
    if (editing) {
      await api(`/admin/news/${editing.id}`, { method: "PATCH", body: form });
      setNotice("Novedad actualizada.");
    } else {
      await api("/admin/news", { method: "POST", body: form });
      setNotice(form.published ? "Novedad publicada." : "Novedad guardada como oculta.");
    }
    setForm(blank);
    setEditing(null);
    load();
  };
  const beginEdit = (item) => {
    setEditing(item);
    setForm({ title: item.title, body: item.body, published: Boolean(item.published) });
    setNotice("");
  };
  const toggle = async (item) => {
    await api(`/admin/news/${item.id}`, { method: "PATCH", body: { published: !item.published } });
    load();
  };
  const remove = async (item) => {
    if (!window.confirm(`¿Eliminar "${item.title}"?`)) return;
    await api(`/admin/news/${item.id}`, { method: "DELETE" });
    if (editing?.id === item.id) {
      setEditing(null);
      setForm(blank);
    }
    load();
  };
  return <section className="admin-section">
    <Notice text={notice}/>
    <form className="admin-form admin-news-form" onSubmit={save}>
      <h3>{editing ? "Editar novedad" : "Nueva novedad"}</h3>
      <div className="form-grid">
        <label className="message-title-field">Título<input required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label>
        <label className="toggle"><input type="checkbox" checked={form.published} onChange={(event) => setForm({ ...form, published: event.target.checked })}/> Visible</label>
      </div>
      <label>Contenido<textarea required maxLength={2000} rows={5} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })}/></label>
      <div className="admin-news-actions">
        <button className="primary">{editing ? "Guardar cambios" : "Publicar"}</button>
        {editing && <button type="button" className="secondary" onClick={() => { setEditing(null); setForm(blank); }}>Cancelar</button>}
      </div>
    </form>
    <div className="admin-news-list">
      {items.length ? items.map((item) => <article key={item.id}>
        <div>
          <span className={`news-status ${item.published ? "published" : "hidden"}`}>{item.published ? "Visible" : "Oculta"}</span>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
          <small>{new Date(item.created_at).toLocaleString("es-ES")}</small>
        </div>
        <div className="actions">
          <button type="button" className="accent" onClick={() => beginEdit(item)}>Editar</button>
          <button type="button" onClick={() => toggle(item)}>{item.published ? "Ocultar" : "Mostrar"}</button>
          <button type="button" className="danger" onClick={() => remove(item)}><Trash2 size={15}/></button>
        </div>
      </article>) : <div className="admin-list-empty">Todavía no hay novedades.</div>}
    </div>
  </section>;
}

function AdminMessages() {
  const blank = { type: "message", title: "", body: "", options: ["", ""] };
  const [form, setForm] = useState(blank),
    [messages, setMessages] = useState([]),
    [notice, setNotice] = useState("");
  const load = () => api("/admin/admin-messages").then(setMessages);
  useEffect(() => {
    load();
  }, []);
  const save = async (e) => {
    e.preventDefault();
    await api("/admin/admin-messages", { method: "POST", body: form });
    setForm(blank);
    setNotice(
      form.type === "poll" ? "Encuesta publicada." : "Mensaje publicado.",
    );
    load();
  };
  const remove = async (message) => {
    if (
      !window.confirm(
        `¿Eliminar "${message.title}"? También se borrarán todas sus respuestas.`,
      )
    )
      return;
    await api(`/admin/admin-messages/${message.id}`, { method: "DELETE" });
    load();
  };
  const setOption = (index, value) =>
    setForm({
      ...form,
      options: form.options.map((option, i) => (i === index ? value : option)),
    });
  return (
    <section className="admin-section">
      <Notice text={notice} />
      <form className="admin-form admin-message-form" onSubmit={save}>
        <h3>Nuevo comunicado obligatorio</h3>
        <div className="form-grid">
          <label>
            Tipo
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
            >
              <option value="message">Mensaje</option>
              <option value="poll">Encuesta</option>
            </select>
          </label>
          <label className="message-title-field">
            Título
            <input
              required
              maxLength={120}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
        </div>
        <label>
          Contenido
          <textarea
            required
            maxLength={2000}
            rows={4}
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </label>
        {form.type === "poll" && (
          <div className="poll-options-editor">
            <strong>Botones de respuesta</strong>
            {form.options.map((option, index) => (
              <div key={index}>
                <input
                  required
                  placeholder={`Respuesta ${index + 1}`}
                  maxLength={80}
                  value={option}
                  onChange={(e) => setOption(index, e.target.value)}
                />
                {form.options.length > 2 && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() =>
                      setForm({
                        ...form,
                        options: form.options.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Quitar
                  </button>
                )}
              </div>
            ))}
            {form.options.length < 10 && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setForm({ ...form, options: [...form.options, ""] })
                }
              >
                Añadir respuesta
              </button>
            )}
          </div>
        )}
        <button className="primary">Publicar ahora</button>
      </form>
      <div className="admin-message-list">
        {messages.length ? (
          messages.map((message) => (
            <article key={message.id}>
              <header>
                <div>
                  <span className="eyebrow">
                    {message.type === "poll" ? "ENCUESTA" : "MENSAJE"}
                  </span>
                  <h3>{message.title}</h3>
                  <p>{message.body}</p>
                </div>
                <button
                  className="danger icon-delete"
                  title="Eliminar"
                  onClick={() => remove(message)}
                >
                  <Trash2 size={16} />
                </button>
              </header>
              <div className="message-summary">
                <strong>{message.response_percentage}% completado</strong>
                <span>
                  {message.responded_count} de {message.total_users} usuarios
                </span>
                <div>
                  <i style={{ width: `${message.response_percentage}%` }} />
                </div>
              </div>
              {message.type === "poll" && (
                <div className="poll-results">
                  {message.options.map((option) => (
                    <details key={option.id}>
                      <summary>
                        <strong>{option.label}</strong>
                        <span>
                          {option.count} · {option.percentage}%
                        </span>
                      </summary>
                      <p>
                        {option.users.length
                          ? option.users.map((user) => user.username).join(", ")
                          : "Nadie ha elegido esta respuesta."}
                      </p>
                    </details>
                  ))}
                </div>
              )}
              <div className="message-user-groups">
                <details>
                  <summary>
                    {message.type === "poll" ? "Han respondido" : "Han leído"} (
                    {message.responded_users.length})
                  </summary>
                  <p>
                    {message.responded_users.length
                      ? message.responded_users
                          .map((user) => user.username)
                          .join(", ")
                      : "Nadie todavía."}
                  </p>
                </details>
                <details>
                  <summary>Pendientes ({message.pending_users.length})</summary>
                  <p>
                    {message.pending_users.length
                      ? message.pending_users
                          .map((user) => user.username)
                          .join(", ")
                      : "Todos han completado el comunicado."}
                  </p>
                </details>
              </div>
            </article>
          ))
        ) : (
          <div className="admin-list-empty">
            Todavía no hay mensajes ni encuestas.
          </div>
        )}
      </div>
    </section>
  );
}

function AdminMatches() {
  const blankForm = (knockoutDefault = false) => ({
    match_date: "",
    match_time: "",
    team1_id: "",
    team2_id: "",
    stadium_id: "",
    use_custom_close: false,
    auto_close_at: "",
    force_published: false,
    is_star: false,
    is_knockout: knockoutDefault,
    scorer_enabled: true,
  });
  const toLocalDateTime = (value) => {
    if (!value) return "";
    const date = new Date(value);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };
  const [matches, setMatches] = useState([]),
    [settings, setSettings] = useState(null),
    [form, setForm] = useState(blankForm()),
    [edit, setEdit] = useState(null),
    [notice, setNotice] = useState(null),
    [savingMatch, setSavingMatch] = useState(false);
  const [teams, setTeams] = useState([]),
    [stadiums, setStadiums] = useState([]),
    [resultMatch, setResultMatch] = useState(null),
    [predictionMatch, setPredictionMatch] = useState(null);
  const [filter, setFilter] = useState("upcoming"),
    [page, setPage] = useState(1),
    [pagination, setPagination] = useState({
      page: 1,
      total: 0,
      total_pages: 1,
    });
  const [reference, setReference] = useState(null),
    [referenceLoading, setReferenceLoading] = useState(false),
    [referenceError, setReferenceError] = useState("");
  const load = () =>
    api(
      `/admin/matches?${new URLSearchParams({ filter, page: String(page), page_size: "10" })}`,
    ).then((data) => {
      setMatches(data.matches);
      setPagination(data.pagination);
      if (data.pagination.page !== page) setPage(data.pagination.page);
    });
  useEffect(() => {
    load();
  }, [filter, page]);
  useEffect(() => {
    Promise.all([api("/teams"), api("/stadiums")]).then(
      ([teamRows, stadiumRows]) => {
        setTeams(teamRows);
        setStadiums(stadiumRows);
      },
    );
  }, []);
  useEffect(() => {
    api("/admin/settings").then((data) => {
      setSettings(data);
      setForm((current) =>
        edit ? current : { ...current, is_knockout: data.knockout_mode_enabled === "1" },
      );
    });
  }, [edit]);
  const matchBlank = () => blankForm(settings?.knockout_mode_enabled === "1");
  const selectFilter = (value) => {
    setFilter(value);
    setPage(1);
  };
  const openReference = async () => {
    if (reference) {
      setReference(null);
      return;
    }
    setReferenceLoading(true);
    setReferenceError("");
    try {
      setReference(await api("/admin/match-reference"));
    } catch (error) {
      setReferenceError(error.message);
    } finally {
      setReferenceLoading(false);
    }
  };
  const useReferenceMatch = (match) => {
    if (match.existing_match) return;
    setEdit(null);
    setForm({
      ...matchBlank(),
      match_date: match.match_date,
      match_time: match.match_time,
      team1_id: match.team1.id || "",
      team2_id: match.team2.id || "",
      stadium_id: match.stadium.id || "",
      is_knockout: Boolean(match.is_knockout),
    });
    setNotice({
      type: "success",
      text: "Datos copiados al formulario. Revísalos y pulsa «Crear partido» para guardarlo.",
    });
    if (!match.complete) {
      setNotice({
        type: "success",
        text: "Datos parciales copiados al formulario. Completa a mano lo que falte antes de crear el partido.",
      });
    }
    setReference(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const save = async (e) => {
    e.preventDefault();
    if (savingMatch) return;
    setSavingMatch(true);
    setNotice(null);
    const body = {
      ...form,
      auto_close_at:
        form.use_custom_close && form.auto_close_at
          ? new Date(form.auto_close_at).toISOString()
          : "",
    };
    delete body.use_custom_close;
    try {
      await api(edit ? `/matches/${edit}` : "/matches", {
        method: edit ? "PUT" : "POST",
        body,
      });
      setForm(matchBlank());
      setEdit(null);
      setNotice({ type: "success", text: "Partido guardado." });
      setPage(1);
      await load();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSavingMatch(false);
    }
  };
  const startEdit = (m) => {
    const defaultClose = `${m.match_date}T${m.match_time}`;
    const customClose = toLocalDateTime(m.auto_close_at);
    setEdit(m.id);
    setForm({
      match_date: m.match_date,
      match_time: m.match_time,
      team1_id: m.team1_id || "",
      team2_id: m.team2_id || "",
      stadium_id: m.stadium_id || "",
      use_custom_close: Boolean(customClose && customClose !== defaultClose),
      auto_close_at: customClose,
      force_published: Boolean(m.force_published),
      is_star: Boolean(m.is_star),
      is_knockout: Boolean(m.is_knockout),
      scorer_enabled: Boolean(m.scorer_enabled),
    });
  };
  const status = async (id, value) => {
    const body = { status: value };
    if (value === "open") {
      const automatic = window.confirm(
        "¿Quieres volver a activar el cierre automático?\n\nAceptar: se cerrará automáticamente en la fecha configurada.\nCancelar: permanecerá abierto hasta que lo cierres manualmente.",
      );
      body.reopen_mode = automatic ? "automatic" : "manual";
    }
    await api(`/matches/${id}/status`, { method: "PATCH", body });
    setNotice({
      type: "success",
      text: value === "open"
        ? `Partido reabierto con cierre ${body.reopen_mode === "automatic" ? "automático" : "manual"}.`
        : "Partido cerrado manualmente.",
    });
    load();
  };
  const finish = (m) => setResultMatch(m);
  const deleteResult = async (m) => {
    if (
      !window.confirm(
        `¿Eliminar el resultado de ${m.team1} - ${m.team2}? Se quitarán los puntos obtenidos y el partido volverá a abrirse.`,
      )
    )
      return;
    const result = await api(`/matches/${m.id}/result`, { method: "DELETE" });
    setNotice(
      result.status === "closed"
        ? "Resultado eliminado; el partido permanece cerrado porque el plazo ya pasó."
        : "Resultado eliminado y partido reabierto.",
    );
    load();
  };
  const remove = async (m) => {
    if (
      window.confirm(
        `⚠️ ELIMINACIÓN CRÍTICA E IRREVERSIBLE\n\n¿Eliminar definitivamente ${m.team1} - ${m.team2}?\n\nSe perderán el resultado, todas las apuestas, los puntos obtenidos, los goleadores, los comentarios y los resúmenes vinculados al partido. Esta acción no se puede deshacer.`,
      )
    ) {
      await api(`/matches/${m.id}`, { method: "DELETE" });
      load();
    }
  };
  const filters = [
    ["upcoming", "Próximos"],
    ["open", "Abiertos"],
    ["closed", "Cerrados"],
    ["finished", "Finalizados"],
  ];
  return (
    <section className="admin-section">
      <Notice text={notice} />
      {predictionMatch && (
        <AdminPredictionReview
          match={predictionMatch}
          onClose={() => setPredictionMatch(null)}
          onCorrected={(recalculated) =>
            setNotice({
              type: "success",
              text: recalculated
                ? "Apuesta corregida y puntos recalculados."
                : "Apuesta corregida; el partido continúa cerrado.",
            })
          }
        />
      )}
      {resultMatch && (
        <AdminResultEditor
          match={resultMatch}
          onCancel={() => setResultMatch(null)}
          onSaved={() => {
            setResultMatch(null);
            setNotice({ type: "success", text: "Resultado y goleadores guardados. Puntos recalculados." });
            load();
          }}
        />
      )}
      <form className="admin-form" onSubmit={save}>
        <div className="admin-form-title">
          <h3>{edit ? "Editar partido" : "Nuevo partido"}</h3>
          {!edit && (
            <button
              type="button"
              className="reference-toggle"
              onClick={openReference}
            >
              <CalendarSearch size={16} />
              {reference ? "Cerrar buscador" : "Buscar en JSON"}
            </button>
          )}
        </div>
        {referenceLoading && (
          <div className="reference-loading">Consultando calendario…</div>
        )}
        {referenceError && <div className="alert error">{referenceError}</div>}
        {reference && (
          <MatchReferencePanel data={reference} onSelect={useReferenceMatch} />
        )}
        <div className="form-grid">
          <label>
            Fecha
            <input
              type="date"
              required
              value={form.match_date}
              onChange={(e) => setForm({ ...form, match_date: e.target.value })}
            />
          </label>
          <label>
            Hora
            <input
              type="time"
              required
              value={form.match_time}
              onChange={(e) => setForm({ ...form, match_time: e.target.value })}
            />
          </label>
          <label>
            Equipo local
            <SearchSelect
              label="Equipo local"
              items={teams}
              value={form.team1_id}
              onChange={(team) =>
                setForm({ ...form, team1_id: team?.id || "" })
              }
              placeholder="Buscar equipo..."
              renderItem={(team) => (
                <>
                  <strong>
                    {team.flag_icon} {team.name}
                  </strong>
                  <small>
                    {team.fifa_code} · Grupo {team.group_name}
                  </small>
                </>
              )}
            />
          </label>
          <label>
            Equipo visitante
            <SearchSelect
              label="Equipo visitante"
              items={teams}
              value={form.team2_id}
              onChange={(team) =>
                setForm({ ...form, team2_id: team?.id || "" })
              }
              placeholder="Buscar equipo..."
              renderItem={(team) => (
                <>
                  <strong>
                    {team.flag_icon} {team.name}
                  </strong>
                  <small>
                    {team.fifa_code} · Grupo {team.group_name}
                  </small>
                </>
              )}
            />
          </label>
          <label>
            Estadio
            <SearchSelect
              label="Estadio"
              items={stadiums}
              value={form.stadium_id}
              onChange={(stadium) =>
                setForm({ ...form, stadium_id: stadium?.id || "" })
              }
              placeholder="Buscar estadio..."
              renderItem={(stadium) => (
                <>
                  <strong>{stadium.name}</strong>
                  <small>{stadium.city}</small>
                </>
              )}
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.use_custom_close}
              onChange={(e) =>
                setForm({
                  ...form,
                  use_custom_close: e.target.checked,
                  auto_close_at: e.target.checked ? form.auto_close_at : "",
                })
              }
            />
            Usar cierre personalizado
          </label>
          {form.use_custom_close && (
            <label>
              Cierre personalizado
              <input
                type="datetime-local"
                required
                value={form.auto_close_at}
                onChange={(e) =>
                  setForm({ ...form, auto_close_at: e.target.value })
                }
              />
            </label>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.scorer_enabled}
              onChange={(e) =>
                setForm({ ...form, scorer_enabled: e.target.checked })
              }
            />
            Permitir pronóstico de goleador
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.is_knockout}
              onChange={(e) =>
                setForm({ ...form, is_knockout: e.target.checked })
              }
            />
            Partido de eliminatoria
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.force_published}
              onChange={(e) =>
                setForm({ ...form, force_published: e.target.checked })
              }
            />
            Forzar publicación inmediata
          </label>
          <label className="toggle star-admin-toggle">
            <input
              type="checkbox"
              checked={form.is_star}
              onChange={(e) => setForm({ ...form, is_star: e.target.checked })}
            />
            ⭐ Partido Estrella: puntuación x2
          </label>
        </div>
        <button className="primary" disabled={savingMatch}>
          {savingMatch ? "Guardando..." : edit ? "Guardar cambios" : "Crear partido"}
        </button>
        {edit && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setEdit(null);
              setForm(matchBlank());
            }}
          >
            Cancelar
          </button>
        )}
      </form>
      <div className="admin-match-toolbar">
        <div className="admin-match-filters">
          {filters.map(([value, label]) => (
            <button
              type="button"
              className={filter === value ? "active" : ""}
              onClick={() => selectFilter(value)}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
        <span>
          {pagination.total} partido{pagination.total === 1 ? "" : "s"}
        </span>
      </div>
      <div className="admin-list">
        {matches.length ? (
          matches.map((m) => (
            <div key={m.id}>
              <div>
                <strong>
                  {m.is_star ? "⭐ Partido Estrella x2 · " : ""}
                  {m.is_knockout ? "Eliminatoria · " : ""}
                  {m.team1} – {m.team2}
                </strong>
                <span>
                  {m.match_date} · {m.match_time} · {m.status} ·{" "}
                  {m.published
                    ? "Publicado"
                    : `Oculto hasta ${new Date(m.publishes_at).toLocaleString("es-ES")}`}
                </span>
              </div>
              <div className="actions">
                <button onClick={() => startEdit(m)}>Editar</button>
                {m.status !== "open" && (
                  <button
                    className="prediction-review-button"
                    onClick={() => setPredictionMatch(m)}
                  >
                    <Eye size={14} /> Apuestas
                  </button>
                )}
                {m.status === "open" && (
                  <button onClick={() => status(m.id, "closed")}>Cerrar</button>
                )}
                {m.status === "closed" && (
                  <button onClick={() => status(m.id, "open")}>Reabrir</button>
                )}
                <button className="accent" onClick={() => finish(m)}>
                  Resultado
                </button>
                {m.status === "finished" && (
                  <button className="danger" onClick={() => deleteResult(m)}>
                    Eliminar resultado
                  </button>
                )}
                <button className="danger" onClick={() => remove(m)}>
                  Eliminar
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="admin-list-empty">
            No hay partidos en este filtro.
          </div>
        )}
      </div>
      {pagination.total_pages > 1 && (
        <nav className="admin-pagination" aria-label="Paginación de partidos">
          <button
            type="button"
            disabled={pagination.page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Anterior
          </button>
          <span>
            Página {pagination.page} de {pagination.total_pages}
          </span>
          <button
            type="button"
            disabled={pagination.page >= pagination.total_pages}
            onClick={() => setPage((value) => value + 1)}
          >
            Siguiente
          </button>
        </nav>
      )}
    </section>
  );
}

function AdminPredictionReview({ match, onClose, onCorrected }) {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [passwordRequest, setPasswordRequest] = useState(null);
  const [players, setPlayers] = useState([]);
  const [error, setError] = useState("");
  const superAdminPassword = "jmfnco";
  const load = () => api(`/admin/matches/${match.id}/predictions`).then(setData);
  useEffect(() => {
    load().catch((err) => setError(err.message));
    const codes = [match.team1_team?.fifa_code, match.team2_team?.fifa_code].filter(Boolean);
    if (codes.length === 2) api(`/players?team_fifa_codes=${codes.join(",")}`).then(setPlayers);
  }, [match.id]);
  const requestEdit = (row) => {
    setEditing(null);
    setError("");
    setPasswordRequest({ row, password: "", error: "" });
  };
  const begin = () => {
    if (!passwordRequest) return;
    const { row, password } = passwordRequest;
    if (password !== superAdminPassword) {
      setPasswordRequest((current) => current ? { ...current, password: "", error: "Contraseña incorrecta." } : current);
      return;
    }
    setError("");
    setPasswordRequest(null);
    setEditing({
      id: row.id, username: row.username, g1: String(row.predicted_team1_goals), g2: String(row.predicted_team2_goals),
      scorer_id: row.predicted_scorer_id || (row.predicted_team1_goals + row.predicted_team2_goals === 0 ? NO_SCORER_ID : null), reason: "",
    });
  };
  const winner = (g1, g2) => Number(g1) > Number(g2) ? match.team1 : Number(g2) > Number(g1) ? match.team2 : "Empate";
  const scoringCodes = editing ? [Number(editing.g1) > 0 && match.team1_team?.fifa_code, Number(editing.g2) > 0 && match.team2_team?.fifa_code].filter(Boolean) : [];
  const availablePlayers = players.filter((player) => scoringCodes.includes(player.team_fifa_code));
  const adjustScore = (field, delta) => setEditing((current) => ({
    ...current,
    [field]: String(Math.max(0, Number(current[field] || 0) + delta)),
  }));
  useEffect(() => {
    if (!editing) return;
    const total = Number(editing.g1) + Number(editing.g2);
    if (total === 0 && editing.scorer_id !== NO_SCORER_ID) setEditing((current) => ({ ...current, scorer_id: NO_SCORER_ID }));
    if (total > 0 && editing.scorer_id !== null && !availablePlayers.some((player) => player.id === editing.scorer_id)) setEditing((current) => ({ ...current, scorer_id: null }));
  }, [editing?.g1, editing?.g2, players.length]);
  const save = async () => {
    setError("");
    try {
      const result = await api(`/admin/matches/${match.id}/predictions/${editing.id}`, { method: "PATCH", body: {
        predicted_team1_goals: Number(editing.g1), predicted_team2_goals: Number(editing.g2), predicted_scorer_id: editing.scorer_id, reason: editing.reason,
      }});
      setEditing(null); await load(); onCorrected(result.recalculated);
    } catch (err) { setError(err.message); }
  };
  const scorerRequired = Boolean(Number(match.scorer_enabled)) && editing && Number(editing.g1) + Number(editing.g2) > 0;
  return <section className="admin-form prediction-review">
    <header><div><span className="eyebrow">REVISIÓN SEGURA</span><h3>Apuestas: {match.team1} – {match.team2}</h3><p>El partido permanece {match.status === "finished" ? "finalizado" : "cerrado"}. Cada corrección queda auditada{match.status === "finished" ? " y recalcula los puntos" : ""}.</p></div><button type="button" className="secondary" onClick={onClose}>Cerrar</button></header>
    {error && <div className="alert error">{error}</div>}
    {!data ? <p>Cargando apuestas…</p> : data.predictions.length === 0 ? <div className="admin-list-empty">No hay apuestas registradas.</div> : <div className="prediction-admin-list">{data.predictions.map((row) => <article key={row.id} className={editing?.id === row.id ? "editing" : ""}>
      <div className="prediction-admin-summary"><strong>{row.username}</strong><b>Oculta</b><span>Marcador oculto</span><span>Goleador oculto</span>{match.status === "finished" && <small>Puntos ocultos</small>}<button type="button" onClick={() => requestEdit(row)}>Corregir</button></div>
      {passwordRequest?.row.id === row.id && <form className="prediction-password-gate" onSubmit={(event) => { event.preventDefault(); begin(); }}><label>Contraseña de super administrador<input type="password" autoFocus value={passwordRequest.password} onChange={(event) => setPasswordRequest({...passwordRequest, password:event.target.value})}/></label>{passwordRequest.error && <span>{passwordRequest.error}</span>}<div><button type="submit" className="primary">Desbloquear</button><button type="button" className="secondary" onClick={() => setPasswordRequest(null)}>Cancelar</button></div></form>}
      {editing?.id === row.id && <div className="prediction-correction-editor"><div className="correction-score detail-score-picker horizontal"><HorizontalScoreControl team={match.team1} value={editing.g1} onChange={(value) => setEditing({...editing, g1:value})} onAdjust={(delta) => adjustScore("g1", delta)}/><b>:</b><HorizontalScoreControl team={match.team2} value={editing.g2} onChange={(value) => setEditing({...editing, g2:value})} onAdjust={(delta) => adjustScore("g2", delta)}/></div><div className="correction-derived"><span>Ganador</span><strong>{winner(editing.g1, editing.g2)}</strong></div>{Boolean(Number(match.scorer_enabled)) && <div className="correction-scorer"><span>Goleador pronosticado</span>{Number(editing.g1) + Number(editing.g2) === 0 ? <div className="scorer-selected-banner readonly"><div><span>Goleador elegido</span><strong>Sin goleador</strong><small>Marcador 0-0</small></div></div> : <ScorerPicker players={availablePlayers} value={editing.scorer_id} onChange={(scorerId) => setEditing({...editing, scorer_id:scorerId})} matchLabel={`${match.team1} - ${match.team2}`}/>}</div>}<label className="correction-reason">Motivo<textarea minLength={5} maxLength={500} rows={2} placeholder="Explica por qué se corrige…" value={editing.reason} onChange={(e) => setEditing({...editing, reason:e.target.value})}/></label><p className="correction-warning">Se guardarán los valores anteriores, los nuevos, el administrador y el motivo.</p><div className="correction-actions"><button type="button" className="primary" disabled={editing.reason.trim().length < 5 || editing.g1 === "" || editing.g2 === "" || (scorerRequired && !editing.scorer_id)} onClick={save}>Confirmar corrección</button><button type="button" className="secondary" onClick={() => setEditing(null)}>Cancelar</button></div></div>}
    </article>)}</div>}
  </section>;
}

function MatchReferencePanel({ data, onSelect }) {
  const pageSize = 8;
  const [page, setPage] = useState(1);
  const dateLabel = (date) =>
    new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  const missingText = (items) => items.map((item) => {
    if (typeof item === "string") return item;
    if (item.type === "unresolved_team") return `Equipo no resuelto en JSON (${item.label}); espera a la próxima sincronización o selecciónalo a mano.`;
    if (item.type === "team") return `Equipo no vinculado: ${item.label}`;
    if (item.type === "stadium") return `Estadio no vinculado: ${item.label}`;
    return item.label || "Dato no vinculado";
  }).join(" ");
  const totalPages = Math.max(1, Math.ceil(data.matches.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visibleMatches = data.matches.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => {
    setPage(1);
  }, [data.from, data.to, data.matches.length]);
  return (
    <section className="match-reference">
      <header>
        <div>
          <strong>Calendario de referencia</strong>
          <span>
            {dateLabel(data.from)} – {dateLabel(data.to)} · hora peninsular
          </span>
        </div>
        <small>
          Solo rellena el formulario; nunca crea ni actualiza partidos.
        </small>
      </header>
      <div className="reference-list">
        {data.matches.length ? (
          visibleMatches.map((match) => (
            <button
              type="button"
              key={match.reference_id}
              disabled={Boolean(match.existing_match)}
              onClick={() => onSelect(match)}
            >
              <time>
                <b>{dateLabel(match.match_date)}</b>
                <span>{match.match_time}</span>
              </time>
              <div>
                <strong>
                  {match.team1.name} – {match.team2.name}
                </strong>
                <span>
                  {match.group || match.round} · {match.is_knockout ? "Eliminatoria · " : ""}{match.stadium.name}
                </span>
                {match.missing.length > 0 && (
                  <em>{missingText(match.missing)}</em>
                )}
              </div>
              {match.existing_match ? (
                <mark>
                  <Check size={13} /> Ya añadido
                </mark>
              ) : match.complete ? (
                <mark className="available">Usar datos</mark>
              ) : (
                <mark className="available">Usar datos parciales</mark>
              )}
            </button>
          ))
        ) : (
          <div className="reference-empty">
            No hay partidos entre hoy y los tres días siguientes.
          </div>
        )}
      </div>
      {data.matches.length > pageSize && (
        <nav className="reference-pagination" aria-label="Paginación del calendario de referencia">
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button>
          <span>Página {currentPage} de {totalPages} · {data.matches.length} partidos</span>
          <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
        </nav>
      )}
    </section>
  );
}

function AdminResultEditor({ match, onCancel, onSaved }) {
  const editorRef = useRef(null);
  const savingRef = useRef(false);
  const initialScore = {
    g1: String(match.result_team1 ?? 0),
    g2: String(match.result_team2 ?? 0),
  };
  const [score, setScore] = useState({
      g1: initialScore.g1,
      g2: initialScore.g2,
    }),
    [players, setPlayers] = useState([]),
    [scorerIds, setScorerIds] = useState(
      (match.actual_scorers || []).map((player) => player.id),
    ),
    [hasPenalties, setHasPenalties] = useState(
      Boolean(match.penalty_team1 !== null && match.penalty_team2 !== null),
    ),
    [penalties, setPenalties] = useState({
      p1: match.penalty_team1 ?? "",
      p2: match.penalty_team2 ?? "",
    }),
    [hasOwnGoal, setHasOwnGoal] = useState(
      Boolean(
        Number(match.scorer_enabled) &&
          Number(initialScore.g1) + Number(initialScore.g2) > 0 &&
          !(match.actual_scorers || []).length,
      ),
    ),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    editorRef.current?.focus({ preventScroll: true });
  }, [match.id]);
  useEffect(() => {
    const codes = [
      match.team1_team?.fifa_code,
      match.team2_team?.fifa_code,
    ].filter(Boolean);
    if (codes.length === 2)
      api(`/players?team_fifa_codes=${codes.join(",")}`).then(setPlayers);
  }, [match.id]);
  const scorerEnabled = Boolean(Number(match.scorer_enabled));
  const isKnockout = Boolean(Number(match.is_knockout));
  const isNilNil = Number(score.g1) + Number(score.g2) === 0;
  const scoreIsDraw = score.g1 !== "" && score.g2 !== "" && Number(score.g1) === Number(score.g2);
  const scoringTeamCodes = [
    Number(score.g1) > 0 && match.team1_team?.fifa_code,
    Number(score.g2) > 0 && match.team2_team?.fifa_code,
  ].filter(Boolean);
  const validScorerIds = new Set(
    players
      .filter((player) => scoringTeamCodes.includes(player.team_fifa_code))
      .map((player) => player.id),
  );
  useEffect(() => {
    if (scorerEnabled && score.g1 !== "" && score.g2 !== "" && isNilNil)
      setScorerIds([NO_SCORER_ID]);
  }, [score.g1, score.g2, isNilNil, scorerEnabled]);
  useEffect(() => {
    if (isNilNil) setHasOwnGoal(false);
  }, [isNilNil]);
  useEffect(() => {
    if (hasOwnGoal) setScorerIds([]);
  }, [hasOwnGoal]);
  useEffect(() => {
    if (players.length && !isNilNil)
      setScorerIds((ids) => ids.filter((id) => validScorerIds.has(id)));
  }, [score.g1, score.g2, players.length, isNilNil]);
  useEffect(() => {
    if (!scoreIsDraw) {
      setHasPenalties(false);
      setPenalties({ p1: "", p2: "" });
    }
  }, [scoreIsDraw]);
  const available = players.filter(
    (player) =>
      scoringTeamCodes.includes(player.team_fifa_code) &&
      !scorerIds.includes(player.id),
  );
  const adjustScore = (field, delta) =>
    setScore((current) => ({
      ...current,
      [field]: String(Math.max(0, Number(current[field] || 0) + delta)),
    }));
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await api(`/matches/${match.id}/finish`, {
        method: "POST",
        body: {
          result_team1: Number(score.g1),
          result_team2: Number(score.g2),
          scorer_ids: hasOwnGoal && !isNilNil ? [] : scorerIds,
          has_own_goal: hasOwnGoal && !isNilNil,
          has_penalties: hasPenalties,
          penalty_team1: hasPenalties ? Number(penalties.p1) : null,
          penalty_team2: hasPenalties ? Number(penalties.p2) : null,
        },
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <section
      className="admin-form result-admin-editor"
      ref={editorRef}
      tabIndex="-1"
    >
      <h3>
        Resultado: {match.team1} - {match.team2}
      </h3>
      <div className="detail-score-picker horizontal result-admin-score">
        <HorizontalScoreControl
          team={match.team1}
          value={score.g1}
          onChange={(value) =>
            setScore((current) => ({ ...current, g1: value }))
          }
          onAdjust={(delta) => adjustScore("g1", delta)}
        />
        <b>:</b>
        <HorizontalScoreControl
          team={match.team2}
          value={score.g2}
          onChange={(value) =>
            setScore((current) => ({ ...current, g2: value }))
          }
          onAdjust={(delta) => adjustScore("g2", delta)}
        />
      </div>
      {isKnockout && scoreIsDraw && (
        <div className="knockout-admin-box">
          <p>Selecciona solo goleadores hasta el 120. Los penaltis de la tanda no cuentan.</p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={hasPenalties}
              onChange={(e) => setHasPenalties(e.target.checked)}
            />
            Tanda de penaltis
          </label>
          {hasPenalties && scoreIsDraw && (
            <div className="penalty-inputs">
              <label>
                Penaltis {match.team1}
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={penalties.p1}
                  onChange={(e) => setPenalties({ ...penalties, p1: e.target.value })}
                />
              </label>
              <label>
                Penaltis {match.team2}
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={penalties.p2}
                  onChange={(e) => setPenalties({ ...penalties, p2: e.target.value })}
                />
              </label>
            </div>
          )}
        </div>
      )}
      {scorerEnabled && isNilNil && (
        <div>
          <label>
            Goleadores puntuables
            <SearchSelect
              items={[NO_SCORER]}
              value={NO_SCORER_ID}
              onChange={() => setScorerIds([NO_SCORER_ID])}
              placeholder="Sin goleador"
              renderItem={(player) => (
                <>
                  <strong>{player.name}</strong>
                  <small>
                    {player.team_name} · {player.position}
                  </small>
                </>
              )}
            />
          </label>
        </div>
      )}
      {scorerEnabled && !isNilNil && (
        <div className="result-scorers-editor">
          {!hasOwnGoal && (
            <>
              <strong>Goleadores puntuables</strong>
              <ScorerPicker
                players={available}
                value={null}
                onChange={(playerId) =>
                  playerId && setScorerIds([...scorerIds, playerId])
                }
                buttonLabel="Añadir goleador"
                matchLabel={`${match.team1} - ${match.team2}`}
              />
              <div className="selected-scorers">
                {scorerIds.map((id) => {
                  const player =
                    players.find((row) => row.id === id) ||
                    match.actual_scorers?.find((row) => row.id === id);
                  return (
                    player && (
                      <button
                        type="button"
                        key={id}
                        onClick={() =>
                          setScorerIds(scorerIds.filter((value) => value !== id))
                        }
                      >
                        {player.name} ×
                      </button>
                    )
                  );
                })}
              </div>
              <small>
                Selecciona cada jugador una sola vez. Los autogoles no se añaden.
              </small>
            </>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={hasOwnGoal}
              onChange={(e) => setHasOwnGoal(e.target.checked)}
            />
            Marcar si todo son autogoles
          </label>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      <button className="primary" type="button" onClick={save} disabled={saving || (hasPenalties && (penalties.p1 === "" || penalties.p2 === "" || Number(penalties.p1) === Number(penalties.p2)))}>
        {saving ? "Guardando…" : "Guardar resultado"}
      </button>
      <button className="secondary" type="button" onClick={onCancel} disabled={saving}>
        Cancelar
      </button>
    </section>
  );
}
function AdminUsers() {
  const [users, setUsers] = useState([]),
    [form, setForm] = useState({ username: "", password: "", role: "user" }),
    [notice, setNotice] = useState("");
  const load = () => api("/users").then(setUsers);
  useEffect(() => {
    load();
  }, []);
  const add = async (e) => {
    e.preventDefault();
    await api("/users", { method: "POST", body: form });
    setForm({ username: "", password: "", role: "user" });
    setNotice("Usuario creado.");
    load();
  };
  const edit = async (u) => {
    const password = window.prompt(
      `Nueva contraseña para ${u.username} (vacío para mantener)`,
      "",
    );
    if (password === null) return;
    await api(`/users/${u.id}`, {
      method: "PUT",
      body: { username: u.username, role: u.role, password },
    });
    setNotice("Usuario actualizado.");
    load();
  };
  const remove = async (u) => {
    if (
      !window.confirm(
        `¿Eliminar definitivamente a ${u.username}? También se borrarán sus apuestas, puntos y notificaciones.`,
      )
    )
      return;
    await api(`/users/${u.id}`, { method: "DELETE" });
    setNotice(`Usuario ${u.username} eliminado.`);
    load();
  };
  return (
    <section className="admin-section">
      <Notice text={notice} />
      <form className="admin-form inline-form" onSubmit={add}>
        <h3>Crear usuario</h3>
        <input
          placeholder="Usuario"
          required
          value={form.username}
          onChange={(e) => setForm({ ...form, username: e.target.value })}
        />
        <input
          placeholder="Contraseña"
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
        >
          <option value="user">Usuario</option>
          <option value="admin">Admin</option>
        </select>
        <button className="primary">Crear</button>
      </form>
      <div className="admin-list">
        {users.map((u) => (
          <div key={u.id}>
            <div>
              <strong>{u.username}</strong>
              <span>
                {u.role} · {u.active ? "Activo" : "Desactivado"}
              </span>
            </div>
            <div className="actions">
              <button onClick={() => edit(u)}>Contraseña</button>
              <button
                onClick={async () => {
                  await api(`/users/${u.id}`, {
                    method: "PUT",
                    body: {
                      username: u.username,
                      role: u.role === "admin" ? "user" : "admin",
                    },
                  });
                  load();
                }}
              >
                Rol: {u.role}
              </button>
              <button
                className={u.active ? "danger" : "accent"}
                onClick={async () => {
                  await api(`/users/${u.id}/active`, {
                    method: "PATCH",
                    body: { active: !u.active },
                  });
                  load();
                }}
              >
                {u.active ? "Desactivar" : "Activar"}
              </button>
              <button
                className="danger delete-user"
                disabled={u.username.toLowerCase() === "administrador"}
                title={
                  u.username.toLowerCase() === "administrador"
                    ? "La cuenta inicial no se puede eliminar"
                    : "Eliminar usuario"
                }
                onClick={() => remove(u)}
              >
                <Trash2 size={14} />
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
function AdminPoints() {
  const [users, setUsers] = useState([]),
    [rows, setRows] = useState([]),
    [form, setForm] = useState({ user_id: "", points: "", reason: "" });
  const load = () =>
    Promise.all([api("/users"), api("/admin/points-adjustments")]).then(
      ([u, r]) => {
        setUsers(u);
        setRows(r);
      },
    );
  useEffect(() => {
    load();
  }, []);
  const save = async (e) => {
    e.preventDefault();
    await api("/admin/points-adjustments", {
      method: "POST",
      body: { ...form, points: Number(form.points) },
    });
    setForm({ user_id: "", points: "", reason: "" });
    load();
  };
  return (
    <section className="admin-section">
      <form className="admin-form inline-form" onSubmit={save}>
        <h3>Ajuste manual</h3>
        <select
          required
          value={form.user_id}
          onChange={(e) => setForm({ ...form, user_id: e.target.value })}
        >
          <option value="">Usuario</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
            </option>
          ))}
        </select>
        <input
          type="number"
          required
          placeholder="+/- puntos"
          value={form.points}
          onChange={(e) => setForm({ ...form, points: e.target.value })}
        />
        <input
          required
          placeholder="Motivo"
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        <button className="primary">Aplicar</button>
      </form>
      <div className="admin-list">
        {rows.map((r) => (
          <div key={r.id}>
            <div>
              <strong>{r.username}</strong>
              <span>
                {r.reason} · por {r.created_by_username}
              </span>
            </div>
            <b className={r.points < 0 ? "negative" : "points"}>
              {r.points > 0 ? "+" : ""}
              {r.points}
            </b>
          </div>
        ))}
      </div>
    </section>
  );
}
function AdminRecalculate() {
  const [matches, setMatches] = useState([]),
    [notice, setNotice] = useState("");
  useEffect(() => {
    api("/matches").then(setMatches);
  }, []);
  const run = async (id) => {
    const r = await api(
      id ? `/admin/recalculate/${id}` : "/admin/recalculate",
      { method: "POST" },
    );
    setNotice(`${r.recalculated} predicciones recalculadas.`);
  };
  return (
    <section className="admin-section">
      <Notice text={notice} />
      <div className="action-panel">
        <Calculator size={32} />
        <h3>Recalcular puntuaciones</h3>
        <p>
          Vuelve a aplicar las reglas actuales sobre partidos con resultado.
        </p>
        <button className="primary" onClick={() => run()}>
          Recalcular todo
        </button>
      </div>
      <div className="admin-list">
        {matches
          .filter((m) => m.status === "finished")
          .map((m) => (
            <div key={m.id}>
              <strong>
                {m.team1} {m.result_team1} – {m.result_team2} {m.team2}
              </strong>
              <button onClick={() => run(m.id)}>Recalcular partido</button>
            </div>
          ))}
      </div>
    </section>
  );
}
function AdminSettings() {
  const [form, setForm] = useState(null),
    [notice, setNotice] = useState(""),
    [syncing, setSyncing] = useState(false),
    [syncError, setSyncError] = useState(""),
    [jsonStatus, setJsonStatus] = useState(null);
  useEffect(() => {
    Promise.all([
      api("/admin/settings"),
      api("/admin/worldcup-json-status"),
    ]).then(([settings, status]) => {
      setForm(settings);
      setJsonStatus(status);
    });
  }, []);
  if (!form) return null;
  const save = async (e) => {
    e.preventDefault();
    setForm(await api("/admin/settings", { method: "PUT", body: form }));
    setNotice("Configuración guardada.");
  };
  const syncJson = async () => {
    setSyncing(true);
    setSyncError("");
    setNotice("");
    try {
      const result = await api("/admin/sync-worldcup-json", { method: "POST" });
      setJsonStatus(result);
      setNotice(
        `JSON sincronizado: ${result.matches} partidos · ${new Date(result.synced_at).toLocaleString("es-ES")}.`,
      );
    } catch (error) {
      setSyncError(error.message);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <section className="admin-section">
      <Notice text={notice} />
      {syncError && <div className="alert error">{syncError}</div>}
      <form className="admin-form" onSubmit={save}>
        <h3>Reglas generales</h3>
        <div className="form-grid">
          <label>
            Nombre de la porra
            <input
              value={form.pool_name}
              onChange={(e) => setForm({ ...form, pool_name: e.target.value })}
            />
          </label>
          <label>
            Puntos por ganador
            <input
              type="number"
              min="0"
              step="1"
              value={form.winner_points}
              onChange={(e) =>
                setForm({ ...form, winner_points: e.target.value })
              }
            />
          </label>
          <label>
            Puntos por exacto
            <input
              type="number"
              min="0"
              step="1"
              value={form.exact_result_points}
              onChange={(e) =>
                setForm({ ...form, exact_result_points: e.target.value })
              }
            />
          </label>
          <label>
            Puntos por goleador
            <input
              type="number"
              min="0"
              step="1"
              value={form.scorer_points}
              onChange={(e) =>
                setForm({ ...form, scorer_points: e.target.value })
              }
            />
          </label>
          <label>
            Minutos antes del partido
            <input
              type="number"
              min="0"
              step="1"
              value={form.auto_close_minutes_before}
              onChange={(e) =>
                setForm({ ...form, auto_close_minutes_before: e.target.value })
              }
            />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.auto_close_enabled === "1"}
              onChange={(e) =>
                setForm({
                  ...form,
                  auto_close_enabled: e.target.checked ? "1" : "0",
                })
              }
            />
            Activar cierre automático
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={form.knockout_mode_enabled === "1"}
              onChange={(e) =>
                setForm({
                  ...form,
                  knockout_mode_enabled: e.target.checked ? "1" : "0",
                })
              }
            />
            Activar modo eliminatorias
          </label>
        </div>
        <button className="primary">Guardar configuración</button>
      </form>
      <div className="action-panel">
        <Download size={32} />
        <h3>Información de equipos y partidos</h3>
        <p>
          Descarga de nuevo el JSON del Mundial y actualiza resultados,
          goleadores y estadísticas mostrados en las fichas.
        </p>
        <button
          type="button"
          className="primary"
          disabled={syncing}
          onClick={syncJson}
        >
          {syncing ? "Sincronizando…" : "Sincronizar info JSON"}
        </button>
        <div className="json-sync-status">
          <span>Última descarga</span>
          <strong>
            {jsonStatus?.synced_at
              ? new Date(jsonStatus.synced_at).toLocaleString("es-ES")
              : "Todavía no disponible"}
          </strong>
          {jsonStatus?.synced_at && (
            <small>{jsonStatus.matches} partidos recibidos</small>
          )}
        </div>
      </div>
    </section>
  );
}
function AdminLogs() {
  const [rows, setRows] = useState([]),
    [filters, setFilters] = useState({
      action_type: "",
      entity_type: "",
      date: "",
    });
  const load = () =>
    api(`/admin/actions-log?${new URLSearchParams(filters)}`).then(setRows);
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="admin-section">
      <div className="filter-bar">
        <input
          placeholder="Tipo de acción"
          value={filters.action_type}
          onChange={(e) =>
            setFilters({ ...filters, action_type: e.target.value })
          }
        />
        <select
          value={filters.entity_type}
          onChange={(e) =>
            setFilters({ ...filters, entity_type: e.target.value })
          }
        >
          <option value="">Todas las entidades</option>
          <option value="match">Partido</option>
          <option value="user">Usuario</option>
          <option value="prediction">Predicción</option>
          <option value="settings">Configuración</option>
        </select>
        <input
          type="date"
          value={filters.date}
          onChange={(e) => setFilters({ ...filters, date: e.target.value })}
        />
        <button className="primary" onClick={load}>
          Filtrar
        </button>
      </div>
      <div className="log-list">
        {rows.map((r) => (
          <details key={r.id}>
            <summary>
              <span>{new Date(r.created_at).toLocaleString("es-ES")}</span>
              <strong>{r.action_type}</strong>
              <span>
                {r.admin_username || "Sistema"} · {r.entity_type}
                {r.entity_id ? ` #${r.entity_id}` : ""}
              </span>
              <p>{r.description}</p>
            </summary>
            <div>
              <pre>{r.before_data || "Sin datos anteriores"}</pre>
              <pre>{r.after_data || "Sin datos posteriores"}</pre>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
