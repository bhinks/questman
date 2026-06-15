/**
 * Lazy socket.io-client connection. Created on demand after login,
 * authenticated by the same httpOnly auth cookie used by REST (sent on the
 * handshake via withCredentials).
 *
 * Events we expect from the backend (broadcast to `user-${userId}`):
 *   - player-updated:    { player, timestamp }
 *   - quest-completed:   { questId, xpAwarded, leveledUp, timestamp }
 *   - habit-checked:     { habitId, xpAwarded, questAutoCompleted, timestamp }
 *   - workout-logged:    { workoutId, xpAwarded, questAutoCompleted, timestamp }
 *
 * The HTTP response is the source of truth for the action that just
 * happened (the same data is returned synchronously). Sockets exist
 * for live HUD animation when other devices/tabs make changes.
 */
import { io, Socket } from 'socket.io-client';
import { API_BASE } from './api';

let socket: Socket | null = null;

export function connectSocket(): Socket | null {
  if (socket?.connected) return socket;

  // socket.io's default origin is API_BASE; pass "" in prod to use
  // same-origin (the nginx proxy fronts /socket.io). withCredentials sends
  // the httpOnly auth cookie on the handshake (the server authenticates it).
  socket = io(API_BASE || window.location.origin, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function getSocket(): Socket | null {
  return socket;
}
