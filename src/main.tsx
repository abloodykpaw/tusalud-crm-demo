import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StoreProvider } from "@/lib/store";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider } from "@/lib/i18n";
import { SyncErrorToaster, ToastProvider } from "@/components/Toast";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <StoreProvider>
          <ToastProvider>
            <SyncErrorToaster />
            <App />
          </ToastProvider>
        </StoreProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>
);
