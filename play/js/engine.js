// Game rules. Pure functions: each takes the current game state and returns the next one.
// Nothing here talks to the network, so the same rules run in test mode and online.

export const TURN_MS = 15000;          // 15 seconds a turn
export const GRACE_MS = 1500;          // allowance for slow phones / networks
export const PAUSE_MS = 8 * 3600e3;    // a pause may last 8 hours
export const MAX_STRIKES = 3;
export const ASK_MS = 3000;            // extra time to name a position when a name belongs to 2+ players

// Answer buttons for "which one?" and what each covers.
export const POSITIONS = [['P', 'Pitcher'], ['C', 'Catcher'], ['1B', '1st base'], ['2B', '2nd base'],
  ['3B', '3rd base'], ['SS', 'Shortstop'], ['OF', 'Outfield'], ['DH', 'DH']];
export const posName = code => (POSITIONS.find(p => p[0] === code) || [code, code])[1];

// Does a player listed at `listed` (MLB's primary position) fit the answer `said`?
export function posFits(listed, said) {
  if (!listed || ['X', 'PH', 'PR'].includes(listed)) return true;   // old-timers with no listed spot
  if (listed === 'P/DH') return said === 'P' || said === 'DH';        // two-way (Ohtani)
  if (listed === 'DH') return said === 'DH' || said === '1B';
  return listed === said;
}

const rid = () => Math.random().toString(36).slice(2, 10);

export function newGame({ code, category, host }, now) {
  return {
    v: 1, code, category, status: 'lobby', hostUid: host.uid, createdAt: now, gameNo: 0,
    players: [{ uid: host.uid, name: host.name, strikes: 0, out: false }],
    turn: 0, dir: 1, letter: '', used: {}, plays: [], pending: [], turnStartedAt: 0, pause: null, banner: null, winnerUid: '',
  };
}

// The realtime database drops empty arrays/objects; put the defaults back.
export function fill(s) {
  if (!s) return s;
  s.players = (s.players || []).map(p => ({ strikes: 0, out: false, ...p }));
  s.used = s.used || {};
  s.plays = s.plays || [];
  s.pending = s.pending || [];
  s.pause = s.pause || null;
  s.ask = s.ask || null;
  s.banner = s.banner || null;
  s.letter = s.letter || '';
  s.dir = s.dir || 1;
  return s;
}

const active = s => s.players.filter(p => !p.out);
const idxOf = (s, uid) => s.players.findIndex(p => p.uid === uid);
export const current = s => s.players[s.turn];

function nextIdx(s, from, dir) {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (!s.players[i].out) return i;
  }
  return from;
}

export function join(s, { uid, name }) {
  if (idxOf(s, uid) >= 0) {
    s.players[idxOf(s, uid)].name = name;
    return s;
  }
  if (s.status !== 'lobby') throw new Error('That game already started.');
  if (s.players.length >= 8) throw new Error('That game is full (8 players).');
  s.players.push({ uid, name, strikes: 0, out: false });
  return s;
}

export function start(s, uid, now) {
  if (uid !== s.hostUid) throw new Error('Only the host can start.');
  if (s.players.length < 2) throw new Error('Need at least 2 players.');
  s.players.forEach(p => { p.strikes = 0; p.out = false; });
  Object.assign(s, {
    status: 'playing', gameNo: (s.gameNo || 0) + 1, turn: Math.floor(Math.random() * s.players.length),
    dir: 1, letter: '', used: {}, plays: [], pending: [], pause: null, winnerUid: '', turnStartedAt: now,
  });
  s.banner = { id: rid(), kind: 'start', nextUid: current(s).uid, nextName: current(s).name };
  return s;
}

// A miss doesn't count yet: it's a *pending* strike until the next correct answer seals it.
// If the turn comes all the way back to whoever missed first, nobody had one: every pending
// strike is wiped and that player starts fresh with any name that hasn't been played.
// Shared by a normal play, a timeout and a revealed paused play.
function strike(s, reason, text, now) {
  const p = current(s);
  s.pending.push({ uid: p.uid, name: p.name, reason, text: text || '' });
  s.plays.push({ uid: p.uid, name: p.name, text: text || '', ok: false, reason, k: 'pending', t: now });
  advance(s, now);
  s.banner = {
    id: rid(), kind: 'strike', byUid: p.uid, byName: p.name, text: text || '', reason,
    letter: s.letter, nextUid: current(s).uid, nextName: current(s).name,
  };
  washIfAround(s);
  return s;
}

function washIfAround(s) {
  if (!s.pending.length || current(s).uid !== s.pending[0].uid) return;
  const names = s.pending.map(x => x.name);
  s.plays.forEach(pl => { if (pl.k === 'pending') pl.k = 'washed'; });
  s.pending = [];
  s.letter = '';
  s.banner = { ...s.banner, kind: 'wash', names, letter: '', nextUid: current(s).uid, nextName: current(s).name };
}

// A correct answer seals every pending strike. Returns who got one and who's out.
function seal(s) {
  const sealed = s.pending.map(x => {
    const p = s.players.find(q => q.uid === x.uid);
    if (!p || p.out) return null;
    p.strikes += 1;
    if (p.strikes >= MAX_STRIKES) p.out = true;
    return { uid: p.uid, name: p.name, strikes: p.strikes, out: p.out };
  }).filter(Boolean);
  s.plays.forEach(pl => { if (pl.k === 'pending') pl.k = 'sealed'; });
  s.pending = [];
  return sealed;
}

function advance(s, now) {
  s.ask = null;
  s.turn = nextIdx(s, s.turn, s.dir);
  s.turnStartedAt = now;
}

function finishIfWon(s) {
  const left = active(s);
  if (left.length <= 1) {
    s.status = 'over';
    s.winnerUid = left[0] ? left[0].uid : '';
    s.banner = { ...s.banner, kind: 'win', winnerUid: s.winnerUid, winnerName: left[0] ? left[0].name : '' };
  }
}

// resolve(text, used, pos?) -> { status, id, display, first, last, from, to, pos }
//   status: 'ok' | 'used' | 'unknown' | 'oneword' | 'close' (too near two names to call)
//         | 'pick' (2+ players share the name; ask for a position) | 'wrongpos' (none of them played it)
export function play(s, uid, text, resolve, now, { fromPause = false, pos = '' } = {}) {
  if (s.status !== 'playing' && !(fromPause && s.status === 'paused')) throw new Error('The game is not in play.');
  if (current(s).uid !== uid) throw new Error("It's not your turn.");
  if (s.ask) throw new Error('Pick a position.');
  if (!fromPause && now > s.turnStartedAt + TURN_MS + GRACE_MS) return strike(s, 'time', '', now);

  const r = resolve(text, s.used, pos || undefined);
  if (r.status === 'close' && !fromPause) throw new Error('Too close to call between two players — check the spelling.');
  s.status = 'playing';
  s.pause = null;
  if (r.status === 'close') return strike(s, 'close', text, now);
  if (r.status === 'oneword') return strike(s, 'oneword', text, now);
  if (r.status === 'unknown') return strike(s, 'unknown', text, now);
  if (s.letter && r.first[0].toUpperCase() !== s.letter) return strike(s, 'letter', r.display, now);
  if (r.status === 'used') return strike(s, 'used', r.display, now);
  if (r.status === 'pick') {
    // Same name, 2+ players: 3 more seconds to say which one by position. Only the typed text is
    // stored, so nobody can peek at the answers.
    s.ask = { uid, text, display: r.display, until: now + ASK_MS };
    s.banner = { id: rid(), kind: 'ask', byUid: uid, byName: current(s).name, text: r.display };
    return s;
  }
  return accept(s, r, now, pos);
}

export function answerPosition(s, uid, pos, resolve, now) {
  if (s.status !== 'playing' || !s.ask) throw new Error('Nothing to answer.');
  if (s.ask.uid !== uid) throw new Error("It's not your turn.");
  const { text, display } = s.ask;
  if (now > s.ask.until + GRACE_MS) return strike(s, 'postime', display, now);
  const r = resolve(text, s.used, pos);
  if (r.status === 'wrongpos') return strike(s, 'wrongpos', `${display} (${posName(pos)})`, now);
  if (r.status === 'used') return strike(s, 'used', `${display} (${posName(pos)})`, now);
  return accept(s, r, now, pos);
}

function accept(s, r, now, pos) {
  const p = current(s);
  const firstL = r.first[0].toUpperCase();
  const lastL = r.last[0].toUpperCase();
  const double = firstL === lastL;
  for (const id of r.ids || [r.id]) s.used[id] = true;   // same name + same position = one player
  s.letter = lastL;
  s.plays.push({ uid: p.uid, name: p.name, text: r.display, id: r.id, from: r.from, to: r.to, pos: pos || '',
    fuzzy: !!r.fuzzy, ok: true, double, t: now });
  const sealed = seal(s);
  const reversed = double && active(s).length > 2;
  if (reversed) s.dir = -s.dir;
  // Two players left: a double letter keeps the turn until you play your way out of it.
  const again = double && active(s).length === 2;
  if (again) { s.ask = null; s.turnStartedAt = now; } else advance(s, now);
  s.banner = {
    id: rid(), kind: 'ok', byUid: p.uid, byName: p.name, text: r.display, playerId: r.id, from: r.from, to: r.to,
    pos: pos || '', typed: r.fuzzy ? r.typed : '', letter: lastL, double, reversed, again, sealed,
    nextUid: current(s).uid, nextName: current(s).name,
  };
  finishIfWon(s);
  return s;
}

// Anyone's phone may call this once the clock runs out; the rules decide if it really has.
export function timeout(s, now) {
  if (s.status !== 'playing') return s;
  if (s.ask) return now > s.ask.until + GRACE_MS ? strike(s, 'postime', s.ask.display, now) : s;
  if (now <= s.turnStartedAt + TURN_MS + GRACE_MS) return s;
  return strike(s, 'time', '', now);
}

// The play is sealed before the pause, so nobody (including the pauser) can change it.
export function pause(s, uid, { hash, pid }, now) {
  if (s.status !== 'playing') throw new Error('The game is not in play.');
  if (current(s).uid !== uid) throw new Error('You can only pause on your turn, after you submit.');
  if (s.ask) throw new Error('Pick a position first.');
  if (now > s.turnStartedAt + TURN_MS + GRACE_MS) return strike(s, 'time', '', now);
  const p = current(s);
  s.status = 'paused';
  s.pause = { byUid: uid, byName: p.name, at: now, until: now + PAUSE_MS, hash, pid };
  s.banner = { id: rid(), kind: 'pause', byUid: uid, byName: p.name };
  return s;
}

export function unpause(s, uid, { text, salt, pos = '' }, resolve, now) {
  if (s.status !== 'paused' || !s.pause) throw new Error('The game is not paused.');
  if (s.pause.byUid !== uid) throw new Error(`Only ${s.pause.byName} can unpause.`);
  if (now > s.pause.until) return resetAfterPause(s, now);
  const hash = s.pause.hash;
  play(s, uid, text, resolve, now, { fromPause: true, pos });
  // A sealed name shared by 2+ players should come with its position; if not, they get the 3 seconds now.
  if (s.ask) { s.banner.unpaused = true; s.pause = null; return s; }
  s.plays[s.plays.length - 1].sealed = { hash, salt, raw: text, pos };   // lets every phone check the reveal
  s.banner.unpaused = true;
  return s;
}

// "Game resets when 8 hours has elapsed."
export function resetAfterPause(s, now) {
  if (s.status !== 'paused' || !s.pause || now <= s.pause.until) return s;
  const who = s.pause.byName;
  s.players.forEach(p => { p.strikes = 0; p.out = false; });
  Object.assign(s, { status: 'playing', dir: 1, letter: '', used: {}, plays: [], pending: [], pause: null, turnStartedAt: now,
    gameNo: (s.gameNo || 0) + 1, turn: Math.floor(Math.random() * s.players.length) });
  s.banner = { id: rid(), kind: 'reset', byName: who, nextUid: current(s).uid, nextName: current(s).name };
  return s;
}

export function rematch(s, uid, now) {
  if (s.status !== 'over') throw new Error('The game is still going.');
  return start({ ...s, hostUid: uid === s.hostUid ? uid : s.hostUid }, s.hostUid, now);
}

export function leave(s, uid, now) {
  const i = idxOf(s, uid);
  if (i < 0) return s;
  if (s.status === 'lobby') {
    s.players.splice(i, 1);
    if (s.hostUid === uid && s.players[0]) s.hostUid = s.players[0].uid;
    return s;
  }
  if (s.status === 'over') return s;
  const wasTurn = s.turn === i;
  s.pending = s.pending.filter(x => x.uid !== uid);
  s.players[i].out = true;
  s.players[i].strikes = MAX_STRIKES;
  if (wasTurn) { s.pause = null; s.status = 'playing'; advance(s, now); }
  s.banner = { id: rid(), kind: 'left', byName: s.players[i].name, letter: s.letter, nextUid: current(s).uid, nextName: current(s).name };
  washIfAround(s);
  finishIfWon(s);
  return s;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
