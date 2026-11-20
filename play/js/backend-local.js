// Test mode: no server. Games live in this browser's localStorage, and each browser
// tab acts as a different player, so two tabs side by side = two phones.

const KEY = code => `namegame:game:${code}`;

export async function createBackend() {
  // window.name sticks to one tab (and survives reloads) but isn't copied to new tabs.
  if (!window.name.startsWith('namegame-')) window.name = 'namegame-local-' + Math.random().toString(36).slice(2, 10);
  const uid = window.name.slice('namegame-'.length);

  const read = code => { try { return JSON.parse(localStorage.getItem(KEY(code))); } catch { return null; } };
  const listeners = new Map();
  const emit = code => (listeners.get(code) || []).forEach(cb => cb(read(code)));
  addEventListener('storage', e => {
    if (e.key && e.key.startsWith('namegame:game:')) emit(e.key.slice('namegame:game:'.length));
  });

  return {
    mode: 'local',
    uid,
    now: () => Date.now(),
    async exists(code) { return !!read(code); },
    async create(code, state) { localStorage.setItem(KEY(code), JSON.stringify(state)); },
    watch(code, cb) {
      if (!listeners.has(code)) listeners.set(code, []);
      listeners.get(code).push(cb);
      cb(read(code));
      return () => listeners.set(code, listeners.get(code).filter(f => f !== cb));
    },
    // fn gets a copy of the state and returns the new state (or throws)
    async update(code, fn) {
      const cur = read(code);
      if (!cur) throw new Error('Game not found.');
      const next = fn(cur);
      localStorage.setItem(KEY(code), JSON.stringify(next));
      emit(code);
      return next;
    },
    async seal(code, pid, data) {
      const k = `namegame:sealed:${code}:${uid}:${pid}`;
      if (localStorage.getItem(k)) throw new Error('Already sealed.');
      localStorage.setItem(k, JSON.stringify(data));
    },
    async saveRecord(board, id, entry) {
      const all = JSON.parse(localStorage.getItem('namegame:records') || '{}');
      (all[board] = all[board] || {})[id] = entry;
      localStorage.setItem('namegame:records', JSON.stringify(all));
    },
    async topRecords(board, limit) {
      const all = JSON.parse(localStorage.getItem('namegame:records') || '{}');
      return Object.entries(all[board] || {}).map(([id, e]) => ({ id, ...e }))
        .sort((a, b) => b.n - a.n || a.at - b.at).slice(0, limit);
    },
    async unseal(code, pid) {
      try { return JSON.parse(localStorage.getItem(`namegame:sealed:${code}:${uid}:${pid}`)); } catch { return null; }
    },
  };
}
