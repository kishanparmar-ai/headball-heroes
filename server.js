/**
 * HEAD BALL HEROES — WebSocket Server
 * ─────────────────────────────────────
 * Features:
 *  • Room Code  — 4-digit code share
 *  • Auto Match — random player pairing
 *
 * Local  : node server.js          → ws://localhost:3000
 * Online : Deploy to Render/Railway → wss://your-app.onrender.com
 *
 * Install: npm install ws
 * Run    : node server.js
 */

const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const wss  = new WebSocket.Server({ port: PORT });

/* ─── State ─────────────────────────────────── */
const rooms        = new Map();   // code → { players[], host }
const waitingQueue = [];          // players waiting for auto-match

/* ─── Helpers ───────────────────────────────── */
function uid() {
  return Math.random().toString(36).substr(2, 9);
}

function genCode() {
  let code;
  do { code = Math.floor(1000 + Math.random() * 9000).toString(); }
  while (rooms.has(code));
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(obj));
}

function broadcast(room, obj, exclude) {
  room.players.forEach(p => { if (p !== exclude) send(p, obj); });
}

function removeFromQueue(ws) {
  const i = waitingQueue.indexOf(ws);
  if (i !== -1) waitingQueue.splice(i, 1);
}

function closeRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  broadcast(room, { type: 'opponent_disconnected' });
  rooms.delete(code);
}

/* ─── Connection Handler ────────────────────── */
wss.on('connection', (ws) => {
  ws._id         = uid();
  ws._room       = null;
  ws._playerNum  = 0;

  console.log(`[+] Connected: ${ws._id}  | Total: ${wss.clients.size}`);

  /* ── Message Router ── */
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      /* ── CREATE ROOM ── */
      case 'create_room': {
        if (ws._room) return; // already in a room
        const code = genCode();
        rooms.set(code, { code, players: [ws] });
        ws._room      = code;
        ws._playerNum = 1;
        send(ws, { type: 'room_created', code });
        console.log(`[Room] Created: ${code}`);
        break;
      }

      /* ── JOIN ROOM ── */
      case 'join_room': {
        const code = (msg.code || '').trim();
        const room = rooms.get(code);

        if (!room) {
          send(ws, { type: 'error', msg: 'Room not found!' });
          return;
        }
        if (room.players.length >= 2) {
          send(ws, { type: 'error', msg: 'Room is full!' });
          return;
        }
        if (room.players[0] === ws) {
          send(ws, { type: 'error', msg: 'Cannot join your own room!' });
          return;
        }

        room.players.push(ws);
        ws._room      = code;
        ws._playerNum = 2;

        send(room.players[0], { type: 'game_start', playerNum: 1, code });
        send(ws,              { type: 'game_start', playerNum: 2, code });
        console.log(`[Room] Started: ${code}`);
        break;
      }

      /* ── AUTO MATCH ── */
      case 'auto_match': {
        if (ws._room) return;

        // Remove duplicate in queue (reconnect edge case)
        removeFromQueue(ws);

        if (waitingQueue.length > 0) {
          const opponent = waitingQueue.shift();
          const code     = genCode();
          rooms.set(code, { code, players: [opponent, ws] });

          opponent._room     = code;
          opponent._playerNum = 1;
          ws._room           = code;
          ws._playerNum      = 2;

          send(opponent, { type: 'game_start', playerNum: 1, code });
          send(ws,       { type: 'game_start', playerNum: 2, code });
          console.log(`[AutoMatch] Room: ${code}`);
        } else {
          waitingQueue.push(ws);
          send(ws, { type: 'waiting' });
          console.log(`[AutoMatch] Waiting queue: ${waitingQueue.length}`);
        }
        break;
      }

      /* ── CANCEL WAITING ── */
      case 'cancel_wait': {
        removeFromQueue(ws);
        send(ws, { type: 'wait_cancelled' });
        break;
      }

      /* ── GAME STATE RELAY ── */
      case 'game_state': {
        if (!ws._room) return;
        const room = rooms.get(ws._room);
        if (!room) return;
        broadcast(room, {
          type  : 'game_state',
          state : msg.state,
          from  : ws._playerNum
        }, ws);
        break;
      }

      /* ── GOAL EVENT ── */
      case 'goal': {
        if (!ws._room) return;
        const room = rooms.get(ws._room);
        if (!room || ws._playerNum !== 1) return; // only host sends goals
        broadcast(room, { type: 'goal', scorer: msg.scorer }, ws);
        break;
      }

      /* ── PING ── */
      case 'ping': {
        send(ws, { type: 'pong' });
        break;
      }
    }
  });

  /* ── Disconnect ── */
  ws.on('close', () => {
    console.log(`[-] Disconnected: ${ws._id}`);
    removeFromQueue(ws);
    if (ws._room) closeRoom(ws._room);
  });

  ws.on('error', (err) => {
    console.error(`[Error] ${ws._id}:`, err.message);
  });
});

console.log(`✅ Head Ball Heroes server running on port ${PORT}`);
console.log(`   Local  → ws://localhost:${PORT}`);
console.log(`   Online → Set WS_URL in script.js after deploying`);
