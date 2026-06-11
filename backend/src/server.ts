import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { config } from './config';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import { startHealthPull } from './services/healthSync';
import { WebSocketService } from './services/WebSocketService';

// Routes
import authRoutes from './routes/auth';
import transactionRoutes from './routes/transactions';
import categoryRoutes from './routes/categories';
import analyticsRoutes from './routes/analytics';
import importRoutes from './routes/import';
import playerRoutes from './routes/player';
import moduleRoutes from './routes/modules';
import habitRoutes from './routes/habits';
import workoutRoutes from './routes/workouts';
import goalRoutes from './routes/goals';
import questRoutes from './routes/quests';
import weatherRoutes from './routes/weather';
import calendarRoutes from './routes/calendar';
import ingestRoutes from './routes/ingest';
import projectRoutes from './routes/projects';
import mediaRoutes from './routes/media';
import metricRoutes from './routes/metrics';
import npcRoutes from './routes/npcs';
import shopRoutes from './routes/shop';
import achievementRoutes from './routes/achievements';
import bossRoutes from './routes/bosses';
import chainRoutes from './routes/chains';
import antigoalRoutes from './routes/antigoals';
import handlerRoutes from './routes/handler';
import insightRoutes from './routes/insights';
import debriefRoutes from './routes/debrief';
import budgetRoutes from './routes/budgets';
import recurringRoutes from './routes/recurring';
import settingsRoutes from './routes/settings';
import focusRoutes from './routes/focus';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
    methods: ['GET', 'POST']
  }
});

// Initialize Prisma
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error']
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', authMiddleware, transactionRoutes);
app.use('/api/categories', authMiddleware, categoryRoutes);
app.use('/api/analytics', authMiddleware, analyticsRoutes);
app.use('/api/import', authMiddleware, importRoutes);
app.use('/api/player', authMiddleware, playerRoutes);
app.use('/api/modules', authMiddleware, moduleRoutes);
app.use('/api/habits', authMiddleware, habitRoutes);
app.use('/api/workouts', authMiddleware, workoutRoutes);
app.use('/api/goals', authMiddleware, goalRoutes);
app.use('/api/quests', authMiddleware, questRoutes);
app.use('/api/weather', authMiddleware, weatherRoutes);
app.use('/api/calendar', authMiddleware, calendarRoutes);
// Ingest does its own auth (JWT OR the INGEST_TOKEN header) so phone-side
// automations can push health metrics without a short-lived login token.
app.use('/api/ingest', ingestRoutes);
app.use('/api/projects', authMiddleware, projectRoutes);
app.use('/api/media', authMiddleware, mediaRoutes);
app.use('/api/metrics', authMiddleware, metricRoutes);
app.use('/api/npcs', authMiddleware, npcRoutes);
app.use('/api/shop', authMiddleware, shopRoutes);
app.use('/api/achievements', authMiddleware, achievementRoutes);
app.use('/api/bosses', authMiddleware, bossRoutes);
app.use('/api/chains', authMiddleware, chainRoutes);
app.use('/api/antigoals', authMiddleware, antigoalRoutes);
app.use('/api/handler', authMiddleware, handlerRoutes);
app.use('/api/insights', authMiddleware, insightRoutes);
app.use('/api/debrief', authMiddleware, debriefRoutes);
app.use('/api/budgets', authMiddleware, budgetRoutes);
app.use('/api/recurring', authMiddleware, recurringRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);
app.use('/api/focus', authMiddleware, focusRoutes);

// Initialize WebSocket service
const webSocketService = new WebSocketService(io);

// Make io and WebSocket service available globally
declare global {
  var io: SocketIOServer;
  var wsService: WebSocketService;
}
global.io = io;
global.wsService = webSocketService;

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Starting graceful shutdown...');
  
  server.close(async () => {
    logger.info('HTTP server closed.');
    
    await prisma.$disconnect();
    logger.info('Database connection closed.');
    
    process.exit(0);
  });
  
  // Force close server after 10s
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const PORT = config.port || 3001;
server.listen(PORT, () => {
  logger.info(`🚀 Questman backend running on port ${PORT}`);
  logger.info(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`📊 Database: ${config.database.url}`);
  // Health pull mode (no-op unless HEALTH_PULL_URL is set): poll the
  // phone's local Health Connect server for daily metrics.
  startHealthPull(prisma);
});

export { app, server, io };