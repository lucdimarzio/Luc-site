// Online mode: Firebase Realtime Database + anonymous sign-in (no accounts for players).
//   /games/<CODE>                  the shared game every phone watches
//   /sealed/<CODE>/<uid>/<pauseId> a paused play; only the person who wrote it can read it
//   /records/<board>/<id>          the longest games (leaderboard)

const V = '10.12.2';
const SDK = name => `https://www.gstatic.com/firebasejs/${V}/firebase-${name}.js`;

export async function createBackend(config) {
  const [{ initializeApp }, auth, db] = await Promise.all([
    import(SDK('app')), import(SDK('auth')), import(SDK('database')),
  ]);
  const app = initializeApp(config);
  const a = auth.getAuth(app);
  const d = db.getDatabase(app);

  const user = a.currentUser || await new Promise((res, rej) => {
    const off = auth.onAuthStateChanged(a, u => { if (u) { off(); res(u); } });
    auth.signInAnonymously(a).catch(rej);
  });

  // Phones' clocks disagree; the database tells us how far off ours is.
  let offset = 0;
  db.onValue(db.ref(d, '.info/serverTimeOffset'), snap => { offset = snap.val() || 0; });

  const gameRef = code => db.ref(d, `games/${code}`);

  return {
    mode: 'online',
    uid: user.uid,
    now: () => Date.now() + offset,
    async exists(code) { return (await db.get(gameRef(code))).exists(); },
    async create(code, state) { await db.set(gameRef(code), state); },
    watch(code, cb) { return db.onValue(gameRef(code), snap => cb(snap.val())); },
    async update(code, fn) {
      let error = null;
      const res = await db.runTransaction(gameRef(code), cur => {
        if (cur === null) return null;            // not loaded yet; Firebase retries with the real value
        try { error = null; return JSON.parse(JSON.stringify(fn(cur))); }
        catch (e) { error = e; return undefined; } // abort
      });
      if (error) throw error;
      if (!res.committed) throw new Error('Could not save — try again.');
      return res.snapshot.val();
    },
    async seal(code, pid, data) { await db.set(db.ref(d, `sealed/${code}/${user.uid}/${pid}`), data); },
    async unseal(code, pid) { return (await db.get(db.ref(d, `sealed/${code}/${user.uid}/${pid}`))).val(); },
    async saveRecord(board, id, entry) { await db.set(db.ref(d, `records/${board}/${id}`), entry); },
    async topRecords(board, limit) {
      const snap = await db.get(db.query(db.ref(d, `records/${board}`), db.orderByChild('n'), db.limitToLast(limit)));
      const out = [];
      snap.forEach(c => { out.push({ id: c.key, ...c.val() }); });
      return out.sort((a, b) => b.n - a.n || a.at - b.at);
    },
  };
}
