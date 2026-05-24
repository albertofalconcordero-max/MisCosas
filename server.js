'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const { Game } = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
};

const game = new Game();
const socketToPlayer = new Map(); // socket.id -> playerId

// IP de la red local para compartir con los amigos
function lanIP() {
  const ifs = os.networkInterfaces();
  let fallback = 'localhost';
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family === 'IPv4' && !i.internal) {
        if (i.address.startsWith('192.168.') || i.address.startsWith('10.') ||
            i.address.startsWith('172.')) return i.address;
        fallback = i.address;
      }
    }
  }
  return fallback;
}

// ── Servidor HTTP: sirve los archivos estaticos de public/ ──
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const file = path.join(PUBLIC, url);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('Prohibido'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const io = new Server(server);

function broadcast() {
  for (const [, s] of io.sockets.sockets) {
    const pid = socketToPlayer.get(s.id) || null;
    s.emit('state', game.state(pid));
  }
}

// Resuelve turnos de jugadores desconectados (juego e intercambio)
function processAuto() {
  let guard = 0;
  while (guard++ < 400) {
    if (game.phase === 'playing' && game.turnId) {
      const p = game.players.get(game.turnId);
      if (p && !p.connected && !p.finished) { game.autoAct(game.turnId); continue; }
      break;
    }
    if (game.phase === 'exchange' && game.exchange) {
      const pid = Object.keys(game.exchange.pending).find(id =>
        !game.exchange.done[id] && game.players.get(id) && !game.players.get(id).connected);
      if (pid) { game.autoExchange(pid); continue; }
      break;
    }
    break;
  }
}

io.on('connection', (socket) => {
  socket.emit('state', game.state(null));

  const actorId = () => socketToPlayer.get(socket.id);
  const isHost = () => actorId() && actorId() === game.hostId;
  const after = (r) => {
    if (r && r.error) socket.emit('errorMsg', r.error);
    processAuto();
    broadcast();
  };

  socket.on('join', ({ name, playerId } = {}) => {
    if (playerId && game.players.has(playerId)) {
      // Reconexion de un jugador existente
      game.setConnected(playerId, true);
      game.reassignHost();
      socketToPlayer.set(socket.id, playerId);
      socket.emit('session', { playerId });
      game.addLog(`${game.players.get(playerId).name} se ha reconectado.`);
      after();
      return;
    }
    const r = game.addPlayer(name);
    if (r.error) { socket.emit('errorMsg', r.error); return; }
    socketToPlayer.set(socket.id, r.id);
    game.reassignHost();
    socket.emit('session', { playerId: r.id });
    broadcast();
  });

  socket.on('startGame', () => { if (isHost()) after(game.startRound()); });
  socket.on('nextRound', () => { if (isHost()) after(game.startRound()); });
  socket.on('backToLobby', () => { if (isHost()) { game.resetToLobby(); broadcast(); } });

  socket.on('rename', ({ name } = {}) => {
    const id = actorId(); if (id) after(game.renamePlayer(id, name));
  });

  socket.on('play', ({ cardIds } = {}) => {
    const id = actorId(); if (id) after(game.playCards(id, cardIds));
  });
  socket.on('pass', () => {
    const id = actorId(); if (id) after(game.pass(id));
  });
  socket.on('exchange', ({ cardIds } = {}) => {
    const id = actorId(); if (id) after(game.submitExchange(id, cardIds));
  });

  socket.on('disconnect', () => {
    const id = socketToPlayer.get(socket.id);
    socketToPlayer.delete(socket.id);
    if (!id) return;
    // Solo se marca como desconectado si ninguna otra pestana mantiene al jugador
    if ([...socketToPlayer.values()].includes(id)) return;
    game.removePlayer(id);
    processAuto();
    broadcast();
  });
});

game.lanUrl = `http://${lanIP()}:${PORT}`;
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ===  EL CULO  -  baraja espanola  ===');
  console.log('  -------------------------------------');
  console.log(`  En este equipo:   http://localhost:${PORT}`);
  console.log(`  Para tus amigos:  ${game.lanUrl}`);
  console.log('');
  console.log('  Comparte el enlace "Para tus amigos" con quien este');
  console.log('  en la misma red WiFi. Para cerrar: Ctrl + C');
  console.log('');
});
