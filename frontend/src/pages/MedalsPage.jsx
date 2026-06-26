import { useEffect, useMemo, useRef, useState } from "react";
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
  record: "Records",
  leader: "Liderazgo"
}[group] || "Logro");

const knownGroups = new Set(["exact", "winner", "scorer", "draw", "points", "participation", "record", "leader"]);
const categoryOrder = ["all", "record", "leader", "exact", "winner", "scorer", "draw", "points", "participation"];
const normalizeGroup = (group, kind) => knownGroups.has(group) ? group : knownGroups.has(kind) ? kind : "";

const compactDescription = (text = "") => text.replace(/\s+/g, " ").trim();
const holdersText = (holders = []) => !holders.length ? "" : holders.length === 1 ? holders[0] : `${holders.slice(0, -1).join(", ")} y ${holders[holders.length - 1]}`;
const missingForTier = (value, threshold) => Math.max(0, Number(threshold || 0) - Number(value || 0));
const progressForTier = (value, threshold, achieved = false) => {
  if (achieved) return 100;
  const total = Number(threshold || 0);
  if (!total) return 0;
  return Math.min(100, Math.max(0, (Number(value || 0) / total) * 100));
};

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
      {statusOptions.map((option) => <button type="button" className={`medals-filter-chip ${activeStatusFilter === option.value ? "active" : ""}`} onClick={() => onStatusChange(option.value)} key={option.value}>
        <span>{option.label}</span>
        <strong>{option.count}</strong>
      </button>)}
    </div>
    <div className="medals-filter-group medals-filter-group-secondary" aria-label="Categorias">
      {categoryOptions.map((option) => <button type="button" className={`medals-filter-chip ${activeCategoryFilter === option.value ? "active" : ""}`} onClick={() => onCategoryChange(option.value)} key={option.value}>
        <span>{option.label}</span>
        <strong>{option.count}</strong>
      </button>)}
    </div>
  </section>;
}

function MedalCollectionCard({ medal, onOpenMedal }) {
  const progress = progressForTier(medal.value, medal.threshold, medal.achieved);
  const holder = holdersText(medal.holders);
  const statusText = medal.type === "disputed" ? "En disputa" : medal.achieved ? "Ganada" : medal.missing > 0 ? `Faltan ${medal.missing}` : "Pendiente";

  return <article
    className={`medal-collection-card ${medal.achieved ? "is-achieved" : "is-locked"} ${medal.type === "disputed" ? "is-disputed" : ""} ${medal.levels?.length ? "has-levels" : ""}`}
    role="button"
    tabIndex={0}
    onClick={() => onOpenMedal(medal)}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpenMedal(medal);
      }
    }}
  >
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
      {medal.levels?.length ? <small>Ver niveles</small> : medal.type === "disputed" && holder ? <small>Ahora: {holder}</small> : medal.threshold ? <small>Objetivo: {medal.threshold}</small> : medal.level ? <small>Nivel {medal.level}</small> : null}
    </div>
  </article>;
}

const chunkMedals = (medals, size = 6) => {
  const chunks = [];
  for (let index = 0; index < medals.length; index += size) chunks.push(medals.slice(index, index + size));
  return chunks;
};

function MedalsCollectionGrid({ medals, onOpenMedal }) {
  const sliderRef = useRef(null);
  const slideRefs = useRef([]);
  const [activePage, setActivePage] = useState(0);
  const [sliderHeight, setSliderHeight] = useState();

  useEffect(() => {
    setActivePage(0);
    if (sliderRef.current) sliderRef.current.scrollTo({ left: 0 });
  }, [medals]);

  useEffect(() => {
    const slide = slideRefs.current[activePage];
    if (slide) setSliderHeight(slide.offsetHeight);
  }, [activePage, medals]);

  if (!medals.length) return <EmptyCollectionState />;
  const pages = chunkMedals(medals, 6);

  const updateActivePage = () => {
    const slider = sliderRef.current;
    if (!slider) return;
    setActivePage(Math.round(slider.scrollLeft / (slider.clientWidth || 1)));
  };

  const goToPage = (index) => {
    const slider = sliderRef.current;
    if (!slider) return;
    slider.scrollTo({ left: slider.clientWidth * index, behavior: "smooth" });
    setActivePage(index);
  };

  return <section className="medals-collection-pager" aria-label="Medallas">
    <div className="medals-collection-slider" ref={sliderRef} onScroll={updateActivePage} style={sliderHeight ? { height: sliderHeight } : undefined}>
      {pages.map((page, index) => <div className="medals-collection-page-slide" ref={(node) => { slideRefs.current[index] = node; }} key={`medals-page-${index}`}>
        <div className="medals-collection-grid">
          {page.map((medal) => <MedalCollectionCard medal={medal} onOpenMedal={onOpenMedal} key={medal.id} />)}
        </div>
      </div>)}
    </div>
    {pages.length > 1 && <div className="medals-page-bubbles" aria-label="Paginas de medallas">
      {pages.map((_, index) => <button type="button" className={activePage === index ? "active" : ""} aria-label={`Ir a pagina ${index + 1}`} aria-current={activePage === index ? "page" : undefined} onClick={() => goToPage(index)} key={`page-bubble-${index}`}>
        <span>{index + 1}</span>
      </button>)}
    </div>}
  </section>;
}

function MedalLevelsDialog({ medal, onClose }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  if (!medal) return null;
  const holder = holdersText(medal.holders);
  const progress = progressForTier(medal.value, medal.threshold, medal.achieved);
  const statusText = medal.type === "disputed" ? "En disputa" : medal.achieved ? "Ganada" : medal.missing > 0 ? `Faltan ${medal.missing}` : "Pendiente";

  return <div className="medal-levels-overlay" role="dialog" aria-modal="true" aria-labelledby="medal-levels-title" onClick={onClose}>
    <article className="medal-levels-dialog" onClick={(event) => event.stopPropagation()}>
      <header>
        <div>
          <span className="medal-collection-icon" aria-hidden="true">{medal.icon || "🏅"}</span>
          <div>
            <small>{groupLabel(medal.group)}</small>
            <h2 id="medal-levels-title">{medal.category || medal.name}</h2>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar">x</button>
      </header>
      <section className="medal-info-summary">
        <p>{compactDescription(medal.description || "Medalla de Mundiporra.")}</p>
        <div className="medal-info-facts">
          <span>{statusText}</span>
          {medal.type === "disputed" && <span>{holder ? `Ahora: ${holder}` : "Sin titular"}</span>}
          {medal.threshold && <span>Objetivo: {medal.threshold}</span>}
          {medal.value !== undefined && medal.threshold && <span>Actual: {medal.value || 0}</span>}
        </div>
        {medal.threshold && <div className="medal-collection-progress" aria-label={`${medal.value || 0} de ${medal.threshold}`}>
          <i style={{ width: `${progress}%` }} />
        </div>}
      </section>
      {medal.levels?.length && <div className="medal-levels-list">
        {medal.levels.map((level) => {
          const missing = missingForTier(medal.value, level.threshold);
          const levelProgress = progressForTier(medal.value, level.threshold, level.achieved);
          return <div className={`medal-level-row ${level.achieved ? "is-achieved" : ""}`} key={`${medal.group}-${level.level}-${level.threshold}`}>
            <span aria-hidden="true">{level.icon || medal.icon || "🏅"}</span>
            <div>
              <strong>{level.name}</strong>
              <p>{compactDescription(level.description || `Objetivo: ${level.threshold}`)}</p>
              <div className="medal-collection-progress" aria-label={`${medal.value || 0} de ${level.threshold}`}>
                <i style={{ width: `${levelProgress}%` }} />
              </div>
            </div>
            <small>{level.achieved ? "Ganada" : `Faltan ${missing}`}</small>
          </div>;
        })}
      </div>}
    </article>
  </div>;
}

function EmptyCollectionState() {
  return <div className="medals-empty-collection">
    <strong>No hay medallas con estos filtros</strong>
    <p>Prueba con otra categoria o estado.</p>
  </div>;
}

function buildCollection({ badges, catalog, disputed }) {
  const catalogNames = new Set();
  const collection = [];

  sortCatalog(catalog).forEach((category) => {
    const group = normalizeGroup(category.group);
    if (!group) return;
    const tiers = [...(category.tiers || [])].sort((a, b) => Number(a.threshold || 0) - Number(b.threshold || 0));
    if (!tiers.length) return;
    tiers.forEach((tier) => catalogNames.add(String(tier.name || "").toLowerCase()));
    const achievedTiers = tiers.filter((tier) => tier.achieved);
    const representative = achievedTiers[achievedTiers.length - 1] || tiers[0];
    const nextTier = tiers.find((tier) => !tier.achieved) || representative;
    const missing = missingForTier(category.value, nextTier.threshold);
    const achieved = achievedTiers.length > 0;

    collection.push({
      id: `catalog-family-${group}`,
      source: "catalog",
      type: "tier-family",
      status: achieved ? "achieved" : "locked",
      group,
      category: category.title || groupLabel(group),
      value: category.value,
      threshold: nextTier.threshold,
      achieved,
      missing,
      icon: representative.icon,
      name: representative.name,
      description: representative.description,
      level: representative.level,
      levels: tiers,
      order: Number(category.order ?? 99)
    });
  });

  sortBadges(disputed).forEach((badge, index) => {
    const group = normalizeGroup(badge.group, badge.kind) || "record";
    collection.push({
      id: `disputed-${group}-${badge.name}-${index}`,
      source: "disputed",
      type: "disputed",
      status: "disputed",
      group,
      achieved: false,
      icon: badge.icon,
      name: badge.name,
      description: badge.description,
      holders: badge.holders,
      order: Number(badge.order ?? 88)
    });
  });

  sortBadges(badges).forEach((badge, index) => {
    const group = normalizeGroup(badge.group, badge.kind);
    if (!group || catalogNames.has(String(badge.name || "").toLowerCase())) return;
    collection.push({
      id: `earned-${group}-${badge.name}-${index}`,
      source: "earned",
      type: "earned",
      status: "achieved",
      group,
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

const expandFamilyLevels = (collection, statusFilter, categoryFilter) => {
  if (statusFilter !== "achieved" || categoryFilter === "all") return collection.filter((medal) => statusMatches(medal, statusFilter) && (categoryFilter === "all" || medal.group === categoryFilter));

  return collection.flatMap((medal) => {
    if (medal.group !== categoryFilter) return [];
    if (!medal.levels?.length) return medal.achieved ? [medal] : [];
    return medal.levels
      .filter((level) => level.achieved)
      .map((level) => ({
        id: `level-${medal.group}-${level.level}-${level.threshold}`,
        source: "catalog-level",
        type: "tier-level",
        status: "achieved",
        group: medal.group,
        category: medal.category,
        value: medal.value,
        threshold: level.threshold,
        achieved: true,
        missing: 0,
        icon: level.icon || medal.icon,
        name: level.name,
        description: level.description,
        level: level.level,
        order: Number(medal.order ?? 99)
      }));
  });
};

const countForStatus = (collection, statusFilter) => collection.reduce((sum, medal) => {
  if (statusFilter === "achieved" && medal.levels?.length) return sum + medal.levels.filter((level) => level.achieved).length;
  if (statusFilter === "locked" && medal.levels?.length) return sum + medal.levels.filter((level) => !level.achieved).length;
  return sum + (statusMatches(medal, statusFilter) ? 1 : 0);
}, 0);

export function MedalsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeStatusFilter, setActiveStatusFilter] = useState("all");
  const [activeCategoryFilter, setActiveCategoryFilter] = useState("all");
  const [infoOpen, setInfoOpen] = useState(false);
  const [levelMedal, setLevelMedal] = useState(null);

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
    { value: "disputed", label: "En disputa", count: countForStatus(collection, "disputed") },
    { value: "achieved", label: "Conseguidas", count: countForStatus(collection, "achieved") },
    { value: "locked", label: "Pendientes", count: countForStatus(collection, "locked") }
  ], [collection]);

  const categoryOptions = useMemo(() => {
    const matchingStatus = activeStatusFilter === "achieved" || activeStatusFilter === "locked"
      ? collection.flatMap((medal) => medal.levels?.length
        ? medal.levels.filter((level) => activeStatusFilter === "achieved" ? level.achieved : !level.achieved).map(() => ({ group: medal.group }))
        : statusMatches(medal, activeStatusFilter) ? [medal] : [])
      : collection.filter((medal) => statusMatches(medal, activeStatusFilter));
    const groups = new Map([["all", { label: "Todas", count: matchingStatus.length }]]);
    matchingStatus.forEach((medal) => {
      const current = groups.get(medal.group) || { label: groupLabel(medal.group), count: 0 };
      groups.set(medal.group, { ...current, count: current.count + 1 });
    });
    return [...groups]
      .map(([value, item]) => ({ value, label: item.label, count: item.count }))
      .sort((a, b) => {
        const aIndex = categoryOrder.includes(a.value) ? categoryOrder.indexOf(a.value) : 99;
        const bIndex = categoryOrder.includes(b.value) ? categoryOrder.indexOf(b.value) : 99;
        return aIndex - bIndex || a.label.localeCompare(b.label, "es");
      });
  }, [activeStatusFilter, collection]);

  useEffect(() => {
    if (activeCategoryFilter !== "all" && !categoryOptions.some((option) => option.value === activeCategoryFilter)) setActiveCategoryFilter("all");
  }, [activeCategoryFilter, categoryOptions]);

  const filteredMedals = useMemo(() => expandFamilyLevels(collection, activeStatusFilter, activeCategoryFilter), [activeCategoryFilter, activeStatusFilter, collection]);
  const hasInfo = Boolean(catalog.some((category) => category.tiers?.length) || disputed.length);

  return <div className="page medals-page medals-collection-page">
    <MedalsCompactHero onOpenInfo={() => setInfoOpen(true)} hasInfo={hasInfo} />

    {loading && <div className="medals-loader medals-collection-loader" role="status"><strong>Cargando medallero...</strong></div>}

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
        onStatusChange={(value) => {
          setActiveStatusFilter(value);
          setActiveCategoryFilter("all");
        }}
        onCategoryChange={setActiveCategoryFilter}
      />
      <MedalsCollectionGrid medals={filteredMedals} onOpenMedal={setLevelMedal} />
    </>}
    {infoOpen && <BadgeCatalogDialog catalog={catalog} disputed={disputed} onClose={() => setInfoOpen(false)} />}
    {levelMedal && <MedalLevelsDialog medal={levelMedal} onClose={() => setLevelMedal(null)} />}
  </div>;
}
