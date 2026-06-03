
  import { createRoot } from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { AuthProvider } from "./app/auth/AuthContext";
import { RealtimeQuotesProvider } from "./app/contexts/RealtimeQuotesContext";
import { NotificationProvider } from "./app/contexts/NotificationContext";
import { StockDataProvider } from "./app/contexts/StockDataContext";
import { PortfolioDataProvider } from "./app/contexts/PortfolioDataContext";
import { PaperTradingProvider } from "./app/contexts/PaperTradingContext";
import { quickFinancialSymbols } from "./app/data/stockUniverses";
  import App from "./app/App.tsx";
  import "./styles/index.css";

const allSymbols = quickFinancialSymbols.map(s =>
  s.market === "nse" ? `NSE:${s.symbol}` : s.symbol
);

  createRoot(document.getElementById("root")!).render(
  <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID || "269380955616-346nscd402cen6cr0ts8ppiiv6i85i1r.apps.googleusercontent.com"}>
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
  </GoogleOAuthProvider>
);
  