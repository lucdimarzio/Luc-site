// Name lookup: turns whatever a player typed into a known entry (or nothing).
// The list format is generic so movies / bands can reuse it later:
// each entry = [first, last, given, suffix, id, from, to, pos, nicknames].

export function normalize(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // José -> Jose
    .toLowerCase()
    .replace(/[.'’`"]/g, '')                            // J.D. -> JD, O'Neill -> ONeill
    .replace(/[-_,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

// Everyday short forms, so "Vlad Guerrero", "Javy Baez" and "Mike Trout" all count.
const SHORT = {
  vladimir: 'vlad', javier: 'javy javi', yadier: 'yadi', alexander: 'alex', alejandro: 'alex', alexis: 'alex',
  michael: 'mike mikey', miguel: 'miggy', william: 'will bill billy willie', robert: 'bob bobby rob robbie robby',
  roberto: 'robbie', anthony: 'tony', antonio: 'tony', joseph: 'joe joey', james: 'jim jimmy jamie',
  thomas: 'tom tommy', richard: 'rich rick ricky dick', edward: 'ed eddie ted', eduardo: 'eddie',
  christopher: 'chris', matthew: 'matt', daniel: 'dan danny', david: 'dave', steven: 'steve', stephen: 'steve',
  nicholas: 'nick', jonathan: 'jon', benjamin: 'ben', samuel: 'sam sammy', andrew: 'andy drew',
  gregory: 'greg', jeffrey: 'jeff', kenneth: 'ken kenny', ronald: 'ron ronnie', donald: 'don donnie',
  gerald: 'jerry', lawrence: 'larry', charles: 'charlie chuck', frederick: 'fred freddie freddy',
  zachary: 'zach zack', jacob: 'jake', joshua: 'josh', timothy: 'tim', patrick: 'pat', peter: 'pete',
  francisco: 'frankie', fernando: 'nando', raymond: 'ray', randall: 'randy', douglas: 'doug',
  phillip: 'phil', philip: 'phil', nathaniel: 'nate', nathan: 'nate', theodore: 'teddy ted', albert: 'al',
  alfred: 'al', walter: 'walt', leonard: 'len lenny', harold: 'hal harry', henry: 'hank', jose: 'pepe',
};

export function buildIndex(players) {
  const index = new Map();
  // alt = only reachable through a short form (Bill -> William -> Will); real names beat those
  const add = (key, i, firstForm, alt) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    const list = index.get(key);
    const have = list.find(m => m.i === i);
    if (!have) list.push({ i, firstForm, alt });
    else if (have.alt && !alt) Object.assign(have, { firstForm, alt });
  };
  players.forEach((p, i) => {
    const [first, last, given, suffix] = p;
    const L = normalize(last);
    const S = normalize(suffix);
    const firsts = new Set([normalize(first)]);
    if (given) {
      const g = normalize(given);
      firsts.add(g);                     // George Herman Ruth
      firsts.add(g.split(' ')[0]);       // George Ruth
    }
    // nicknames from the register, e.g. "Tuffy" Rhodes; "Whitey; Shotgun" = two of them
    for (const n of String(p[8] || '').split(';')) if (n.trim()) firsts.add(normalize(n));
    const shorts = new Set();
    for (const f of [...firsts]) {
      if (/^(\w )+\w$/.test(f)) firsts.add(f.replace(/ /g, '')); // "j d" -> "jd"
      for (const sh of (SHORT[f] || '').split(' ')) if (sh) shorts.add(sh);
    }
    const put = (f, alt) => {
      if (!f) return;
      add(`${f} ${L}`, i, f, alt);
      if (S) add(`${f} ${L} ${S}`, i, f, alt);
    };
    firsts.forEach(f => put(f, false));
    shorts.forEach(f => { if (!firsts.has(f)) put(f, true); });
  });
  index.players = players;
  return index;
}

// Optimal-string-alignment distance: typos, missing/extra letters, swapped neighbors.
// Gives up early (returns max+1) once it can't come in under max.
function dist(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

const initials = s => { const w = s.split(' '); return w[0][0] + w[w.length - 1][0]; };
const squash = s => s.replace(/ /g, '');

// How far off a spelling may be and still count: 1 letter for short names, 2 for longer ones.
export const allowed = typed => (squash(typed).length <= 9 ? 1 : 2);

// Returns { matches: [{i, firstForm}], typed, fuzzy, ambiguous }.
// 1) exact name  2) same letters with spaces/hyphens ignored (VanSlyke)  3) a close spelling, but only
// when exactly one name is closest AND both initials are right. An exact name always wins, so
// "Scott Service" is Scott Service and "Scott Servais" is Scott Servais.
export function lookup(index, text) {
  let typed = normalize(text);
  const words = typed.split(' ');
  let suffix = '';
  if (words.length > 2 && SUFFIXES.has(words[words.length - 1])) {
    suffix = words.pop();
    typed = words.join(' ');
  }
  const r = find(index, typed);
  if (r.matches.length) {
    // When the name has a Jr., anyone listed without a suffix is the Sr. (Bobby Witt -> Bobby Witt Sr.)
    const raw = m => normalize(index.players[m.i][3]);
    const hasJr = r.matches.some(m => raw(m) === 'jr');
    const sfx = m => raw(m) || (hasJr ? 'sr' : '');
    if (suffix) {
      // "Ken Griffy Jr" -> only the Jr.
      const same = r.matches.filter(m => sfx(m) === suffix);
      if (same.length) r.matches = same;
    } else {
      // No suffix typed always means the Sr. (Ken Griffey = Ken Griffey Sr.; you must type Jr. for the son).
      // If the only one is a Jr. (Cal Ripken Jr. — his dad never played), the plain name is him.
      const sr = r.matches.filter(m => sfx(m) === '' || sfx(m) === 'sr');
      if (sr.length) r.matches = sr;
    }
  }
  return r;
}

const real = list => (list.some(m => !m.alt) ? list.filter(m => !m.alt) : list);

function find(index, typed) {
  const exact = index.get(typed) && real(index.get(typed));
  if (exact) return { matches: exact, typed, fuzzy: false };
  if (typed.split(' ').length < 2) return { matches: [], typed, fuzzy: false };

  const keys = keyList(index);
  const sq = squash(typed);
  const flat = keys.bySquash.get(sq);
  if (flat && flat.length === 1) return { matches: real(index.get(flat[0])), typed, fuzzy: true, matchedKey: flat[0] };

  const max = allowed(typed);
  const ini = initials(typed);
  let best = max + 1, hits = [];
  for (const k of keys.byInitial.get(ini) || []) {
    const d = dist(sq, squash(k), best);
    if (d < best) { best = d; hits = [k]; }
    else if (d === best) hits.push(k);
  }
  if (best > max || !hits.length) return { matches: [], typed, fuzzy: false };
  // Two different people equally close is too close to call. (Two spellings of the
  // same person — "George Ruth" / "Babe Ruth" — don't count as different.)
  const who = k => real(index.get(k)).map(m => m.i).sort().join(',');
  if (new Set(hits.map(who)).size > 1) return { matches: [], typed, fuzzy: true, ambiguous: true };
  return { matches: real(index.get(hits[0])), typed, fuzzy: true, matchedKey: hits[0] };
}

const cache = new WeakMap();
function keyList(index) {
  if (cache.has(index)) return cache.get(index);
  const byInitial = new Map(), bySquash = new Map();
  for (const k of index.keys()) {
    const w = k.split(' ');
    if (w.length > 2 && SUFFIXES.has(w[w.length - 1])) continue; // suffix forms are just duplicates
    const ini = initials(k);
    if (!byInitial.has(ini)) byInitial.set(ini, []);
    byInitial.get(ini).push(k);
    const sq = squash(k);
    if (!bySquash.has(sq)) bySquash.set(sq, []);
    bySquash.get(sq).push(k);
  }
  const out = { byInitial, bySquash };
  cache.set(index, out);
  return out;
}
