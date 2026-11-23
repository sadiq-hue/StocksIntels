import { PublicBrandHeader, PublicBrandFooter } from "../../components/PublicBrandChrome";
import { Link } from "react-router";
import { ChevronRight, Key, Shield, Clock, RotateCcw, AlertTriangle, Copy, Check, ExternalLink, Lock, Unlock, User, Mail, RefreshCw, Fingerprint, Globe, Server } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useState } from "react";

const authMethods = [
  {
    id: "jwt-header",
    title: "JWT Bearer Token (Authorization Header)",
    description: "Standard JWT authentication via Authorization header. Recommended for most integrations.",
    bestFor: "Server-to-server, backend services, API integrations",
    steps: [
      "Obtain a JWT access token via login or registration endpoint",
      "Include the token in the Authorization header: `Authorization: Bearer <token>`",
      "Token expires in 15 minutes — use refresh token to obtain a new one",
    ],
    code: `// cURL
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..." \\
  "https://api.stocksintels.com/api/market/quote/SCOM"

# JavaScript (fetch)
const response = await fetch('https://api.stocksintels.com/api/market/quote/SCOM', {
  headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIs...' }
});

# Python (requests)
import requests
headers = {'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIs...'}
response = requests.get('https://api.stocksintels.com/api/market/quote/SCOM', headers=headers)`,
    security: [
      "Store tokens in environment variables, never in code",
      "Access tokens expire in 15 minutes — implement automatic refresh",
      "Use httpOnly cookies for refresh tokens in browser apps",
      "Rotate JWT_SECRET periodically in production",
    ],
  },
  {
    id: "x-auth-token",
    title: "x-auth-token Header",
    description: "Alternative header-based authentication. Useful when Authorization header is unavailable.",
    bestFor: "Legacy systems, proxies that strip Authorization header",
    steps: [
      "Obtain a JWT access token via login or registration endpoint",
      "Include the token in the x-auth-token header: `x-auth-token: <token>`",
      "Same 15-minute expiry and refresh flow as Authorization header",
    ],
    code: `// cURL
curl -H "x-auth-token: eyJhbGciOiJIUzI1NiIs..." \\
  "https://api.stocksintels.com/api/market/quote/SCOM"

# JavaScript (fetch)
const response = await fetch('https://api.stocksintels.com/api/market/quote/SCOM', {
  headers: { 'x-auth-token': 'eyJhbGciOiJIUzI1NiIs...' }
});`,
    security: [
      "Same security considerations as Authorization header",
      "Prefer Authorization header when possible (standard)",
    ],
  },
  {
    id: "cookie-auth",
    title: "Cookie-Based Authentication (Browser Apps)",
    description: "Automatic authentication via httpOnly cookies. Best for web applications.",
    bestFor: "Single-page applications, traditional web apps, server-rendered apps",
    steps: [
      "User logs in via `/api/auth/login` — server sets httpOnly `refresh_token` cookie",
      "Access token returned in response body — store in memory (not localStorage)",
      "Include access token in Authorization header for subsequent requests",
      "Call `/api/auth/refresh` to get new access token using httpOnly cookie",
      "Call `/api/auth/logout` to revoke refresh token and clear cookie",
    ],
    code: `// 1. Login — returns access token + sets httpOnly refresh_token cookie
const loginResponse = await fetch('https://api.stocksintels.com/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include', // Important: sends cookies
  body: JSON.stringify({ email: 'user@example.com', password: 'password123' })
});
const { user, token: accessToken } = await loginResponse.json();

// 2. Use access token for authenticated requests
const quoteResponse = await fetch('https://api.stocksintels.com/api/market/quote/SCOM', {
  headers: { 'Authorization': \`Bearer \${accessToken}\` }
});

// 3. Refresh access token when expired (uses httpOnly cookie automatically)
const refreshResponse = await fetch('https://api.stocksintels.com/api/auth/refresh', {
  method: 'POST',
  credentials: 'include',
});
const { token: newAccessToken } = await refreshResponse.json();

// 4. Logout — revokes refresh token and clears cookie
await fetch('https://api.stocksintels.com/api/auth/logout', {
  method: 'POST',
  credentials: 'include',
});`,
    security: [
      "httpOnly cookie prevents XSS access to refresh token",
      "Secure flag in production (HTTPS only)",
      "SameSite: 'none' for cross-origin, 'lax' for same-origin",
      "Store access token in memory only — never in localStorage/sessionStorage",
      "Implement automatic token refresh 1-2 minutes before expiry",
    ],
  },
];

const authEndpoints = [
  { method: "POST", path: "/api/auth/register", description: "Create new user account", auth: false },
  { method: "POST", path: "/api/auth/send-verification-code", description: "Send 6-digit email verification code", auth: false },
  { method: "POST", path: "/api/auth/verify-email-and-register", description: "Verify code + register in one step", auth: false },
  { method: "POST", path: "/api/auth/login", description: "Password-based login — returns access token + sets refresh cookie", auth: false },
  { method: "POST", path: "/api/auth/send-otp", description: "Send OTP to email for passwordless login", auth: false },
  { method: "POST", path: "/api/auth/verify-otp", description: "Verify OTP — auto-creates account if new", auth: false },
  { method: "POST", path: "/api/auth/login-request-otp", description: "Step 1: Validate password then email OTP (2FA)", auth: false },
  { method: "POST", path: "/api/auth/login-verify-otp", description: "Step 2: Verify OTP and get token (2FA)", auth: false },
  { method: "POST", path: "/api/auth/forgot-password", description: "Send password reset code", auth: false },
  { method: "POST", path: "/api/auth/reset-password", description: "Reset password with code", auth: false },
  { method: "POST", path: "/api/auth/refresh", description: "Refresh expired JWT using httpOnly cookie", auth: "cookie" },
  { method: "POST", path: "/api/auth/logout", description: "Revoke refresh token and clear cookie", auth: "cookie" },
  { method: "GET", path: "/api/auth/me", description: "Get current authenticated user", auth: true },
];

const tokenDetails = [
  { type: "Access Token (JWT)", lifetime: "15 minutes", format: "HS256 signed JWT", usage: "Authorization: Bearer <token> or x-auth-token header", storage: "Memory only (never localStorage)" },
  { type: "Refresh Token", lifetime: "30 days", format: "Opaque string (SHA-256 hashed in DB)", usage: "Automatic via httpOnly cookie on /api/auth/refresh", storage: "httpOnly, Secure, SameSite cookie" },
];

const userRoles = [
  { role: "user", description: "Standard user — access to own data, portfolio, watchlist, paper trading" },
  { role: "admin", description: "Administrative access — user management, signal management, support tickets, analytics" },
  { role: "super_admin", description: "Full system access — all admin capabilities plus system configuration" },
];

const permissionScopes = [
  { scope: "read:market", description: "Market quotes, history, indices, movers, sectors", endpoints: "/api/market/*, /api/quote/*, /api/stocks/*" },
  { scope: "read:financials", description: "Company financials, income statements, balance sheets, metrics", endpoints: "/api/financials/*, /api/company/*" },
  { scope: "read:signals", description: "Trading signals, backtest, forward test, engine config", endpoints: "/api/signals/*, /api/signal/*" },
  { scope: "read:portfolio", description: "User portfolio, holdings, watchlist, performance", endpoints: "/api/portfolio/*, /api/watchlist/*" },
  { scope: "write:portfolio", description: "Modify watchlist, paper trading orders", endpoints: "POST/DELETE /api/watchlist/*, POST /api/paper/orders" },
  { scope: "write:orders", description: "Place/cancel paper trading orders", endpoints: "POST /api/paper/orders, POST /api/trade" },
  { scope: "read:notifications", description: "User notifications", endpoints: "/api/notifications/*" },
  { scope: "read:news", description: "Financial news, sentiment, hot news", endpoints: "/api/news/*" },
  { scope: "read:social", description: "Groups, chat messages, people directory", endpoints: "/api/groups/*, /api/chat/*, /api/people/*" },
  { scope: "admin", description: "Administrative endpoints (role-based)", endpoints: "/api/admin/*" },
];

const rateLimits = [
  { tier: "Free", requests: "1,000/day", burst: "10/sec", auth: "JWT required" },
  { tier: "Pro", requests: "100,000/day", burst: "50/sec", auth: "JWT required" },
  { tier: "Enterprise", requests: "Custom", burst: "Custom", auth: "JWT + optional mTLS" },
];

const errorCodes = [
  { code: "NO_TOKEN", http: 401, description: "No authentication provided", resolution: "Include Authorization header, x-auth-token header, or access_token cookie" },
  { code: "TOKEN_EXPIRED", http: 401, description: "Access token expired", resolution: "Call /api/auth/refresh with httpOnly cookie to get new access token" },
  { code: "INVALID_TOKEN", http: 401, description: "Token malformed, tampered, or signed with wrong secret", resolution: "Re-authenticate user — token is invalid" },
  { code: "USER_NOT_FOUND", http: 401, description: "User from token no longer exists", resolution: "Re-authenticate — account may have been deleted" },
  { code: "AUTH_DB_UNAVAILABLE", http: 503, description: "Database temporarily unavailable", resolution: "Retry with exponential backoff" },
  { code: "ADMIN_REQUIRED", http: 403, description: "Admin role required", resolution: "Ensure user has admin or super_admin role" },
  { code: "SUPER_ADMIN_REQUIRED", http: 403, description: "Super admin role required", resolution: "Endpoint restricted to super_admin role only" },
  { code: "FORBIDDEN", http: 403, description: "Access denied — can only access own data", resolution: "Use correct userId — admins can access any user" },
  { code: "RATE_LIMITED", http: 429, description: "Rate limit exceeded", resolution: "Check X-RateLimit-Reset header, implement exponential backoff" },
  { code: "NO_REFRESH_TOKEN", http: 401, description: "No refresh token cookie found", resolution: "User must log in again" },
  { code: "INVALID_REFRESH_TOKEN", http: 401, description: "Refresh token revoked, expired, or invalid", resolution: "User must log in again" },
];

const flowDiagrams = {
  login: `┌─────────────┐     POST /api/auth/login      ┌─────────────┐
│   Client    │ ─────────────────────────────▶ │   Server    │
│             │  { email, password }           │             │
│             │ ◀───────────────────────────── │             │
│             │  { user, token }               │             │
│             │  Set-Cookie: refresh_token=... │             │
└─────────────┘                                 └─────────────┘
       │                                              │
       │         Authorization: Bearer <token>        │
       ├─────────────────────────────────────────────▶│
       │                                              │
       │              200 OK + Data                   │
       │◀─────────────────────────────────────────────┤`,

  refresh: `┌─────────────┐     POST /api/auth/refresh       ┌─────────────┐
│   Client    │ ──────────────────────────────────▶│   Server    │
│             │  Cookie: refresh_token=...         │             │
│             │ ◀──────────────────────────────────│             │
│             │  { user, token }                   │             │
└─────────────┘  (New access token)                └─────────────┘`,

  logout: `┌─────────────┐     POST /api/auth/logout        ┌─────────────┐
│   Client    │ ──────────────────────────────────▶│   Server    │
│             │  Cookie: refresh_token=...         │             │
│             │ ◀──────────────────────────────────│             │
│             │  { message }                       │             │
│             │  Clear-Cookie: refresh_token       │             │
└─────────────┘  (Token revoked in DB)             └─────────────┘`,
};

export function AuthGuidePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="min-h-screen bg-white">
      <PublicBrandHeader />
      <main className="pt-28">
        {/* Header */}
        <section className="mx-auto max-w-[1440px] px-5 py-12 sm:px-8 lg:px-12 border-b border-[#DCE5F0]">
          <div>
            <Link to="/developers" className="text-sm text-[#52647A] hover:text-[#0D7490] mb-2 inline-flex items-center gap-1">
              <ChevronRight className="size-4 rotate-180" />
              Developer Portal
            </Link>
            <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-[#102B50]">Authentication Guide</h1>
            <p className="mt-2 text-[#52647A]">Understand JWT authentication, token management, authentication flows, permissions, and security best practices.</p>
          </div>
        </section>

        {/* Tabs */}
        <section className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 lg:px-12">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full max-w-4xl mx-auto mb-8">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="methods">Auth Methods</TabsTrigger>
              <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
              <TabsTrigger value="tokens">Tokens</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-8">
            <div className="grid gap-6 md:grid-cols-3">
              <Card className="border-[#DCE5F0]">
                <CardHeader>
                  <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center mb-3">
                    <Fingerprint className="size-5 text-[#0D7490]" />
                  </div>
                  <CardTitle className="text-[#102B50]">JWT Authentication</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[#52647A] text-sm mb-4">Stateless authentication with short-lived access tokens and secure refresh tokens.</p>
                  <ul className="space-y-2 text-sm text-[#52647A]">
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> HS256 signed JWT (15 min expiry)</li>
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> httpOnly refresh cookie (30 days)</li>
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> Three header options supported</li>
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> Role-based access control</li>
                  </ul>
                </CardContent>
              </Card>
              <Card className="border-[#DCE5F0]">
                <CardHeader>
                  <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center mb-3">
                    <RefreshCw className="size-5 text-[#0D7490]" />
                  </div>
                  <CardTitle className="text-[#102B50]">Token Refresh Flow</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[#52647A] text-sm mb-4">Automatic token renewal without user interaction.</p>
                  <ul className="space-y-2 text-sm text-[#52647A]">
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> Refresh via httpOnly cookie</li>
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> New access + refresh token pair</li>
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> Revoke on logout</li>
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> 30-day inactivity expiry</li>
                  </ul>
                </CardContent>
              </Card>
              <Card className="border-[#DCE5F0]">
                <CardHeader>
                  <div className="w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center mb-3">
                    <Shield className="size-5 text-[#0D7490]" />
                  </div>
                  <CardTitle className="text-[#102B50]">Security First</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[#52647A] text-sm mb-4">Built-in protections for production deployments.</p>
                  <ul className="space-y-2 text-sm text-[#52647A]">
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> httpOnly, Secure, SameSite cookies</li>
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> Refresh tokens hashed in database</li>
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> Ownership & role enforcement</li>
                    <li className="flex items-center gap-2"><Check className="size-4 text-green-600" /> Rate limiting per tier</li>
                  </ul>
                </CardContent>
              </Card>
            </div>

            {/* Quick Start Flow */}
            <div>
              <h2 className="text-2xl font-bold text-[#102B50] mb-6">Quick Start: Login Flow</h2>
              <div className="bg-[#0B203D] rounded-xl p-6 font-mono text-sm text-slate-200 overflow-x-auto">
                <code>{flowDiagrams.login}</code>
              </div>
            </div>

            {/* Supported Auth Headers */}
            <div>
              <h2 className="text-2xl font-bold text-[#102B50] mb-6">Supported Authentication Headers</h2>
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="border-[#DCE5F0] border-l-4 border-l-[#0D7490]">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Key className="size-4 text-[#0D7490]" />
                      <h3 className="font-semibold text-[#102B50]">Authorization: Bearer</h3>
                    </div>
                    <p className="text-sm text-[#52647A]">Standard RFC 6750 Bearer token. Recommended for all new integrations.</p>
                    <code className="block mt-2 bg-[#F1F5F9] px-2 py-1 rounded text-xs font-mono text-[#0D7490]">Authorization: Bearer eyJhbGciOiJIUzI1NiIs...</code>
                  </CardContent>
                </Card>
                <Card className="border-[#DCE5F0] border-l-4 border-l-amber-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Key className="size-4 text-amber-500" />
                      <h3 className="font-semibold text-[#102B50]">x-auth-token</h3>
                    </div>
                    <p className="text-sm text-[#52647A]">Alternative header when Authorization is stripped by proxies.</p>
                    <code className="block mt-2 bg-[#F1F5F9] px-2 py-1 rounded text-xs font-mono text-amber-600">x-auth-token: eyJhbGciOiJIUzI1NiIs...</code>
                  </CardContent>
                </Card>
                <Card className="border-[#DCE5F0] border-l-4 border-l-green-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Server className="size-4 text-green-500" />
                      <h3 className="font-semibold text-[#102B50]">access_token cookie</h3>
                    </div>
                    <p className="text-sm text-[#52647A]">Cookie-based for browser apps. Less common — prefer headers.</p>
                    <code className="block mt-2 bg-[#F1F5F9] px-2 py-1 rounded text-xs font-mono text-green-600">Cookie: access_token=eyJhbGciOiJIUzI1NiIs...</code>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Rate Limits */}
            <div>
              <h2 className="text-2xl font-bold text-[#102B50] mb-6">Rate Limits by Tier</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-[#DCE5F0]">
                      <th className="pb-3 font-semibold text-[#102B50]">Tier</th>
                      <th className="pb-3 font-semibold text-[#102B50]">Requests/Day</th>
                      <th className="pb-3 font-semibold text-[#102B50]">Burst Limit</th>
                      <th className="pb-3 font-semibold text-[#102B50]">Auth Required</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateLimits.map((r, i) => (
                      <tr key={i} className="border-b border-[#DCE5F0]/50">
                        <td className="py-3 font-medium text-[#102B50]">{r.tier}</td>
                        <td className="py-3 text-[#52647A]">{r.requests}</td>
                        <td className="py-3 text-[#52647A]">{r.burst}</td>
                        <td className="py-3 text-[#52647A]">{r.auth}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-sm text-[#52647A]">
                Rate limit headers on every response: 
                <code className="bg-[#F1F5F9] px-1.5 py-0.5 rounded font-mono">X-RateLimit-Limit</code>, 
                <code className="bg-[#F1F5F9] px-1.5 py-0.5 rounded font-mono">X-RateLimit-Remaining</code>, 
                <code className="bg-[#F1F5F9] px-1.5 py-0.5 rounded font-mono">X-RateLimit-Reset</code>
              </p>
            </div>
          </TabsContent>

          {/* Auth Methods Tab */}
          <TabsContent value="methods" className="space-y-8">
            {authMethods.map((method, methodIndex) => (
              <div key={method.id} className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#0D7490]/10 flex items-center justify-center">
                    {methodIndex === 0 && <Fingerprint className="size-5 text-[#0D7490]" />}
                    {methodIndex === 1 && <Key className="size-5 text-[#0D7490]" />}
                    {methodIndex === 2 && <Globe className="size-5 text-[#0D7490]" />}
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-[#102B50]">{method.title}</h2>
                    <p className="text-[#52647A] mt-1">{method.description}</p>
                    <p className="text-sm text-[#52647A] mt-1"><strong>Best for:</strong> {method.bestFor}</p>
                  </div>
                </div>

                <div className="space-y-4 ml-12">
                  {method.steps.map((step, i) => (
                    <Card key={i} className="border-[#DCE5F0]">
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-4">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#0D7490]/10 flex items-center justify-center text-sm font-bold text-[#0D7490]">
                            {i + 1}
                          </div>
                          <p className="text-[#52647A] mt-1">{step}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div>
                  <h3 className="font-semibold text-[#102B50] mb-3">Code Examples</h3>
                  <div className="relative">
                    <pre className="bg-[#0B203D] rounded-xl overflow-hidden">
                      <code className="block p-6 text-sm text-slate-200 font-mono leading-relaxed overflow-x-auto">
                        {method.code}
                      </code>
                    </pre>
                    <Button variant="ghost" size="sm" className="absolute top-3 right-3" onClick={() => copyToClipboard(method.code, method.id)}>
                      {copied === method.id ? <Check className="size-4 mr-1 text-green-600" /> : <Copy className="size-4 mr-1" />}
                      Copy
                    </Button>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-[#102B50] mb-3">Security Best Practices</h3>
                  <ul className="space-y-2">
                    {method.security.map((s, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-[#52647A]">
                        <Shield className="size-5 text-green-600 flex-shrink-0 mt-0.5" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </TabsContent>

          {/* Endpoints Tab */}
          <TabsContent value="endpoints" className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-[#102B50] mb-4">Authentication Endpoints</h2>
              <p className="text-[#52647A] mb-6">
                All authentication-related endpoints. Public endpoints require no authentication; protected endpoints require valid JWT.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-[#DCE5F0]">
                    <th className="pb-3 font-semibold text-[#102B50] w-20">Method</th>
                    <th className="pb-3 font-semibold text-[#102B50] w-56">Endpoint</th>
                    <th className="pb-3 font-semibold text-[#102B50]">Description</th>
                    <th className="pb-3 font-semibold text-[#102B50] w-24">Auth Required</th>
                  </tr>
                </thead>
                <tbody>
                  {authEndpoints.map((ep, i) => (
                    <tr key={i} className="border-b border-[#DCE5F0]/50 hover:bg-[#F8FAFC]">
                      <td className="py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          ep.method === 'GET' ? 'bg-[#2563A6]/10 text-[#2563A6]' :
                          ep.method === 'POST' ? 'bg-green-100 text-green-700' :
                          'bg-purple-100 text-purple-700'
                        }`}>
                          {ep.method}
                        </span>
                      </td>
                      <td className="py-3 font-mono text-[#102B50]">{ep.path}</td>
                      <td className="py-3 text-[#52647A]">{ep.description}</td>
                      <td className="py-3">
                        {ep.auth === false ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Public</span>
                        ) : ep.auth === "cookie" ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Cookie</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">JWT Required</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Flow Diagrams */}
            <div>
              <h3 className="font-semibold text-[#102B50] mb-4">Token Refresh Flow</h3>
              <div className="bg-[#0B203D] rounded-xl p-4 font-mono text-sm text-slate-200 overflow-x-auto">
                <code>{flowDiagrams.refresh}</code>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-[#102B50] mb-4">Logout Flow</h3>
              <div className="bg-[#0B203D] rounded-xl p-4 font-mono text-sm text-slate-200 overflow-x-auto">
                <code>{flowDiagrams.logout}</code>
              </div>
            </div>
          </TabsContent>

          {/* Tokens Tab */}
          <TabsContent value="tokens" className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-[#102B50] mb-4">Token Types & Lifetimes</h2>
              <p className="text-[#52647A] mb-6">
                Two-token system: short-lived access tokens for API requests, long-lived refresh tokens for session persistence.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-[#DCE5F0]">
                    <th className="pb-3 font-semibold text-[#102B50]">Token Type</th>
                    <th className="pb-3 font-semibold text-[#102B50]">Lifetime</th>
                    <th className="pb-3 font-semibold text-[#102B50]">Format</th>
                    <th className="pb-3 font-semibold text-[#102B50]">Usage</th>
                    <th className="pb-3 font-semibold text-[#102B50]">Storage</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenDetails.map((t, i) => (
                    <tr key={i} className="border-b border-[#DCE5F0]/50">
                      <td className="py-3 font-medium text-[#102B50]">{t.type}</td>
                      <td className="py-3 text-[#52647A]"><code className="bg-[#F1F5F9] px-2 py-1 rounded">{t.lifetime}</code></td>
                      <td className="py-3 text-[#52647A]"><code className="bg-[#F1F5F9] px-2 py-1 rounded">{t.format}</code></td>
                      <td className="py-3 text-[#52647A]">{t.usage}</td>
                      <td className="py-3 text-[#52647A]">{t.storage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* JWT Payload */}
            <div>
              <h3 className="font-semibold text-[#102B50] mb-3">JWT Access Token Payload</h3>
              <div className="bg-[#F5F8FC] border border-[#DCE5F0] rounded-lg p-4 space-y-3">
                <p className="text-sm text-[#52647A]">Decoded JWT payload structure (HS256 signed):</p>
                <pre className="bg-[#0B203D] p-3 rounded font-mono text-sm text-slate-200 overflow-x-auto"><code>{`{
  "userId": "uuid-string",
  "iat": 1700737200,           // Issued at (Unix timestamp)
  "exp": 1700738100            // Expires at (Unix timestamp, ~15 min)
}`}</code></pre>
                <p className="text-sm text-[#52647A]">
                  The token contains only the user ID. Additional user data (role, subscription, etc.) is fetched from the database on each request.
                </p>
              </div>
            </div>

            {/* User Roles */}
            <div>
              <h3 className="font-semibold text-[#102B50] mb-3">User Roles & Permissions</h3>
              <div className="grid gap-4 md:grid-cols-3">
                {userRoles.map((r, i) => (
                  <Card key={i} className="border-[#DCE5F0]">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="size-5 text-[#0D7490]" />
                        <h4 className="font-semibold text-[#102B50] capitalize">{r.role}</h4>
                      </div>
                      <p className="text-sm text-[#52647A]">{r.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            {/* Permission Scopes */}
            <div>
              <h3 className="font-semibold text-[#102B50] mb-3">Permission Scopes (Implicit via Role)</h3>
              <p className="text-sm text-[#52647A] mb-4">Scopes are enforced implicitly based on user role and endpoint access patterns:</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-[#DCE5F0]">
                      <th className="pb-3 font-semibold text-[#102B50] w-40">Scope</th>
                      <th className="pb-3 font-semibold text-[#102B50]">Description</th>
                      <th className="pb-3 font-semibold text-[#102B50]">Example Endpoints</th>
                    </tr>
                  </thead>
                  <tbody>
                    {permissionScopes.map((s, i) => (
                      <tr key={i} className="border-b border-[#DCE5F0]/50">
                        <td className="py-3 font-mono text-[#0D7490]">{s.scope}</td>
                        <td className="py-3 text-[#52647A]">{s.description}</td>
                        <td className="py-3 text-[#52647A] font-mono text-xs">{s.endpoints}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-[#102B50] mb-4">Security Best Practices</h2>
              <p className="text-[#52647A] mb-6">
                Protect your integrations and users' data with these security guidelines.
              </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Card className="border-[#DCE5F0]">
                <CardHeader>
                  <CardTitle className="text-[#102B50] flex items-center gap-2">
                    <Lock className="size-5" /> Credential Storage
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-[#52647A]">
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Use environment variables for JWT_SECRET</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Never commit secrets to version control</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Use secret managers (Vault, AWS Secrets Manager, etc.)</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Rotate JWT_SECRET periodically in production</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Use different secrets per environment</li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-[#DCE5F0]">
                <CardHeader>
                  <CardTitle className="text-[#102B50] flex items-center gap-2">
                    <Shield className="size-5" /> Token Handling
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-[#52647A]">
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Store access tokens in memory only (never localStorage)</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Implement auto-refresh 1-2 min before expiry</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Handle 401 with automatic retry after refresh</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Clear tokens on logout / session expiry</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Validate token expiry client-side before requests</li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-[#DCE5F0]">
                <CardHeader>
                  <CardTitle className="text-[#102B50] flex items-center gap-2">
                    <Globe className="size-5" /> Network Security
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-[#52647A]">
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Always use HTTPS (enforced by API in production)</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Verify TLS certificates</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Configure CORS properly for your domains</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Use IP allowlists where possible</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Implement request signing for high-value operations</li>
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-[#DCE5F0]">
                <CardHeader>
                  <CardTitle className="text-[#102B50] flex items-center gap-2">
                    <AlertTriangle className="size-5" /> Incident Response
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-[#52647A]">
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Monitor for unusual API usage patterns</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Set up alerts for 401/403 error spikes</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Have JWT_SECRET rotation procedure documented</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Know how to revoke user sessions (logout endpoint)</li>
                    <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Contact security@stocksintels.com for incidents</li>
                  </ul>
                </CardContent>
              </Card>
            </div>

            {/* Cookie Security Details */}
            <div>
              <h3 className="font-semibold text-[#102B50] mb-4">Refresh Token Cookie Configuration</h3>
              <div className="bg-[#F5F8FC] border border-[#DCE5F0] rounded-lg p-4 space-y-3">
                <p className="text-sm text-[#52647A]">The httpOnly refresh_token cookie is configured with:</p>
                <div className="grid gap-2 md:grid-cols-2 text-sm">
                  <div className="flex items-center gap-2"><code className="bg-[#F1F5F9] px-2 py-1 rounded font-mono text-xs">httpOnly: true</code> <span className="text-[#52647A]">Prevents XSS access</span></div>
                  <div className="flex items-center gap-2"><code className="bg-[#F1F5F9] px-2 py-1 rounded font-mono text-xs">secure: true (prod)</code> <span className="text-[#52647A]">HTTPS only in production</span></div>
                  <div className="flex items-center gap-2"><code className="bg-[#F1F5F9] px-2 py-1 rounded font-mono text-xs">sameSite: 'none' (prod)</code> <span className="text-[#52647A]">Cross-origin support</span></div>
                  <div className="flex items-center gap-2"><code className="bg-[#F1F5F9] px-2 py-1 rounded font-mono text-xs">sameSite: 'lax' (dev)</code> <span className="text-[#52647A]">Same-origin in development</span></div>
                  <div className="flex items-center gap-2"><code className="bg-[#F1F5F9] px-2 py-1 rounded font-mono text-xs">path: '/api/auth'</code> <span className="text-[#52647A]">Scoped to auth endpoints</span></div>
                  <div className="flex items-center gap-2"><code className="bg-[#F1F5F9] px-2 py-1 rounded font-mono text-xs">maxAge: 30 days</code> <span className="text-[#52647A]">Matches token expiry</span></div>
                </div>
              </div>
            </div>

            {/* Error Codes */}
            <div>
              <h3 className="font-semibold text-[#102B50] mb-4">Authentication Error Codes</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-[#DCE5F0]">
                      <th className="pb-3 font-semibold text-[#102B50] w-40">Error Code</th>
                      <th className="pb-3 font-semibold text-[#102B50] w-12">HTTP</th>
                      <th className="pb-3 font-semibold text-[#102B50]">Description</th>
                      <th className="pb-3 font-semibold text-[#102B50]">Resolution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errorCodes.map((e, i) => (
                      <tr key={i} className="border-b border-[#DCE5F0]/50">
                        <td className="py-3 font-mono text-[#0D7490]">{e.code}</td>
                        <td className="py-3 text-[#52647A]">{e.http}</td>
                        <td className="py-3 text-[#52647A]">{e.description}</td>
                        <td className="py-3 text-[#52647A]">{e.resolution}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Common Integration Patterns */}
            <div>
              <h3 className="font-semibold text-[#102B50] mb-4">Common Integration Patterns</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="border-[#DCE5F0]">
                  <CardHeader>
                    <CardTitle className="text-[#102B50]">Server-to-Server (Backend)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm text-[#52647A]">
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Store JWT_SECRET in env vars</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Generate service account user</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Login once, cache access token</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Refresh proactively before expiry</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Handle 401 with retry logic</li>
                    </ul>
                  </CardContent>
                </Card>

                <Card className="border-[#DCE5F0]">
                  <CardHeader>
                    <CardTitle className="text-[#102B50]">Browser App (SPA/SSR)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm text-[#52647A]">
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Use httpOnly cookie for refresh token</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Store access token in memory (React context, Vue store, etc.)</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Never use localStorage for tokens</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Implement silent refresh on app load</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Redirect to login on 401 after refresh fails</li>
                    </ul>
                  </CardContent>
                </Card>

                <Card className="border-[#DCE5F0]">
                  <CardHeader>
                    <CardTitle className="text-[#102B50]">Mobile App</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm text-[#52647A]">
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Use secure storage (Keychain/Keystore)</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Store both access & refresh tokens securely</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Implement background token refresh</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Handle app background/foreground cycles</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Clear tokens on logout/uninstall</li>
                    </ul>
                  </CardContent>
                </Card>

                <Card className="border-[#DCE5F0]">
                  <CardHeader>
                    <CardTitle className="text-[#102B50]">Two-Factor Authentication (2FA)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm text-[#52647A]">
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Step 1: POST /api/auth/login-request-otp</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Step 2: POST /api/auth/login-verify-otp</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Returns standard access + refresh tokens</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> OTP expires in 10 minutes</li>
                      <li className="flex items-start gap-2"><Check className="size-4 text-green-600" /> Passwordless OTP: /api/auth/send-otp + /api/auth/verify-otp</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </section>
      </main>
      <PublicBrandFooter />
    </div>
  );
}