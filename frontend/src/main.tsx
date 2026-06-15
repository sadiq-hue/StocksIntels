
  import { createRoot } from "react-dom/client";
import { AuthProvider } from "./app/auth/AuthContext";
import { ThemeProvider } from "next-themes";

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
import { RealtimeQuotesProvider } from "./app/contexts/RealtimeQuotesContext";
import { NotificationProvider } from "./app/contexts/NotificationContext";
import { StockDataProvider } from "./app/contexts/StockDataContext";
import { PortfolioDataProvider } from "./app/contexts/PortfolioDataContext";
import { PaperTradingProvider } from "./app/contexts/PaperTradingContext";
import { kenyanStocks, globalStocks } from "./app/data/stockUniverses";
  import App from "./app/App.tsx";
  import "./styles/index.css";

const nseSymbols = kenyanStocks.map(s => `NSE:${s.ticker}`);
const globalSymbols = globalStocks.map(s => s.ticker);
const allSymbols = [...nseSymbols, ...globalSymbols];

createRoot(document.getElementById("root")!).render(
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <AuthProvider>
        <RealtimeQuotesProvider symbols={allSymbols}>
          <NotificationProvider>
            <StockDataProvider>
              <PortfolioDataProvider>
                <PaperTradingProvider>
                  <App />
                </PaperTradingProvider>
              </PortfolioDataProvider>
            </StockDataProvider>
          </NotificationProvider>
        </RealtimeQuotesProvider>
      </AuthProvider>
    </ThemeProvider>
);
  