import React from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./style.css";
import { backendUrl } from "../shared/deployment";

// Hosted rooms must always use the backend serving this deployment.
// A local build's .env.local must never redirect production rooms to dev.
const url = backendUrl(location.hostname, import.meta.env.VITE_CONVEX_URL);
const root = createRoot(document.getElementById("root")!);
if (url)
  root.render(
    <React.StrictMode>
      <ConvexProvider client={new ConvexReactClient(url)}>
        <App />
      </ConvexProvider>
    </React.StrictMode>,
  );
else
  root.render(
    <main className="setup">
      <div className="logo">Collaborative Tier List</div>
      <h1>Connect Convex</h1>
      <p>
        Start the Convex backend, then restart the frontend to connect your
        multiplayer board.
      </p>
      <code>npm run backend</code>
      <p>The Convex CLI will set VITE_CONVEX_URL in .env.local for you.</p>
    </main>,
  );
