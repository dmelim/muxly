import { useEffect, useState } from "react";
import muxlyLogo from "../src-tauri/icons/128x128@2x.png";

// Shares the inline splash's markup and CSS, so the React handoff has no visual jump.
export function StartupScreen({ error }: { error: string | null }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="boot-screen" role={error ? "alert" : "status"} aria-label={error ? "Startup failed" : "Loading Muxly"}>
      <img className="boot-logo" src={muxlyLogo} width={72} height={72} alt="" />
      <h1 className="boot-name">Muxly</h1>
      <p className="boot-message">{error ?? (slow ? "Startup is taking longer than expected. You can reload to try again." : "Starting your workspace…")}</p>
      {!error ? <div className="boot-track" aria-hidden="true"><div className="boot-fill" /></div> : null}
      {error || slow ? <button className="boot-reload" onClick={() => location.reload()}>Reload</button> : null}
    </div>
  );
}
