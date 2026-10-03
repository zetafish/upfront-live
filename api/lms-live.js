// Vercel Function: geeft de live-stand van Upfront door met CORS-headers,
// zodat de pagina op GitHub Pages hem kan ophalen.
//
// Het CDN van Vercel bewaart het antwoord 10 s (s-maxage). Kijkers krijgen
// dan de kopie uit de cache en de functie draait hooguit zo'n 6 keer per
// minuut, hoeveel mensen er ook kijken.
//
// Bij elke run houdt de functie in Redis (Upstash) per ronde bij wie er op
// het parcours gezien is en sinds wanneer iemand in de zone bij start/finish
// staat. Die geschiedenis gaat mee als `history`, zodat iedere bezoeker
// dezelfde indeling ziet. Zonder Redis werkt alles gewoon, zonder `history`.

import { MID, buildSegs, project, makeLapOf, lapInfo, onCourse } from "../lib/course.js";
import { redis, hasRedis, CORS } from "./_redis.js";

const UPSTREAM = "https://event.upfront.nl/api/lms-live";
const TTL = 3 * 3600;          // geschiedenis van een ronde blijft 3 uur bewaard
const GAP = 5 * 60 * 1000;     // langer niet gekeken: geschiedenis onvolledig

let SEGS = null, SEGS_KEY = null;

const toObj = flat => {
  const o = {};
  for (let i = 0; i < (flat?.length ?? 0); i += 2) o[flat[i]] = flat[i + 1];
  return o;
};

async function history(d, now) {
  const lap = d.currentLap, lapStart = Date.parse(d.currentLapStartedAt);
  const elapsed = (now - lapStart) / 1000, lapM = d.course.distance;
  const key = d.course.points.length + ":" + lapM;
  if (SEGS_KEY !== key) { SEGS = buildSegs(d.course.points); SEGS_KEY = key; }
  const lapOf = makeLapOf(Date.parse(d.eventStart));
  const k = `lms:${d.eventId}:${lap}`;

  const [leftArr, zoneFlat, metaFlat, maxFlat] = await redis([
    ["SMEMBERS", `${k}:left`], ["HGETALL", `${k}:zone`], ["HGETALL", `${k}:meta`], ["HGETALL", `${k}:max`],
  ]);
  const left = new Set(leftArr), zone = toObj(zoneFlat), meta = toObj(metaFlat), max = toObj(maxFlat);

  // waar is iedereen die aan deze ronde bezig kan zijn?
  const newLeft = [], newZone = [], leftZone = [], newMax = [];
  for (const r of d.runners) {
    if (r.status !== 1 || r.lat == null) continue;
    const { laps, avg } = lapInfo(r, lap, lapOf);
    if (laps !== lap - 1) continue;                       // al binnen, of eruit
    const { along, off } = project(SEGS, r.lat, r.lng, Math.min(lapM, lapM * elapsed / avg));
    const mid = along >= MID && along <= lapM - MID;
    const seen = onCourse(along, off, lapM, r.lastPingAt != null ? Date.parse(r.lastPingAt) : null, lapStart);
    if (seen && !left.has(r.bib)) { newLeft.push(r.bib); left.add(r.bib); }
    if (seen && zone[r.bib]) { leftZone.push(r.bib); delete zone[r.bib]; }
    // verste punt van deze ronde: wie omdraait, komt nooit bij de laatste kilometers
    if (seen && along > Number(max[r.bib] ?? 0) + 50) { max[r.bib] = String(Math.round(along)); newMax.push(r.bib, max[r.bib]); }
    if (!mid && !zone[r.bib]) { newZone.push(r.bib); zone[r.bib] = String(now); }
  }

  const since = meta.since != null ? Number(meta.since) : elapsed;
  const last = meta.last != null ? Number(meta.last) : null;
  const gap = meta.gap === "1" || (last != null && now - last > GAP);

  const writes = [];
  if (meta.since == null) writes.push(["HSET", `${k}:meta`, "since", String(elapsed)]);
  if (gap && meta.gap !== "1") writes.push(["HSET", `${k}:meta`, "gap", "1"]);
  if (last == null || now - last > 60000) writes.push(["HSET", `${k}:meta`, "last", String(now)]);
  if (newLeft.length) writes.push(["SADD", `${k}:left`, ...newLeft]);
  if (leftZone.length) writes.push(["HDEL", `${k}:zone`, ...leftZone]);
  for (const bib of newZone) writes.push(["HSETNX", `${k}:zone`, bib, String(now)]);
  if (newMax.length) writes.push(["HSET", `${k}:max`, ...newMax], ["EXPIRE", `${k}:max`, String(TTL)]);
  if (meta.since == null) for (const s of ["left", "zone", "meta"]) writes.push(["EXPIRE", `${k}:${s}`, String(TTL)]);
  if (writes.length) await redis(writes);

  return {
    lap, since, gap, left: [...left],
    zone: Object.fromEntries(Object.entries(zone).map(([b, t]) => [b, Number(t)])),
    max: Object.fromEntries(Object.entries(max).map(([b, m]) => [b, Number(m)])),
  };
}

// ?ping: voor een cron-dienst die de geschiedenis bijhoudt als niemand kijkt.
// Zelfde werk, maar een klein antwoord en niet uit de cache.
export async function GET(req) {
  const ping = new URL(req.url).searchParams.has("ping");
  try {
    const res = await fetch(UPSTREAM, { headers: { "User-Agent": "lms-live-proxy" } });
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    const d = await res.json();
    // status van de geschiedenis in een header: ok, off (geen Redis) of error
    let hs = hasRedis ? "skip" : "off";
    if (hasRedis && d.ok && d.started && !d.finished) {
      try { d.history = await history(d, Date.now()); hs = "ok"; }
      catch (e) { hs = "error"; console.error("history:", e.message); }   // zonder geschiedenis verder
    }
    if (ping) return new Response(JSON.stringify({ ok: true, history: hs, lap: d.currentLap }), {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store", "X-LMS-History": hs },
    });
    return new Response(JSON.stringify(d), {
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=20",
        "X-LMS-History": hs,
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message ?? e) }), {
      status: 502,
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
