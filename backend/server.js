const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const pool = require('./db'); // Assuming db.js exports a PG pool

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

// --- REST API Endpoints ---

// Fetch all groups with membership count
app.get('/api/groups', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, COUNT(gm.user_id)::int as members 
      FROM trading_groups g 
      LEFT JOIN group_members gm ON g.id = gm.group_id 
      GROUP BY g.id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch user directory (People Page)
app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, full_name, role, trader_type, is_verified FROM users');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Socket.io Logic ---

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a specific trading group room
  socket.on('join_group', (groupId) => {
    socket.join(groupId);
    console.log(`Socket ${socket.id} joined group: ${groupId}`);
  });

  // Join a private conversation room
  socket.on('join_private', (userId, peerId) => {
    const room = [userId, peerId].sort().join('_');
    socket.join(room);
  });

  // Handle outgoing messages
  socket.on('send_message', async (data) => {
    const { senderId, content, groupId, recipientId, type } = data;
    
    try {
      // 1. Persist to Database
      const result = await pool.query(
        `INSERT INTO messages (sender_id, content, group_id, recipient_id, message_type) 
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [senderId, content, groupId, recipientId, type || 'user']
      );
      
      const savedMsg = result.rows[0];

      // 2. Broadcast
      if (groupId) {
        // Group message
        io.to(groupId).emit('receive_message', savedMsg);
      } else {
        // Private message
        const room = [senderId, recipientId].sort().join('_');
        io.to(room).emit('receive_message', savedMsg);
      }

      // 3. Trigger AI Assistant if stocks are mentioned (NSE-specific logic)
      if (groupId && content.match(/\b(SCOM|EQTY|KCB)\b/)) {
        // In a real app, this would call your AI service
        setTimeout(() => {
          io.to(groupId).emit('receive_message', {
            user: 'AI Assistant',
            content: `Technical analysis for mentioned stocks shows bullish momentum.`,
            message_type: 'ai',
            group_id: groupId
          });
        }, 1500);
      }
    } catch (err) {
      console.error('Message error:', err);
    }
  });
});

server.listen(3001, () => console.log('Backend running on port 3001'));