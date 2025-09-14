const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
require('dotenv').config();

// Import configurations
const connectDB = require('./config/db');
const redisClient = require('./services/cacheService');

// Import routes/controllers
const chatController = require('./controllers/chatController');
const orderController = require('./controllers/orderController');
const cacheController = require('./controllers/cacheController');

const app = express();

// Enable trust proxy for rate limiting
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
   origin: process.env.NODE_ENV === 'production' 
      ? ['https://poc-rp-3.onrender.com'] 
      : ['https://poc-rp-3.onrender.com'],
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://poc-rp-3.onrender.com'] 
    : ['http://localhost:3000', 'https://poc-rp-3.onrender.com'],
  credentials: true
 
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Routes
app.use('/api/chat', chatController);
app.use('/api/orders', orderController);
app.use('/api/cache', cacheController);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Socket.IO for real-time chat
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-session', (sessionId) => {
    socket.join(sessionId);
    console.log(`User ${socket.id} joined session ${sessionId}`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Make io available to controllers
app.set('io', io);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(error.status || 500).json({
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

// Initialize connections and start server
const startServer = async () => {
  try {
    await connectDB();
    
    // Try to connect to Redis but don't fail if it's not available
    try {
      await redisClient.connect();
      console.log('Redis connected successfully');
    } catch (redisError) {
      console.warn('Redis connection failed, continuing without cache:', redisError.message);
    }
    
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  try {
    if (redisClient.isReady()) {
      await redisClient.quit();
    }
  } catch (error) {
    console.warn('Error closing Redis connection:', error.message);
  }
  process.exit(0);
});

module.exports = { app, io };
