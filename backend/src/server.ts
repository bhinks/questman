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
import { rateLimit } from './middleware/rateLimit';
import { startHealthPull } from './services/healthSync';
import { WebSocketService } from './services/WebSocketService';

// Routes
import authRoutes from './routes/auth';
import transactionRoutes from './routes/transactions';
import categoryRoutes from './routes/categories';
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
import antigoalRoutes from './routes/antigoals';
import handlerRoutes from './routes/handler';
import insightRoutes from './routes/insights';
import debriefRoutes from './routes/debrief';
import budgetRoutes from './routes/budgets';
import recurringRoutes from './routes/recurring';
import settingsRoutes from './routes/settings';
import focusRoutes from './routes/focus';
import adminRoutes from './routes/admin';
import apikeyRoutes from './routes/apikeys';
import v1Routes from './routes/v1';
import { adminAuth } from './middleware/admin';
import { apiKeyAuth } from './middleware/apiKeyAuth';

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true // allow the httpOnly auth cookie on the handshake (dev cross-port)
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
// Redact secret query params before logging. morgan 'combined' logs the full
// URL incl. the query string, so the long-lived INGEST_TOKEN passed as
// /api/ingest/health-connect?token=... would otherwise be persisted to
// logs/combined.log (and the console) in plaintext. Header-based auth is
// preferred; this protects the documented ?token= fallback.
morgan.token('safeUrl', (req: any) => {
  const url: string = req.originalUrl || req.url || '';
  return url.replace(/([?&](?:token|access_token|api_key)=)[^&]*/gi, '$1[REDACTED]');
});
const LOG_FORMAT =
  ':remote-addr - :remote-user [:date[clf]] ":method :safeUrl HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"';
app.use(morgan(LOG_FORMAT, { stream: { write: message => logger.info(message.trim()) } }));

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Throttle the credential/secret surfaces (login, register, and the
// token-authenticated ingest endpoints) to blunt brute-forcing. Uses the
// previously-dead config.rateLimit values; the rest of the API is already
// gated by a logged-in JWT.
const sensitiveLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: 'Too many requests to this endpoint — try again later.',
});

// API Routes
app.use('/api/auth', sensitiveLimiter, authRoutes);
app.use('/api/transactions', authMiddleware, transactionRoutes);
app.use('/api/categories', authMiddleware, categoryRoutes);
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
app.use('/api/ingest', sensitiveLimiter, ingestRoutes);
app.use('/api/projects', authMiddleware, projectRoutes);
app.use('/api/media', authMiddleware, mediaRoutes);
app.use('/api/metrics', authMiddleware, metricRoutes);
app.use('/api/npcs', authMiddleware, npcRoutes);
app.use('/api/shop', authMiddleware, shopRoutes);
app.use('/api/achievements', authMiddleware, achievementRoutes);
app.use('/api/bosses', authMiddleware, bossRoutes);
app.use('/api/antigoals', authMiddleware, antigoalRoutes);
app.use('/api/handler', authMiddleware, handlerRoutes);
app.use('/api/insights', authMiddleware, insightRoutes);
app.use('/api/debrief', authMiddleware, debriefRoutes);
app.use('/api/budgets', authMiddleware, budgetRoutes);
app.use('/api/recurring', authMiddleware, recurringRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);
app.use('/api/focus', authMiddleware, focusRoutes);
// Admin routes: accept either a logged-in admin JWT or the ADMIN_API_KEY header.
app.use('/api/admin', adminAuth, adminRoutes);
// API key management (requires a logged-in session).
app.use('/api/apikeys', authMiddleware, apikeyRoutes);
// External REST API v1: authenticated via user-generated API keys (bearer tokens).
app.use('/api/v1', apiKeyAuth, v1Routes);

// Initialize WebSocket service
const webSocketService = new WebSocketService(io);

// Make io and WebSocket service available globally
declare global {
  var io: SocketIOServer;
  var wsService: WebSocketService;
}
global.io = io;
global.wsService = webSocketService;

// 404 handler (after all routes, before the error handler)
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handling — MUST be registered last. Express identifies error
// middleware by its 4-arg signature and only reaches it after the route
// handlers, so registering it before the 404 catch-all (as it was) meant
// errors thrown downstream were never formatted by it.
app.use(errorHandler);

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