import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CircleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

const groupLabel = (group) => ({
  exact: "Exactos",
  winner: "Ganadores",
  scorer: "Goleadores",
  draw: "Empates",
  points: "Puntos",
  participation: "Participacion",
  record: "Record",
  leader: "Liderazgo",
  milestone: "Hito"
}[group] || "Logro");

const holdersText = (holders = []) => {
  if (!holders.length) return "Sin titular";
  if (holders.length === 1) return holders[0];
  return `${holders.slice(0, -1).join(", ")} y ${holders[holders.length - 1]}`;
};

const missingForTier = (value, threshold) => Math.max(0, Number(threshold || 0) - Number(value || 0));

const progressForTier = (value, threshold) => {
  const total = Number(threshold || 0);
  if (!total) return 0;
  return Math.min(100, Math.max(0, (Number(value || 0) / total) * 100));
};

const sortBadges = (badges = []) => [...badges].sort((a, b) =>
  Number(a.order ?? 99) - Number(b.order ?? 99) ||
  Number(b.level ?? 0) - Number(a.level ?? 0) ||
  String(a.name).localeCompare(String(b.name), "es")
);

const sortCatalog = (catalog = []) => [...catalog].sort((a, b) => Number(a.order ?? 99) - Number(b.order ?? 99));

function HorizontalRail({ children, className = "", label }) {
  return <div className={`medals-horizontal-rail ${className}`} aria-label={label}>
    {children}
  </div>;
}

function MedalsHero({ achievedCount }) {
  const navigate = useNavigate();

  return <section className="medals-showcase-hero">
    <div>
      <button type="button" className="medals-back-button" onClick={() => navigate("/")}>
        <ArrowLeft size={16} /> Inicio
      </button>
      <span className="eyebrow">MEDALLERO</span>
      <h1>Tu vitrina</h1>
      <p>Medallas, records y logros de la porra.</p>
    </div>
    <aside className="medals-hero-count" aria-label={`${achievedCount} medallas conseguidas`}>
      <strong>{achievedCount}</strong>
      <span>conseguidas</span>
    </aside>
  </section>;
}

function QuickStatCard({ label, value }) {
  return <article className="medals-stat-pill">
    <small>{label}</small>
    <strong>{value}</strong>
  </article>;
}

function MedalsQuickStats({ badges, disputed, catalog, achievedTierCount, tierCount }) {
  return <section className="medals-quick-stats" aria-label="Resumen del medallero">
    <QuickStatCard label="Conseguidas" value={badges.length} />
    <QuickStatCard label="En disputa" value={disputed.length} />
    <QuickStatCard label="Progreso" value={`${achievedTierCount}/${tierCount}`} />
    <QuickStatCard label="Categorias" value={catalog.length} />
  </section>;
}

function EmptyShelf({ title, text }) {
  return <div className="medals-empty-shelf">
    <strong>{title}</strong>
    {text && <p>{text}</p>}
  </div>;
}

function MedalsShelf({ title, subtitle, count, children }) {
  return <section className="medals-shelf">
    <header className="medals-shelf-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {typeof count === "number" && <span>{count}</span>}
    </header>
    {children}
  </section>;
}

function ShowcaseMedalCard({ badge }) {
  return <article className="medal-showcase-card achieved">
    <span className="medal-showcase-icon" aria-hidden="true">{badge.icon || "🏅"}</span>
    <div className="medal-showcase-copy">
      <h3>{badge.name}</h3>
      <p>{badge.description || "Medalla de Mundiporra."}</p>
    </div>
    <span className="medal-showcase-pill">{groupLabel(badge.group || badge.kind)}</span>
  </article>;
}

function DisputedMedalCard({ badge }) {
  return <article className="medal-showcase-card disputed">
    <span className="medal-showcase-icon" aria-hidden="true">{badge.icon || "🏅"}</span>
    <div className="medal-showcase-copy">
      <h3>{badge.name}</h3>
      <p>{badge.description || "Puede cambiar de dueno."}</p>
    </div>
    <span className="medal-showcase-pill">Ahora: {holdersText(badge.holders)}</span>
  </article>;
}

function UpcomingMedalCard({ badge }) {
  const progress = progressForTier(badge.value, badge.threshold);
  return <article className="medal-showcase-card upcoming">
    <span className="medal-showcase-icon" aria-hidden="true">{badge.icon || "🏅"}</span>
    <div className="medal-showcase-copy">
      <span>{badge.category}</span>
      <h3>{badge.name}</h3>
    </div>
    <div className="medal-progress-mini" aria-label={`${badge.value || 0} de ${badge.threshold}`}>
      <i style={{ width: `${progress}%` }} />
    </div>
    <span className="medal-showcase-pill">{badge.missing === 1 ? "A 1 de conseguirla" : `Faltan ${badge.missing}`}</span>
  </article>;
}

function TierShowcaseCard({ tier, category }) {
  const missing = missingForTier(category.value, tier.threshold);
  const progress = progressForTier(category.value, tier.threshold);

  return <article className={`medal-tier-showcase-card ${tier.achieved ? "achieved" : ""}`}>
    <span className="medal-showcase-icon" aria-hidden="true">{tier.icon || "🏅"}</span>
    <div className="medal-showcase-copy">
      <h3>{tier.name}</h3>
      <p>Objetivo: {tier.threshold}</p>
    </div>
    <div className="medal-progress-mini" aria-label={`${category.value || 0} de ${tier.threshold}`}>
      <i style={{ width: `${progress}%` }} />
    </div>
    <span className="medal-showcase-pill">{tier.achieved ? "Ganada" : `Faltan ${missing}`}</span>
  </article>;
}

function CatalogCategoryPanel({ category }) {
  const tiers = [...(category?.tiers || [])].sort((a, b) => Number(a.threshold || 0) - Number(b.threshold || 0));
  const achieved = tiers.filter((tier) => tier.achieved).length;

  return <article className="medals-category-panel">
    <header>
      <div>
        <span>{groupLabel(category?.group)}</span>
        <h3>{category?.title || "Catalogo"}</h3>
      </div>
      <strong>{achieved}/{tiers.length}</strong>
    </header>
    <HorizontalRail className="medals-tier-rail" label={`Niveles de ${category?.title || "categoria"}`}>
      {tiers.map((tier) => <TierShowcaseCard tier={tier} category={category} key={`${category.group}-${tier.level}`} />)}
    </HorizontalRail>
  </article>;
}

function CatalogShowcase({ catalog }) {
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0);
  const activeCategory = catalog[activeCategoryIndex] || catalog[0];

  useEffect(() => {
    if (activeCategoryIndex > Math.max(0, catalog.length - 1)) {
      setActiveCategoryIndex(0);
    }
  }, [activeCategoryIndex, catalog.length]);

  if (!catalog.length) {
    return <MedalsShelf title="Catalogo" subtitle="Niveles y objetivos.">
      <EmptyShelf title="Catalogo vacio" text="Aparecera aqui cuando haya medallas." />
    </MedalsShelf>;
  }

  return <section className="medals-catalog-showcase">
    <header className="medals-shelf-header">
      <div>
        <h2>Catalogo</h2>
        <p>Elige una categoria.</p>
      </div>
      <span>{catalog.length}</span>
    </header>
    <div className="medals-category-chips" aria-label="Categorias del catalogo">
      {catalog.map((category, index) => (
        <button
          type="button"
          className={index === activeCategoryIndex ? "active" : ""}
          onClick={() => setActiveCategoryIndex(index)}
          key={category.group || category.title}
        >
          {category.title || groupLabel(category.group)}
        </button>
      ))}
    </div>
    <CatalogCategoryPanel category={activeCategory} />
  </section>;
}

export function MedalsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError("");
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
      .map((tier) => ({
        ...tier,
        group: category.group,
        category: category.title || groupLabel(category.group),
        value: category.value,
        missing: missingForTier(category.value, tier.threshold)
      })))
    .sort((a, b) => a.missing - b.missing || Number(a.threshold || 0) - Number(b.threshold || 0))
    .slice(0, 8), [catalog]);
  const achievedTierCount = catalog.reduce((sum, category) => sum + (category.tiers || []).filter((tier) => tier.achieved).length, 0);
  const tierCount = catalog.reduce((sum, category) => sum + (category.tiers || []).length, 0);

  return <div className="page medals-page medals-showcase-page">
    <MedalsHero achievedCount={badges.length} />

    {loading && <div className="medals-loader" role="status">
      <strong>Cargando medallero...</strong>
    </div>}

    {!loading && error && <div className="medals-error" role="alert">
      <CircleAlert size={22} />
      <strong>No hemos podido cargar el medallero</strong>
      <p>{error}</p>
      <button type="button" className="primary" onClick={() => window.location.reload()}>Reintentar</button>
    </div>}

    {!loading && !error && <>
      <MedalsQuickStats badges={badges} disputed={disputed} catalog={catalog} achievedTierCount={achievedTierCount} tierCount={tierCount} />

      <MedalsShelf title="Tu vitrina" subtitle="Las medallas que ya has ganado." count={badges.length}>
        {badges.length ? <HorizontalRail label="Medallas conseguidas">
          {badges.map((badge) => <ShowcaseMedalCard badge={badge} key={`${badge.name}-${badge.description}`} />)}
        </HorizontalRail> : <EmptyShelf title="Aun no tienes medallas" text="Cuando desbloquees la primera aparecera aqui." />}
      </MedalsShelf>

      <MedalsShelf title="En disputa" subtitle="Pueden cambiar de dueno." count={disputed.length}>
        {disputed.length ? <HorizontalRail label="Medallas en disputa">
          {disputed.map((badge) => <DisputedMedalCard badge={badge} key={`${badge.name}-${badge.description}`} />)}
        </HorizontalRail> : <EmptyShelf title="No hay medallas en disputa ahora mismo." />}
      </MedalsShelf>

      <MedalsShelf title="Cerca de desbloquear" subtitle="Tus siguientes objetivos." count={upcoming.length}>
        {upcoming.length ? <HorizontalRail label="Medallas cerca de desbloquear">
          {upcoming.map((badge) => <UpcomingMedalCard badge={badge} key={`${badge.group}-${badge.level}`} />)}
        </HorizontalRail> : <EmptyShelf title="Todo el catalogo completado" text="No hay niveles pendientes." />}
      </MedalsShelf>

      <CatalogShowcase catalog={catalog} />
    </>}
  </div>;
}
