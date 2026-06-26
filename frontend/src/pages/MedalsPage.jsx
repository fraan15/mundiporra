import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, CircleAlert, Crown, Lock, Medal, Sparkles, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

const holdersText = (holders = []) => {
  if (!holders.length) return "Sin titular ahora mismo";
  if (holders.length === 1) return holders[0];
  return `${holders.slice(0, -1).join(", ")} y ${holders[holders.length - 1]}`;
};

const missingForTier = (value, threshold) => Math.max(0, Number(threshold || 0) - Number(value || 0));

const sortBadges = (badges = []) => [...badges].sort((a, b) =>
  Number(a.order ?? 99) - Number(b.order ?? 99) ||
  Number(b.level ?? 0) - Number(a.level ?? 0) ||
  String(a.name).localeCompare(String(b.name), "es")
);

const sortCatalog = (catalog = []) => [...catalog].sort((a, b) => Number(a.order ?? 99) - Number(b.order ?? 99));

function MedalIcon({ icon, locked = false }) {
  return <span className={`medal-card-icon ${locked ? "locked" : ""}`} aria-hidden="true">{icon || "🏅"}</span>;
}

function MedalCard({ badge, locked = false }) {
  return <article className={`medal-card ${locked ? "medal-card-locked" : "medal-card-achieved"} ${badge.kind || badge.group || ""}`}>
    <MedalIcon icon={badge.icon} locked={locked} />
    <div>
      <span className="medal-card-kicker">{badge.group || badge.kind || "Logro"}</span>
      <h3>{badge.name}</h3>
      <p>{badge.description || "Medalla de Mundiporra."}</p>
    </div>
    <strong>{locked ? <Lock size={15} /> : <Check size={15} />}{locked ? "Pendiente" : "Conseguida"}</strong>
  </article>;
}

function EmptyMedals() {
  return <div className="medals-empty-state">
    <Medal size={34} />
    <strong>Tu vitrina esta calentando</strong>
    <p>Las medallas aparecen aqui cuando alcanzas objetivos, lideras alguna estadistica o marcas un record de la porra.</p>
  </div>;
}

function DisputedCard({ badge }) {
  return <article className={`medals-disputed-card ${badge.kind || ""}`}>
    <div className="medals-disputed-medal"><MedalIcon icon={badge.icon} /></div>
    <div>
      <span>En disputa</span>
      <h3>{badge.name}</h3>
      <p>{badge.description || "Medalla competitiva que puede cambiar segun la clasificacion actual."}</p>
      <strong><Crown size={15} />{holdersText(badge.holders)}</strong>
    </div>
  </article>;
}

function CategoryCard({ category }) {
  const value = Number(category.value || 0);
  const tiers = [...(category.tiers || [])].sort((a, b) => Number(a.threshold || 0) - Number(b.threshold || 0));
  const achieved = tiers.filter((tier) => tier.achieved).length;

  return <article className={`medals-category-card ${category.group || ""}`}>
    <header>
      <div>
        <span className="medals-category-mark"><Trophy size={18} /></span>
        <div>
          <h3>{category.title}</h3>
          <p>{achieved} de {tiers.length} niveles conseguidos</p>
        </div>
      </div>
      <span className="medal-progress-pill">Ahora: {value}</span>
    </header>
    <div className="medal-tier-list">
      {tiers.map((tier) => {
        const missing = missingForTier(value, tier.threshold);
        return <div className={`medal-tier-item ${tier.achieved ? "achieved" : "locked"}`} key={`${category.group}-${tier.level}`}>
          <MedalIcon icon={tier.icon} locked={!tier.achieved} />
          <div>
            <strong>{tier.name}</strong>
            <p>{tier.description}</p>
            <small>Objetivo: {tier.threshold}</small>
          </div>
          <span>{tier.achieved ? <><Check size={14} />Conseguida</> : <><Lock size={14} />Faltan {missing}</>}</span>
        </div>;
      })}
    </div>
  </article>;
}

export function MedalsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("resumen");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api("/dashboard/medals")
      .then((result) => { if (mounted) setData(result); })
      .catch((err) => { if (mounted) setError(err.message || "No se pudo cargar el medallero."); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const badges = useMemo(() => sortBadges(data?.badges || []), [data]);
  const disputed = useMemo(() => sortBadges(data?.disputed_badges || []), [data]);
  const catalog = useMemo(() => sortCatalog(data?.badge_catalog || []), [data]);
  const upcoming = useMemo(() => catalog
    .flatMap((category) => (category.tiers || [])
      .filter((tier) => !tier.achieved)
      .map((tier) => ({ ...tier, group: category.group, category: category.title, value: category.value, missing: missingForTier(category.value, tier.threshold) })))
    .sort((a, b) => a.missing - b.missing || Number(a.threshold || 0) - Number(b.threshold || 0))
    .slice(0, 4), [catalog]);
  const achievedTierCount = catalog.reduce((sum, category) => sum + (category.tiers || []).filter((tier) => tier.achieved).length, 0);
  const tierCount = catalog.reduce((sum, category) => sum + (category.tiers || []).length, 0);

  const tabs = [
    ["resumen", "Resumen"],
    ["disputa", "En disputa"],
    ["catalogo", "Catalogo"],
    ["conseguidas", "Conseguidas"]
  ];

  const goToSection = (id) => {
    setActiveTab(id);
    document.getElementById(`medals-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <div className="page medals-page">
    <section className="medals-hero" id="medals-resumen">
      <div>
        <button type="button" className="medals-back-button" onClick={() => navigate("/")}>
          <ArrowLeft size={17} /> Inicio
        </button>
        <span className="eyebrow">LOGROS</span>
        <h1>Medallero</h1>
        <p>Consulta todas las insignias de la porra, como se consiguen y cuales estan ahora mismo en disputa.</p>
      </div>
      <div className="medals-hero-emblem" aria-hidden="true">
        <span>🏆</span>
        <small>Mundiporra</small>
      </div>
    </section>

    <nav className="medals-tabs" aria-label="Secciones del medallero">
      {tabs.map(([id, label]) => <button type="button" className={activeTab === id ? "active" : ""} key={id} onClick={() => goToSection(id)}>{label}</button>)}
    </nav>

    {loading && <div className="medals-loader" role="status">
      <Sparkles size={26} />
      <strong>Cargando medallero</strong>
      <span>Preparando insignias, titulares y progreso.</span>
    </div>}

    {!loading && error && <div className="medals-error" role="alert">
      <CircleAlert size={24} />
      <strong>No hemos podido cargar el medallero</strong>
      <p>{error}</p>
      <button type="button" className="primary" onClick={() => window.location.reload()}>Reintentar</button>
    </div>}

    {!loading && !error && <>
      <section className="medals-summary-grid" aria-label="Resumen del medallero">
        <article className="medals-summary-card"><span><Check size={18} /></span><small>Conseguidas</small><strong>{badges.length}</strong></article>
        <article className="medals-summary-card"><span><Crown size={18} /></span><small>En disputa</small><strong>{disputed.length}</strong></article>
        <article className="medals-summary-card"><span><Trophy size={18} /></span><small>Categorias</small><strong>{catalog.length}</strong></article>
        <article className="medals-summary-card"><span><Lock size={18} /></span><small>Progreso</small><strong>{achievedTierCount}/{tierCount}</strong></article>
      </section>

      <section className="medals-explainer">
        <p>Las medallas de progreso se consiguen al alcanzar objetivos.</p>
        <p>Las medallas en disputa pueden cambiar segun la clasificacion y estadisticas actuales.</p>
        <p>Algunas medallas son records o liderazgos temporales.</p>
      </section>

      <section className="medals-section" id="medals-conseguidas">
        <div className="medals-section-head">
          <div><span className="eyebrow">TU VITRINA</span><h2>Tus medallas</h2></div>
          <span>{badges.length} logradas</span>
        </div>
        {badges.length ? <div className="medals-grid">{badges.map((badge) => <MedalCard badge={badge} key={`${badge.name}-${badge.description}`} />)}</div> : <EmptyMedals />}
      </section>

      <section className="medals-section" id="medals-disputa">
        <div className="medals-section-head">
          <div><span className="eyebrow">COMPETITIVAS</span><h2>Medallas en disputa</h2></div>
          <span>{disputed.length} activas</span>
        </div>
        {disputed.length ? <div className="medals-disputed-grid">{disputed.map((badge) => <DisputedCard badge={badge} key={`${badge.name}-${badge.description}`} />)}</div> : <div className="medals-empty-state compact"><Crown size={28} /><strong>No hay medallas en disputa</strong><p>Cuando aparezcan liderazgos o records activos se mostraran aqui.</p></div>}
      </section>

      <section className="medals-section">
        <div className="medals-section-head">
          <div><span className="eyebrow">SIGUIENTES</span><h2>Proximas por desbloquear</h2></div>
        </div>
        {upcoming.length ? <div className="medals-grid upcoming">
          {upcoming.map((badge) => <MedalCard badge={{ ...badge, description: `${badge.description} Categoria: ${badge.category}.`, kind: badge.group }} locked key={`${badge.group}-${badge.level}`} />)}
        </div> : <div className="medals-empty-state compact"><Check size={28} /><strong>Todo el catalogo completado</strong><p>No hay niveles pendientes en este momento.</p></div>}
      </section>

      <section className="medals-section" id="medals-catalogo">
        <div className="medals-section-head">
          <div><span className="eyebrow">GUIA COMPLETA</span><h2>Catalogo completo</h2></div>
          <span>{catalog.length} categorias</span>
        </div>
        <div className="medals-category-list">
          {catalog.map((category) => <CategoryCard category={category} key={category.group} />)}
        </div>
      </section>

      <button type="button" className="medals-top-link" onClick={() => goToSection("resumen")}>
        Volver arriba <ChevronRight size={15} />
      </button>
    </>}
  </div>;
}
