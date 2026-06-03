# StocksIntels

A full-stack stock market analysis platform with real-time data, AI insights, and portfolio tracking. This project is based on a Figma design available at [Figma](https://www.figma.com/design/sM3Vq1tlfGm5huRu74E5hB/StockIntel).

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-web-lightgrey.svg)

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [API Documentation](#api-documentation)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

- **Real-time Market Data**: Live stock prices and market indices from NSE (Nairobi Securities Exchange)
- **Watchlist Management**: Create, update, and track your favorite stocks
- **AI-Powered Insights**: Market summaries and analysis powered by AI
- **User Authentication**: Secure user registration and login system
- **News Aggregation**: Financial news from multiple sources
- **Portfolio Tracking**: Monitor your investment portfolio performance
- **Interactive Charts**: Visual representation of stock trends and analytics

## 🛠 Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development and building
- **Tailwind CSS** for styling
- **shadcn/ui** and **Radix UI** for accessible components
- **React Router v7** for navigation
- **Recharts** for data visualization
- **React Hook Form** for form management

### Backend
- **Node.js** with Express.js
- **PostgreSQL** for data persistence
- **Docker** for containerized database
- **bcryptjs** for password hashing
- **Axios** for HTTP requests

### DevOps & Tools
- **pnpm** workspaces for monorepo management
- **Docker Compose** for database orchestration

## 📁 Project Structure

```
StocksIntels/
├── frontend/                 # React frontend application
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/   # Reusable UI components
│   │   │   ├── pages/        # Application pages/routes
│   │   │   ├── services/     # API service layers
│   │   │   ├── auth/         # Authentication logic
│   │   │   └── layouts/      # Page layouts
│   │   └── styles/           # Global styles
│   ├── package.json
│   └── vite.config.ts
├── backend/                  # Node.js backend API
│   ├── db/                   # Database initialization scripts
│   ├── index.js              # Main server file
│   ├── newsService.js        # News aggregation service
│   ├── db.js                 # Database connection
│   └── package.json
├── docker-compose.yml        # Docker configuration for PostgreSQL
├── .env.example              # Frontend environment variables template
├── pnpm-workspace.yaml       # pnpm workspace configuration
└── README.md
```

## 📦 Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (v18 or higher)
- **pnpm** (v8 or higher) - [Install pnpm](https://pnpm.io/installation)
- **Docker** and **Docker Compose** (for PostgreSQL)
- **Git** for version control

## 🚀 Getting Started

### 1. Clone and Install Dependencies

```bash
# Install dependencies for all workspaces
pnpm install
```

### 2. Database Setup

Start PostgreSQL using Docker:

```bash
docker compose up -d postgres
```

This creates a database with the following credentials:
- **Host**: `localhost`
- **Port**: `5432`
- **Database**: `stockintel`
- **User**: `stockintel`
- **Password**: `stockintel`

### 3. Environment Configuration

#### Backend Environment Variables

Copy the backend environment template and configure:

```bash
# Windows
copy backend\.env.example backend\.env

# macOS/Linux
cp backend/.env.example backend/.env
```

Edit `backend/.env` with your configuration. Key variables:
- `DATABASE_URL`: PostgreSQL connection string (pre-configured for Docker)
- `MARKET_DATA_PROVIDER`: Set to `rapidapi` (recommended) or `twelvedata`
- `RAPIDAPI_KEY`: API key for RapidAPI (Yahoo Finance via RapidAPI). Get a free key at [RapidAPI](https://rapidapi.com/)
- `TWELVE_DATA_API_KEY`: API key for Twelve Data (alternative market data provider). Get a free key at [Twelve Data](https://twelvedata.com/)
- `FMP_API_KEY`: API key for Financial Modeling Prep (FMP). Get a free key at Financial Modeling Prep for financial reports.

> **Note**: RapidAPI with Yahoo Finance provides better coverage for NSE (Nairobi Securities Exchange) stocks. The application gracefully falls back to direct Yahoo Finance or synthetic data when the configured provider is unavailable.

#### Frontend Environment Variables

Create a `.env.local` file in the root directory:

```bash
# Copy from template
copy .env.example .env.local    # Windows
cp .env.example .env.local      # macOS/Linux
```

Configure your API keys:
- `VITE_NEWSAPI_KEY`: NewsAPI key for financial news
- `VITE_FINNHUB_KEY`: Finnhub API key for market data

> **Note**: Never commit `.env.local` or `backend/.env` to version control!

### 4. Running the Application

You'll need to run the frontend and backend separately:

#### Terminal 1: Start Backend

```bash
cd backend
pnpm run dev
```

Backend will run on `http://localhost:3001`

#### Terminal 2: Start Frontend

```bash
# From root directory
pnpm run dev
```

Frontend will run on `http://localhost:5173` (or next available port)

### 5. Verify Setup

- **Frontend**: Open `http://localhost:5173` in your browser
- **Backend Health Check**: Visit `http://localhost:3001/api/health/db` to verify database connectivity
- **API Base URL**: `http://localhost:3001/api`

### Troubleshooting

**Port already in use:**
- Backend (3001): Change `port` in `backend/index.js`
- Frontend (5173): Change `port` in `frontend/vite.config.ts`

**Database connection issues:**
- Ensure Docker is running: `docker ps`
- Check PostgreSQL logs: `docker logs stockintel-postgres`
- Restart database: `docker compose restart postgres`

**Missing API keys:**
- Get free API keys from [NewsAPI](https://newsapi.org/) and [Finnhub](https://finnhub.io/)
- Some features will use fallback data if keys are not configured

## 📡 API Documentation

### Base URL
```
http://localhost:3001/api
```

### Health Check
```
GET /api/health/db
```
Verifies database connectivity.

### Market Data Endpoints

#### Get Market Indices
```
GET /api/market/indices
```
Returns all market indices with current values.

#### Get Top Movers
```
GET /api/market/movers
```
Returns top gainers and losers.

#### Get Active Stocks
```
GET /api/market/active
```
Returns most actively traded stocks.

#### Get Single Stock Data
```
GET /api/stock/:symbol
```
Returns real-time data for a specific stock.

#### Market Data Stream (SSE)
```
GET /api/market/stream
```
Server-Sent Events stream for real-time market updates.

### Watchlist Endpoints

#### Get All Watchlist Items
```
GET /api/watchlist
```

#### Get Single Watchlist Item
```
GET /api/watchlist/:id
```

#### Create Watchlist Item
```
POST /api/watchlist
```
Body: `{ "symbol": "SCOM", "company_name": "Safaricom", "notes": "Optional notes", "target_price": 30.0 }`

#### Update Watchlist Item
```
PUT /api/watchlist/:id
```

#### Delete Watchlist Item
```
DELETE /api/watchlist/:id
```

### User Endpoints

#### Get All Users
```
GET /api/users
```

#### Get User by ID
```
GET /api/users/:id
```

#### Create User
```
POST /api/users
```
Body: `{ "full_name": "John Doe", "email": "john@example.com", "password": "password123" }`
- Password must be at least 8 characters

#### Update User
```
PUT /api/users/:id
```

#### Delete User
```
DELETE /api/users/:id
```

### News Endpoint

#### Get Financial News
```
GET /api/news
```
Returns aggregated financial news from multiple sources focused on Kenyan stocks and the Nairobi Securities Exchange (NSE).

**News Sources:**
The application aggregates news from:
- **NewsAPI**: Searches for Kenyan business and stock market news from global sources
- **Finnhub**: General financial market news
- **Kenyan Business Sources**: Curated news from local sources including:
  - Business Daily Africa
  - Nation Africa
  - The Star Kenya
  - Standard Media
  - Citizen TV
  - KBC
  - NTV Kenya
  - K24 TV

**Covered Kenyan Stocks:**
The news service tracks and filters news for major NSE-listed companies including:
- Safaricom (SCOM)
- Equity Group (EQTY)
- KCB Group (KCB)
- East African Breweries (EABL)
- Bamburi Cement (BAMB)
- Kenya Airways (KLG)
- Kenya Power (KPLC)
- Nation Media Group (NMG)
- And 10+ other NSE-listed companies

**Features:**
- **Sentiment Analysis**: Articles are analyzed for positive/negative/neutral sentiment
- **Stock Tagging**: Articles are automatically tagged with related stock symbols
- **Deduplication**: Duplicate articles from different sources are filtered out
- **Real-time Updates**: News is fetched and sorted by recency

## 🤝 Contributing

We welcome contributions from the community! Please follow these guidelines to help us maintain code quality and consistency.

### Code of Conduct

- Be respectful and inclusive in all interactions
- Provide constructive feedback
- Focus on what's best for the community

### Development Workflow

1. **Fork the repository** and create your branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following our coding standards:
   - Write clean, readable, and maintainable code
   - Follow existing patterns in the codebase
   - Add comments for complex logic
   - Keep components small and focused on a single responsibility

3. **Test your changes**:
   - Ensure the application runs without errors
   - Test both frontend and backend functionality
   - Verify database operations work correctly

4. **Commit your changes** with clear, descriptive messages:
   ```bash
   git commit -m "feat: add new feature description"
   ```
   
   **Commit message format:**
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `style:` for formatting changes (non-functional)
   - `refactor:` for code refactoring
   - `perf:` for performance improvements
   - `test:` for adding or updating tests
   - `chore:` for maintenance tasks

5. **Push to your fork** and submit a Pull Request:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request** with:
   - Clear title and description
   - Screenshots if UI changes are involved
   - Description of testing performed
   - Link to any relevant issues

### Coding Standards

#### Frontend (React/TypeScript)
- Use TypeScript for type safety
- Follow React best practices (hooks, functional components)
- Use Tailwind CSS for styling (avoid inline styles)
- Keep components under 200 lines when possible
- Use meaningful variable and function names
- Import from absolute paths when possible

#### Backend (Node.js)
- Use async/await for asynchronous operations
- Handle errors gracefully with try/catch
- Use environment variables for configuration
- Keep routes organized and modular
- Validate all user inputs
- Use parameterized queries for database operations

### Pull Request Process

1. Update documentation if needed
2. Test your changes thoroughly
3. Ensure no sensitive data is committed
4. Request review from maintainers
5. Address review feedback promptly

### Reporting Issues

- Use the GitHub issue template
- Provide clear reproduction steps
- Include error messages and screenshots
- Specify your environment (OS, Node version, browser)

### Questions?

Feel free to open an issue for any questions or discussions about contributing.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Built with ❤️ using React, Node.js, and PostgreSQL**