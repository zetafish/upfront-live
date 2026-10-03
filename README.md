# Last Man Standing Live

Live stand van [Last Man Standing](https://event.upfront.nl/lms-live) op Terschelling, met:
- wie er echt nog in de race zit (de officiële teller telt uitgevallen lopers mee)
- hoe ver iedere loper in de huidige ronde is
- een kaart van het parcours en het hele klassement

Hoe ver iemand is, wordt berekend uit de GPS-positie, geprojecteerd op het parcours.

## Hoe het werkt

```
GitHub Pages (index.html) ──fetch──▶ Vercel: api/lms-live.js ──▶ event.upfront.nl/api/lms-live
                                      (CDN-cache 10 s)
```

De API van Upfront stuurt geen CORS-headers mee, dus een browser mag hem niet rechtstreeks ophalen vanaf een andere site. Een kleine Vercel-functie geeft het antwoord door met CORS-headers. Het CDN van Vercel bewaart het 10 seconden, dus de functie draait hooguit zo'n 6 keer per minuut, hoeveel mensen er ook kijken. Alle berekeningen gebeuren in de pagina zelf.

Op het gratis Hobby-plan van Vercel hoef je geen betaalgegevens op te geven. Elke kijker telt als edge request (1 miljoen per maand gratis). De pagina ververst elke 15 s, en niet als het tabblad op de achtergrond staat.

## Lokaal draaien

```sh
bb server.bb      # http://localhost:8787
```

`server.bb` serveert de pagina en geeft de API door met CORS-headers, net als de Vercel-functie. Op `localhost` gebruikt de pagina automatisch deze server.

`bb lms.bb` toont de stand in de terminal (`--all` laat ook uitgevallen lopers zien).

## Publiceren

1. **De repo op GitHub zetten** en onder *Settings → Pages* de bron *Deploy from a branch* kiezen, met `main` / root.

2. **Vercel koppelen:** log in op [vercel.com](https://vercel.com) met je GitHub-account, kies *Add New → Project* en importeer deze repo. Je hoeft niets in te stellen: Vercel vindt `api/lms-live.js` zelf. Elke push naar `main` deployt opnieuw.

   Liever vanaf de command line:
   ```sh
   npx vercel login
   npx vercel --prod
   ```

3. **De URL in de pagina zetten:** Vercel geeft je project een adres, bijvoorbeeld `https://upfront-live.vercel.app`. Komt dat niet overeen met `VERCEL_URL` in `index.html`, pas het daar aan en push opnieuw.

De pagina werkt ook rechtstreeks op het Vercel-adres; daar gebruikt hij de functie op hetzelfde domein.

## Bronnen

- Data: [event.upfront.nl/lms-live](https://event.upfront.nl/lms-live)
- Kaart: [PDOK](https://www.pdok.nl), BRT-achtergrondkaart © Kadaster, luchtfoto © Beeldmateriaal Nederland
