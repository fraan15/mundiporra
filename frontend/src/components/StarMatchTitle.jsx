import { Star } from "lucide-react";

export function StarMatchTitle({ match, className = "", onClick }) {
  if (!match.is_star) return null;
  const Component = onClick ? "button" : "span";
  return <Component type={onClick ? "button" : undefined} className={`star-match-title ${className}`.trim()} onClick={onClick}>
    <span className="star-match-badge"><Star size={15} fill="currentColor"/> ¡Partido Estrella! <b>x2</b></span>
    <span className="star-match-teams">{match.team1} - {match.team2}</span>
  </Component>;
}

export function StarPoints({ match, points, suffix = "pts" }) {
  if (!match.is_star || !points) return <>{points || 0} {suffix}</>;
  return <><strong>{points} {suffix}</strong><small className="star-points-detail">{points / 2} base ×2 Partido Estrella</small></>;
}
