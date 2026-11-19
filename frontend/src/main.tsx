import { createRoot } from "react-dom/client";
import { AuthProvider } from "./app/auth/AuthContext";
import { ThemeProvider } from "next-themes";
import { ErrorBoundary } from "./app/components/ErrorBoundary";
import { initMetaPixel } from "./app/utils/metaPixel";
import { initXPixel } from "./app/utils/xPixel";

initMetaPixel();
initXPixel();

// Global fetch interceptor: adds JWT Authorization header to all API requests
const originalFetch = window.fetch;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const token = localStorage.getItem("stockintel_token");
  if (token) {
    init = init || {};
    init.headers = {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    };
  }
  return originalFetch(input, init);
};
import App from "./app/App.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
    <AuthProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AuthProvider>
  </ThemeProvider>
);
