"""Rebuilds play/data/baseball.json (every MLB player) from the Chadwick Bureau register,
with each player's primary position from MLB's public stats API.

1. Download the 16 files data/people-0.csv ... people-f.csv from
   https://github.com/chadwickbureau/register into an empty folder.
2. python3 _tools/build_baseball_players.py <that folder> play/data/baseball.json

Positions are cached in _tools/positions-cache.json, so a rebuild only asks MLB about new players.
Run it once a season to pick up new debuts. Data license: ODC-By 1.0 (credit Chadwick Baseball Bureau).
"""
import csv, json, sys, glob, os, time, urllib.request

src, out = sys.argv[1], sys.argv[2]
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'positions-cache.json')
# Outfield spots count as one ("OF"); a two-way player counts as P or DH.
# Father/son pairs the register lists without Jr./Sr. Add more here as you find them.
SUFFIX_FIX = {'alomasa01': 'Sr.', 'alomasa02': 'Jr.', 'cruzjo01': 'Sr.', 'cruzjo02': 'Jr.',
              'guerrvl01': 'Sr.', 'guerrvl02': 'Jr.', 'tatisfe01': 'Sr.', 'tatisfe02': 'Jr.',
              'deshide01': 'Sr.', 'deshide02': 'Jr.', 'lombage01': 'Sr.', 'lombage02': 'Jr.'}
GROUP = {'LF': 'OF', 'CF': 'OF', 'RF': 'OF', 'OF': 'OF', 'TWP': 'P/DH'}

rows = []
for f in sorted(glob.glob(os.path.join(src, 'people-*.csv'))):
    with open(f, newline='', encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            if not r['mlb_played_first'] or not r['key_bbref']: continue
            if not r['name_first'] or not r['name_last']: continue
            given = r['name_given'] if r['name_given'] != r['name_first'] else ''
            rows.append(dict(first=r['name_first'], last=r['name_last'], given=given, suffix=r['name_suffix'],
                             bbref=r['key_bbref'], mlbam=r['key_mlbam'], nick=r['name_nick'],
                             frm=int(r['mlb_played_first']), to=int(r['mlb_played_last'] or r['mlb_played_first'])))

cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
todo = sorted({r['mlbam'] for r in rows if r['mlbam'] and r['mlbam'] not in cache})
for i in range(0, len(todo), 100):
    ids = todo[i:i + 100]
    url = 'https://statsapi.mlb.com/api/v1/people?fields=people,id,primaryPosition,abbreviation&personIds=' + ','.join(ids)
    req = urllib.request.Request(url, headers={'User-Agent': 'name-game-builder'})
    data = json.load(urllib.request.urlopen(req, timeout=30))
    for p in data.get('people', []):
        cache[str(p['id'])] = (p.get('primaryPosition') or {}).get('abbreviation', '')
    for x in ids: cache.setdefault(x, '')
    json.dump(cache, open(CACHE, 'w'), separators=(',', ':'))
    print(f'positions {min(i + 100, len(todo))}/{len(todo)}', file=sys.stderr)
    time.sleep(0.25)

players = []
for r in rows:
    pos = cache.get(r['mlbam'], '')
    pos = GROUP.get(pos, pos)
    players.append([r['first'], r['last'], r['given'], SUFFIX_FIX.get(r['bbref'], r['suffix']), r['bbref'], r['frm'], r['to'], pos, r['nick']])
players.sort(key=lambda x: (x[1], x[0], x[5]))
json.dump({'source': 'Chadwick Baseball Bureau Register (ODC-By 1.0); positions from MLB Stats API',
           'fields': ['first', 'last', 'given', 'suffix', 'id', 'from', 'to', 'pos', 'nicknames'], 'players': players},
          open(out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(players))
