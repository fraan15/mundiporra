import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

export function SearchSelect({
  items = [], value = null, onChange, placeholder = "Buscar...",
  label = "Seleccionar", renderItem, disabled = false
}) {
  const id = useId();
  const rootRef = useRef(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = items.find((item) => String(item.id) === String(value));
  const filtered = useMemo(() => {
    const text = query.trim().toLocaleLowerCase("es");
    const matches = text ? items.filter((item) =>
      `${item.name || ""} ${item.city || ""} ${item.position || ""} ${item.team_name || ""}`
        .toLocaleLowerCase("es").includes(text)
    ) : items;
    return matches.slice(0, 60);
  }, [items, query]);

  useEffect(() => {
    const closeOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const select = (item) => {
    onChange(item);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
    rootRef.current?.querySelector("input")?.blur();
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => {
        if (!filtered.length) return 0;
        return event.key === "ArrowDown"
          ? (index + 1) % filtered.length
          : (index - 1 + filtered.length) % filtered.length;
      });
      return;
    }
    if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      select(filtered[activeIndex]);
    }
  };

  return <div className="search-select" ref={rootRef}>
    <div className="search-select-control">
      <input
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${filtered[activeIndex].id}` : undefined}
        disabled={disabled}
        value={query}
        placeholder={selected ? selected.name : placeholder}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {selected && !disabled && <button
        type="button"
        className="search-select-clear"
        aria-label={`Borrar ${selected.name}`}
        onClick={() => select(null)}
      ><X size={15}/></button>}
    </div>
    {!disabled && open && <div className="search-select-menu" id={`${id}-listbox`} role="listbox">
      {filtered.length ? filtered.map((item, index) =>
        <button
          type="button"
          role="option"
          aria-selected={String(item.id) === String(value)}
          id={`${id}-option-${item.id}`}
          className={index === activeIndex ? "active" : ""}
          key={item.id}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => select(item)}
        >
          {renderItem ? renderItem(item) : <><strong>{item.name}</strong><small>{item.city || item.position || ""}</small></>}
        </button>
      ) : <span className="search-select-empty">Sin resultados</span>}
    </div>}
    {selected && <div className="search-select-value">
      {renderItem ? renderItem(selected) : <><strong>{selected.name}</strong><small>{selected.city || selected.position || ""}</small></>}
    </div>}
  </div>;
}
