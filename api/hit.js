// Vercel Function: telt unieke bezoekers.
//
// POST: de pagina meldt zich één keer per bezoek met een willekeurig id dat in
// de browser bewaard blijft. Geen cookies, geen IP-adressen. Redis telt de ids
// met een HyperLogLog (PFADD): een schatting op ongeveer 1% nauwkeurig, die
// per sleutel maar 12 kB inneemt, hoeveel bezoekers er ook zijn.
//
// GET: het aantal unieke bezoekers in totaal, vandaag, per dag en per uur
// (tijden in Nederlandse tijd).

import { redis, hasRedis, CORS } from "./_redis.js";

const DAYS = 14;          // zoveel dagen terug in het overzicht
const KEEP = 35 * 86400;  // dag- en uurtellingen blijven 35 dagen bewaard

// "2026-10-03" en "2026-10-03T16" in Nederlandse tijd
const parts = t => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
}).formatToParts(t).map(p => [p.type, p.value]));
const dayKey = t => { const p = parts(t); return `${p.year}-${p.month}-${p.day}`; };
const hourKey = t => { const p = parts(t); return `${p.year}-${p.month}-${p.day}T${p.hour}`; };

const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body, null, 2), {
    status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": cache },
  });

export async function POST(req) {
  if (!hasRedis) return json({ ok: false, error: "geen Redis" }, 503);
  const id = (await req.text()).trim();
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return json({ ok: false }, 400);
  const now = Date.now(), d = `lms:visitors:day:${dayKey(now)}`, h = `lms:visitors:hour:${hourKey(now)}`;
  try {
    await redis([
      ["PFADD", "lms:visitors:all", id],
      ["PFADD", d, id], ["EXPIRE", d, String(KEEP)],
      ["PFADD", h, id], ["EXPIRE", h, String(KEEP)],
    ]);
    return json({ ok: true });
  } catch (e) {
    console.error("hit:", e.message);
    return json({ ok: false }, 502);
  }
}

export async function GET() {
  if (!hasRedis) return json({ ok: false, error: "geen Redis" }, 503);
  const now = Date.now();
  const days = Array.from({ length: DAYS }, (_, i) => dayKey(now - i * 86400000));
  const hours = Array.from({ length: 24 }, (_, i) => hourKey(now - i * 3600000));
  try {
    const res = await redis([
      ["PFCOUNT", "lms:visitors:all"],
      ...days.map(k => ["PFCOUNT", `lms:visitors:day:${k}`]),
      ...hours.map(k => ["PFCOUNT", `lms:visitors:hour:${k}`]),
    ]);
    const perDay = Object.fromEntries(days.map((k, i) => [k, res[1 + i]]).filter(([, n]) => n > 0));
    const perHour = Object.fromEntries(hours.map((k, i) => [k.replace("T", " ") + ":00", res[1 + DAYS + i]]).filter(([, n]) => n > 0));
    return json({ ok: true, total: res[0], today: res[1], perDay, perHour }, 200, "public, max-age=0, s-maxage=60");
  } catch (e) {
    console.error("hit:", e.message);
    return json({ ok: false }, 502);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
