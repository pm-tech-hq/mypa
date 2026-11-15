import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/shadcn.css";
import "./styles/app.css";
import { App } from "./App";
import { CapturePopup } from "./components/CapturePopup";
import { TooltipProvider } from "./components/ui/tooltip";
import { StoreProvider } from "./lib/store";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

createRoot(container).render(
  <StrictMode>
    <TooltipProvider>
      <StoreProvider>
        {window.location.hash === "#capture" ? <CapturePopup /> : <App />}
      </StoreProvider>
    </TooltipProvider>
  </StrictMode>,
);
