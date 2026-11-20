# Name Game (lucdimarzio.com/play/)

A phone-friendly name-chain game. Baseball first; other categories later.

## Files
- `play/index.html` — the page (no site header, so it feels like an app)
- `play/js/engine.js` — every rule (turns, strikes, double letters, pause, 8-hour reset)
- `play/js/names.js` — matches what someone typed to a real player: real/given names and register nicknames
  (Babe Ruth = George Herman Ruth, Tuffy Rhodes), everyday short forms (Vlad, Javy, Mike — only when nobody
  actually goes by that name), and close spellings (1 letter off for short names, 2 for longer; both initials
  must be right; if two different players are equally close it says "too close to call" and lets you retype)
- `play/js/backend-firebase.js` — online play; `backend-local.js` — test mode
- `play/js/firebase-config.js` — paste your Firebase keys here
- `play/data/baseball.json` — every MLB player with MLB's listed primary position (rebuild with
  `build_baseball_players.py`; positions are cached in `positions-cache.json`)

## Shared names
When a name belongs to 2+ players (Will Smith), the player gets 3 more seconds to tap a position.
Positions are MLB's *primary* position. Outfield spots count as one; a DH also counts as 1B; Ohtani counts
as P or DH; old-timers with no listed position accept any answer.
Players who share a name *and* a position count as one player: the two Pedro Martinez pitchers are one
"Pedro Martinez", so there's no question and playing it uses both. A position is only asked for when it
actually tells the players apart.

## Jr. / Sr.
No suffix typed always means the Sr.: "Ken Griffey" = Ken Griffey Sr., "Bobby Witt" = the father.
Type Jr. for the son. (If the only player is a Jr., like Cal Ripken Jr., the plain name is him.)
When a name has a Jr., anyone with that name and no suffix counts as the Sr.
A few famous father/son pairs are missing Jr./Sr. in the register; they're filled in by `SUFFIX_FIX`
in `build_baseball_players.py` (Alomar, Cruz, Guerrero, Tatís, DeShields, Lombard) — add more there.

## Playing the computer
"Play the computer" on the home screen runs a 1-on-1 game on the phone itself (no server; `backend-solo.js`
keeps it in localStorage so you can come back to it). `bot.js` is the opponent:
- Who it "knows" comes from career WAR (Baseball-Reference), plus the `STARS` list in `bot.js`:
  **Easy** 25+ WAR and active since 1950 (~850 players), thinks 4–9 s, comes up empty ~14% of the time;
  **Medium** 10+ WAR since 1955 (~2,100), 3–7.5 s, ~6%; **Hard** 4+ WAR since 1920 (~4,850), 2–5.5 s, ~2%.
- WAR is the last field in `baseball.json`. Refresh it with `python3 _tools/update_war.py` (saves totals in
  `war-cache.json`, which `build_baseball_players.py` also uses).
It plays by every rule (shared-name positions, Jr./Sr., doubles). Edit `LEVELS` or `STARS` to tune it.
Leaving the page doesn't stop the clock; pause first if you're stepping away.

## Longest games (leaderboard)
When a game ends, every phone in it saves the number of correct names to `/records/<board>/<game>` in Firebase
(boards: `p2`, `p3`, `p4`, `p5` = 5+ players, and `cpu-easy` / `cpu-medium` / `cpu-hard`). The home screen's
"Longest games" shows the top 10 of each; the game-over card says if you made it. Needs the `records` part of
`firebase-database-rules.json` in the Firebase console. Anyone could post a fake score; fine for friends.

## Test mode
Until `firebase-config.js` has an apiKey, the game runs with no server: open the page in two
browser tabs, and each tab is a different player. Add `?local` to the URL to force test mode later.

## Turning on online play (one time, ~10 minutes, free)
1. Go to console.firebase.google.com → **Add project** (Google Analytics: off).
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
   Players never make accounts; each phone gets a quiet anonymous ID.
3. **Build → Realtime Database → Create database** (United States, start in **locked mode**).
   Open the **Rules** tab, paste the contents of `_tools/firebase-database-rules.json`, **Publish**.
4. **Project settings (gear) → Your apps → Web (</>)** → nickname "name-game" → Register.
   Copy the `firebaseConfig` values into `play/js/firebase-config.js`
   (make sure `databaseURL` is included — it's on the Realtime Database page if missing).
5. **Authentication → Settings → Authorized domains** → add `lucdimarzio.com`.
6. Commit and push. The page tag will say **Online** instead of Test mode.

Free tier (Spark plan) easily covers friends-and-family play.

## Adding another category later
Make `play/data/<category>.json` in the same shape (`players: [[first, last, given, suffix, id, from, to], ...]`)
and change `CATEGORY` in `app.js` (or add a picker on the home screen).
