import * as G from './engine.js';
import { buildIndex, lookup, normalize } from './names.js';
import { firebaseConfig } from './firebase-config.js';
import { createBackend as createSolo } from './backend-solo.js';
import { makeBot, LEVELS } from './bot.js';

const $ = id => document.getElementById(id);
const CATEGORY = 'baseball';
const params = new URLSearchParams(location.search);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let api, net, solo, bot, players, index;
// in test mode every tab is its own player, so each tab keeps its own name
const NAME_KEY = () => api.mode === 'local' ? `namegame:name:${api.uid}` : 'namegame:name';
let code = '', state = null, unwatch = null, lastBannerId = null, busy = false;

// ---------- names ----------
// What the typed name means right now (see engine.js play() for the statuses).
function resolve(text, used, pos) {
  const r = lookup(index, text);
  const { typed } = r;
  if (typed.split(' ').length < 2) return { status: 'oneword' };
  if (r.ambiguous) return { status: 'close' };
  if (!r.matches.length) return { status: 'unknown' };
  const info = m => {
    const [first, last, given, suffix, id, from, to, listed] = players[m.i];
    // show the name the way it was typed (Babe vs George Herman), with proper capitals
    const firstShown = [first, given, given && given.split(' ')[0]].find(f => f && normalize(f) === m.firstForm)
      || [first, given].find(f => f && normalize(f).replace(/ /g, '') === m.firstForm)
      || m.firstForm.replace(/\b\w/g, c => c.toUpperCase());   // a nickname / short form: "Vlad", "Javy"
    return { id, listed, from, to, first: m.firstForm, last: normalize(last), fuzzy: r.fuzzy, typed: text,
      display: `${firstShown} ${last}${suffix ? ' ' + suffix : ''}` };
  };
  let cands = r.matches.map(info);
  // Players who share a name AND a position count as one player (there's one "Pedro Martinez, pitcher"):
  // playing it uses all of them. Only ask for a position when it actually tells them apart.
  const known = new Set(cands.map(c => c.listed).filter(l => l && !['X', 'PH', 'PR'].includes(l)));
  if (pos) {
    cands = cands.filter(c => G.posFits(c.listed, pos));
    if (!cands.length) return { ...info(r.matches[0]), status: 'wrongpos' };
  } else if (known.size > 1) {
    return { ...cands[0], status: cands.some(c => !used[c.id]) ? 'pick' : 'used' };
  }
  // A player with no listed position fits any answer, so they don't decide whether it's been played.
  const listedOnes = cands.filter(c => known.has(c.listed));
  const taken = (listedOnes.length ? listedOnes : cands).some(c => used[c.id]);
  const lead = listedOnes[0] || cands[0];
  return { ...lead, ids: cands.map(c => c.id), status: taken ? 'used' : 'ok' };
}
const bref = id => `https://www.baseball-reference.com/players/${id[0]}/${id}.shtml`;

// ---------- boot ----------
async function boot() {
  const online = firebaseConfig.apiKey && !params.has('local');
  const [backend, data] = await Promise.all([
    online ? import('./backend-firebase.js').then(m => m.createBackend(firebaseConfig))
           : import('./backend-local.js').then(m => m.createBackend()),
    fetch(`/play/data/${CATEGORY}.json${new URL(import.meta.url).search}`).then(r => r.json()),
  ]);
  api = net = backend;
  solo = createSolo();
  players = data.players;
  index = buildIndex(players);
  $('modeTag').textContent = api.mode === 'online' ? 'Online' : 'Test mode · 1 tab = 1 player';
  $('modeTag').classList.toggle('test', api.mode !== 'online');

  $('name').value = localStorage.getItem(NAME_KEY()) || '';
  const want = (params.get('g') || '').toUpperCase();
  if (want) {
    if ($('name').value.trim()) return enter(want, true);
    $('joinCode').value = want;
  }
  showHome();
}

function show(id) {
  for (const s of ['home', 'lobby', 'game', 'loading']) $(s).hidden = s !== id;
}

function showHome() {
  show('home');
  const last = localStorage.getItem('namegame:last');
  $('rejoinBtn').hidden = !last;
  if (last) $('rejoinBtn').textContent = `Back to game ${last}`;
  const s = solo.saved();
  $('soloResume').hidden = !(s && s.status !== 'over');
  if (s) $('soloResume').textContent = `Back to your game vs the computer (${(LEVELS[s.cpuLevel] || LEVELS.medium).label})`;
}

// ---------- vs the computer ----------
function useNet() { if (api !== net) { if (unwatch) unwatch(); unwatch = null; state = null; api = net; } }
function enterSolo() {
  if (unwatch) unwatch();
  api = solo; code = 'SOLO'; lastBannerId = null; botKey = '';
  const saved = solo.saved();
  bot = makeBot(players, resolve, saved.cpuLevel);
  history.replaceState(null, '', `/play/${params.has('local') ? '?local' : ''}`);
  unwatch = api.watch(code, s => { state = s && G.fill(s); render(); });
}
$('soloLevels').onclick = async e => {
  const b = e.target.closest('[data-level]');
  if (!b) return;
  const name = myName('soloErr'); if (!name) return;
  const now = Date.now();
  let s = G.newGame({ code: 'SOLO', category: CATEGORY, host: { uid: 'me', name } }, now);
  s = G.join(G.fill(s), { uid: 'cpu', name: 'Computer' });
  s.cpuLevel = b.dataset.level;
  s = G.start(s, 'me', now);
  await solo.create('SOLO', s);
  enterSolo();
};
$('soloResume').onclick = () => { if (myName('soloErr')) enterSolo(); };

// ---------- longest games (leaderboard) ----------
const BOARDS = [['p2', '2 players'], ['p3', '3 players'], ['p4', '4 players'], ['p5', '5+ players'],
  ['cpu-easy', 'vs the computer · Easy'], ['cpu-medium', 'vs the computer · Medium'], ['cpu-hard', 'vs the computer · Hard']];
// "#1 on the 2-player leaderboard" / "#1 on the Easy computer leaderboard"
const boardName = b => b.startsWith('cpu-') ? `${b[4].toUpperCase()}${b.slice(5)} computer` : `${b[1]}${b === 'p5' ? '+' : ''}-player`;
const boardOf = s => s.cpuLevel ? `cpu-${s.cpuLevel}` : `p${Math.min(5, Math.max(2, s.size || s.players.length))}`;
const goodPlays = s => s.plays.filter(p => p.ok).length;
const recorded = new Set();

function recordGame() {
  const s = state, n = goodPlays(s);
  const id = s.cpuLevel ? `cpu-${net.uid.slice(0, 28)}-${(s.plays[0] || {}).t || 0}` : `${s.code}-${s.gameNo}`;
  if (recorded.has(id)) return;
  recorded.add(id);
  $('overRecord').textContent = `${n} name${n === 1 ? '' : 's'} played.`;
  if (n < 1) return;
  const board = boardOf(s);
  // every phone in the game writes the same entry, so it doesn't matter who's still around
  const entry = { n, names: s.players.filter(p => p.uid !== 'cpu').map(p => p.name).join(' · ').slice(0, 200),
    at: (s.plays[s.plays.length - 1] || {}).t || api.now() };
  net.saveRecord(board, id, entry)
    .then(() => net.topRecords(board, 10))
    .then(top => {
      const rank = top.findIndex(e => e.id === id);
      if (rank >= 0) $('overRecord').innerHTML = `${n} names played — <b style="color:var(--gold)">#${rank + 1}</b> on the ${esc(boardName(board))} leaderboard!`;
    })
    .catch(() => { /* leaderboard not set up; the game still counts */ });
}

$('lbBoard').innerHTML = BOARDS.map(([k, label]) => `<option value="${k}">${label}</option>`).join('');
async function loadBoard() {
  const list = $('lbList');
  list.innerHTML = '<li class="muted">Loading…</li>';
  try {
    const top = await net.topRecords($('lbBoard').value, 10);
    list.innerHTML = top.length ? top.map(e => `<li><b>${e.n}</b> names — ${esc(e.names)}<span class="by">${new Date(e.at).toLocaleDateString()}</span></li>`).join('')
      : '<li class="muted">No games yet. Go set the mark.</li>';
  } catch { list.innerHTML = '<li class="muted">The leaderboard isn\'t set up yet.</li>'; }
}
// Rules and leaderboard open as sheets over the page
const openSheet = id => { const d = $(id); if (!d.open) d.showModal(); };
$('rulesBtn').onclick = () => openSheet('rulesSheet');
$('rulesLink').onclick = e => { e.preventDefault(); openSheet('rulesSheet'); };
$('lbBtn').onclick = () => { openSheet('lbSheet'); loadBoard(); };
for (const d of document.querySelectorAll('dialog.sheet')) {
  d.addEventListener('click', e => {
    const r = d.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if ((e.target === d && outside) || e.target.closest('[data-close]')) d.close();
  });
}
$('lbBoard').onchange = loadBoard;

// The computer's turn: think for a few seconds, then answer (or come up empty).
let botTimer = null, botKey = '';
function driveBot() {
  if (api !== solo || !state || state.status !== 'playing' || current().uid !== 'cpu') return;
  const key = `${state.gameNo}:${state.plays.length}`;
  if (botTimer || key === botKey) return;
  // coming back to a game where it was already the computer's turn: answer quickly
  const wait = Math.min(bot.thinkMs(), Math.max(1200, state.turnStartedAt + G.TURN_MS - 2500 - api.now()));
  botTimer = setTimeout(async () => {
    botTimer = null;
    if (api !== solo || !state || state.status !== 'playing' || current().uid !== 'cpu') return;
    if (`${state.gameNo}:${state.plays.length}` !== key) return;
    botKey = key;
    const pick = bot.choose(state);
    await act(s => pick ? G.play(s, 'cpu', pick.text, resolve, api.now(), { pos: pick.pos || '' })
                        : G.giveUp(s, 'cpu', api.now()));
    if (`${state.gameNo}:${state.plays.length}` === key) botKey = '';   // didn't go through; try again
  }, wait);
}

const myName = (err = 'homeErr') => {
  const n = $('name').value.trim().replace(/\s+/g, ' ');
  $('homeErr').textContent = $('soloErr').textContent = '';
  if (!n) {
    $(err).textContent = 'Put your name in first (top of the page).';
    $('name').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('name').focus({ preventScroll: true });
    return '';
  }
  localStorage.setItem(NAME_KEY(), n);
  return n;
};

$('createBtn').onclick = async () => {
  useNet();
  const name = myName(); if (!name) return;
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); }
  while (await api.exists(c));
  await api.create(c, G.newGame({ code: c, category: CATEGORY, host: { uid: api.uid, name } }, api.now()));
  enter(c, false);
};
$('joinBtn').onclick = () => { useNet(); if (myName()) enter($('joinCode').value.trim().toUpperCase(), true); };
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
$('rejoinBtn').onclick = () => { useNet(); if (myName()) enter(localStorage.getItem('namegame:last'), true); };

async function enter(c, joining) {
  $('homeErr').textContent = '';
  if (!/^[A-Z]{4}$/.test(c || '')) { showHome(); $('homeErr').textContent = 'Codes are 4 letters.'; return; }
  show('loading');
  try {
    if (!(await api.exists(c))) throw new Error(`No game called ${c}.`);
    const name = localStorage.getItem(NAME_KEY());
    if (joining) await api.update(c, s => G.join(G.fill(s), { uid: api.uid, name }));
  } catch (e) {
    showHome(); $('homeErr').textContent = e.message;
    if (localStorage.getItem('namegame:last') === c) localStorage.removeItem('namegame:last');
    return;
  }
  code = c;
  localStorage.setItem('namegame:last', c);
  history.replaceState(null, '', `/play/?g=${c}${params.has('local') ? '&local' : ''}`);
  if (unwatch) unwatch();
  unwatch = api.watch(c, s => { state = G.fill(s); render(); });
}

// ---------- actions ----------
async function act(fn) {
  if (busy) return;
  busy = true; $('gameErr').textContent = '';
  try { await api.update(code, s => fn(G.fill(s))); }
  catch (e) { $('gameErr').textContent = e.message; }
  finally { busy = false; }
}

$('startBtn').onclick = () => act(s => G.start(s, api.uid, api.now()));
$('rematchBtn').onclick = () => act(s => G.rematch(s, api.uid, api.now()));
$('shareBtn').onclick = async () => {
  const url = `${location.origin}/play/?g=${code}`;
  const text = `Name Game — Baseball. Join my game: ${code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Name Game', text, url });
    else { await navigator.clipboard.writeText(url); $('shareBtn').textContent = 'Link copied!'; }
  } catch { /* closed the share sheet */ }
};
const leave = () => {
  if (!confirm('Leave this game? If it has started, you\'re out.')) return;
  act(s => G.leave(s, api.uid, api.now())).then(() => {
    if (unwatch) unwatch(); unwatch = null; state = null;
    if (api === solo) { solo.clear(); api = net; }
    else localStorage.removeItem('namegame:last');
    history.replaceState(null, '', '/play/'); showHome();
  });
};
$('lobbyLeave').onclick = leave;
$('leaveBtn').onclick = leave;

$('playForm').onsubmit = e => {
  e.preventDefault();
  const text = $('playInput').value.trim();
  if (!text) return;
  $('playInput').value = '';
  act(s => G.play(s, api.uid, text, resolve, api.now()));
};

const sealText = (salt, text, pos) => `${salt}${text}|${pos || ''}`;

// Pausing: the answer (and its position, if the name is shared) is sealed first.
let pausePick = null;   // { text, until } while choosing a position before pausing
$('pauseBtn').onclick = () => {
  const text = $('playInput').value.trim();
  if (!text) { $('gameErr').textContent = 'Type your answer first — you have to submit before you pause.'; return; }
  const r = resolve(text, state.used);
  if (r.status === 'close') { $('gameErr').textContent = 'Too close to call between two players — check the spelling.'; return; }
  if (r.status === 'pick') {
    pausePick = { text, until: api.now() + G.ASK_MS };
    render();
    return;
  }
  sealAndPause(text, '');
};

async function sealAndPause(text, pos) {
  const pid = Math.random().toString(36).slice(2, 10);
  const salt = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const hash = await G.sha256(sealText(salt, text, pos));
  try { await api.seal(code, pid, { text, salt, pos }); }
  catch (e) { $('gameErr').textContent = e.message; return; }
  $('playInput').value = '';
  act(s => G.pause(s, api.uid, { hash, pid }, api.now()));
}

$('unpauseBtn').onclick = async () => {
  const sealed = await api.unseal(code, state.pause.pid);
  if (!sealed) { $('gameErr').textContent = "Couldn't find your sealed answer on this device."; return; }
  act(s => G.unpause(s, api.uid, sealed, resolve, api.now()));
};

// Position buttons ("Which Will Smith?")
$('posPick').innerHTML = G.POSITIONS.map(([c, label]) => `<button type="button" class="btn ghost" data-pos="${c}">${label}</button>`).join('');
$('posPick').onclick = e => {
  const b = e.target.closest('[data-pos]');
  if (!b) return;
  const pos = b.dataset.pos;
  if (pausePick) {
    const { text, until } = pausePick;
    pausePick = null;
    if (api.now() > until + G.GRACE_MS) { $('gameErr').textContent = 'Too slow on the position — no pause.'; render(); return; }
    sealAndPause(text, pos);
    return;
  }
  act(s => G.answerPosition(s, api.uid, pos, resolve, api.now()));
};

$('banner').onclick = () => { $('banner').hidden = true; };

// ---------- clock ----------
setInterval(() => {
  if (!state) return;
  const now = api.now();
  if (pausePick && now > pausePick.until + G.GRACE_MS) {
    pausePick = null; $('gameErr').textContent = 'Too slow on the position — no pause.'; render();
  }
  if (state.status === 'playing' && (state.ask || pausePick)) {
    const until = state.ask ? state.ask.until : pausePick.until;
    drawClock(until - now, G.ASK_MS);
    if (state.ask && now > until + G.GRACE_MS + (state.ask.uid === api.uid ? 0 : 600)) act(s => G.timeout(s, api.now()));
  } else if (state.status === 'playing') {
    const left = state.turnStartedAt + G.TURN_MS - now;
    drawClock(left);
    // Any phone can call time; the rules ignore it if the clock hasn't really run out.
    if (left < -G.GRACE_MS - (current().uid === api.uid ? 0 : 600)) act(s => G.timeout(s, api.now()));
  } else if (state.status === 'paused' && now > state.pause.until) {
    act(s => G.resetAfterPause(s, api.now()));
  } else if (state.status === 'paused') {
    $('pausedText').innerHTML = pausedLine();
  }
}, 250);

const current = () => G.current(state);
function drawClock(left, total = G.TURN_MS) {
  const frac = Math.max(0, Math.min(1, left / total));
  $('bar').style.strokeDashoffset = String(477.5 * (1 - frac));
  $('ring').classList.toggle('hurry', left < Math.min(5000, total));
  $('secs').textContent = `${Math.max(0, Math.ceil(left / 1000))} sec`;
}

// ---------- render ----------
let lastTurnKey = '';
function render() {
  if (!state) { showHome(); $('homeErr').textContent = 'That game is gone.'; return; }
  const me = state.players.find(p => p.uid === api.uid);
  if (!me) { show('home'); $('homeErr').textContent = 'You are not in that game.'; return; }

  if (state.status === 'lobby') {
    show('lobby');
    $('lobbyCode').textContent = state.code;
    $('lobbyPlayers').innerHTML = state.players.map(p =>
      `<li><span>${esc(p.name)}${p.uid === api.uid ? ' <span class="by">(you)</span>' : ''}</span><span class="by">${p.uid === state.hostUid ? 'host' : ''}</span></li>`).join('');
    const host = state.hostUid === api.uid;
    $('startBtn').hidden = !host;
    $('startBtn').disabled = state.players.length < 2;
    $('lobbyWait').textContent = host
      ? (state.players.length < 2 ? 'Send the invite — you need at least one opponent.' : `${state.players.length} players. Ready when you are.`)
      : 'Waiting for the host to start…';
    return;
  }

  show('game');
  const cur = current();
  const myTurn = cur.uid === api.uid && !me.out;
  $('players').innerHTML = state.players.map((p, i) => {
    const pend = Math.min(state.pending.filter(x => x.uid === p.uid).length, G.MAX_STRIKES - p.strikes);
    return `
    <div class="pl${i === state.turn && state.status !== 'over' ? ' turn' : ''}${p.out ? ' out' : ''}${p.uid === api.uid ? ' me' : ''}">
      <div class="n">${esc(p.name)}</div>
      <div class="s">${'<b>K</b>'.repeat(p.strikes)}${'<i title="pending">K</i>'.repeat(pend)}${'·'.repeat(Math.max(0, G.MAX_STRIKES - p.strikes - pend))}</div>
    </div>`;
  }).join('');
  const pendNames = state.pending.map(x => x.uid === api.uid ? 'you' : x.name);
  $('pendingLine').hidden = !(state.pending.length && state.status !== 'over');
  $('pendingLine').textContent = state.pending.length
    ? `Pending strike${state.pending.length > 1 ? 's' : ''} on ${pendNames.join(' & ')} — a right answer seals ${state.pending.length > 1 ? 'them' : 'it'}.` : '';

  const L = $('letter');
  L.textContent = state.letter || 'Any letter';
  L.classList.toggle('any', !state.letter);
  if (!(myTurn && state.status === 'playing')) pausePick = null;
  const myAsk = state.status === 'playing' && ((state.ask && state.ask.uid === api.uid) || !!pausePick);
  const askName = state.ask ? state.ask.display : pausePick ? resolve(pausePick.text, state.used).display : '';
  $('who').textContent = state.status === 'over' ? ''
    : myAsk ? `Which ${askName}?`
    : state.ask ? `${cur.name} said ${askName} — which one?`
    : myTurn ? 'Your turn' : `${cur.name}'s turn`;
  $('posPick').hidden = !myAsk;
  $('posHint').hidden = !myAsk;
  $('posHint').textContent = pausePick ? 'More than one big leaguer has that name. Tap a position, then it seals and pauses.'
    : 'More than one big leaguer has that name. Tap the position — 3 seconds.';
  const live = state.players.filter(p => !p.out).length;
  $('dir').textContent = live > 2 && state.dir === -1 ? '↺ order reversed' : '';

  $('playForm').hidden = !(myTurn && state.status === 'playing') || myAsk || !!state.ask;
  $('pausedBox').hidden = state.status !== 'paused';
  $('overBox').hidden = state.status !== 'over';
  $('leaveBtn').hidden = state.status === 'over';
  $('ring').style.opacity = state.status === 'playing' ? 1 : .35;

  if (state.status === 'paused') {
    $('pausedText').innerHTML = pausedLine();
    $('unpauseBtn').hidden = state.pause.byUid !== api.uid;
    $('secs').textContent = 'clock stopped';
  }
  if (state.status === 'over') {
    recordGame();
    const w = state.players.find(p => p.uid === state.winnerUid);
    $('overText').textContent = w ? (w.uid === api.uid ? 'You win!' : `${w.name} wins`) : 'Game over';
    $('secs').textContent = '';
  }

  // my turn just started: buzz and focus the box
  const turnKey = `${state.gameNo}:${state.plays.length}:${state.turn}:${state.status}:${state.ask ? 1 : 0}`;
  if (myTurn && state.status === 'playing' && !state.ask && turnKey !== lastTurnKey) {
    navigator.vibrate?.(120);
    setTimeout(() => $('playInput').focus(), 50);
  }
  lastTurnKey = turnKey;

  renderHistory();
  showBanner(state.banner);
  driveBot();
}

function pausedLine() {
  const p = state.pause;
  const hrs = Math.max(0, p.until - api.now());
  const h = Math.floor(hrs / 3600e3), m = Math.floor((hrs % 3600e3) / 60e3);
  const who = p.byUid === api.uid ? 'You' : esc(p.byName);
  return `${who} submitted an answer and paused. Nobody sees it until the unpause.<br>` +
    `<b>${h}h ${m}m</b> left before the game resets.`;
}

const REASONS = {
  unknown: 'never played in the majors',
  close: 'is too close to two different players to call',
  wrongpos: 'nobody by that name played there',
  postime: 'no position in time',
  used: 'has already been played',
  letter: 'starts with the wrong letter',
  time: 'ran out of time',
  oneword: 'needs a first and last name',
  stumped: 'came up empty',
};

const verified = new Map();
function renderHistory() {
  const items = [...state.plays].reverse().map(p => {
    if (p.sealed && !verified.has(p.t)) {
      verified.set(p.t, null);
      G.sha256(sealText(p.sealed.salt, p.sealed.raw, p.sealed.pos)).then(h => { verified.set(p.t, h === p.sealed.hash); renderHistory(); });
    }
    const seal = p.sealed ? (verified.get(p.t) === false ? ' ⚠️' : ' 🔒') : '';
    if (p.ok) {
      return `<li><span class="what"><a href="${bref(p.id)}" target="_blank" rel="noopener">${esc(p.text)}</a>${p.pos ? ` <span class="by">${esc(G.posName(p.pos))}</span>` : ''}<span class="yrs">${p.from}–${String(p.to).slice(-2)}</span>${seal}</span><span class="by">${esc(p.name)}${p.double ? ' · double' : ''}</span></li>`;
    }
    const what = p.text ? `${esc(p.text)} — ${REASONS[p.reason]}` : REASONS[p.reason];
    const tag = { pending: 'K? ', washed: 'No K · ', sealed: 'K · ' }[p.k] || 'K · ';
    const note = { pending: ' (pending)', washed: ' (wiped — nobody had one)' }[p.k] || '';
    return `<li class="bad ${p.k || ''}"><span class="what">${tag}${what}${note}${seal}</span><span class="by">${esc(p.name)}</span></li>`;
  });
  $('history').innerHTML = items.join('') || '<li class="muted">No plays yet.</li>';
}

function sealedLine(sealed) {
  if (!sealed || !sealed.length) return '';
  return ' ' + sealed.map(x => {
    const who = x.uid === api.uid ? 'you' : esc(x.name);
    return x.out ? `Strike sealed — ${x.uid === api.uid ? "you're" : who + ' is'} <b>out</b>!` : `Strike ${x.strikes} sealed on ${who}.`;
  }).join(' ');
}

// ---------- banner ----------
let bannerTimer;
function showBanner(b) {
  if (!b || b.id === lastBannerId) return;
  const first = lastBannerId === null;
  lastBannerId = b.id;
  if (first && b.kind !== 'start') return; // don't replay an old banner when you open the game
  const toMe = b.nextUid === api.uid;
  const next = toMe ? 'you' : esc(b.nextName);
  let big = '', sub = '', tone = '';
  switch (b.kind) {
    case 'start':
      big = toMe ? 'You lead off' : `${esc(b.nextName)} leads off`;
      sub = 'Any letter. 15 seconds. Play ball.'; break;
    case 'ok': {
      big = b.again ? (toMe ? `Double ${b.letter}! Go again` : `Double ${b.letter}! ${esc(b.nextName)} goes again`)
        : b.double ? `Double ${b.letter}! ${b.letter} to ${next}` : `${b.letter} to ${next}`;
      sub = `<b>${esc(b.byName)}</b> ${b.unpaused ? 'unpaused — the sealed answer was' : 'played'} <b>${esc(b.text)}</b>${b.pos ? ` (${esc(G.posName(b.pos))})` : ''}.`;
      if (b.typed) sub += ` <span style="opacity:.75">(typed “${esc(b.typed)}” — close enough)</span>`;
      if (b.reversed) sub += ' Order reverses!';
      if (b.again) sub += ` Keep going until a name isn't a double.`;
      sub += sealedLine(b.sealed);
      tone = b.double ? 'gold' : ''; break;
    }
    case 'strike': {
      const who = b.byUid === api.uid ? 'You' : esc(b.byName);
      const L = b.letter ? b.letter : 'Any letter';
      big = toMe ? `Seal it! ${L} to you` : 'Strike pending';
      const dash = ['wrongpos', 'postime'].includes(b.reason) ? '— ' : '';
      sub = `${who}: ${b.text ? `<b>${esc(b.text)}</b> ${dash}` : ''}${REASONS[b.reason]}.`;
      if (b.unpaused) sub = `Unpaused. ${sub}`;
      sub += toMe ? ` Answer with ${b.letter ? `an ${b.letter}` : 'any name'} to make the strike stick.`
                  : ` ${L} to ${next} to seal it.`;
      tone = 'bad'; break;
    }
    case 'ask':
      if (b.byUid === api.uid) return;   // the asker needs the buttons, not a banner
      big = 'Which one?';
      sub = `<b>${esc(b.byName)}</b> said <b>${esc(b.text)}</b> — more than one big leaguer has that name. Waiting on a position…`;
      break;
    case 'wash': {
      big = 'Nobody had one';
      const fresh = toMe ? 'You start' : `${esc(b.nextName)} starts`;
      sub = `It went all the way around — no strikes for anyone. ${fresh} fresh: any name that hasn't been played.`;
      tone = 'gold'; break;
    }
    case 'win':
      big = b.winnerUid === api.uid ? 'You win!' : `${esc(b.winnerName)} wins!`;
      sub = (b.sealed || []).filter(x => x.out).map(x => `${esc(x.name)} struck out.`).join(' ');
      tone = 'gold'; break;
    case 'pause':
      big = 'Paused';
      sub = b.byUid === api.uid ? 'Your answer is sealed. Nobody sees it until you unpause.'
        : `<b>${esc(b.byName)}</b> has submitted an answer and paused the game.`;
      tone = 'gold'; break;
    case 'reset':
      big = 'Game reset';
      sub = `${esc(b.byName)}'s pause ran past 8 hours. Fresh game — ${next} ${toMe ? 'lead' : 'leads'} off.`; break;
    case 'left':
      big = `${esc(b.byName)} left`;
      sub = state.status === 'over' ? '' : `${b.letter ? b.letter : 'Any letter'} to ${next}.`; break;
  }
  $('bannerBig').innerHTML = big;
  $('bannerSub').innerHTML = sub;
  $('banner').className = `banner ${tone}`;
  $('banner').hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { $('banner').hidden = true; }, 2600);
}

boot().catch(e => {
  console.error(e);
  $('loading').innerHTML = `<p class="err">Couldn't start: ${esc(e.message)}</p>`;
});
