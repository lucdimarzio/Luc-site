// The computer opponent. It knows a pool of players that grows with the difficulty,
// takes a few seconds to "think", and now and then comes up empty, like a person.
import { POSITIONS } from './engine.js';
import { normalize } from './names.js';

export const LEVELS = {
  // Who it "knows", by career WAR (Baseball-Reference) and whether they played since 1950/1955/1920.
  easy:   { label: 'Easy',   minWar: 25, since: 1950, miss: 0.14, think: [4000, 9000] },
  medium: { label: 'Medium', minWar: 10, since: 1955, miss: 0.06, think: [3000, 7500] },
  hard:   { label: 'Hard',   minWar: 4,  since: 1920, miss: 0.015, think: [2000, 5500] },
};

// Stars every level knows, whatever their career length.
const STARS = `Hank Aaron; Babe Ruth; Willie Mays; Mickey Mantle; Ted Williams; Lou Gehrig; Joe DiMaggio; Ty Cobb;
Stan Musial; Jackie Robinson; Roberto Clemente; Sandy Koufax; Bob Gibson; Nolan Ryan; Tom Seaver; Johnny Bench;
Pete Rose; Reggie Jackson; Mike Schmidt; George Brett; Cal Ripken Jr.; Tony Gwynn; Rickey Henderson; Ozzie Smith;
Kirby Puckett; Ryne Sandberg; Wade Boggs; Don Mattingly; Dave Winfield; Eddie Murray; Paul Molitor; Robin Yount;
Carlton Fisk; Gary Carter; Andre Dawson; Ken Griffey Jr.; Barry Bonds; Frank Thomas; Greg Maddux; Tom Glavine;
John Smoltz; Randy Johnson; Pedro Martinez; Roger Clemens; Derek Jeter; Mariano Rivera; Alex Rodriguez; Chipper Jones;
Jim Thome; Ivan Rodriguez; Mike Piazza; Craig Biggio; Jeff Bagwell; Sammy Sosa; Mark McGwire; Albert Pujols;
Ichiro Suzuki; David Ortiz; Manny Ramirez; Vladimir Guerrero; Miguel Cabrera; Justin Verlander; Clayton Kershaw;
Max Scherzer; Zack Greinke; Joey Votto; Buster Posey; Mike Trout; Bryce Harper; Mookie Betts; Shohei Ohtani;
Aaron Judge; Freddie Freeman; Jose Altuve; Paul Goldschmidt; Nolan Arenado; Francisco Lindor; Juan Soto;
Ronald Acuna; Fernando Tatis Jr.; Vladimir Guerrero Jr.; Gerrit Cole; Jacob deGrom; Yu Darvish; Ernie Banks;
Yogi Berra; Whitey Ford; Warren Spahn; Willie McCovey; Harmon Killebrew; Al Kaline; Brooks Robinson; Frank Robinson;
Carl Yastrzemski; Rod Carew; Lou Brock; Willie Stargell; Jim Palmer; Steve Carlton; Fergie Jenkins; Gaylord Perry;
Phil Niekro; Bert Blyleven; Dennis Eckersley; Rollie Fingers; Goose Gossage; Trevor Hoffman; Lee Smith; Ozzie Guillen;
Omar Vizquel; Roberto Alomar; Barry Larkin; Larry Walker; Todd Helton; Edgar Martinez; Jim Rice; Dave Parker;
Dale Murphy; Don Sutton; Orel Hershiser; Dwight Gooden; Darryl Strawberry; Keith Hernandez; Gary Sheffield;
Fred McGriff; Andruw Jones; Scott Rolen; Joe Mauer; Adrian Beltre; Carlos Beltran; David Wright; Dustin Pedroia;
Yadier Molina; Felix Hernandez; CC Sabathia; Roy Halladay; Johan Santana; Tim Lincecum; Madison Bumgarner;
Jon Lester; Cole Hamels; Kris Bryant; Anthony Rizzo; Javier Baez; Corey Seager; Xander Bogaerts; Jose Abreu;
Carlos Correa; Yordan Alvarez; Julio Rodriguez; Bobby Witt Jr.; Elly De La Cruz; Gunnar Henderson; Zack Wheeler;
Ozzie Albies; Ken Griffey; Bobby Bonds; Honus Wagner; Cy Young; Walter Johnson; Christy Mathewson; Jimmie Foxx;
Rogers Hornsby; Mel Ott; Satchel Paige; Dizzy Dean; Hank Greenberg; Ralph Kiner; Duke Snider; Roy Campanella;
Eddie Mathews; Luis Aparicio; Juan Marichal; Orlando Cepeda; Tony Perez; Joe Morgan; Dave Concepcion; Jim Abbott;
Bo Jackson; Deion Sanders; Jose Canseco; Rafael Palmeiro; Kenny Lofton; Bernie Williams; Paul O'Neill;
Jorge Posada; Andy Pettitte; Nomar Garciaparra; Kevin Youkilis; Zack Greinke; Ubaldo Jimenez; Yoenis Cespedes;
Yasiel Puig; Ivan Nova; Ian Kinsler; Evan Longoria; Eric Hosmer; Nelson Cruz; Victor Martinez; Vernon Wells;
Quilvio Veras; Yogi Berra; Zoilo Versalles; Xavier Nady; Ugueth Urbina; Oscar Gamble; Noah Syndergaard`
  .split(';').map(s => s.trim()).filter(Boolean);

const nameOf = p => `${p[0]} ${p[1]}${p[3] ? ' ' + p[3] : ''}`;

export function makeBot(players, resolve, level) {
  const L = LEVELS[level] || LEVELS.medium;
  // Pool of names the computer "knows", grouped by first letter.
  const byLetter = new Map();
  const add = text => {
    const k = normalize(text)[0]?.toUpperCase();
    if (!k) return;
    if (!byLetter.has(k)) byLetter.set(k, new Set());
    byLetter.get(k).add(text);
  };
  STARS.forEach(add);
  for (const p of players) {
    if ((p[9] || 0) < L.minWar || (L.since && p[6] < L.since)) continue;
    add(nameOf(p));
  }
  const lists = new Map([...byLetter].map(([k, v]) => [k, [...v]]));
  const all = [...new Set(STARS.concat(...lists.values()))];

  const thinkMs = () => L.think[0] + Math.random() * (L.think[1] - L.think[0]);

  // What the computer says this turn: { text, pos } or null when it's stumped.
  function choose(s) {
    if (Math.random() < L.miss) return null;
    const letter = s.letter;
    const list = letter ? (lists.get(letter) || []) : all;
    // a random look through the list, like a person flipping through memory
    const order = list.map((t, i) => [Math.random(), i]).sort((a, b) => a[0] - b[0]).map(x => list[x[1]]);
    for (const text of order.slice(0, 400)) {
      const r = resolve(text, s.used);
      if (letter && (!r.first || r.first[0].toUpperCase() !== letter)) continue;
      if (r.status === 'ok') return { text };
      if (r.status === 'pick') {
        for (const [code] of POSITIONS) {
          const r2 = resolve(text, s.used, code);
          if (r2.status === 'ok') return { text, pos: code };
        }
      }
    }
    return null;
  }
  return { choose, thinkMs, label: L.label, size: all.length };
}
