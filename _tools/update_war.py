"""Adds each player's career WAR (Baseball-Reference) to play/data/baseball.json.

The computer opponent uses it to decide which players it "knows" (see play/js/bot.js).
python3 _tools/update_war.py        (run from the site folder; downloads ~50 MB, keeps only the totals)

Career WAR = batting WAR + pitching WAR, summed over every season. The totals are saved in
_tools/war-cache.json so build_baseball_players.py can add them on a full rebuild too.
"""
import csv, collections, io, json, os, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'war-cache.json')
DATA = os.path.join(HERE, '..', 'play', 'data', 'baseball.json')

war = collections.defaultdict(float)
for name in ('war_daily_bat.txt', 'war_daily_pitch.txt'):
    req = urllib.request.Request('https://www.baseball-reference.com/data/' + name, headers={'User-Agent': 'Mozilla/5.0'})
    text = urllib.request.urlopen(req, timeout=120).read().decode('utf-8', 'replace')
    for r in csv.DictReader(io.StringIO(text)):
        try: war[r['player_ID']] += float(r['WAR'])
        except (ValueError, TypeError): pass
cache = {k: round(v, 1) for k, v in war.items() if round(v, 1)}
json.dump(cache, open(CACHE, 'w'), separators=(',', ':'), sort_keys=True)

d = json.load(open(DATA, encoding='utf-8'))
fields = d['fields']
if 'war' not in fields: fields.append('war')
i = fields.index('war')
for p in d['players']:
    while len(p) <= i: p.append('')
    p[i] = round(cache.get(p[4], 0))
d['source'] = 'Chadwick Baseball Bureau Register (ODC-By 1.0); positions from MLB Stats API; WAR from Baseball-Reference'
json.dump(d, open(DATA, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(cache), 'players with WAR')
