import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PostHogProvider } from "@posthog/react";

import App from "./App";
import { initAnalytics } from "./lib/analytics";
import "./index.css";

const posthog = initAnalytics();

const app = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {posthog ? <PostHogProvider client={posthog}>{app}</PostHogProvider> : app}
  </StrictMode>,
);
