'use strict';
// Starts the server on a spare port and plays host and guests against it.
//   npm install && npm test
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 9191;
const URL = `ws://127.0.0.1:${PORT}`;
let failures = 0;

function check(name, condition) {
  if (condition) console.log(`  ok    ${name}`);
  else { console.log(`  FAIL  ${name}`); failures += 1; }
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.inbox = [];
    ws.waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const index = ws.waiters.findIndex((w) => w.type === msg.type);
      if (index >= 0) ws.waiters.splice(index, 1)[0].resolve(msg);
      else ws.inbox.push(msg);
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

// Wait for the next message of a type (or null after a short while).
function next(ws, type, timeoutMs = 800) {
  const queued = ws.inbox.findIndex((m) => m.type === type);
  if (queued >= 0) return Promise.resolve(ws.inbox.splice(queued, 1)[0]);
  return new Promise((resolve) => {
    const waiter = { type, resolve };
    ws.waiters.push(waiter);
    setTimeout(() => {
      const i = ws.waiters.indexOf(waiter);
      if (i >= 0) { ws.waiters.splice(i, 1); resolve(null); }
    }, timeoutMs);
  });
}

const send = (ws, obj) => ws.send(JSON.stringify(obj));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log('hosting and joining');
  const host = await connect();
  send(host, { type: 'host', max: 3 });
  const hosted = await next(host, 'hosted');
  check('host gets a room code', hosted && /^[A-Z2-9]{5}$/.test(hosted.code));
  check('host is peer 1', hosted && hosted.id === 1);
  const code = hosted.code;

  const guestA = await connect();
  send(guestA, { type: 'join', code: code.toLowerCase() });
  const joinedA = await next(guestA, 'joined');
  check('guest can join (code is not case sensitive)', joinedA && joinedA.id >= 2);
  const peerJoined = await next(host, 'peer_joined');
  check('host is told about the guest', peerJoined && peerJoined.id === joinedA.id);

  console.log('relaying the handshake');
  send(guestA, { type: 'offer', to: 1, sdp: 'v=0 fake-offer' });
  const offer = await next(host, 'offer');
  check('host receives the offer', offer && offer.sdp === 'v=0 fake-offer');
  check('offer is stamped with the sender id', offer && offer.from === joinedA.id);

  send(host, { type: 'answer', to: joinedA.id, sdp: 'v=0 fake-answer' });
  const answer = await next(guestA, 'answer');
  check('guest receives the answer', answer && answer.sdp === 'v=0 fake-answer');

  send(guestA, { type: 'candidate', to: 1, mid: '0', index: 0, sdp: 'candidate:1 1 UDP 1 1.2.3.4 5 typ host' });
  const candidate = await next(host, 'candidate');
  check('host receives an ICE candidate', candidate && candidate.mid === '0' && candidate.from === joinedA.id);

  console.log('abuse and limits');
  send(guestA, { type: 'offer', to: joinedA.id + 1, sdp: 'x' });
  const guestB = await connect();
  send(guestB, { type: 'join', code });
  const joinedB = await next(guestB, 'joined');
  check('a second guest fits (room max 3)', joinedB && joinedB.id !== joinedA.id);

  send(guestA, { type: 'offer', to: joinedB.id, sdp: 'sneaky' });
  const sneaky = await next(guestB, 'offer', 400);
  check('guests cannot message other guests', sneaky === null);

  send(guestA, { type: 'offer', to: 1, sdp: 'x'.repeat(20000) });
  await wait(200);
  check('an oversized message gets the connection dropped', guestA.readyState !== WebSocket.OPEN);

  const guestC = await connect();
  send(guestC, { type: 'join', code });
  const joinedC = await next(guestC, 'joined');
  check('a third guest is allowed once a slot is free', joinedC !== null);
  const guestD = await connect();
  send(guestD, { type: 'join', code });
  const full = await next(guestD, 'error');
  check('a full room says room_full', full && full.reason === 'room_full');

  const stranger = await connect();
  send(stranger, { type: 'join', code: 'ZZZZZ' });
  const missing = await next(stranger, 'error');
  check('a wrong code says room_not_found', missing && missing.reason === 'room_not_found');

  send(stranger, { type: 'banana' });
  const junk = await next(stranger, 'error');
  check('unknown messages are rejected', junk && junk.reason === 'bad_message');

  console.log('leaving');
  // Guest A was dropped above for the oversized message, so the host was
  // told about A first, then about B.
  const leftA = await next(host, 'peer_left');
  check('host is told when a guest is dropped', leftA && leftA.id === joinedA.id);

  guestB.close();
  const leftB = await next(host, 'peer_left');
  check('host is told when a guest leaves', leftB && leftB.id === joinedB.id);

  host.close();
  const closed = await next(guestC, 'room_closed');
  check('guests are told when the host leaves', closed !== null);
  await wait(200);

  const late = await connect();
  send(late, { type: 'join', code });
  const gone = await next(late, 'error');
  check('the room code stops working after the host leaves', gone && gone.reason === 'room_not_found');
  late.close();
  stranger.close();
}

const server = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'ignore', 'inherit'],
});

setTimeout(async () => {
  try {
    await run();
  } catch (e) {
    console.log('test crashed:', e);
    failures += 1;
  }
  server.kill();
  console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}, 600);
