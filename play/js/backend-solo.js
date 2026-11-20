// Playing the computer: no server. The one game lives in this phone's localStorage,
// so you can close the page (or pause) and pick it back up later.

const KEY = 'namegame:solo';

export function createBackend() {
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  let mem = read();   // still works if storage is blocked (private browsing)
  const save = s => { mem = s; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* memory only */ } };
  const listeners = new Set();
  const sealed = new Map();

  return {
    mode: 'solo',
    uid: 'me',
    now: () => Date.now(),
    saved: () => mem,
    clear() { mem = null; try { localStorage.removeItem(KEY); } catch { /* ignore */ } },
    async exists() { return !!mem; },
    async create(code, state) { save(state); },
    watch(code, cb) {
      listeners.add(cb);
      cb(mem && JSON.parse(JSON.stringify(mem)));
      return () => listeners.delete(cb);
    },
    async update(code, fn) {
      if (!mem) throw new Error('Game not found.');
      const next = fn(JSON.parse(JSON.stringify(mem)));
      save(next);
      listeners.forEach(cb => cb(JSON.parse(JSON.stringify(next))));
      return next;
    },
    async seal(code, pid, data) {
      sealed.set(pid, data);
      try { localStorage.setItem(`${KEY}:sealed:${pid}`, JSON.stringify(data)); } catch { /* memory only */ }
    },
    async unseal(code, pid) {
      if (sealed.has(pid)) return sealed.get(pid);
      try { return JSON.parse(localStorage.getItem(`${KEY}:sealed:${pid}`)); } catch { return null; }
    },
  };
}
