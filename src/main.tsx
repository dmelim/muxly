import React, { useLayoutEffect, type ReactNode } from "react";
import { startupMark } from "./startup";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";

function BootHandoff({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    document.getElementById("boot-splash")?.remove();
    window.dispatchEvent(new Event("muxly-react-ready"));
    startupMark("React committed");
  }, []);
  return children;
}

startupMark("frontend module loaded");
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BootHandoff>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BootHandoff>
  </React.StrictMode>
);
