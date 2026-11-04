import { WebSocketServer } from 'ws';
import { verifyAccessToken } from '../services/token.service.js';
import { User } from '../models/User.js';
import { LiveExam } from '../models/LiveExam.js';
import { LiveParticipant } from '../models/LiveParticipant.js';
import { ACCESS_COOKIE } from '../config/cookies.js';
import { registerWs, unregisterWs } from '../services/liveEvents.js';
import { logger } from '../utils/logger.js';

const ROOM_PATH = /^\/ws\/live-cbt\/([A-Za-z2-9]{6,16})$/;

/**
 * Live CBT WebSocket gateway (rooms capped at 30 participants per exam).
 *
 * Endpoint:  WS(S) /ws/live-cbt/:shareCode
 * Auth:      ?token=<JWT access token> query param (primary — browsers can't
 *            set headers on WS handshakes), else the `tf_access` cookie.
 * Events in:  { "type": "ping" } -> { event: "pong", serverTime }
 * Events out: participant.joined | participant.approved | participant.rejected |
 *             room.updated | exam.started | exam.timed_out | participant.submitted |
 *             exam.ended | results.published | exam.cancelled
 *             Every payload carries authoritative `serverTime`; countdowns derive
 *             from `startedAt`/`endsAt` in REST responses — never the client clock.
 */

const parseToken = (req) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken) return queryToken;
  } catch {
    // Fall through to cookies.
  }
  const cookieHeader = req.headers?.cookie ?? '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((part) => {
      const index = part.indexOf('=');
      if (index === -1) return [];
      return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }),
  );
  return cookies[ACCESS_COOKIE] ?? null;
};

export const attachLiveCbtSocket = (server) => {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (!ROOM_PATH.test(pathname)) return; // Not ours — let other handlers decide.
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', async (ws, req) => {
    const match = new URL(req.url, 'http://localhost').pathname.match(ROOM_PATH);
    const shareCode = match?.[1];
    if (!shareCode) {
      ws.close(4404, 'Unknown exam room.');
      return;
    }

    let userId;
    try {
      const token = parseToken(req);
      if (!token) throw new Error('Missing token.');
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub).select('+tokenVersion').lean();
      if (!user || (user.tokenVersion ?? 0) !== payload.tv) throw new Error('Stale token.');
      userId = String(user._id);
    } catch {
      ws.close(4401, 'Authentication required.');
      return;
    }

    const exam = await LiveExam.findOne({ shareCode }).lean();
    if (!exam) {
      ws.close(4404, 'Examination not found.');
      return;
    }
    const isHost = String(exam.host) === String(userId);
    const membership = await LiveParticipant.findOne({ liveExam: exam._id, user: userId }).lean();
    if (!isHost && !membership) {
      ws.close(4403, 'Join this examination to receive live updates.');
      return;
    }

    ws.shareCode = shareCode;
    ws.userId = userId;
    ws.isAlive = true;
    registerWs(shareCode, ws);
    ws.send(
      JSON.stringify({
        event: 'connected',
        shareCode,
        status: exam.status,
        startedAt: exam.startedAt ?? null,
        endsAt: exam.endsAt ?? null,
        serverTime: new Date().toISOString(),
      }),
    );

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (message?.type === 'ping') {
        ws.send(JSON.stringify({ event: 'pong', serverTime: new Date().toISOString() }));
      }
      // All exam mutations travel over authenticated REST — the socket is
      // push-only (aside from ping) so clients can never mutate exam state here.
    });

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => unregisterWs(shareCode, ws));
    ws.on('error', () => unregisterWs(shareCode, ws));
  });

  // Prune dead connections; rooms are tiny (<=30) so this is cheap.
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        unregisterWs(ws.shareCode, ws);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (error) {
        logger.error('Live CBT heartbeat failed', error);
      }
    });
  }, 25000);
  heartbeat.unref();

  return wss;
};
