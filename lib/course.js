// Gedeelde rekenregels voor de pagina (index.html) en de Vercel-functie
// (api/lms-live.js): positie op het parcours en rondes per loper.

// Zone rond start/finish (m): daarbuiten is een loper zeker onderweg.
export const MID = 150;

// Officiële rondeafstand van een backyard ultra: 4,167 mijl, zodat 24 rondes
// precies 100 mijl zijn. De GPS-route in de data is korter (ongeveer 6,59 km,
// GPS snijdt bochten af); die gebruiken we alleen voor de positie in de ronde.
export const LAP_M = 6706;

const KX = 111320 * Math.cos(53.37 * Math.PI / 180), KY = 110540;
const xy = (lat, lng) => [lng * KX, lat * KY];

export function buildSegs(points) {
  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    segs.push({ a: xy(a.lat, a.lng), b: xy(b.lat, b.lng), d0: a.dist, d1: b.dist });
  }
  return segs;
}

// Positie langs het parcours. Waar parcoursdelen dicht bij elkaar liggen
// (zoals start en finish) kiezen we de kandidaat die het best past bij waar de
// loper op basis van zijn tempo zou moeten zijn.
export function project(segs, lat, lng, expected) {
  const [px, py] = xy(lat, lng);
  const cs = segs.map(({ a: [ax, ay], b: [bx, by], d0, d1 }) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return { along: d0 + t * (d1 - d0), off: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) };
  });
  const best = Math.min(...cs.map(c => c.off));
  const near = cs.filter(c => c.off <= best + 25);
  const pick = near.reduce((p, c) => Math.abs(c.along - expected) < Math.abs(p.along - expected) ? c : p);
  return { along: pick.along, off: best };
}

// Bij welke ronde hoort een finish? Het uur waarin hij valt, behalve in de
// eerste 30 min: dan is het een te late finish van de ronde ervoor (de snelste
// ronde ooit duurt ruim 32 min). Zo tellen we ook rondes mee waarvan de
// tijdwaarneming de doorkomst gemist heeft.
export function makeLapOf(eventStart) {
  return at => {
    const e = Date.parse(at) - eventStart, h = Math.floor(e / 3600000) + 1;
    return (e % 3600000) < 1800000 ? h - 1 : h;
  };
}

// Rondes van één loper, gecorrigeerd voor gemiste doorkomsten en foute tijden.
export function lapInfo(r, cur, lapOf) {
  let prev = 0;
  const n = (r.lapTimes || []).length;
  const lastLap = n ? lapOf(r.lapTimes[n - 1].finishedAt) : 0;
  const stillIn = r.status === 1 && lastLap >= cur - 1;
  const lapDetail = (r.lapTimes || []).map((t, i) => {
    const lap = lapOf(t.finishedAt), gap = lap - prev > 1;
    prev = lap;
    // Wie na deze ronde nog een ronde liep, finishte binnen het uur. Een tijd
    // boven de 60:00 is dan fout: na een gemiste doorkomst telt de API soms
    // door vanaf een eerdere doorkomst. Alleen de laatste ronde van iemand die
    // eruit ligt, mag te laat zijn.
    const bad = t.seconds > 3600 && (i < n - 1 || stillIn);
    return { lap, s: bad ? null : t.seconds, pace: bad ? null : t.paceSecPerKm, at: t.finishedAt, gap };
  });
  const missed = [];
  for (let k = 1, seen = new Set(lapDetail.map(t => t.lap)); k <= prev; k++) if (!seen.has(k)) missed.push(k);
  // nog in de race: de laatste finish bepaalt het aantal rondes (wie verder
  // is, heeft de gemiste rondes ook gelopen); uitgevallen: de API volgen
  const laps = r.status === 1 ? Math.max(r.laps, prev) : r.laps;
  const times = lapDetail.filter(t => t.s != null).map(t => t.s);
  const valid = times.filter(s => s <= 3600);
  const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 3000;
  return { lapDetail, missed, laps, times, avg };
}
