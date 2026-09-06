import { useEffect, useState } from "react";

// Shares the inline splash's markup and CSS, so the React handoff has no visual jump.
export function StartupScreen({ error }: { error: string | null }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="boot-screen" role={error ? "alert" : "status"} aria-label={error ? "Startup failed" : "Loading Muxly"}>
      <svg className="boot-logo" viewBox="0 0 72 72" aria-hidden="true"><rect width="72" height="72" rx="18" fill="var(--boot-border)" opacity=".25"/><g fill="none" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M16 30 26 20 36 30 46 20 56 30" stroke="var(--boot-foreground)"/><path d="M16 40 26 30 36 40 46 30 56 40" stroke="var(--boot-accent)"/><path d="M16 50 26 40 36 50 46 40 56 50" stroke="var(--boot-accent)" opacity=".55"/></g></svg>
      <h1 className="boot-name">Muxly</h1>
      <p className="boot-message">{error ?? (slow ? "Startup is taking longer than expected. You can reload to try again." : "Starting your workspace…")}</p>
      {!error ? <div className="boot-track" aria-hidden="true"><div className="boot-fill" /></div> : null}
      {error || slow ? <button className="boot-reload" onClick={() => location.reload()}>Reload</button> : null}
    </div>
  );
}
