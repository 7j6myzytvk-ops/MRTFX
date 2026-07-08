# Beslisplan 3 juli — MRTFX interventie-keuze

**Doel:** Op 3 juli de data lezen, binnen 30 minuten de interventieroute bepalen,
en maandag 6 juli direct met implementatie beginnen.

---

## Stap 1 — Data ophalen (3 juli, ~15 min)

Voer in Discord achtereenvolgens uit:

```
/diagnose     → welke conditie blokkeert het meest (% per conditie)
/health       → hoeveel signalen zijn doorgekomen + gemiddelde kwaliteitsscores
/geschiedenis → lees de wél doorgekomen signalen: waren de besluiten sterk of vaag?
```

Noteer:
- **A.** Aantal triggers in 6 dagen (ATR-fix was 27 juni → effectieve periode 27 juni–3 juli)
- **B.** Welke conditie staat bovenaan in `/diagnose` (meest geblokkeerd)
- **C.** Hoeveel van de doorgelaten signalen werden geblokkeerd door `assessSignalQuality`
- **D.** Kwaliteit van de CEO-reasoning in `/geschiedenis`: concreet en scherp, of vaag en generiek?

---

## Stap 2 — Beslisboom

### Vraag 1: Hoeveel triggers waren er? (punt A)

**< 3 triggers in 6 dagen** → conditionChecker is het knelpunt → ga naar **Vraag 2**

**≥ 3 triggers** → conditionChecker werkt → ga naar **Vraag 3**

---

### Vraag 2: Welke conditie blokkeert het meest? (punt B)

Bekijk `/diagnose`-output. Kijk welke conditie in >50% van de geblokkeerde
polls als blocker verschijnt.

| Diagnose-uitkomst | Route |
|---|---|
| `nearLevel` blokkeert het meest (>50%) | **→ Optie 1** |
| `tfAligned` of `trendAligned` blokkeert het meest | **→ Optie 2** |
| Meerdere condities elk ~25–35% | **→ Optie 1 + Optie 2 gecombineerd** |
| Sessiefilter blokkeert (buiten 08–17 UTC) | **→ Optie 2 (uitbreiding sessievenster)** |

---

### Vraag 3: Wat houdt de doorgelaten signalen tegen? (punt C + D)

**C: `assessSignalQuality` blokkeert >50% van de triggers:**

| Blocker die het vaakst voorkomt | Route |
|---|---|
| `setup-kwaliteit te laag (X/6 criteria)` | **→ Optie 3** |
| `macro contraireert de richting` | **→ Optie 4** |
| `analist verloor vertrouwen na discussie` | **→ Optie 4** |

**D: Signalen komen wél door, maar CEO-reasoning is vaag/generiek:**
→ **Optie 4** (agents missen specialisatiediepte)

---

## De vier opties — exact wat er maandag 6 juli gebeurt

---

### Optie 1 — `nearLevel` optioneel maken (lichtste ingreep)

**Bestand:** `services/conditionChecker.js`

**Wijziging:** `nearLevel` wordt geen harde blocker meer, maar een zachte voorkeur.
Triggered = session + tfAlignment + trendBias + directionConsistency allemaal groen.
`nearLevel` wordt alleen nog als context meegegeven aan agents.

Regel 53–56 (huidige code):
```js
const nearLevel = checkKeyLevelProximity(h1Candles, w1Candles);
if (!nearLevel.near) {
  blockers.push('prijs niet nabij een sleutelniveau');
}
```

Vervangen door:
```js
const nearLevel = checkKeyLevelProximity(h1Candles, w1Candles);
// nearLevel is een kwaliteitssignaal, geen harde poort — agents wegen dit zelf mee
```

Regel 58 — geen wijziging nodig (triggered = blockers.length === 0 blijft correct).

**Extra:** In `formatConditionContext()` regel 87: voeg toe of `nearLevel.near` true/false
is zodat agents het expliciet meekrijgen.

**Test vóór live:** `node scripts/test-conditionDiagnostics.js` + handmatige Discord-check
met `/analyse` op een moment dat markt open is.

**Verwacht effect:** meer triggers per dag (nearLevel blokkeerde ~50% van de polls in
historische data), agents beoordelen zelf of niveau sterk genoeg is via setupQualityScore.

---

### Optie 2 — Sessievenster uitbreiden naar Asian Kill Zone + pre-London

**Bestand:** `services/conditionChecker.js` + `agents/agentAnalysis.js`

**Stap 1 — sessievenster:**
Regel 9 (huidige code):
```js
return hour >= 8 && hour < 17;
```
Vervangen door:
```js
// 06:00–08:00 UTC = Asian Kill Zone / pre-London (hogere drempel vereist)
// 08:00–17:00 UTC = London + NY overlap (normaal venster)
return hour >= 6 && hour < 17;
```

**Stap 2 — hogere kwaliteitsdrempel voor vroege uren:**
In `agents/agentAnalysis.js`, `assessSignalQuality()`: voeg een extra blocker toe:
```js
// Vroege sessie (06:00–08:00 UTC): setupQualityScore ≥ 4 vereist (i.p.v. ≥ 3)
const sessionHour = sample.sessionHour; // moet meegegeven worden vanuit scheduler
if (sessionHour !== undefined && sessionHour < 8 && (setupScore ?? 6) < 4) {
  blockers.push('vroege sessie: setup-kwaliteit minimaal 4/6 vereist');
}
```

**Opmerking:** `sessionHour` moet als extra veld worden doorgegeven vanuit `scheduler.js`
aan het sample-object. Dit is een kleine uitbreiding (~3 regels in scheduler.js).

**Test vóór live:** backfill met `scripts/backfillConditions.js` op de vroege uren
(06:00–08:00 UTC) om te zien hoeveel extra triggers dit oplevert.

**Verwacht effect:** extra 2 uur window per dag, maar alleen de sterkste setups passeren.

---

### Optie 3 — setupQualityScore drempel verlagen van 3 naar 2

**Bestand:** `agents/agentAnalysis.js`

**Wijziging:**
Regel 89 (huidige code):
```js
if (setupScore !== undefined && setupScore !== null && setupScore < 3) {
  blockers.push(`setup-kwaliteit te laag (${setupScore}/6 criteria aanwezig)`);
}
```

Vervangen door:
```js
if (setupScore !== undefined && setupScore !== null && setupScore < 2) {
  blockers.push(`setup-kwaliteit te laag (${setupScore}/6 criteria aanwezig)`);
}
```

**Test vóór live:** `node scripts/test-agentAnalysis.js` — er zijn al tests die
`setupQualityScore`-drempels raken; controleer dat deze nog kloppen na de wijziging.

**Verwacht effect:** signalen met 2/6 criteria worden niet meer tegengehouden.
Let op: dit is een echte versoepeling van kwaliteitsdrempel — alleen kiezen als
de data aantoont dat score=2 niet de slechte uitkomsten voorspelt.

---

### Optie 4 — Prompt-verdieping agents (zwaarste ingreep)

Gebaseerd op `CONCEPT-agent-verdieping.md`. Implementeer in deze volgorde:

**Fase A — schema-velden (makkelijkst te valideren, start hier):**

1. `agents/analyst.js` — voeg `invalidationLevel: number` toe aan JSON-schema
   en vraag in de prompt om het exacte prijs-niveau te noemen waarop de setup ongeldig is.

2. `services/signalValidator.js` — voeg validatie toe voor `invalidationLevel`:
   moet een getal zijn, ≠ 0, logisch t.o.v. richting (bullish → invalidationLevel < entryPrice).

**Fase B — vrije-tekst uitbreidingen (na A getest):**

3. `agents/macroAnalyst.js` — voeg toe aan prompt: vraag om expliciet één historisch
   analogon te benoemen ("dit lijkt op [periode/event], omdat [...], maar wijkt af doordat [...]").

4. `agents/geopoliticalAnalyst.js` — voeg toe aan prompt: vraag bij elke keyEvent
   een decay-score te geven: `vers` / `deels verwerkt` / `grotendeels ingeprijsd`.

5. `agents/analyst.js` — voeg toe aan STRUCTUURANALYSE: classificeer in welke AMD-fase
   (Accumulation / Manipulation / Distribution) de sessie zich bevindt, en of de
   judas swing al heeft plaatsgevonden vóór de beoogde entry.

6. `agents/riskManager.js` — voeg toe: verlaag positiegrootte bij open posities
   die het weekend in zouden gaan (vrijdag na 16:00 UTC) en bij hoge ATR/news events
   een spread-buffer van minimaal 3 pip op SL/TP.

**Test per fase:** Na Fase A eerst `node scripts/test-*.js` volledig groen krijgen
vóór Fase B te starten. Prompt-wijzigingen worden getest via `/analyse`-commando
in Discord met een live chart als input.

**Verwacht effect:** substantieel scherpere reasoning per agent, met name bij
edge-case setups waar de huidige agents generiek antwoorden.

---

## Combinaties die toegestaan zijn

Als de data op 3 juli ambigu is (bv. zowel conditionChecker als agent-kwaliteit
zijn matig), dan is dit de veilige volgorde:

1. Eerst Optie 1 (één regel wijzigen, makkelijk terug te draaien)
2. Na 3–4 dagen meten of dat genoeg was
3. Daarna eventueel Optie 3 of 4 toevoegen

**Nooit tegelijk** Optie 1 + 2 + 3 doorvoeren — dan kun je niet meer meten
welke wijziging het verschil maakte.

---

## Checklist voor maandag 6 juli (startmoment implementatie)

- [ ] `/diagnose` gelezen en beslisboom doorlopen
- [ ] Interventieroute gekozen (één van de vier opties)
- [ ] Bestaande tests draaien en groen (`node scripts/test-*.js`)
- [ ] Wijziging implementeren
- [ ] Nieuwe/aangepaste tests schrijven
- [ ] Deploy naar Railway
- [ ] `/health` en `/diagnose` in Discord bevestigen dat systeem draait
- [ ] Eerste live trigger monitoren via Discord

---

*Dit document is een beslishulp, geen vaststaand plan. Als de data op 3 juli
iets anders laat zien dan verwacht, past de route zich aan de data aan.*
