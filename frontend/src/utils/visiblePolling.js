export function startVisiblePolling(task, intervalMs, { immediate = true } = {}) {
  let active = true;
  let inFlight = false;

  const run = async () => {
    if (!active || document.hidden || inFlight) return;
    inFlight = true;
    try {
      await task();
    } finally {
      inFlight = false;
    }
  };

  const onVisibilityChange = () => {
    if (!document.hidden) void run();
  };

  if (immediate) void run();
  const timer = window.setInterval(run, intervalMs);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    active = false;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
