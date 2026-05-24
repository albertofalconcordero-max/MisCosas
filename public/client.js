'use strict';
const socket = io();

let state = null;
const selected = new Set();
let myName = localStorage.getItem('culo_name') || '';
let myId = localStorage.getItem('culo_pid') || null;
let editingName = false;

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');

// ── Conexion ──
socket.on('connect', () => {
  if (myName) socket.emit('join', { name: myName, playerId: myId });
});
socket.on('session', ({ playerId }) => {
  myId = playerId;
  localStorage.setItem('culo_pid', playerId);
});
socket.on('errorMsg', (msg) => toast(msg));
socket.on('state', (s) => { state = s; render(); });

// ── Utilidades ──
const byId = (id) => document.getElementById(id);
const ordinal = (n) => n + 'º';
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();
const slug = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function titleEmoji(t) {
  return ({
    'Presidente': '\u{1F451}',
    'Vicepresidente': '\u{1F948}',
    'Neutro': '\u{1F610}',
    'Vice-culo': '\u{1F9FB}',
    'Culo': '\u{1F4A9}',
  })[t] || '';
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), 3200);
}

function cardHtml(c, opts = {}) {
  return `<div class="card suit-${c.suit}${opts.selected ? ' selected' : ''}${opts.small ? ' small' : ''}" data-id="${c.id}">
    <span class="corner tl">${c.label}</span>
    <span class="pip">${c.suitSymbol}</span>
    ${c.court ? `<span class="court">${c.court}</span>` : ''}
    <span class="corner br">${c.label}</span>
  </div>`;
}

function comboInfo(cards) {
  if (cards.length < 1 || cards.length > 4) return null;
  const naturals = cards.filter(c => c.rank !== 2); // los 2 son comodines
  let effRank;
  if (naturals.length) {
    effRank = naturals[0].rank;
    if (naturals.some(c => c.rank !== effRank)) return null;
  } else {
    effRank = 2;
  }
  return { effRank, count: cards.length, isCut: effRank === 1 || effRank === 2 };
}

function validPlay(ids) {
  const cards = ids.map(id => state.you.hand.find(c => c.id === id)).filter(Boolean);
  if (cards.length !== ids.length) return false;
  const info = comboInfo(cards);
  if (!info) return false;
  const t = state.table;
  if (!t || t.combo.length === 0) return true; // lideras: lo que quieras
  if (info.count !== t.count) return false;    // mismo numero de cartas que la mesa
  if (info.isCut) return true;                 // los 1 y 2 cortan (con esa misma cantidad)
  return info.effRank >= t.effRank;            // igual o mayor (igual = salta turno)
}

function wireHand() {
  document.querySelectorAll('.hand .card').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.id;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      render();
    };
  });
}

// ── Render principal ──
function render() {
  if (!state) { app.innerHTML = '<div class="screen"><p class="center">Conectando...</p></div>'; return; }
  if (state.you) {
    const ids = new Set(state.you.hand.map(c => c.id));
    for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
  } else {
    selected.clear();
  }

  if (state.phase !== 'lobby') editingName = false;
  if (!state.you) return renderJoin();
  if (state.phase === 'lobby') return renderLobby();
  if (state.phase === 'exchange') return renderExchange();
  if (state.phase === 'playing') return renderPlaying();
  if (state.phase === 'roundEnd') return renderRoundEnd();
}

function renderJoin() {
  const busy = state.phase !== 'lobby';
  app.innerHTML = `
    <div class="screen join">
      <div class="logo">\u{1F0CF}</div>
      <h1>El Culo</h1>
      <p class="sub">Juego de cartas con baraja espanola</p>
      ${busy ? '<p class="note">\u{23F3} Hay una partida en curso. Podras unirte cuando termine.</p>' : ''}
      <input id="nameInput" maxlength="16" placeholder="Tu nombre" value="${escapeHtml(myName)}" ${busy ? 'disabled' : ''}>
      <button id="joinBtn" ${busy ? 'disabled' : ''}>Entrar a la mesa</button>
    </div>`;
  const input = byId('nameInput'), btn = byId('joinBtn');
  if (btn) btn.onclick = () => {
    const n = input.value.trim();
    if (!n) return toast('Escribe tu nombre.');
    myName = n;
    localStorage.setItem('culo_name', n);
    socket.emit('join', { name: n, playerId: myId });
  };
  if (input) input.onkeydown = (e) => { if (e.key === 'Enter' && btn && !btn.disabled) btn.click(); };
}

function renderLobby() {
  const you = state.you;
  const list = state.players.map(p => `
    <li class="${p.connected ? '' : 'off'}">
      <span>${p.isHost ? '\u{1F451}' : '\u{2022}'}</span>
      <span>${escapeHtml(p.name)}</span>
      ${p.id === you.id ? '<em>(tu)</em>' : ''}
    </li>`).join('');

  const nameBox = editingName
    ? `<div class="namebox">
         <input id="renameInput" maxlength="16" placeholder="Tu nuevo nombre" value="${escapeHtml(you.name)}">
         <div class="namebtns">
           <button id="renameOk">Guardar</button>
           <button id="renameCancel" class="ghost">Cancelar</button>
         </div>
       </div>`
    : `<div class="namebox">
         <span>Juegas como <b>${escapeHtml(you.name)}</b></span>
         <button id="renameBtn" class="ghost">Cambiar nombre</button>
       </div>`;

  app.innerHTML = `
    <div class="screen lobby">
      <h1>\u{1F0CF} Sala de espera</h1>
      <div class="lanbox">
        <span>Comparte este enlace con tus amigos (misma red WiFi):</span>
        <code>${escapeHtml(state.lanUrl)}</code>
        <button id="copyLan">Copiar enlace</button>
      </div>
      <h2>Jugadores en la mesa (${state.players.length}/${state.maxPlayers})</h2>
      <ul class="players">${list}</ul>
      ${nameBox}
      ${you.isHost
        ? `<button id="startBtn" class="big" ${state.canStart ? '' : 'disabled'}>Empezar partida</button>
           ${state.canStart ? '' : `<p class="note">Hacen falta al menos ${state.minPlayers} jugadores para empezar.</p>`}`
        : '<p class="note">Esperando a que el anfitrion empiece la partida...</p>'}
    </div>`;
  byId('copyLan').onclick = () => {
    if (navigator.clipboard) navigator.clipboard.writeText(state.lanUrl);
    toast('Enlace copiado.');
  };
  const sb = byId('startBtn');
  if (sb) sb.onclick = () => socket.emit('startGame');

  const renameBtn = byId('renameBtn');
  if (renameBtn) renameBtn.onclick = () => { editingName = true; render(); };
  const renameCancel = byId('renameCancel');
  if (renameCancel) renameCancel.onclick = () => { editingName = false; render(); };
  const renameInput = byId('renameInput'), renameOk = byId('renameOk');
  const doRename = () => {
    const n = renameInput.value.trim();
    if (!n) return toast('Escribe un nombre.');
    myName = n;
    localStorage.setItem('culo_name', n);
    socket.emit('rename', { name: n });
    editingName = false;
  };
  if (renameOk) renameOk.onclick = doRename;
  if (renameInput) {
    renameInput.focus();
    renameInput.onkeydown = (e) => { if (e.key === 'Enter') doRename(); };
  }
}

function renderPlaying() {
  const you = state.you;
  const yourTurn = state.turnId === you.id;
  const opponents = state.players.filter(p => p.id !== you.id);

  const oppHtml = opponents.map(p => `
    <div class="opp ${p.isTurn ? 'turn' : ''} ${p.connected ? '' : 'off'} ${p.finished ? 'done' : ''}">
      <div class="ava">${initial(p.name)}</div>
      <div class="oname">${escapeHtml(p.name)} ${p.lastTitle ? titleEmoji(p.lastTitle) : ''}</div>
      <div class="ocards">${p.finished ? '\u{1F3C1} ' + ordinal(p.finishPos) : '\u{1F0CF} ' + p.cardCount}</div>
      ${p.connected ? '' : '<div class="warn">desconectado</div>'}
    </div>`).join('');

  const combo = state.table.combo;
  const tableHtml = combo.length
    ? `<div class="hand">${combo.map(c => cardHtml(c, { small: true })).join('')}</div>
       <div class="towho">jugada de ${escapeHtml(state.table.ownerName)}</div>`
    : '<div class="empty">Mesa vacia<br>el lider juega lo que quiera</div>';

  const handHtml = you.finished
    ? '<div class="empty">\u{1F3C1} Ya no tienes cartas. Espera a que acabe la ronda.</div>'
    : you.hand.map(c => cardHtml(c, { selected: selected.has(c.id) })).join('');

  const sel = [...selected];
  const canPlay = yourTurn && !you.finished && validPlay(sel);
  const canPass = yourTurn && !you.finished && combo.length > 0;

  app.innerHTML = `
    <div class="screen game">
      <div class="topbar">
        <span>Ronda ${state.round}</span>
        <span class="${yourTurn ? 'myturn' : ''}">${yourTurn ? '\u{00A1}TU TURNO!' : 'Turno de ' + escapeHtml(state.turnName)}</span>
      </div>
      <div class="opps">${oppHtml}</div>
      <div class="table">${tableHtml}</div>
      <div class="log">${state.log.map(l => `<div>${escapeHtml(l)}</div>`).join('')}</div>
      <div class="hand-area">
        <div class="hand">${handHtml}</div>
        <div class="actions">
          <button id="playBtn" ${canPlay ? '' : 'disabled'}>Jugar (${sel.length})</button>
          <button id="passBtn" class="ghost" ${canPass ? '' : 'disabled'}>Pasar</button>
        </div>
      </div>
    </div>`;

  if (!you.finished) wireHand();
  const pb = byId('playBtn'), ps = byId('passBtn');
  if (pb) pb.onclick = () => {
    if (!validPlay([...selected])) return;
    socket.emit('play', { cardIds: [...selected] });
    selected.clear();
  };
  if (ps) ps.onclick = () => socket.emit('pass');
  const logBox = document.querySelector('.log');
  if (logBox) logBox.scrollTop = logBox.scrollHeight;
}

function renderExchange() {
  const you = state.you;
  const mine = state.players.find(p => p.id === you.id);
  const myTitle = mine ? mine.lastTitle : null;
  let action;

  if (state.exchangeAsk) {
    const need = state.exchangeAsk.give;
    const handHtml = you.hand.map(c => cardHtml(c, { selected: selected.has(c.id) })).join('');
    const ok = selected.size === need;
    action = `
      <p class="note">Eres <b>${titleEmoji(myTitle)} ${escapeHtml(myTitle || '')}</b>.
      Elige <b>${need}</b> carta(s) para entregar a <b>${escapeHtml(state.exchangeAsk.toName)}</b>:</p>
      <div class="hand">${handHtml}</div>
      <button id="exBtn" ${ok ? '' : 'disabled'}>Entregar cartas (${selected.size}/${need})</button>`;
  } else {
    action = `
      <p class="note">\u{23F3} Esperando a que los demas jugadores elijan sus cartas...</p>
      <div class="hand">${you.hand.map(c => cardHtml(c, { small: true })).join('')}</div>`;
  }

  app.innerHTML = `
    <div class="screen exchange">
      <h1>\u{1F501} Intercambio</h1>
      <h2>Ronda ${state.round}</h2>
      <div class="log">${state.log.slice(-7).map(l => `<div>${escapeHtml(l)}</div>`).join('')}</div>
      ${action}
    </div>`;

  if (state.exchangeAsk) {
    wireHand();
    const b = byId('exBtn');
    if (b) b.onclick = () => {
      if (selected.size !== state.exchangeAsk.give) return;
      socket.emit('exchange', { cardIds: [...selected] });
      selected.clear();
    };
  }
}

function renderRoundEnd() {
  const you = state.you;
  const rows = state.results.map(r => `
    <li class="res-${slug(r.title)}">
      <span class="medal">${titleEmoji(r.title)}</span>
      <span class="rtitle">${escapeHtml(r.title)}</span>
      <span class="rname">${escapeHtml(r.name)}</span>
    </li>`).join('');
  app.innerHTML = `
    <div class="screen roundend">
      <h1>\u{1F3C6} Fin de la ronda ${state.round}</h1>
      <ul class="results">${rows}</ul>
      ${you.isHost
        ? `<button id="nextBtn" class="big">Siguiente ronda</button>
           <button id="lobbyBtn" class="ghost">Volver al lobby</button>`
        : '<p class="note">Esperando a que el anfitrion continue...</p>'}
    </div>`;
  const nb = byId('nextBtn'), lb = byId('lobbyBtn');
  if (nb) nb.onclick = () => socket.emit('nextRound');
  if (lb) lb.onclick = () => socket.emit('backToLobby');
}
