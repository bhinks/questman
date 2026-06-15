import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { AuthRequest, readCookie, verifyAuthToken, AUTH_COOKIE } from '../middleware/auth';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

export class WebSocketService {
  private io: SocketIOServer;
  private connectedUsers: Map<string, string[]> = new Map(); // userId -> socketIds

  constructor(io: SocketIOServer) {
    this.io = io;
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.io.use(this.authenticateSocket.bind(this));
    this.io.on('connection', this.handleConnection.bind(this));
  }

  /**
   * Authenticate socket connections using JWT tokens
   */
  private async authenticateSocket(socket: AuthenticatedSocket, next: Function) {
    try {
      // The httpOnly cookie rides along on the handshake; fall back to the
      // auth payload / Authorization header for non-browser clients.
      const token = readCookie(socket.handshake.headers.cookie, AUTH_COOKIE)
        || socket.handshake.auth.token
        || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      // Same gate as the HTTP middleware: valid signature + the account still
      // exists + the token hasn't been revoked (tokenVersion match).
      const user = await verifyAuthToken(token);
      socket.userId = user.id;

      logger.info(`Socket authenticated for user: ${user.id}`);
      next();
    } catch (error) {
      logger.error('Socket authentication failed:', error);
      next(new Error('Authentication error'));
    }
  }

  /**
   * Handle new socket connections
   */
  private handleConnection(socket: AuthenticatedSocket) {
    const userId = socket.userId!;
    
    logger.info(`User ${userId} connected with socket ${socket.id}`);
    
    // Track user connections
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, []);
    }
    this.connectedUsers.get(userId)!.push(socket.id);
    
    // Join user's personal room
    socket.join(`user-${userId}`);
    
    // Send connection confirmation with user stats
    this.sendUserStats(socket, userId);
    
    // Set up event handlers
    this.setupSocketEventHandlers(socket);
    
    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });
  }

  /**
   * Set up event handlers for socket
   */
  private setupSocketEventHandlers(socket: AuthenticatedSocket) {
    const userId = socket.userId!;

    // Real-time data subscriptions
    socket.on('subscribe-analytics', () => {
      socket.join(`analytics-${userId}`);
      logger.debug(`User ${userId} subscribed to analytics updates`);
    });

    socket.on('unsubscribe-analytics', () => {
      socket.leave(`analytics-${userId}`);
      logger.debug(`User ${userId} unsubscribed from analytics updates`);
    });

    socket.on('subscribe-transactions', () => {
      socket.join(`transactions-${userId}`);
      logger.debug(`User ${userId} subscribed to transaction updates`);
    });

    socket.on('unsubscribe-transactions', () => {
      socket.leave(`transactions-${userId}`);
      logger.debug(`User ${userId} unsubscribed from transaction updates`);
    });

    // Import progress tracking
    socket.on('subscribe-import-progress', (importId: string) => {
      socket.join(`import-${importId}`);
      logger.debug(`User ${userId} subscribed to import ${importId} progress`);
    });

    socket.on('unsubscribe-import-progress', (importId: string) => {
      socket.leave(`import-${importId}`);
      logger.debug(`User ${userId} unsubscribed from import ${importId} progress`);
    });

    // Heartbeat for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    // Error handling
    socket.on('error', (error) => {
      logger.error(`Socket error for user ${userId}:`, error);
    });
  }

  /**
   * Handle socket disconnection
   */
  private handleDisconnection(socket: AuthenticatedSocket) {
    const userId = socket.userId!;
    
    logger.info(`User ${userId} disconnected socket ${socket.id}`);
    
    // Remove from tracking
    const userSockets = this.connectedUsers.get(userId);
    if (userSockets) {
      const index = userSockets.indexOf(socket.id);
      if (index > -1) {
        userSockets.splice(index, 1);
        if (userSockets.length === 0) {
          this.connectedUsers.delete(userId);
          logger.info(`User ${userId} fully disconnected`);
        }
      }
    }
  }

  /**
   * Send user stats on connection
   */
  private async sendUserStats(socket: AuthenticatedSocket, userId: string) {
    try {
      // This would integrate with AnalyticsEngine to send current stats
      socket.emit('connection-stats', {
        connectedAt: new Date(),
        userId,
        sessionId: socket.id
      });
    } catch (error) {
      logger.error('Error sending user stats:', error);
    }
  }

  // Public methods for broadcasting updates

  /**
   * Broadcast transaction update to user
   */
  broadcastTransactionUpdate(userId: string, event: string, data: any) {
    this.io.to(`user-${userId}`).emit(event, {
      ...data,
      timestamp: new Date()
    });
    
    // Also send to transaction subscribers
    this.io.to(`transactions-${userId}`).emit('transaction-update', {
      event,
      data,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast category update to user
   */
  broadcastCategoryUpdate(userId: string, event: string, data: any) {
    this.io.to(`user-${userId}`).emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast analytics update to user
   */
  broadcastAnalyticsUpdate(userId: string, data: any) {
    this.io.to(`analytics-${userId}`).emit('analytics-updated', {
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Send import progress update
   */
  broadcastImportProgress(importId: string, progress: any) {
    this.io.to(`import-${importId}`).emit('import-progress', {
      importId,
      ...progress,
      timestamp: new Date()
    });
  }

  /**
   * Send import completion notification
   */
  broadcastImportComplete(userId: string, importId: string, result: any) {
    this.io.to(`user-${userId}`).emit('import-completed', {
      importId,
      ...result,
      timestamp: new Date()
    });
  }

  /**
   * Send import error notification
   */
  broadcastImportError(userId: string, importId: string, error: string) {
    this.io.to(`user-${userId}`).emit('import-error', {
      importId,
      error,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast a gamification event (quest completed, habit checked, workout logged, etc.)
   */
  broadcastGameEvent(userId: string, event: string, data: any) {
    this.io.to(`user-${userId}`).emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast updated player profile (level / XP / streak) to user
   */
  broadcastPlayerUpdate(userId: string, player: any) {
    this.io.to(`user-${userId}`).emit('player-updated', {
      player,
      timestamp: new Date()
    });
  }

  /**
   * Broadcast system notification
   */
  broadcastNotification(userId: string, notification: {
    type: 'info' | 'warning' | 'error' | 'success';
    title: string;
    message: string;
    duration?: number;
  }) {
    this.io.to(`user-${userId}`).emit('notification', {
      ...notification,
      timestamp: new Date()
    });
  }

  /**
   * Get connected users count
   */
  getConnectedUsersCount(): number {
    return this.connectedUsers.size;
  }

  /**
   * Get user connection status
   */
  isUserConnected(userId: string): boolean {
    return this.connectedUsers.has(userId);
  }

  /**
   * Get user's socket count
   */
  getUserSocketCount(userId: string): number {
    return this.connectedUsers.get(userId)?.length || 0;
  }

  /**
   * Send message to specific user across all their connections
   */
  sendToUser(userId: string, event: string, data: any) {
    this.io.to(`user-${userId}`).emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Force disconnect user (for security/admin purposes)
   */
  disconnectUser(userId: string, reason?: string) {
    const sockets = this.connectedUsers.get(userId);
    if (sockets) {
      sockets.forEach(socketId => {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('force-disconnect', { reason: reason || 'Session terminated by system' });
          socket.disconnect(true);
        }
      });
      this.connectedUsers.delete(userId);
      logger.info(`Force disconnected user ${userId}. Reason: ${reason || 'Unknown'}`);
    }
  }
}