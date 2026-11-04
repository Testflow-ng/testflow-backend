/**
 * Realtime fan-out for Live CBT rooms (max 30 participants per exam).
 * Persistence lives in MongoDB; these maps hold only active subscribers.
 * Room isolation: subscribers are keyed by exam shareCode, never broadcast
 * across rooms. A server restart drops subscribers (clients reconnect and
 * re-sync authoritative state via REST — no exam state is lost).
 *
 * Two transports, one room:
 * - WebSocket (primary): full-duplex, low-latency join/start/timer events.
 * - Server-Sent Events (fallback): GET /api/live-cbt/:code/stream.
 * `publish` fans every exam event out to BOTH transports in the same room.
 */

const sseRooms = new Map(); // shareCode -> Set<res>
const wsRooms = new Map(); // shareCode -> Set<ws>

export const subscribe = (shareCode, res) => {
  if (!sseRooms.has(shareCode)) sseRooms.set(shareCode, new Set());
  sseRooms.get(shareCode).add(res);
};

export const unsubscribe = (shareCode, res) => {
  const set = sseRooms.get(shareCode);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseRooms.delete(shareCode);
};

export const registerWs = (shareCode, socket) => {
  if (!wsRooms.has(shareCode)) wsRooms.set(shareCode, new Set());
  wsRooms.get(shareCode).add(socket);
};

export const unregisterWs = (shareCode, socket) => {
  const set = wsRooms.get(shareCode);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) wsRooms.delete(shareCode);
};

export const subscriberCount = (shareCode) =>
  (sseRooms.get(shareCode)?.size ?? 0) + (wsRooms.get(shareCode)?.size ?? 0);

export const wsSubscriberCount = (shareCode) => wsRooms.get(shareCode)?.size ?? 0;

/** Broadcast a named event to every subscriber (WS + SSE) of one exam room. */
export const publish = (shareCode, event, data = {}) => {
  const envelope = JSON.stringify({ event, ...data, serverTime: new Date().toISOString() });
  let delivered = 0;

  const wsSet = wsRooms.get(shareCode);
  if (wsSet) {
    for (const socket of [...wsSet]) {
      try {
        if (socket.readyState === 1) {
          socket.send(envelope);
          delivered += 1;
        } else {
          wsSet.delete(socket);
        }
      } catch {
        wsSet.delete(socket);
      }
    }
    if (wsSet.size === 0) wsRooms.delete(shareCode);
  }

  const sseSet = sseRooms.get(shareCode);
  if (sseSet) {
    const payload = `event: ${event}\ndata: ${envelope}\n\n`;
    for (const res of [...sseSet]) {
      try {
        res.write(payload);
        delivered += 1;
      } catch {
        sseSet.delete(res);
      }
    }
    if (sseSet.size === 0) sseRooms.delete(shareCode);
  }

  return delivered;
};
