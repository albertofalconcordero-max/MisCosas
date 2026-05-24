'use strict';
const crypto = require('crypto');

// ── Baraja espanola de 40 cartas ──────────────────────────────
const SUITS = [
  { id: 'oros',    symbol: '\u{1F4B0}', name: 'Oros' },     // moneda (emoji compatible Win10/11)
  { id: 'copas',   symbol: '\u{1F377}', name: 'Copas' },    // copa
  { id: 'espadas', symbol: '\u{2694}\u{FE0F}', name: 'Espadas' }, // espadas
  { id: 'bastos',  symbol: '\u{1F332}', name: 'Bastos' },   // arbol/madera (emoji compatible Win10/11)
];
const SUIT_ORDER = { oros: 0, copas: 1, espadas: 2, bastos: 3 };
const RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
const COURT = { 10: 'Sota', 11: 'Caballo', 12: 'Rey' };

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;
const LOG_MAX = 40;

function buildDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({
        id: `${s.id}-${r}`,
        suit: s.id,
        suitSymbol: s.symbol,
        suitName: s.name,
        rank: r,
        value: r,            // 1 < 2 < ... < 7 < 10 < 11 < 12
        label: String(r),
        court: COURT[r] || null,
      });
    }
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sortHand(hand) {
  return hand.slice().sort((a, b) =>
    a.value - b.value || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]);
}

// Analiza una jugada: los 2 son comodines de cualquier numero.
// Devuelve el valor efectivo de la jugada y si "corta" (valor 1 o 2).
function comboInfo(cards) {
  if (!cards.length || cards.length > 4)
    return { ok: false, error: 'Debes jugar entre 1 y 4 cartas.' };
  const naturals = cards.filter(c => c.rank !== 2); // las que no son comodin
  let effRank;
  if (naturals.length) {
    effRank = naturals[0].rank;
    if (naturals.some(c => c.rank !== effRank))
      return { ok: false, error: 'Las cartas (sin contar los 2) deben ser del mismo numero.' };
  } else {
    effRank = 2; // jugada formada solo por comodines
  }
  return { ok: true, effRank, count: cards.length, isCut: effRank === 1 || effRank === 2 };
}

// Cartas "fuerza" que el perdedor debe entregar: los 2 (mas fuertes) y los 1.
function powerCards(hand) {
  return hand
    .filter(c => c.rank === 1 || c.rank === 2)
    .sort((a, b) => b.rank - a.rank); // el 2 antes que el 1
}

const cardName = (c) => c.label + c.suitSymbol;
const ordinal = (n) => n + 'º';

// ── Motor del juego ───────────────────────────────────────────
class Game {
  constructor() {
    this.players = new Map();   // id -> { id, name, hand, connected, finished, finishPos }
    this.order = [];            // ids en orden de asiento
    this.hostId = null;
    this.phase = 'lobby';       // lobby | exchange | playing | roundEnd
    this.round = 0;
    this.lanUrl = '';
    this.finishOrder = [];
    this.lastResults = [];
    this.log = [];
    this.exchange = null;
    this.pendingStarterId = null;
    this.resetTable();
  }

  resetTable() {
    this.table = { combo: [], count: 0, effRank: 0, ownerId: null };
    this.turnId = null;
    this.lastPlayerId = null;
    this.passCount = 0;
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > LOG_MAX) this.log.shift();
  }

  reassignHost() {
    if (this.hostId && this.players.get(this.hostId) &&
        this.players.get(this.hostId).connected) return;
    const next = this.order.find(id => this.players.get(id) && this.players.get(id).connected);
    this.hostId = next || this.order[0] || null;
  }

  // ── Lobby ──
  addPlayer(name) {
    if (this.phase !== 'lobby')
      return { error: 'Hay una partida en curso. Espera a que termine.' };
    if (this.order.length >= MAX_PLAYERS)
      return { error: `La mesa esta llena (maximo ${MAX_PLAYERS} jugadores).` };
    let base = String(name || '').trim().slice(0, 16) || 'Jugador';
    let final = base, n = 2;
    while ([...this.players.values()].some(p => p.name === final)) final = `${base} ${n++}`;
    const id = 'p_' + crypto.randomUUID().slice(0, 8);
    this.players.set(id, { id, name: final, hand: [], connected: true, finished: false, finishPos: 0 });
    this.order.push(id);
    if (!this.hostId) this.hostId = id;
    this.addLog(`${final} se ha unido a la mesa.`);
    return { id };
  }

  renamePlayer(id, name) {
    const p = this.players.get(id);
    if (!p) return { error: 'Jugador no encontrado.' };
    if (this.phase !== 'lobby')
      return { error: 'Solo puedes cambiar el nombre en el lobby.' };
    let base = String(name || '').trim().slice(0, 16) || 'Jugador';
    let final = base, n = 2;
    while ([...this.players.values()].some(x => x.id !== id && x.name === final))
      final = `${base} ${n++}`;
    if (final === p.name) return {};
    const old = p.name;
    p.name = final;
    this.addLog(`${old} ahora se llama ${final}.`);
    return {};
  }

  setConnected(id, val) {
    const p = this.players.get(id);
    if (p) p.connected = val;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase === 'lobby') {
      this.players.delete(id);
      this.order = this.order.filter(x => x !== id);
      this.addLog(`${p.name} ha salido de la mesa.`);
    } else {
      p.connected = false;
      this.addLog(`${p.name} se ha desconectado.`);
    }
    this.reassignHost();
  }

  // ── Inicio de ronda ──
  startRound() {
    if (this.phase !== 'lobby' && this.phase !== 'roundEnd')
      return { error: 'No se puede iniciar una ronda ahora.' };
    if (this.order.length < MIN_PLAYERS)
      return { error: `Hacen falta al menos ${MIN_PLAYERS} jugadores.` };

    this.round += 1;
    this.finishOrder = [];
    this.resetTable();

    for (const id of this.order) {
      const p = this.players.get(id);
      p.hand = [];
      p.finished = false;
      p.finishPos = 0;
    }

    // Reparto: todas las cartas, lo mas equitativo posible
    const deck = shuffle(buildDeck());
    let i = 0;
    while (deck.length) {
      this.players.get(this.order[i % this.order.length]).hand.push(deck.pop());
      i++;
    }
    for (const id of this.order)
      this.players.get(id).hand = sortHand(this.players.get(id).hand);

    if (this.round === 1 || this.lastResults.length === 0) {
      // Primera ronda: empieza un jugador al azar
      this.pendingStarterId = this.order[Math.floor(Math.random() * this.order.length)];
      this.beginPlaying();
      this.addLog(`\u{1F3B4} Ronda ${this.round}: empieza ${this.players.get(this.turnId).name}.`);
    } else {
      this.setupExchange();
    }
    return {};
  }

  beginPlaying() {
    this.phase = 'playing';
    this.resetTable();
    this.turnId = this.pendingStarterId;
  }

  // ── Fase de intercambio ──
  setupExchange() {
    this.phase = 'exchange';
    this.exchange = { pending: {}, done: {}, receiver: {} };
    const res = this.lastResults;
    const n = this.order.length;
    const find = (t) => { const r = res.find(x => x.title === t); return r ? r.id : null; };

    // El perdedor entrega sus 1 y 2 (sus mejores cartas). Si no le bastan,
    // los elige el mismo (queda pendiente para que escoja en su pantalla).
    const loserGives = (loserId, receiverId, count, loserTitle, receiverTitle) => {
      const power = powerCards(this.players.get(loserId).hand);
      if (power.length >= count) {
        this.giveCards(loserId, receiverId, power.slice(0, count), loserTitle, receiverTitle);
      } else {
        this.exchange.pending[loserId] = count;
        this.exchange.receiver[loserId] = receiverId;
      }
    };

    const presId = find('Presidente');
    const culoId = find('Culo');
    if (presId && culoId && presId !== culoId) {
      // El Culo entrega sus 1 y 2 al Presidente
      loserGives(culoId, presId, 2, 'Culo', 'Presidente');
      // El Presidente elige sus 2 peores cartas para el Culo
      this.exchange.pending[presId] = 2;
      this.exchange.receiver[presId] = culoId;
    }
    if (n >= 4) {
      const viceId = find('Vicepresidente');
      const viceculoId = find('Vice-culo');
      if (viceId && viceculoId && viceId !== viceculoId) {
        // El Vice-culo entrega un 1 o un 2 al Vicepresidente
        loserGives(viceculoId, viceId, 1, 'Vice-culo', 'Vicepresidente');
        this.exchange.pending[viceId] = 1;
        this.exchange.receiver[viceId] = viceculoId;
      }
    }

    // En las rondas siguientes empieza el Culo de la ronda anterior
    this.pendingStarterId = culoId || this.order[0];
    this.addLog(`\u{1F501} Ronda ${this.round}: fase de intercambio de cartas.`);

    if (Object.keys(this.exchange.pending).length === 0) {
      this.beginPlaying();
      this.addLog(`\u{1F3B4} Empieza la ronda ${this.round}.`);
    }
  }

  giveCards(fromId, toId, cards, fromTitle, toTitle) {
    const from = this.players.get(fromId), to = this.players.get(toId);
    for (const c of cards) {
      from.hand = from.hand.filter(x => x.id !== c.id);
      to.hand.push(c);
    }
    from.hand = sortHand(from.hand);
    to.hand = sortHand(to.hand);
    this.addLog(`\u{1F501} ${from.name} (${fromTitle}) entrega ${cards.map(cardName).join(' ')} a ${to.name} (${toTitle}).`);
  }

  submitExchange(playerId, cardIds) {
    if (this.phase !== 'exchange') return { error: 'No es momento de intercambiar.' };
    const need = this.exchange.pending[playerId];
    if (!need) return { error: 'No tienes que intercambiar nada.' };
    if (this.exchange.done[playerId]) return { error: 'Ya has hecho tu intercambio.' };
    if (!Array.isArray(cardIds) || new Set(cardIds).size !== need)
      return { error: `Debes elegir exactamente ${need} carta(s) distintas.` };
    const p = this.players.get(playerId);
    const cards = cardIds.map(cid => p.hand.find(c => c.id === cid));
    if (cards.some(c => !c)) return { error: 'Carta no valida.' };

    const to = this.players.get(this.exchange.receiver[playerId]);
    for (const c of cards) {
      p.hand = p.hand.filter(x => x.id !== c.id);
      to.hand.push(c);
    }
    p.hand = sortHand(p.hand);
    to.hand = sortHand(to.hand);
    this.exchange.done[playerId] = true;
    this.addLog(`\u{1F501} ${p.name} entrega ${cards.map(cardName).join(' ')} a ${to.name}.`);

    if (Object.keys(this.exchange.pending).every(id => this.exchange.done[id])) {
      this.beginPlaying();
      this.addLog(`\u{1F3B4} Empieza la ronda ${this.round}: lidera ${this.players.get(this.turnId).name}.`);
    }
    return {};
  }

  autoExchange(playerId) {
    const need = this.exchange && this.exchange.pending[playerId];
    if (!need || this.exchange.done[playerId]) return;
    const p = this.players.get(playerId);
    const give = sortHand(p.hand).slice(0, need).map(c => c.id); // las mas bajas
    this.submitExchange(playerId, give);
  }

  // ── Turnos de juego ──
  activeIds() {
    return this.order.filter(id => !this.players.get(id).finished);
  }

  nextActiveAfter(id) {
    const n = this.order.length;
    const idx = this.order.indexOf(id);
    for (let k = 1; k <= n; k++) {
      const cand = this.order[(idx + k) % n];
      if (!this.players.get(cand).finished) return cand;
    }
    return null;
  }

  playCards(playerId, cardIds) {
    if (this.phase !== 'playing') return { error: 'No es momento de jugar.' };
    if (this.turnId !== playerId) return { error: 'No es tu turno.' };
    const p = this.players.get(playerId);
    if (!p || p.finished) return { error: 'No puedes jugar.' };
    if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 4)
      return { error: 'Debes jugar entre 1 y 4 cartas.' };
    if (new Set(cardIds).size !== cardIds.length)
      return { error: 'Cartas repetidas.' };
    const cards = cardIds.map(cid => p.hand.find(c => c.id === cid));
    if (cards.some(c => !c)) return { error: 'Carta no valida.' };

    const info = comboInfo(cards); // los 2 son comodines de cualquier numero
    if (!info.ok) return { error: info.error };

    // Validacion frente a la mesa. Los 1 y 2 cortan, pero con el mismo numero
    // de cartas que hay en la mesa (un duo necesita dos, un trio tres, etc.).
    const tableHadCards = this.table.combo.length > 0;
    let tieSkip = false;
    if (tableHadCards) {
      if (info.count !== this.table.count)
        return { error: `Debes jugar ${this.table.count} carta(s), igual que en la mesa.` };
      if (!info.isCut) {
        if (info.effRank < this.table.effRank)
          return { error: 'Tu jugada debe igualar o superar el valor de la mesa.' };
        if (info.effRank === this.table.effRank) tieSkip = true; // mismo valor
      }
    }

    for (const c of cards) p.hand = p.hand.filter(x => x.id !== c.id);
    this.table = { combo: cards, count: cards.length, effRank: info.effRank, ownerId: playerId };
    this.lastPlayerId = playerId;
    this.passCount = 0;
    this.addLog(`${p.name} juega ${cards.map(cardName).join(' ')}.`);

    if (p.hand.length === 0) {
      p.finished = true;
      this.finishOrder.push(playerId);
      p.finishPos = this.finishOrder.length;
      this.addLog(`\u{1F3C1} ${p.name} se queda sin cartas (${ordinal(p.finishPos)}).`);
    }

    if (this.activeIds().length <= 1) { this.endRound(); return {}; }

    if (info.isCut) {
      // Los 1 y 2 cortan la baza: se limpia la mesa y repite el mismo jugador
      this.addLog(`\u{2702}\u{FE0F} ${p.name} corta la baza y vuelve a jugar.`);
      this.table = { combo: [], count: 0, effRank: 0, ownerId: null };
      this.lastPlayerId = null;
      this.passCount = 0;
      this.turnId = p.finished ? this.nextActiveAfter(playerId) : playerId;
    } else if (tieSkip) {
      // Jugada del mismo valor: solo el siguiente jugador pierde este unico turno
      const skipId = this.nextActiveAfter(playerId);
      if (skipId && skipId !== playerId) {
        this.passCount += 1; // su turno saltado cuenta como un paso suyo
        this.addLog(`\u{23ED}\u{FE0F} ${this.players.get(skipId).name} se salta el turno (jugada del mismo valor).`);
        this.advanceAfterYield(skipId);
      } else {
        this.turnId = this.nextActiveAfter(playerId);
      }
    } else {
      this.turnId = this.nextActiveAfter(playerId);
    }
    return {};
  }

  // Tras pasar (o saltar un turno): limpia la mesa si ya nadie puede responder
  advanceAfterYield(yielderId) {
    const owner = this.players.get(this.lastPlayerId);
    const ownerActive = owner && !owner.finished;
    const contenders = this.activeIds().length - (ownerActive ? 1 : 0);

    if (contenders > 0 && this.passCount >= contenders) {
      // Todos han pasado: se limpia la mesa
      this.addLog('\u{1F9F9} Todos pasan. Se limpia la mesa.');
      this.table = { combo: [], count: 0, effRank: 0, ownerId: null };
      this.passCount = 0;
      this.turnId = ownerActive ? this.lastPlayerId : this.nextActiveAfter(this.lastPlayerId);
      this.lastPlayerId = null;
      this.addLog(`${this.players.get(this.turnId).name} lidera la nueva baza.`);
    } else {
      this.turnId = this.nextActiveAfter(yielderId);
    }
  }

  pass(playerId) {
    if (this.phase !== 'playing') return { error: 'No es momento de jugar.' };
    if (this.turnId !== playerId) return { error: 'No es tu turno.' };
    if (this.table.combo.length === 0)
      return { error: 'La mesa esta vacia: tienes que jugar, no puedes pasar.' };
    const p = this.players.get(playerId);
    this.passCount += 1;
    this.addLog(`${p.name} pasa.`);
    this.advanceAfterYield(playerId);
    return {};
  }

  autoAct(playerId) {
    if (this.phase !== 'playing' || this.turnId !== playerId) return;
    const p = this.players.get(playerId);
    if (this.table.combo.length === 0) {
      const low = sortHand(p.hand)[0];
      this.playCards(playerId, [low.id]);
    } else {
      this.pass(playerId);
    }
  }

  endRound() {
    // El jugador que aun tiene cartas es el Culo
    for (const id of this.order) {
      const p = this.players.get(id);
      if (!p.finished) {
        p.finished = true;
        this.finishOrder.push(id);
        p.finishPos = this.finishOrder.length;
      }
    }
    const n = this.finishOrder.length;
    this.lastResults = this.finishOrder.map((id, i) => {
      let title = 'Neutro';
      if (i === 0) title = 'Presidente';
      else if (i === n - 1) title = 'Culo';
      else if (n >= 4 && i === 1) title = 'Vicepresidente';
      else if (n >= 4 && i === n - 2) title = 'Vice-culo';
      return { id, name: this.players.get(id).name, title, pos: i + 1 };
    });
    this.phase = 'roundEnd';
    this.resetTable();
    const pres = this.lastResults[0], culo = this.lastResults[n - 1];
    this.addLog(`\u{1F3C6} Fin de la ronda ${this.round}. Presidente: ${pres.name}. Culo: ${culo.name}.`);
  }

  resetToLobby() {
    this.phase = 'lobby';
    this.round = 0;
    this.finishOrder = [];
    this.lastResults = [];
    this.exchange = null;
    this.resetTable();
    for (const id of [...this.order]) {
      const p = this.players.get(id);
      if (!p.connected) {
        this.players.delete(id);
        this.order = this.order.filter(x => x !== id);
      } else {
        p.hand = []; p.finished = false; p.finishPos = 0;
      }
    }
    this.reassignHost();
    this.addLog('Vuelta al lobby.');
  }

  // ── Estado personalizado para un jugador ──
  state(forId) {
    const you = this.players.get(forId) || null;
    const titleById = {};
    for (const r of this.lastResults) titleById[r.id] = r.title;

    const players = this.order.map(id => {
      const p = this.players.get(id);
      return {
        id, name: p.name,
        isHost: id === this.hostId,
        cardCount: p.hand.length,
        connected: p.connected,
        finished: p.finished,
        finishPos: p.finishPos,
        isTurn: this.phase === 'playing' && this.turnId === id,
        lastTitle: titleById[id] || null,
      };
    });

    const base = {
      phase: this.phase,
      round: this.round,
      hostId: this.hostId,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      lanUrl: this.lanUrl,
      players,
      log: this.log.slice(-14),
      you: you ? {
        id: you.id,
        name: you.name,
        isHost: you.id === this.hostId,
        hand: sortHand(you.hand),
        finished: you.finished,
      } : null,
    };

    if (this.phase === 'playing') {
      base.table = {
        combo: this.table.combo,
        count: this.table.count,
        effRank: this.table.effRank,
        ownerName: this.table.ownerId ? this.players.get(this.table.ownerId).name : null,
      };
      base.turnId = this.turnId;
      base.turnName = this.turnId ? this.players.get(this.turnId).name : null;
    }

    if (this.phase === 'exchange' && you) {
      const need = this.exchange.pending[forId];
      if (need && !this.exchange.done[forId]) {
        base.exchangeAsk = {
          give: need,
          toName: this.players.get(this.exchange.receiver[forId]).name,
        };
      } else {
        base.exchangeWait = true;
      }
    }

    if (this.phase === 'roundEnd')
      base.results = this.lastResults.map(r => ({ name: r.name, title: r.title, pos: r.pos }));

    if (this.phase === 'lobby')
      base.canStart = this.order.length >= MIN_PLAYERS;

    return base;
  }
}

module.exports = { Game, MIN_PLAYERS, MAX_PLAYERS };
