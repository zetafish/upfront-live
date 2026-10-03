// Vercel Function: geeft de live-stand van Upfront door met CORS-headers,
// zodat de pagina op GitHub Pages hem kan ophalen.
//
// Het CDN van Vercel bewaart het antwoord 10 s (s-maxage). Kijkers krijgen
// dan de kopie uit de cache en de functie draait hooguit zo'n 6 keer per
// minuut, hoeveel mensen er ook kijken.

const UPSTREAM = "https://event.upfront.nl/api/lms-live";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export async function GET() {
  try {
    const res = await fetch(UPSTREAM, { headers: { "User-Agent": "lms-live-proxy" } });
    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    return new Response(await res.text(), {
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=0, s-maxage=10, stale-while-revalidate=20",
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
