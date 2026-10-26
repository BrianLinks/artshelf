import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("Missing #root element");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
