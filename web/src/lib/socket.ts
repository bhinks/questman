/**
 * Lazy socket.io-client connection. Created on demand after login,
 * authenticated with the same Bearer token used by REST.
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
import { API_BASE, getToken } from './api';

let socket: Socket | null = null;

export function connectSocket(): Socket | null {
  if (socket?.connected) return socket;
  const token = getToken();
  if (!token) return null;

  // socket.io's default origin is API_BASE; pass "" in prod to use
  // same-origin (the nginx proxy fronts /socket.io).
  socket = io(API_BASE || window.location.origin, {
    auth: { token },
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
