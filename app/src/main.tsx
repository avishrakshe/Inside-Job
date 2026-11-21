import "./polyfills";
import React from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import App from "./App";
import "./styles.css";
import "./landing.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    {/* Vercel Web Analytics (visitors, pages, custom events) + Speed Insights (Core Web Vitals) */}
    <Analytics />
    <SpeedInsights />
  </React.StrictMode>,
);
