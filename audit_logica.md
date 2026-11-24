# MRTFX Logica- en Architectuuraudit
Datum: 2026-07-13
Systeem: MRTFX — geautomatiseerde XAU/USD setup-alert bot (6-agent boardroom)

---

## 1. Agent-samenwerking

### Leest elke agent de output van de vorige agent?

De boardroom-flow in `agents/boardroom.js` is als volgt:

```
analyzeCandles (analyst)
  → parallel: assessRisk, challengeAnalysis, assessSentiment, assessGeopolitical
  → reviewDiscussion (analystRebuttal) — ontvangt: risk, devilsAdvocate, macro, geopolitical
  → decide (CEO) — ontvangt: analysis, risk, devilsAdvocate, macro, geopolitical, rebuttal
```

**Aandachtspunt:** De vier parallelle agents (riskManager, devilsAdvocate, macroAnalyst, geopoliticalAnalyst) worden gelijktijdig gestart met `Promise.all()` (boardroom.js:70–75). Zij ontvangen allemaal de eerste `analysis` van de analist, maar zij lezen elkaars output NIET. Dit is een bewuste architectuurkeuze (parallellisme), maar het betekent:

- De riskManager weet niet wat de pre-mortem-specialist gevonden heeft.
- De devilsAdvocate weet niet wat de macro-analist denkt.
- Dit is in ICT-termen verdedigbaar (mandaatscheiding), maar het is een stille aanname dat deze agents onafhankelijk beter werken. In de praktijk kan de DA een faalscenario missen dat de macro-analist al signaleert.

**Wat de CEO écht ontvangt:** De CEO-prompt (ceo.js:74–142) verwijst expliciet naar alle zes bronnen [A] t/m [F] met gewichten (35%/25%/20%/20%). De geopolitieke stem [E] wordt conditioneel ingesloten (ceo.js:91–98): alleen als `geopolitical && geopolitical.confidence > 0`. Als er geen nieuws is, retourneert `geopoliticalAnalyst.js` `{ confidence: 0 }` en valt [E] volledig weg uit de CEO-prompt. De CEO weet dan niet expliciet dat er géén geo-context beschikbaar was — hij mist gewoon agent [E]. Dit is een stille afwezigheid, geen expliciete melding.

**Aandachtspunt (geopolitical zonder sellTheNewsRisk):** `NO_NEWS_RESULT` in `geopoliticalAnalyst.js:45–50` bevat geen `sellTheNewsRisk`-veld. Het tool-schema definieert dit als required. Als de boardroom op `geopolitical.sellTheNewsRisk` probeert te lezen bij geen nieuws, is het `undefined`. In `boardroomReporter.js:79` wordt dit gecheckt met `&& geopolitical.sellTheNewsRisk !== 'n.v.t.'`, wat `undefined !== 'n.v.t.'` evalueert als `true` — waarna de lege string `''` wordt weergegeven. Geen crash, maar inconsistent schema.

---

## 2. Data-flow gaps en undefined-risico's

### `discussion`-structuur na boardroom

Na `runDiscussion` (boardroom.js:93) is de structuur:
```js
discussion = { analyst, riskManager, devilsAdvocate, macro, geopolitical, analystRebuttal }
```

**Kritiek — `riskManager.entryZone` veld:**
- De CEO-prompt (ceo.js:79) leest `risk.entryZone ?? 'niet opgegeven'`.
- Het risk-tool schema (riskManager.js:11) definieert `entryZone` als required.
- Als de LLM het veld om welke reden dan ook weglaat, is `risk.entryZone` undefined → de CEO-prompt toont "niet opgegeven" maar de CEO-beslissing bevat dan ook `entryZone: undefined` (het tool-schema DECISION_TOOL heeft `entryZone` als required voor het CEO-output).
- Als de CEO dan ook `entryZone: undefined` teruggeeft, schrijft `formatDecisionBody` (boardroomReporter.js:28) `decision.entryZone ? ...` — conditie is false, entryLine = ''. Geen crash, maar de entry-zone ontbreekt in de Discord-melding zonder waarschuwing.

**Kritiek — `analystRebuttal` bevat geen `setupQualityScore`:**
- De `REBUTTAL_TOOL` (analyst.js:31–45) heeft geen `setupQualityScore` in het schema.
- De analist kan in het weerwoord de setup-kwaliteitsscore mentaal verhogen of verlagen, maar dit wordt niet gestructureerd vastgelegd.
- `isComboSignal` (agentAnalysis.js:54–59) leest uitsluitend `sample.discussion.analyst.setupQualityScore` (de initiële score), niet de score na het weerwoord. Als de analist in het weerwoord erkent dat criterium ④ wegvalt, heeft dit GEEN effect op de combo-classificatie.

**Aandachtspunt — `geopolitical` in `reviewDiscussion`:**
- `reviewDiscussion` (analyst.js:160–222) ontvangt `geopolitical = null` als default.
- Als geopolitical confidence = 0, wordt het conditioneel ingesloten (analyst.js:192–195) maar `geopolitical` is dan alsnog een object met `confidence: 0`, niet `null`.
- De conditie is `geopolitical && geopolitical.confidence > 0` — correct, maar subtiel: als `newsItems` leeg is, geeft `assessGeopolitical` een object terug dat `confidence: 0` heeft, en de conditie is correct false. Dit werkt.

**Aandachtspunt — `sma20H1` en `atr14` in `sample`:**
- boardroom.js:102 pakt `indicators.sma20` voor `sma20H1` in het sample.
- `computeIndicators` (indicators.js:103–114) berekent `sma20` met `sma(closes, 20)`.
- De `sma`-functie (indicators.js:1–5) gebruikt `Math.min(period, values.length)` — als er minder dan 20 candles zijn, rekent het met minder punten. Dit geeft een te hoge waarde bij weinig data. In de praktijk worden 50 H1-candles opgehaald, dus dit is zelden een probleem maar er is geen guard.

---

## 3. Logische inconsistenties

### `isComboSignal`-definitie vs CEO-besluit

`isComboSignal` (agentAnalysis.js:54–59) is gedefinieerd als:
```js
classifyRebuttalShift(sample) === 'omhoog' && analyst.setupQualityScore >= 5
```

**Kritiek — combo-signaal ontkoppeld van CEO-zekerheid:**
- Het is mogelijk dat de analist omhoog gaat in zekerheid (rebuttal shift omhoog) EN setupQualityScore ≥ 5, maar de CEO toch neutraal beslist (bijv. omdat de macro tegenvalt).
- Als `decision.signal === 'neutral'`, is er feitelijk geen "combo". Maar `isComboSignal` kijkt niet naar `decision.signal`.
- In `boardroomReporter.js:21–25` wordt `formatSetupMarker` gecheckt: als signaal neutral is, wordt "💤 Geen actie" getoond ongeacht comboSignal. Dus in de Discord-weergave is er geen probleem — maar in de opgeslagen data kan een record `comboSignal: true` hebben terwijl `decision.signal === 'neutral'`. Als je later backtestet op combo-signalen, worden neutrale CEO-besluiten meegerekend.

**Aandachtspunt — combo-signaal passeert niet de kwaliteitsfilter-check:**
- `assessSignalQuality` (agentAnalysis.js:66–137) heeft RR > 3.0 als blocker. Een combo-signaal met RR > 3.0 heeft `qualityResult.passed = false` — en krijgt dan géén combo-melding (boardroomReporter.js:50: `if (!qualityResult.passed) return null`). Dit gedrag is correct maar is nergens expliciet gedocumenteerd als intentie.

### `assessSignalQuality`-filters vs analist/CEO-claims

**Aandachtspunt — dubbele drempel op CEO-confidence:**
- De CEO-prompt (ceo.js:129) stelt: "Minimaal 65% zekerheid vereist voor directioneel signaal — onder 65% altijd neutraal."
- `assessSignalQuality` (agentAnalysis.js:73) blokkeert bij `confidence < 65`.
- Als de CEO tóch een directioneel signaal geeft met 64% zekerheid (wat kan als de LLM de instructie negeert), blokkeert de filter correct. Maar de `signalValidator.js:58` waarschuwt al bij `confidence < 60` (niet 65). Er is een gat: een signaal met 62% confidence passeert de validator maar wordt geblokkeerd door de kwaliteitsfilter. De validator rapporteert het als valide, maar het wordt geblokkeerd. Dit is verwarrend in de /health-output.

**Aandachtspunt — counter-trend blocker inconsistent met CEO-prompt:**
- CEO-prompt (ceo.js:137–141): "COUNTER-TREND STOP: als W1 EN D1 beide dezelfde richting wijzen én het signaal is tegengesteld → maximaal 55% zekerheid."
- `assessSignalQuality` (agentAnalysis.js:99–110): blokkeert counter-trend signalen volledig als `dailyTrend === weeklyTrend` en signaal is tegengesteld.
- Maar `assessSignalQuality` leest `sample.dailyTrend` en `sample.weeklyTrend` die berekend worden via `d1Ctx?.trend` en `w1Ctx?.trend` (boardroom.js:98–99).
- `computeDailyContext` (dailyContext.js:26) en `computeWeeklyContext` (weeklyContext.js:14) berekenen `trend` via `computeTimeframeBias` — een kwantitatieve berekening (SMA20 + RSI + candle-structuur, meerderheidsstem).
- De CEO-prompt beschrijft "als W1 en D1 beide dezelfde richting wijzen" als een hogere conceptuele beoordeling die de CEO zelf maakt. De `assessSignalQuality`-blocker gebruikt echter de algoritmische berekening, niet de CEO's eigen beoordeling. Als de CEO zegt "D1 is bullish" maar de algoritmische `d1Ctx.trend` is "bearish" (vanwege SMA/RSI-meerderheid), dan blokkert de filter terwijl de CEO het niet doet.

**Kritiek — `conditionChecker.js` vs analistprompt bij sessie-definitie:**
- `conditionChecker.js:8–11` definieert actieve sessie als 13:00–17:00 UTC.
- De analist-prompt (analyst.js:121–123) stelt: "⑥ KILL ZONE TIMING: we bevinden ons in de NY Kill Zone (13:00–17:00 UTC). Onze sessie-filter start op 13:00 UTC — London Kill Zone (07:00–10:00) valt hier buiten en wordt nooit bereikt."
- `sessionContext.js:38–42` definieert de "NY Kill Zone" echter als 12:00–15:00 UTC (niet 13:00–17:00), en "London Close" als 15:00–17:00 UTC.
- De condition-checker staat triggers toe van 13:00–17:00 UTC, maar de sessionContext meldt aan agents dat 15:00–17:00 UTC "London Close" is met "matige" betrouwbaarheid en mogelijke reversals. Dit zijn twee overlappende maar inconsistente definities van het "goede venster":
  - Condition-checker: 13:00–17:00 = groen
  - SessionContext: 15:00–17:00 = "matige betrouwbaarheid, posities worden gesloten, reversals mogelijk"
  - Analist-prompt: noemt 13:00–17:00 als NY Kill Zone, maar `sessionContext.js` zegt 12:00–15:00
- **De analist-prompt bevat een fout:** het stelt dat de NY Kill Zone 13:00–17:00 is, terwijl `sessionContext.js` dit als 12:00–15:00 definieert. Dit zijn twee bronnen die de agent informeren over hetzelfde concept, maar ze zijn inconsistent.

### `conditionChecker.js`: W1-trendfilter vs D1-gebruik

- `computeTrendBias` (multiTimeframeAlignment.js:60–64) negeert D1 volledig: het gebruikt alleen W1. De functie ontvangt wel `d1Candles` als parameter maar slaat die op.
- `conditionChecker.js:56` roept `computeTrendBias(d1Candles, w1Candles)` aan, maar de functie body gebruikt `w1Candles` alleen.
- Dit is gedocumenteerd als intentie (multiTimeframeAlignment.js:54–58: "D1 mag in retracement/correctie zitten"), maar de parameter `d1Candles` is misleidend: de naam suggereert dat D1 meeweegt, maar het doet dat niet.
- **Ontbreekt:** als je ooit de D1 wilt meewegen in de trendfilter, is de hook er (parameter bestaat), maar de implementatie doet niets met die data. Er is geen comment die aangeeft dat dit bewust leeg gelaten is voor toekomstig gebruik.

---

## 4. Blinde vlekken in outcome-tracking

### Entry-zone verificatie

**Kritiek — entry-zone wordt NIET geverifieerd voor TP/SL-evaluatie.**

`evaluateOutcome` (outcomeEvaluator.js:15–33) checkt alleen of `c.low <= stopLoss` (SL hit) of `c.high >= takeProfit` (TP hit). Het verifieert NIET of de prijs eerst de entry-zone bereikt heeft.

Dit betekent:
- Een signaal met entry-zone "$3100–$3108" waarbij de prijs op dat moment op $3120 staat en nooit naar $3100 terugkeert, maar TP op $3150 bereikt terwijl SL op $3080 zit → het systeem registreert "TP" maar de trade was nooit ingegaan.
- Dit is een **stille aanname**: het systeem gaat ervan uit dat de entry-zone altijd bereikt wordt, of dat de huidige prijs al in de entry-zone zit.
- De riskManager-prompt (riskManager.js:68–71) instrueert expliciet om bij te late entry een "wacht op pullback"-advies te geven, maar dit heeft geen technisch effect op de outcome-evaluatie.
- **Effect op backtest-betrouwbaarheid:** winrates zijn mogelijk te hoog omdat trades worden meegeteld die in werkelijkheid nooit ingegaan zouden zijn.

**Aanverwante stille aanname:** `evaluateSignalOutcome` (performanceTracker.js:28–30) gebruikt `horizonCandles[0].close` als "huidige prijs" voor de sanity-check. Dit is de eerste candle ná het signaal-timestamp, niet de entry-prijs zelf. Als er een grote gap is in de eerste candle, kan de sanity-check incorrect zijn.

### `entryPrice` in boardroom vs werkelijke entry

- `boardroom.js:92`: `entryPrice = candles[candles.length - 1].close` — dit is de slotkoers van de laatste H1-candle op het moment van het signaal.
- Dit is NIET de entry-zone die de riskManager adviseert. De riskManager geeft een zone (bijv. "$3100–$3108") terwijl `entryPrice` de actuele marktprijs is ($3120).
- `classifyRiskReward` (agentAnalysis.js:41–49) berekent R:R op basis van `entryPrice` (slotkoers) vs SL/TP, niet op basis van de entry-zone.
- Als de riskManager adviseert te wachten op een pullback naar $3100 terwijl de prijs op $3120 staat, en TP is $3150, dan rekent `classifyRiskReward` R:R = ($3150-$3120)/($3120-$3080) = 30/40 = 0.75. Dit is te laag en triggert de RR <1.5 blocker. Maar als de trade correct op $3105 ingegaan zou zijn, is R:R = 45/25 = 1.8. **De R:R-berekening is dus gebaseerd op de verkeerde prijs.**

### Andere stille aannames in `outcomeEvaluator.js`

1. **OHLC-volgorde onbekend:** Gedocumenteerd (outcomeEvaluator.js:21–23) — SL telt conservatief als SL en TP in dezelfde candle vallen. Dit is een bewuste keuze maar overschat verliezen bij vluchtige candles.
2. **Geen spreads:** Geen rekening met bid/ask spread. Bij XAU/USD zijn spreads $0.30–$1.00; SL-niveaus die $0.5 ATR van entry zitten kunnen door de spread eerder geraakt worden.
3. **HORIZON_CANDLES = 48:** Precies 48 H1-candles = 48 uur kalendertime, maar `filterFlatCandles` filtert weekend-candles eruit. 48 "echte" H1-candles beslaan soms 3+ kalenderdagen. Dit is ongedocumenteerd maar gunstig (evalueert over een langere werkelijke periode).

---

## 5. FTMO-guard logica

### Risk-pct-berekening

**Aandachtspunt — RISK_PCT klopt niet voor prop-firm context:**
- `ftmoGuard.js:5`: `RISK_PCT = { klein: 0.5, normaal: 1.0, groot: 2.0 }`.
- `pnlForSignal` (ftmoGuard.js:19–31) berekent PnL als `risk * rr` voor TP en `-risk` voor SL.
- Dit simuleert het risico als percentage van account en is conceptueel correct.
- Maar: de berekening gebruikt `Math.abs(decision.takeProfit - entryPrice)` en `Math.abs(entryPrice - decision.stopLoss)` als reward/risk. Als `entryPrice` de slotkoers is (niet de werkelijke entry), is deze R:R-berekening dezelfde fout als bij `classifyRiskReward` hierboven.
- **Kritiek:** FTMO-drawdown berekening meet cumulatieve PnL, niet maximale intra-trade drawdown. Als een trade van SL $80 naar TP $160 loopt maar tijdelijk $120 drawdown bereikt, registreert FTMO het als TP. Dit is niet hoe FTMO de werkelijke equity-drawdown berekent.

### Welke signaaltypen tellen mee voor FTMO?

- `getAllSignals()` retourneert ALLE signalen inclusief neutrale, geblokkeerde en 'onbruikbare'.
- `pnlForSignal` (ftmoGuard.js:19–31) retourneert `null` als `outcome` ontbreekt of niet `tp`/`sl` is → wordt overgeslagen.
- Neutrale CEO-besluiten (signal = 'neutral') krijgen `outcome.result = 'neutraal'` → `pnlForSignal` retourneert null → tellen niet mee. **Correct.**
- Geblokkeerde signalen (qualityResult.passed = false) worden wel opgeslagen als volledige records en worden geëvalueerd op TP/SL. Als een geblokkeerd signaal toch TP of SL bereikt, **telt het mee in de FTMO-statistieken**. Dit is problematisch: een geblokkeerd signaal zou nooit in productie gehandeld zijn, maar beïnvloedt wel de FTMO-risk-meting. De comment in performanceTracker.js:6 erkent dit ("gefilterd* notatie"), maar de FTMO-guard maakt geen onderscheid.

---

## 6. Heartbeat / health / diagnostics

### Wat rapporteert `/health`?

`/health` (bot.js:296–348) rapporteert op basis van de laatste 20 signalen:
- Structurele validiteit (schema-check via signalValidator.js)
- Signaalverdeling (passed / geblokkeerd / neutraal)
- Setup-kwaliteitsscore verdeling
- Meest actieve kwaliteitsfilters (blockers)

**Wat `/health` NIET laat zien maar relevant is:**
1. **Cooldown-status:** `/health` toont niet of het systeem momenteel in cooldown zit (lastSignalTime) of wanneer de volgende trigger mogelijk is. Dit is alleen zichtbaar via `/status` (maar `/status` toont ook geen cooldown-tijd).
2. **FTMO-status:** Geen risico-overzicht in `/health`. Afzonderlijk commando `/ftmo` is nodig.
3. **Spike-cooldown:** De aparte spike-cooldown (`lastSpikeTime`) is nergens via Discord opvraagbaar.
4. **Boardroom-foutpercentage:** Als een boardroom-run crasht (bijv. API-timeout), wordt het gelogd in console maar niet in signals.json en dus niet zichtbaar in `/health`.
5. **Macro-briefing vervalstatus:** `/health` toont niet of de macro-briefing bijna vervalt (7 dagen na instelling). Alleen `/status` toont dit.
6. **Gecachede candle-kwaliteit:** Er is geen indicator of de gecachede D1/W1-candles vers zijn of van gisteren. Bij Railway-restarts wordt de cache (als die in-memory zit) geleegd.

**Aandachtspunt — signalValidator inconsistentie:**
- `signalValidator.js:58`: blokkeert bij `confidence < 60` als error-check.
- Maar de kwaliteitsfilter blokkeert bij `confidence < 65`.
- `/health` kan dus "✅ Alle signalen structureel valide" melden terwijl er signalen zijn met 62% confidence die geblokkeerd zijn door de kwaliteitsfilter. Valide en geblokkeerd tegelijkertijd — verwarrend.

---

## 7. Cooldown-logica

### Wanneer wordt `lastSignalTime` gezet?

In `scheduler.js:83`: `lastSignalTime = Date.now()` wordt gezet **direct na `conditions.triggered`**, VOORDAT de boardroom wordt uitgevoerd en VOORDAT bekeken wordt of het signaal gefilterd wordt of neutraal is.

**Kritiek — cooldown wordt altijd gezet bij condition-trigger, ook bij neutraal/gefilterd signaal:**
- Als de boardroom wordt gestart en de CEO besluit neutraal (geen setup), wordt `lastSignalTime` al gezet (regel 83) en geldt de 4-uur cooldown.
- Als een signaal geblokkeerd wordt door `assessSignalQuality` (kwaliteitsfilter), geldt de cooldown ook.
- De cooldown blokkeert dus een potentieel goed signaal 4 uur later, ook als de eerste trigger resulteerde in "geen actie".

**Is dat de juiste keuze?**
Er zijn twee valide perspectieven:
- PRO (huidige keuze): als de condities eenmaal triggeren, zijn ze waarschijnlijk nog steeds actief de komende uren. Een direct vervolgend signaal is waarschijnlijk redundant.
- CON: als de CEO neutraal beslist (bijv. ATR te laag), maar een uur later de ATR-conditie verandert en een nieuwe trigger optreedt, wil je wél een nieuwe analyse.

Dit is een stille ontwerpkeuze die niet gedocumenteerd is als bewuste keuze.

**Aandachtspunt — spike-cooldown is onafhankelijk maar interacteert met condition-cooldown:**
- Als een spike-trigger viert op t=0 (lastSpikeTime = t), en een condition-trigger viert op t=1u (lastSignalTime = t+1u), dan is de spike-cooldown (2u) actief tot t=2u maar de condition-cooldown (4u) actief tot t=5u.
- Dit is correct: de twee paden zijn onafhankelijk van elkaar (spike kan vuren terwijl condition-cooldown actief is, en vice versa). Maar er is geen documentatie of het écht de bedoeling is dat beide paden tegelijkertijd actief kunnen zijn (twee boardroom-runs binnen 4 uur).

---

## 8. Sessie-filter consistentie

### Live scheduler vs backtest

**Kritiek — drie inconsistente sessie-definities in het systeem:**

| Bron | NY-sessie definitie |
|---|---|
| `conditionChecker.js:isActiveSession` | 13:00–17:00 UTC |
| `sessionContext.js:SESSIONS` | NY Kill Zone: 12:00–15:00 UTC; London Close: 15:00–17:00 UTC |
| Analist-prompt (analyst.js:121) | "NY Kill Zone (13:00–17:00 UTC)" |

De live scheduler gebruikt `isActiveSession` (13:00–17:00 UTC). De agents ontvangen via `sessionContext.js` de boodschap dat de NY Kill Zone eindigt om 15:00 UTC en 15:00–17:00 UTC "London Close" is (met lagere betrouwbaarheid). De analist-prompt spreekt van "NY Kill Zone 13:00–17:00 UTC" wat niet overeenkomt met `sessionContext.js`.

**Tijdzone-aanname:** Alle berekeningen gebruiken UTC (`getUTCHours()`). Dit is consistent. Er zijn geen CEST/CET-aannames in de code. De documentatie in MEMORY.md vermeldt dat de gebruiker in Europe/Amsterdam zit — dit heeft geen invloed op de bot-logica maar is relevant voor manuele interpretatie van de UTC-tijden in Discord-meldingen.

**Backtest vs live discrepantie:** Als de backtest-logica ergens sessie-uren gebruikt (niet zichtbaar in de geauditeerde bestanden), moet die dezelfde 13:00–17:00 UTC definitie gebruiken als `conditionChecker.js`. Dit kon niet geverifieerd worden zonder de backtest-bestanden.

---

## 9. Wat ontbreekt dat vanzelfsprekend zou zijn

### A. Maandag-filter wordt niet gecheckt in de scheduler-hoofdloop
**Kritiek:** `isActiveDay()` (conditionChecker.js:16–18) bestaat en blokkeert maandag. Maar `scheduler.js` roept dit NIET aan. Alleen `bot.js:status-command` (bot.js:157) laat het zien in de UI. De condition-checker zelf (`checkConditions`) checkt ook geen dag. De maandag-blokkade bestaat als functie maar is dood code in de trigger-logica.

Ter verificatie: `checkConditions` (conditionChecker.js:31–89) checkt sessie, TF-alignment, trendfilter, richting-consistentie. Geen dag-check. In `scheduler.js:poll()` staat geen `isActiveDay()`-call. **Maandag-signalen worden niet geblokkeerd in de live scheduler.**

### B. Geen graceful degradation bij API-timeout in boardroom
Als één agent (bijv. `assessRisk`) een API-timeout krijgt (60 seconde timeout ingesteld), crasht `Promise.all()` en crasht de hele boardroom. De catch in `scheduler.js:135–138` logt de fout en stuurt een Discord-alert, maar het signaal-window is dan voorbij. Er is geen retry-logica of fallback voor individuele agent-failures.

### C. Geen staleness-check op gecachede marktdata
Uit `scheduler.js:52–58`: D1 en W1 worden via `getRecentXauD1Candles` en `getRecentXauW1Candles` opgehaald (opgeslagen caching-mechanisme buiten de geauditeerde bestanden). Als de cache oud is en de marktdatadienst (Twelve Data) niet beschikbaar is, kunnen de agents werken met dagenlange D1/W1-data. Er is geen timestamp-check op de verse-heid van de gecachede candles.

### D. Geen position-tracking (open trades)
Het systeem weet niet of een eerder signaal nog actief is (in de markt open staat). Als de trader zowel signaal #5 als signaal #6 volgt, maar signaal #5 nog open staat wanneer #6 binnenkomt, worden de FTMO-risicoberekeningen gecumuleerd zonder dat het systeem weet dat er al een risicoblootstelling is. Dit is een fundamentele beperking voor prop-firm gebruik.

### E. Geen validatie van SL < TP voor bearish signalen
`signalValidator.js:62–68` checkt `bullish && SL >= entryPrice` en `bearish && SL <= entryPrice`. Maar het checkt NIET of de richting van SL en TP logisch consistent zijn met elkaar (bijv. `bearish && TP >= SL`). Als de CEO per ongeluk SL en TP omdraait, wordt dit niet gedetecteerd.

### F. CEO-weighting noemt geopolitiek als 20% maar het is conditioneel
De CEO-prompt (ceo.js:119): "Geopolitiek + Timing [E]: 20%". Maar als er geen nieuws is, is agent [E] compleet afwezig. De 20% wordt dan niet herverdeeld over de andere agents. Dit is een stille weging-inconsistentie: bij geen nieuws is de effectieve weging van [A+F] + [D] + [C] meer dan 80%.

### G. Geen logging van welk pad (condition vs spike) de boardroom triggerde
`appendSignal` (store.js:22–26) slaat het boardroom-resultaat op zonder te loggen of het een condition-trigger of een spike-trigger was. Dit maakt het onmogelijk om achteraf te analyseren of spike-triggered boardrooms beter presteren dan condition-triggered boardrooms.

### H. `/performance` gebruikt alle signalen inclusief pre-filter data
`bot.js:418`: `const all = await getAllSignals()` en filtert daarna op `outcome`. Er is geen scheiding tussen: (1) gefilterde signalen die niet geadviseerd werden en (2) signalen die wel geadviseerd werden. De winrate die `/performance` toont, is een mix van beide. De `/performance`-output toont `qualityResult`-labels in de outcome-melding (`formatOutcomeMessage`), maar de aggregaat-statistieken tellen alles mee.

---

## Samenvatting per categorie

### Kritiek

| # | Bevinding | Bestand + Regel |
|---|---|---|
| K1 | Entry-zone wordt NIET geverifieerd vóór TP/SL-evaluatie — winrate overschat | `outcomeEvaluator.js:15–33`, `performanceTracker.js:19–44` |
| K2 | `isComboSignal` kijkt niet naar `decision.signal` — neutrale CEO-besluiten kunnen `comboSignal: true` hebben in opgeslagen data | `agentAnalysis.js:54–59` |
| K3 | Sessie-definitie is inconsistent: `conditionChecker.js` (13:00–17:00) vs `sessionContext.js` (NY Kill Zone 12:00–15:00) vs analist-prompt (13:00–17:00) | `conditionChecker.js:8`, `sessionContext.js:38`, `analyst.js:121` |
| K4 | Maandag-filter (`isActiveDay`) bestaat maar wordt nooit aangeroepen in de scheduler — maandag-triggers zijn NIET geblokkeerd | `conditionChecker.js:16`, `scheduler.js` (ontbrekende call) |
| K5 | R:R-berekening gebruikt `entryPrice` (slotkoers) i.p.v. entry-zone prijs — R:R kan sterk afwijken van werkelijk | `agentAnalysis.js:41–49`, `ftmoGuard.js:25–28` |
| K6 | Geblokkeerde signalen tellen mee in FTMO-statistieken alsof ze gehandeld zijn | `ftmoGuard.js:49–61`, `performanceTracker.js` |

### Aandachtspunt

| # | Bevinding | Bestand + Regel |
|---|---|---|
| A1 | `NO_NEWS_RESULT` mist `sellTheNewsRisk`-veld dat het tool-schema als required definieert | `geopoliticalAnalyst.js:45–50` |
| A2 | `analystRebuttal` bevat geen `setupQualityScore` — score-wijziging in weerwoord heeft geen effect op combo-classificatie | `analyst.js:31–45`, `agentAnalysis.js:54–59` |
| A3 | Signalvalidator blokkert bij confidence < 60 maar kwaliteitsfilter blokkeert bij < 65 — inconsistente drempels, `/health` kan "valide" melden voor geblokkeerde signalen | `signalValidator.js:58`, `agentAnalysis.js:73` |
| A4 | Cooldown (4u) wordt gezet bij condition-trigger vóór boardroom-run — neutrale/geblokkeerde resultaten blokkeren wel 4 uur cooldown | `scheduler.js:83` |
| A5 | CEO-gewichten (totaal 100%) zijn feitelijk <80% als geo-agent wegvalt bij geen nieuws — ongedocumenteerd | `ceo.js:112–119` |
| A6 | `computeTrendBias` ontvangt `d1Candles` als parameter maar gebruikt die niet — misleidende signatuur | `multiTimeframeAlignment.js:60–64` |
| A7 | Twee parallelle boardroom-runs mogelijk (spike + condition) binnen 4 uur | `scheduler.js:105`, `SPIKE_COOLDOWN_MS` |

### Ontbreekt

| # | Bevinding |
|---|---|
| O1 | Geen verificatie dat de entry-zone bereikt werd voor TP/SL-evaluatie |
| O2 | Geen logging van trigger-type (condition vs spike) in opgeslagen signalen |
| O3 | `/health` toont geen cooldown-status, FTMO-status of spike-cooldown |
| O4 | Geen position-tracking — systeem weet niet of er al open risico is |
| O5 | Geen SL < TP (voor bearish) consistentiecheck in signalValidator |
| O6 | Geen staleness-check op gecachede D1/W1-candles |
| O7 | `/performance` aggregeert gefilterde en ongefilterde signalen zonder scheiding |
| O8 | Geen retry-logica bij individuele agent API-timeout in boardroom |

---

*Einde audit — gegenereerd op 2026-07-13*
