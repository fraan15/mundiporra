import { useState } from "react";

export function Avatar({ user, className = "avatar" }) {
  const [imageFailed, setImageFailed] = useState(false);
  const initial = user?.username?.[0]?.toUpperCase() || "?";
  return <span className={className}>
    {user?.avatar_url && !imageFailed
      ? <img src={user.avatar_url} alt="" onError={() => setImageFailed(true)} />
      : initial}
  </span>;
}
