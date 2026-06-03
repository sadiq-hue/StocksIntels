// Minimal StockIntel backend server
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { pool } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || "http://localhost:5173", methods: ["GET", "POST"] }
});

app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

const port = process.env.PORT || 3001;

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('join', (userId) => {
    if (userId) socket.join(`user:${userId}`);
  });
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Initialize database
async function initDatabase() {
  try {
    await pool.query('DROP TABLE IF EXISTS watchlist_items CASCADE;');
    await pool.query(`CREATE TABLE IF NOT EXISTS watchlist_items (
      id SERIAL PRIMARY KEY,
      symbol VARCHAR(20) UNIQUE NOT NULL,
      company_name VARCHAR(255) NOT NULL,
      notes TEXT,
      target_price NUMERIC(15,2),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);
    console.log('Database schema verified');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
  }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
initDatabase().then(() => {
  server.listen(port, '0.0.0.0', async () => {
    console.log(`Backend server running at http://localhost:${port}`);
    try {
      const queueService = require('./queueService');
      const signalPublisher = require('./signalPublisher');
      await queueService.connect();
      queueService.onSignalUpdate((signal) => {
        if (signal.batch) {
          io.emit('signal:batch_update', signal);
          signal.signals.forEach(s => io.emit(`signal:update:${s.ticker}`, s));
          io.emit('signal:updates', signal.signals);
        } else {
          io.emit(`signal:update:${signal.ticker}`, signal);
        }
      });
      queueService.onMarketUpdate((quote) => { io.emit('market:update', quote); });
      signalPublisher.start();
      console.log('Redis pub/sub and signal publisher initialized');
    } catch (err) {
      console.warn('Redis unavailable - signal publisher disabled:', err.message);
    }
  });
});
