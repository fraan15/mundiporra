import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CircleAlert, Info, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { BadgeCatalogDialog } from "../components/SportsUI";

const groupLabel = (group) => ({
  exact: "Exactos",
  winner: "Ganadores",
  scorer: "Goleadores",
  draw: "Empates",
  points: "Puntos",
  participation: "Participacion",
  record: "Record",
  leader: "Liderazgo",
  milestone: "Hito",
  special: "Especial"
}[group] || "Logro");

const compactDescription = (text = "") => text.replace(/\s+/g, " ").trim();

const holdersText = (holders = []) => {
  if (!holders.length) return "";
  if (holders.length === 1) return holders[0];
  return `${holders.slice(0, -1).join(", ")} y ${holders[holders.length - 1]}`;
};

const missingForTier = (value, threshold) => Math.max(0, Number(threshold || 0) - Number(value || 0));

const progressForTier = (value, threshold, achieved = false) => {
  if (achieved) return 100;
  const total = Number(threshold || 0);
  if (!total) return 0;
  return Math.min(100, Math.max(0, (Number(value || 0) / total) * 100));
};

const medalIdentity = (medal = {}) => [
  medal.group || medal.kind || "special",
  medal.level ?? "",
  medal.name || "",
  medal.threshold ?? ""
].join("|").toLowerCase();

const sortCatalog = (catalog = []) => [...catalog].sort((a, b) => Number(a.order ?? 99) - Number(b.order ?? 99));

const sortBadges = (badges = []) => [...badges].sort((a, b) =>
  Number(a.order ?? 99) - Number(b.order ?? 99) ||
  Number(b.level ?? 0) - Number(a.level ?? 0) ||
  String(a.name).localeCompare(String(b.name), "es")
);

const statusMatches = (medal, statusFilter) => statusFilter === "all" ||
  (statusFilter === "achieved" && medal.achieved) ||
  (statusFilter === "locked" && !medal.achieved && medal.type !== "disputed") ||
  (statusFilter === "disputed" && medal.type === "disputed");

function MedalsCompactHero({ onOpenInfo, hasInfo }) {
  const navigate = useNavigate();

  return <section className="medals-compact-hero">
    <button type="button" className="medals-back-button" onClick={() => navigate("/")}>
      <ArrowLeft size={15} /> Inicio
    </button>
    <div>
      <span className="eyebrow">MEDALLERO</span>
      <h1>Coleccion de medallas</h1>
      <p>Logros, records y retos de la porra.</p>
    </div>
    {hasInfo && <button type="button" className="medals-info-button" onClick={onOpenInfo} aria-label="Informacion de medallas">
      <Info size={16} />
      Info
    </button>}
  </section>;
}

function MedalsFilters({ statusOptions, categoryOptions, activeStatusFilter, activeCategoryFilter, onStatusChange, onCategoryChange }) {
  return <section className="medals-filter-bar" aria-label="Filtros del medallero">
    <div className="medals-filter-group medals-filter-group-primary" aria-label="Estado">
      {statusOptions.map((option) => <button
        type="button"
        className={`medals-filter-chip ${activeStatusFilter === option.value ? "active" : ""}`}
        onClick={() => onStatusChange(option.value)}
        key={option.value}
      >
        <span>{option.label}</span>
        <strong>{option.count}</strong>
      </button>)}
    </div>
    <div className="medals-filter-group medals-filter-group-secondary" aria-label="Categorias">
      {categoryOptions.map((option) => <button
        type="button"
        className={`medals-filter-chip ${activeCategoryFilter === option.value ? "active" : ""}`}
        onClick={() => onCategoryChange(option.value)}
        key={option.value}
      >
        <span>{option.label}</span>
        <strong>{option.count}</strong>
      </button>)}
    </div>
  </section>;
}

function MedalCollectionCard({ medal }) {
  const progress = progressForTier(medal.value, medal.threshold, medal.achieved);
  const holder = holdersText(medal.holders);
  const statusText = medal.type === "disputed"
    ? "En disputa"
    : medal.achieved
      ? "Ganada"
      : medal.missing > 0
        ? `Faltan ${medal.missing}`
        : "Pendiente";

  return <article className={`medal-collection-card ${medal.achieved ? "is-achieved" : "is-locked"} ${medal.type === "disputed" ? "is-disputed" : ""}`}>
    <div className="medal-collection-top">
      <span className="medal-collection-icon" aria-hidden="true">{medal.icon || "🏅"}</span>
      <span className="medal-collection-status">
        {medal.achieved ? <Check size={12} /> : <Lock size={12} />}
        {statusText}
      </span>
    </div>
    <div className="medal-collection-main">
      <h2 className="medal-collection-title">{medal.name}</h2>
      {medal.description && <p className="medal-collection-description">{compactDescription(medal.description)}</p>}
    </div>
    {(medal.threshold || medal.type === "disputed") && <div className="medal-collection-progress" aria-label={medal.threshold ? `${medal.value || 0} de ${medal.threshold}` : statusText}>
      <i style={{ width: `${medal.type === "disputed" ? 100 : progress}%` }} />
    </div>}
    <div className="medal-collection-meta">
      <span>{groupLabel(medal.group)}</span>
      {medal.type === "disputed" && holder ? <small>Ahora: {holder}</small> : medal.threshold ? <small>Objetivo: {medal.threshold}</small> : medal.level ? <small>Nivel {medal.level}</small> : null}
    </div>
  </article>;
}

const chunkMedals = (medals, size = 6) => {
  const chunks = [];
  for (let index = 0; index < medals.length; index += size) {
    chunks.push(medals.slice(index, index + size));
  }
  return chunks;
};

function MedalsCollectionGrid({ medals }) {
  if (!medals.length) return <EmptyCollectionState />;
  const pages = chunkMedals(medals, 6);

  return <section className="medals-collection-slider" aria-label="Medallas">
    {pages.map((page, index) => <div className="medals-collection-page-slide" key={`medals-page-${index}`}>
      <div className="medals-collection-grid">
        {page.map((medal) => <MedalCollectionCard medal={medal} key={medal.id} />)}
      </div>
    </div>)}
  </section>;
}

function EmptyCollectionState() {
  return <div className="medals-empty-collection">
    <strong>No hay medallas con estos filtros</strong>
    <p>Prueba con otra categoria o estado.</p>
  </div>;
}

function buildCollection({ badges, catalog, disputed }) {
  const achievedCatalogKeys = new Set();
  const collection = [];

  sortCatalog(catalog).forEach((category) => {
    const tiers = [...(category.tiers || [])].sort((a, b) => Number(a.threshold || 0) - Number(b.threshold || 0));
    tiers.forEach((tier) => {
      const missing = missingForTier(category.value, tier.threshold);
      const item = {
        id: `tier-${category.group}-${tier.level}-${tier.threshold}-${tier.name}`,
        source: "catalog",
        type: "tier",
        status: tier.achieved ? "achieved" : "locked",
        group: category.group,
        category: category.title || groupLabel(category.group),
        value: category.value,
        threshold: tier.threshold,
        achieved: Boolean(tier.achieved),
        missing,
        icon: tier.icon,
        name: tier.name,
        description: tier.description,
        level: tier.level,
        order: Number(category.order ?? 99)
      };
      if (item.achieved) achievedCatalogKeys.add(medalIdentity(item));
      collection.push(item);
    });
  });

  sortBadges(disputed).forEach((badge, index) => {
    collection.push({
      id: `disputed-${badge.group || badge.kind || "special"}-${badge.name}-${index}`,
      source: "disputed",
      type: "disputed",
      status: "disputed",
      group: badge.group || badge.kind || "special",
      achieved: false,
      icon: badge.icon,
      name: badge.name,
      description: badge.description,
      holders: badge.holders,
      order: Number(badge.order ?? 88)
    });
  });

  sortBadges(badges).forEach((badge, index) => {
    const normalized = {
      ...badge,
      group: badge.group || badge.kind || "special",
      threshold: badge.threshold
    };
    if (achievedCatalogKeys.has(medalIdentity(normalized))) return;

    collection.push({
      id: `earned-${normalized.group}-${badge.name}-${index}`,
      source: "earned",
      type: "special",
      status: "achieved",
      group: ["record", "leader", "milestone"].includes(normalized.group) ? normalized.group : "special",
      achieved: true,
      icon: badge.icon,
      name: badge.name,
      description: badge.description,
      level: badge.level,
      order: Number(badge.order ?? 80)
    });
  });

  return collection.sort((a, b) =>
    Number(a.order ?? 99) - Number(b.order ?? 99) ||
    (a.achieved === b.achieved ? 0 : a.achieved ? -1 : 1) ||
    Number(a.level ?? 0) - Number(b.level ?? 0) ||
    String(a.name).localeCompare(String(b.name), "es")
  );
}

export function MedalsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeStatusFilter, setActiveStatusFilter] = useState("all");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState("all");
  const [infoOpen, setInfoOpen] = useState(false);

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
  const collection = useMemo(() => buildCollection({ badges, catalog, disputed }), [badges, catalog, disputed]);

  const statusOptions = useMemo(() => [
    { value: "all", label: "Todas", count: collection.length },
    { value: "achieved", label: "Conseguidas", count: collection.filter((medal) => medal.achieved).length },
    { value: "locked", label: "Pendientes", count: collection.filter((medal) => !medal.achieved && medal.type !== "disputed").length },
    { value: "disputed", label: "En disputa", count: collection.filter((medal) => medal.type === "disputed").length }
  ], [collection]);

  const categoryOptions = useMemo(() => {
    const matchingStatus = collection.filter((medal) => statusMatches(medal, activeStatusFilter));
    const groups = new Map([["all", { label: "Todas", count: matchingStatus.length }]]);
    matchingStatus.forEach((medal) => {
      const value = medal.group || "special";
      const current = groups.get(value) || { label: groupLabel(value), count: 0 };
      groups.set(value, { ...current, count: current.count + 1 });
    });
    return [...groups].map(([value, item]) => ({ value, label: item.label, count: item.count }));
  }, [activeStatusFilter, collection]);

  useEffect(() => {
    if (activeCategoryFilter !== "all" && !categoryOptions.some((option) => option.value === activeCategoryFilter)) {
      setActiveCategoryFilter("all");
    }
  }, [activeCategoryFilter, categoryOptions]);

  const filteredMedals = useMemo(() => collection.filter((medal) => {
    const statusMatch = statusMatches(medal, activeStatusFilter);
    const categoryMatch = activeCategoryFilter === "all" || medal.group === activeCategoryFilter;
    return statusMatch && categoryMatch;
  }), [activeCategoryFilter, activeStatusFilter, collection]);
  const hasInfo = Boolean(catalog.some((category) => category.tiers?.length) || disputed.length);

  return <div className="page medals-page medals-collection-page">
    <MedalsCompactHero onOpenInfo={() => setInfoOpen(true)} hasInfo={hasInfo} />

    {loading && <div className="medals-loader medals-collection-loader" role="status">
      <strong>Cargando medallero...</strong>
    </div>}

    {!loading && error && <div className="medals-error medals-collection-error" role="alert">
      <CircleAlert size={20} />
      <strong>No se pudo cargar el medallero</strong>
      <p>{error}</p>
      <button type="button" className="primary" onClick={() => window.location.reload()}>Reintentar</button>
    </div>}

    {!loading && !error && <>
      <MedalsFilters
        statusOptions={statusOptions}
        categoryOptions={categoryOptions}
        activeStatusFilter={activeStatusFilter}
        activeCategoryFilter={activeCategoryFilter}
        onStatusChange={setActiveStatusFilter}
        onCategoryChange={setActiveCategoryFilter}
      />
      <MedalsCollectionGrid medals={filteredMedals} />
    </>}
    {infoOpen && <BadgeCatalogDialog catalog={catalog} disputed={disputed} onClose={() => setInfoOpen(false)} />}
  </div>;
}
