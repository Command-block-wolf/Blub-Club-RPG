'use strict';
/*
 * Blub Club RPG: signaling server.
 *
 * What it does: lets a HOST create a room and get a short code, lets GUESTS
 * join with that code, and passes the WebRTC handshake messages (offer,
 * answer, ICE candidates) between them. That is ALL it does. Game traffic
 * never goes through here: once the handshake is done, the browsers talk to
 * each other directly.
 *
 * Topology: the host is peer 1. Guests only ever talk to the host.
 *
 * Messages are JSON text.
 *   client -> server
 *     {type:"host", max:4}              create a room
 *     {type:"join", code:"ABCDE"}       join a room
 *     {type:"offer"|"answer", to, sdp}  WebRTC handshake
 *     {type:"candidate", to, mid, index, sdp}
 *   server -> client
 *     {type:"hosted", code, id:1}
 *     {type:"joined", id, code}         (guest)
 *     {type:"peer_joined", id}          (host: a guest arrived)
 *     {type:"peer_left", id}            (host: a guest left)
 *     {type:"room_closed"}              (guest: the host left)
 *     {type:"offer"|"answer"|"candidate", from, ...}
 *     {type:"error", reason}
 *
 * Settings (environment variables):
 *   PORT             port to listen on                    (default 9090)
 *   MAX_ROOMS        most rooms at once                   (default 500)
 *   ALLOWED_ORIGINS  comma-separated list of website origins allowed to
 *                    connect, e.g. "https://myblubclub.com". Empty = any.
 *                    A * stands for "any subdomain", e.g. "https://*.itch.zone".
 *                    A site that is turned away is written to the log, so you
 *                    can see exactly what to add.
 */

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '9090', 10);
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS || '500', 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const CODE_LENGTH = 5;
// No I, O, 0 or 1: easy to misread when reading a code aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MAX_MESSAGES_PER_SECOND = 80;
const HEARTBEAT_MS = 30000;
const MAX_SDP = 10000;
const MAX_CANDIDATE = 2000;

// code -> { host: ws, guests: Map(id -> ws), max: number }
const rooms = new Map();

const httpServer = http.createServer((req, res) => {
  // A plain page so hosting platforms can health-check the service.
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Blub Club signaling server: ok\n');
});

// Does this website origin match the allowed list? ("*" = any subdomain.)
function originAllowed(origin) {
  if (ALLOWED_ORIGINS.length === 0) return true;
  if (!origin) return false;

  return ALLOWED_ORIGINS.some((pattern) => {
    if (!pattern.includes('*')) return pattern === origin;

    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[A-Za-z0-9.-]+');

    return new RegExp('^' + escaped + '$').test(origin);
  });
}

const reportedOrigins = new Set();

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: 16 * 1024,
  verifyClient: (info, done) => {
    if (originAllowed(info.origin)) return done(true);

    // Say which site was turned away (once each), so it is easy to fix.
    const shown = info.origin || '(no origin)';
    if (!reportedOrigins.has(shown)) {
      reportedOrigins.add(shown);
      console.log(`Turned away a connection from ${shown}. ` +
        'If that is your game, add it to ALLOWED_ORIGINS.');
    }
    return done(false, 403, 'Origin not allowed');
  },
});

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function fail(ws, reason) {
  send(ws, { type: 'error', reason });
}

function generateCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return null;
}

// Guests get random ids between 2 and 2^31-1 (Godot needs ids in that range;
// 1 is always the host).
function newGuestId(room) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = 2 + Math.floor(Math.random() * 2147483000);
    if (!room.guests.has(id)) return id;
  }
  return null;
}

function isCleanString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function handleHost(ws, msg) {
  if (ws.role) return fail(ws, 'already_in_room');
  if (rooms.size >= MAX_ROOMS) return fail(ws, 'server_full');

  let max = parseInt(msg.max, 10);
  if (!Number.isFinite(max)) max = 4;
  max = Math.min(Math.max(max, MIN_PLAYERS), MAX_PLAYERS);

  const code = generateCode();
  if (!code) return fail(ws, 'server_full');

  rooms.set(code, { host: ws, guests: new Map(), max });
  ws.role = 'host';
  ws.roomCode = code;
  ws.peerId = 1;

  send(ws, { type: 'hosted', code, id: 1 });
  console.log(`room ${code} created (max ${max}). rooms: ${rooms.size}`);
}

function handleJoin(ws, msg) {
  if (ws.role) return fail(ws, 'already_in_room');

  const code = String(msg.code || '').trim().toUpperCase();
  const room = rooms.get(code);

  if (!room) return fail(ws, 'room_not_found');
  if (1 + room.guests.size >= room.max) return fail(ws, 'room_full');

  const id = newGuestId(room);
  if (id === null) return fail(ws, 'server_full');

  room.guests.set(id, ws);
  ws.role = 'guest';
  ws.roomCode = code;
  ws.peerId = id;

  // Tell the host first so it is ready for the guest's offer.
  send(room.host, { type: 'peer_joined', id });
  send(ws, { type: 'joined', id, code });
  console.log(`room ${code}: guest ${id} joined (${1 + room.guests.size}/${room.max})`);
}

function handleRelay(ws, msg) {
  if (!ws.role) return fail(ws, 'not_in_room');

  const room = rooms.get(ws.roomCode);
  if (!room) return;

  const to = msg.to;
  if (!Number.isInteger(to)) return;

  // Guests may only talk to the host. The host may talk to its guests.
  let target = null;
  if (ws.role === 'guest') {
    if (to !== 1) return;
    target = room.host;
  } else {
    target = room.guests.get(to);
  }
  if (!target) return;

  // Rebuild the message from known fields only (never forward extras), and
  // stamp the sender ourselves so nobody can pretend to be someone else.
  if (msg.type === 'offer' || msg.type === 'answer') {
    if (!isCleanString(msg.sdp, MAX_SDP)) return;
    send(target, { type: msg.type, from: ws.peerId, sdp: msg.sdp });
  } else if (msg.type === 'candidate') {
    if (!isCleanString(msg.mid, 256)) return;
    if (!Number.isInteger(msg.index) || msg.index < 0 || msg.index > 64) return;
    if (!isCleanString(msg.sdp, MAX_CANDIDATE)) return;
    send(target, { type: 'candidate', from: ws.peerId, mid: msg.mid, index: msg.index, sdp: msg.sdp });
  }
}

function handleMessage(ws, raw) {
  // Simple flood protection.
  const now = Date.now();
  if (now - ws.windowStart >= 1000) {
    ws.windowStart = now;
    ws.windowCount = 0;
  }
  ws.windowCount += 1;
  if (ws.windowCount > MAX_MESSAGES_PER_SECOND) {
    ws.close(1008, 'Too many messages');
    return;
  }

  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch (e) {
    return fail(ws, 'bad_message');
  }
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    return fail(ws, 'bad_message');
  }

  switch (msg.type) {
    case 'host': return handleHost(ws, msg);
    case 'join': return handleJoin(ws, msg);
    case 'offer':
    case 'answer':
    case 'candidate': return handleRelay(ws, msg);
    default: return fail(ws, 'bad_message');
  }
}

function handleClose(ws) {
  if (!ws.role) return;

  const room = rooms.get(ws.roomCode);
  if (!room) return;

  if (ws.role === 'host') {
    // The session ends with the host: tell every guest, then drop the room.
    for (const guest of room.guests.values()) {
      send(guest, { type: 'room_closed' });
      guest.close(1000, 'Host left');
    }
    rooms.delete(ws.roomCode);
    console.log(`room ${ws.roomCode} closed. rooms: ${rooms.size}`);
  } else {
    room.guests.delete(ws.peerId);
    send(room.host, { type: 'peer_left', id: ws.peerId });
    console.log(`room ${ws.roomCode}: guest ${ws.peerId} left`);
  }
}

wss.on('connection', (ws) => {
  ws.role = null;
  ws.roomCode = null;
  ws.peerId = 0;
  ws.isAlive = true;
  ws.windowStart = Date.now();
  ws.windowCount = 0;

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => handleMessage(ws, raw));
  ws.on('close', () => handleClose(ws));
  ws.on('error', () => {});
});

// Drop connections that stopped answering.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

wss.on('close', () => clearInterval(heartbeat));

httpServer.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
  if (ALLOWED_ORIGINS.length > 0) {
    console.log(`Only allowing origins: ${ALLOWED_ORIGINS.join(', ')}`);
  }
});
