import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { BadgeCatalogDialog } from "../components/SportsUI";

export function MedalsPage() {
  const navigate = useNavigate();
  const [medalData, setMedalData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    api("/dashboard/medals")
      .then((result) => { if (mounted) setMedalData(result); })
      .catch((err) => { if (mounted) setError(err.message || "No se pudo cargar el medallero."); });
    return () => { mounted = false; };
  }, []);

  const closePanel = () => navigate("/");

  return <div className="page medals-page medals-info-launcher">
    {error && <div className="medals-error" role="alert">
      <strong>No se pudo cargar el medallero</strong>
      <p>{error}</p>
      <button type="button" className="primary" onClick={() => window.location.reload()}>Reintentar</button>
      <button type="button" onClick={closePanel}>Inicio</button>
    </div>}

    {!error && <div className="medals-loader" role="status">
      <strong>Cargando medallero...</strong>
    </div>}

    {medalData && <BadgeCatalogDialog
      catalog={medalData.badge_catalog}
      disputed={medalData.disputed_badges}
      onClose={closePanel}
    />}
  </div>;
}
