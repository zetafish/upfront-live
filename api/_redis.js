// Upstash Redis via REST, gedeeld door de functies in api/. Bestanden die met
// een _ beginnen, worden door Vercel niet als eigen endpoint gepubliceerd.

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const hasRedis = Boolean(URL && TOKEN);

// meerdere commando's in één request
export async function redis(cmds) {
  const res = await fetch(`${URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`redis HTTP ${res.status}`);
  return (await res.json()).map(r => {
    if (r.error) throw new Error(`redis: ${r.error}`);
    return r.result;
  });
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};
