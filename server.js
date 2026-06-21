import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Import routes
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import fileRoutes from './routes/files.js';
import chatRoutes from './routes/chat.js';
import reviewRoutes from './routes/review.js';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for dev simplicity
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

// Store io instance on app to use in REST routes
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());

// Routes mapping
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects/:projectId/files', fileRoutes);
app.use('/api/projects/:projectId/chat', chatRoutes);
app.use('/api/projects/:projectId/review', reviewRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

// Database connection logic
let mongoServer = null;

const startMemoryServer = async () => {
  console.log('Starting In-Memory MongoDB Server...');
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  console.log(`In-Memory MongoDB Server running at URI: ${mongoUri}`);
  await mongoose.connect(mongoUri);
  console.log('Connected to In-Memory MongoDB.');
};

const connectDB = async () => {
  const dbUri = process.env.MONGO_URI;

  try {
    if (dbUri) {
      console.log('Connecting to provided MongoDB URI...');
      // Set serverSelectionTimeoutMS to 8000ms so it fails quickly if IP is not whitelisted
      await mongoose.connect(dbUri, { serverSelectionTimeoutMS: 8000 });
      console.log('MongoDB connected successfully.');
    } else {
      await startMemoryServer();
    }
  } catch (error) {
    console.error('Failed to connect to the provided MongoDB database:', error.message);
    console.log('Automatically falling back to In-Memory MongoDB Server to ensure workspace works...');
    try {
      await startMemoryServer();
    } catch (fallbackError) {
      console.error('Failed to start In-Memory MongoDB fallback:', fallbackError);
      console.log('Running server in Database-offline mode. Workspace operations may not persist.');
    }
  }
};

// Socket.io Real-time Collaboration handling
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",   // Connection
  yellow: "\x1b[33m",  // Joining / Syncing
  blue: "\x1b[34m",    // Cursor Activity
  magenta: "\x1b[35m", // Leaving
  red: "\x1b[31m"      // Disconnect
};

io.on('connection', (socket) => {
  // Connection state: Bright Green
  console.log(`${colors.green}${colors.bright}[CONNECTED]${colors.reset} Socket client: ${socket.id}`);

  // User joins a project room: Yellow
  socket.on('join-project', ({ projectId, username }) => {
    socket.join(projectId);
    console.log(`${colors.yellow}[JOIN]${colors.reset} User ${username} (${socket.id}) joined room: ${projectId}`);

    // Notify others in room
    socket.to(projectId).emit('user-joined', { username, socketId: socket.id });
  });

  // User leaves a project room: Magenta
  socket.on('leave-project', ({ projectId, username }) => {
    socket.leave(projectId);
    console.log(`${colors.magenta}[LEAVE]${colors.reset} User ${username} (${socket.id}) left room: ${projectId}`);
    socket.to(projectId).emit('user-left', { username, socketId: socket.id });
  });

  // Active file editing: Yellow (Data Sync)
  socket.on('edit-file-content', ({ projectId, fileId, path, content, username }) => {
    console.log(`${colors.yellow}[EDIT]${colors.reset} User ${username} modified ${path} in project ${projectId}`);

    // Broadcast content updates in real-time
    socket.to(projectId).emit('file-content-sync', {
      fileId,
      path,
      content,
      updatedBy: username
    });
  });

  // Active cursor positions: Blue (Frequent Activity)
  // socket.on('cursor-activity', ({ projectId, fileId, username, position }) => {
  //   // Note: Logging this frequently might flood your console, but here is the color setup:
  //   console.log(`${colors.blue}[CURSOR]${colors.reset} ${username} moved in ${fileId}`);

  //   socket.to(projectId).emit('cursor-activity-sync', {
  //     fileId,
  //     username,
  //     position // {lineNumber, column}
  //   });
  // });

  // Disconnect state: Bright Red
  socket.on('disconnect', () => {
    console.log(`${colors.red}${colors.bright}[DISCONNECTED]${colors.reset} Socket client: ${socket.id}`);
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});

// Handle graceful shutdown
const gracefulShutdown = async () => {
  console.log('Shutting down server...');
  if (mongoose.connection) {
    await mongoose.connection.close();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
  process.exit(0);
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
