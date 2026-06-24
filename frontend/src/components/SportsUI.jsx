import { Check, Info, Lock, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  return `${holders.slice(0, -1).join(", ")} y ${holders[holders.length - 1]}`;
};

const isDisputedBadge = (badge) => badge?.disputed || ["record", "leader"].includes(badge?.kind);

export function BadgeCatalogDialog({ catalog = [], disputed = [], onClose }) {
  const [activeCategory, setActiveCategory] = useState(0);
  const [categoryDirection, setCategoryDirection] = useState(1);
  const [categoryAnimation, setCategoryAnimation] = useState(0);
  const catalogSwipeStart = useRef(null);
  const orderedCatalog = useMemo(() => [...catalog].sort((a, b) => Number(a.order ?? 99) - Number(b.order ?? 99)), [catalog]);
  const orderedDisputed = useMemo(() => [...disputed].sort((a, b) =>
    Number(a.order ?? 99) - Number(b.order ?? 99) ||
    Number(b.level ?? 0) - Number(a.level ?? 0) ||
    String(a.name).localeCompare(String(b.name), "es")
  ), [disputed]);
  const catalogPages = useMemo(() => [
    { type: "disputed", key: "disputed", title: "Medallas en disputa", items: orderedDisputed },
    ...orderedCatalog.map((group) => ({ ...group, type: "catalog", key: group.group, items: group.tiers || [] }))
  ].filter((page) => page.type === "disputed" || page.items.length), [orderedCatalog, orderedDisputed]);
  const categoryCount = catalogPages.length;
  const activePage = catalogPages[activeCategory];

  const moveCategory = (direction) => {
    if (categoryCount < 2) return;
    setCategoryDirection(direction);
    setCategoryAnimation((value) => value + 1);
    setActiveCategory((index) => (index + direction + categoryCount) % categoryCount);
  };

  const goToCategory = (index) => {
    if (index === activeCategory || categoryCount < 2) return;
    setCategoryDirection(index > activeCategory ? 1 : -1);
    setCategoryAnimation((value) => value + 1);
    setActiveCategory(index);
  };

  const endCatalogSwipe = (event) => {
    const start = catalogSwipeStart.current;
    catalogSwipeStart.current = null;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    moveCategory(deltaX < 0 ? 1 : -1);
  };

  useEffect(() => {
    setActiveCategory(0);
    setCategoryDirection(1);
    setCategoryAnimation(0);
  }, [categoryCount]);

  useEffect(() => {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const root = document.documentElement;
    const previousOverflow = document.body.style.overflow;
    const previousOverscrollBehavior = document.body.style.overscrollBehavior;
    const previousPosition = document.body.style.position;
    const previousTop = document.body.style.top;
    const previousLeft = document.body.style.left;
    const previousRight = document.body.style.right;
    const previousWidth = document.body.style.width;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    root.style.overscrollBehavior = "contain";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscrollBehavior;
      document.body.style.position = previousPosition;
      document.body.style.top = previousTop;
      document.body.style.left = previousLeft;
      document.body.style.right = previousRight;
      document.body.style.width = previousWidth;
      root.style.overscrollBehavior = previousRootOverscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, []);

  return <div className="badge-popup-overlay" role="presentation" onClick={onClose}>
    <div className="badge-popup badge-catalog-popup" role="dialog" aria-modal="true" aria-labelledby="badge-catalog-title" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="badge-popup-close" aria-label="Cerrar información de medallas" onClick={onClose}>
        <X size={18} />
      </button>
      <small className="badge-popup-type">Guía de medallas</small>
      <h3 id="badge-catalog-title">Todas las medallas</h3>
      <div
        className="badge-catalog-carousel"
        onPointerDown={(event) => { if (event.pointerType !== "mouse") catalogSwipeStart.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={endCatalogSwipe}
        onPointerCancel={() => { catalogSwipeStart.current = null; }}
      >
        {activePage && <section
          className={`badge-catalog-page ${activePage.type === "disputed" ? "badge-catalog-disputed" : ""} ${categoryDirection < 0 ? "from-left" : "from-right"}`}
          key={`${activePage.key}-${categoryAnimation}`}
        >
            <header>
              <h4>{activePage.title}</h4>
              <small>{activePage.type === "disputed" ? `${activePage.items.length} en juego ahora` : `${activePage.items.filter((tier) => tier.achieved).length} conseguidas`}</small>
            </header>
            <div>
              {activePage.type === "disputed" ? (
                activePage.items.length ? activePage.items.map((badge) => <article className={badge.kind || ""} key={`${badge.name}-${badge.description}`}>
                  <span aria-hidden="true">{badge.icon}</span>
                  <div>
                    <strong>{badge.name}</strong>
                    <small>{badge.description || "Medalla disputada durante la porra."}</small>
                    <em>Ahora: {holdersText(badge.holders)}</em>
                  </div>
                  <Check size={16} />
                </article>) : <p className="badge-catalog-empty">Ahora mismo no hay medallas en disputa.</p>
              ) : activePage.items.map((tier) => <article className={tier.achieved ? "achieved" : ""} key={`${activePage.group}-${tier.level}`}>
                <span aria-hidden="true">{tier.icon}</span>
                <div>
                  <strong>{tier.name}</strong>
                  <small>{tier.description} Ahora: {activePage.value || 0}. {levelStatusText(activePage.value, tier.threshold)}.</small>
                </div>
                {tier.achieved ? <Check size={16} /> : <Lock size={15} />}
              </article>)}
            </div>
          </section>}
      </div>
      {categoryCount > 1 && <div className="badge-catalog-pagination" aria-label="Categorías de medallas">
        {catalogPages.map((page, index) => (
          <button
            type="button"
            className={index === activeCategory ? "active" : ""}
            key={`badge-catalog-dot-${page.key}`}
            aria-label={`Ver ${page.title}`}
            onClick={() => goToCategory(index)}
          />
        ))}
      </div>}
    </div>
  </div>;
}

export function Badges({ badges = [], catalog = [], disputed = [] }) {
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const swipeStart = useRef(null);
  const ignoreBadgeClick = useRef(false);
  const activeBadge = badges.find((badge) => badge.name === selectedBadge);
  const orderedBadges = useMemo(() => [...badges].sort((a, b) =>
    Number(isDisputedBadge(b) || 0) - Number(isDisputedBadge(a) || 0) ||
    Number(a.order ?? 99) - Number(b.order ?? 99) ||
    Number(b.level ?? 0) - Number(a.level ?? 0) ||
    String(a.name).localeCompare(String(b.name), "es")
  ), [badges]);
  const badgePages = useMemo(() => {
    const pages = [];
    for (let index = 0; index < orderedBadges.length; index += 6) pages.push(orderedBadges.slice(index, index + 6));
    return pages;
  }, [orderedBadges]);
  const orderedCatalog = [...catalog].sort((a, b) => Number(a.order ?? 99) - Number(b.order ?? 99));
  const hasCatalog = orderedCatalog.some((group) => group.tiers?.length);
  const pageCount = badgePages.length;
  const safeCurrentPage = pageCount ? Math.min(currentPage, pageCount - 1) : 0;

  useEffect(() => {
    if (safeCurrentPage !== currentPage) setCurrentPage(safeCurrentPage);
  }, [currentPage, safeCurrentPage]);

  const changePage = (direction) => {
    if (pageCount < 2) return;
    setCurrentPage((page) => {
      const nextPage = page + direction;
      if (nextPage < 0) return pageCount - 1;
      if (nextPage >= pageCount) return 0;
      return nextPage;
    });
  };

  const endBadgeSwipe = (event) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    ignoreBadgeClick.current = true;
    changePage(deltaX < 0 ? 1 : -1);
    window.setTimeout(() => { ignoreBadgeClick.current = false; }, 250);
  };

  const renderBadge = (badge) => {
    const isActive = selectedBadge === badge.name;
    return <button
      type="button"
      className={`badge-card ${badge.kind || ""} ${isActive ? "active" : ""}`}
      key={badge.name}
      title={badge.description || badge.name}
      aria-haspopup="dialog"
      onClick={() => {
        if (ignoreBadgeClick.current) return;
        setSelectedBadge(badge.name);
      }}
    >
      <span aria-hidden="true">{badge.icon}</span>
      <strong>{badge.name}</strong>
    </button>;
  };

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
    {orderedBadges.length ? <>
      <div
        className="badges"
        aria-label="Medallas del jugador"
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse") swipeStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={endBadgeSwipe}
        onPointerCancel={() => { swipeStart.current = null; }}
      >
        <div className="badges-pages" style={{ transform: `translateX(-${safeCurrentPage * 100}%)` }}>
          {badgePages.map((page, pageIndex) => (
            <div className="badges-page" key={`badges-page-${pageIndex}`}>
              {page.map(renderBadge)}
            </div>
          ))}
        </div>
      </div>
      {pageCount > 1 && <div className="badges-pagination" aria-label="Páginas de medallas">
        {badgePages.map((_, pageIndex) => (
          <button
            type="button"
            className={pageIndex === safeCurrentPage ? "active" : ""}
            key={`badge-page-dot-${pageIndex}`}
            aria-label={`Ver página ${pageIndex + 1} de medallas`}
            aria-current={pageIndex === safeCurrentPage ? "page" : undefined}
            onClick={() => setCurrentPage(pageIndex)}
          />
        ))}
      </div>}
    </> : <p className="empty-state">Los logros se desbloquean jugando.</p>}
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
    {catalogOpen && <BadgeCatalogDialog catalog={catalog} disputed={disputed} onClose={() => setCatalogOpen(false)} />}
  </div>;
}
