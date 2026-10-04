# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Onofficiële live-stand van de backyard ultra *Last Man Standing* (Upfront, Terschelling): wie zit er echt nog in de race en hoe ver is iedereen in de huidige ronde. Alle UI-tekst, code-commentaar en commitberichten zijn in het Nederlands.

## Commando's

Er is geen build, geen dependencies en geen testsuite.

```sh
bb server.clj          # dev-server op http://localhost:8787 (pagina + /lib + /api/lms-live)
bb lms.clj [--all]     # stand in de terminal (--all: ook uitgevallen lopers)
pkill -f 'bb server.clj'
```

`server.clj` haalt de data via de Vercel-functie, met de Redis-geschiedenis, zodat de indeling lokaal gelijk is aan online. Met `UPSTREAM=https://event.upfront.nl/api/lms-live bb server.clj` haalt hij de data rechtstreeks bij Upfront, zonder geschiedenis.

Controleren na een wijziging:
- **Syntax van de pagina:**
  ```sh
  awk '/<script type="module">/{p=1;next} /<\/script>/{p=0} p' index.html > /tmp/m.mjs && node --check /tmp/m.mjs
  ```
- **Functies:** `node --check api/*.js`.
- **Indeling testen op live data:** knip `enrich()` uit `index.html` (vanaf `let SEGS = null` tot het einde van `function enrich`), zet er een import van `lib/course.js` boven, en draai het in Node op `https://upfront-live.vercel.app/api/lms-live`. Bouw de trail uit `d.history` op als `{ lap, since, gap, left: new Set(h.left), zone: h.zone, max: h.max }`, of geef `null` mee om de terugval zonder geschiedenis te testen.
- **Visueel:**
  ```sh
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot --window-size=1300,700 --virtual-time-budget=8000 http://localhost:8787/
  ```

## Architectuur

```
GitHub Pages / upfront-live.vercel.app (index.html)
   └─ fetch elke 15 s ─▶ Vercel api/lms-live.js (fra1, CDN s-maxage=10) ─▶ event.upfront.nl/api/lms-live
                              └─ Upstash Redis: geschiedenis per ronde
```

- **`index.html`:** de hele app in één bestand: CSS, HTML en `<script type="module">`. `enrich(d, now, trail)` zet de ruwe API-data om in een toestand per loper. Daarna tekenen de `render*`-functies de samenvatting, de strook "Waar is het veld", de Leaflet-kaart (alleen PDOK-tegels; OSM en CARTO blokkeren), "Uitval per ronde", de lijst "Lopers" en het detailvenster. `DATA_URL` kiest localhost, een relatief pad (op `.vercel.app`) of `VERCEL_URL`.
- **`lib/course.js`:** gedeelde rekenregels, gebruikt door de pagina en door de functies:
  - `project()`: GPS → afstand langs het parcours, met keuze tussen kandidaten op basis van de verwachte positie;
  - `makeLapOf()`: bij welke ronde hoort een finishtijd;
  - `lapInfo()`: rondes, gecorrigeerd voor gemiste doorkomsten;
  - `onCourse()`: is een positie geloofwaardig bewijs van vertrek;
  - `MID` = 150 m, `LAP_M` = 6706 m (officieel).
- **`api/lms-live.js`:** proxy met CORS. Voegt `history` toe uit Redis, maar alleen als de race bezig is. De `X-LMS-History`-header zegt `ok`, `off`, `skip` of `error`. `?ping` doet hetzelfde werk maar geeft een klein antwoord, zonder cache; dat is voor de externe cron (cron-job.org, elke minuut), zodat de geschiedenis ook zonder kijkers doorloopt.
- **`api/hit.js`:** unieke bezoekers met HyperLogLog. POST met een willekeurig id uit de browser; GET geeft het overzicht. `api/_redis.js` bevat de gedeelde Upstash-REST-client; een `_` voor de naam betekent geen eigen endpoint. De env-vars zijn `KV_REST_API_URL`/`KV_REST_API_TOKEN`, met als terugval `UPSTASH_REDIS_REST_*`.
- **`lms.clj`:** een eigen Clojure-versie van dezelfde regels, zonder geschiedenis. Die wordt **niet** automatisch gedeeld: pas hem met de hand mee aan.

## Domeinregels (de lastige kant)

**Gebreken van de Upfront-API:**
- `inRace` en `status` lopen uren achter.
- `laps` telt geregistreerde doorkomsten, en de tijdwaarneming mist er soms een.
- Na een gemiste doorkomst kan `seconds` meerdere uren beslaan.
- `speedKmh` is onbetrouwbaar.
- Per loper is er alleen de laatste GPS-positie, zonder spoor.

**Rondes:** `lapOf(finishedAt)` = het uur van de finish, behalve in de eerste 30 min van een uur: dan is het een te late finish van de ronde ervoor. Voor lopers met status 1 geldt `laps = max(api laps, laatste lapOf)`. Een tijd boven 3600 s is fout, behalve in de laatste ronde van iemand die eruit ligt. Uit = `laps < currentLap - 1`.

**Start en finish zijn hetzelfde punt.** Daardoor lijkt "bijna binnen" op "nooit vertrokken". Toestanden in `enrich`: `done`, `running`, `start`, `camp`, `unknown`, `out`, `dns`.
- **`camp`** betekent "niet vertrokken" (RTC) of, met `back`, "teruggekeerd na X km".
- **"Niet vertrokken"** geldt 5 min na de start voor wie deze ronde niet op het parcours gezien is. Bewijs daarvoor:
  - de ronde is zonder gaten gevolgd;
  - de loper staat langer dan 3 min in de zone;
  - de laatste ping is oud (van voor de rondestart, of meer dan 5 min);
  - het is te vroeg voor een finish op eigen tempo;
  - de loper staat meer dan 50 m naast het parcours.
- **"Teruggekeerd"** betekent: wel vertrokken, maar nooit voorbij 1,5 km voor de finish gekomen, en al 3 min terug in de zone.

**Geschiedenis in Redis**, per ronde `lms:{eventId}:{lap}:…`, met een TTL van 3 uur:
- `left`: set van wie gezien is;
- `zone`: bib → sinds wanneer bij start/finish;
- `max`: verste punt;
- `meta`: `since`, `last`, `gap`.

Meer dan 5 min niet gekeken betekent `gap`; dan gelden de regels die volledig volgen vereisen niet. De browser heeft een eigen terugval-trail in localStorage.

**Kilometers** zijn officieel: rondes × 6,706 km. De GPS-route (`course.distance`, ~6,59 km) dient alleen voor de positie in de ronde.

Verander je een indelingsregel, pas dan ook de tekst in het dialoogvenster "Hoe we rekenen" (`<dialog id="how">`) en `lms.clj` aan.

## Publiceren

Elke push naar `main` deployt naar Vercel (Hobby: maximaal 100 deployments per dag) en naar GitHub Pages. Open pagina's tonen dan een melding dat er een nieuwe versie is; er is geen auto-reload. `.vercelignore` sluit `*.clj` en `README.md` uit.
