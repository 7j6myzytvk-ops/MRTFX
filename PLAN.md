# MRTFX Roadmap

Multi-agent analyse- en signalenserver voor XAU/USD, met Discord als interface.

## Fase 0 - Project skeleton (klaar)
- Discord bot met `/status` command
- `services/marketData.js`: live prijzen en candles via de Twelve Data API
  (oorspronkelijk opgezet met OANDA, maar OANDA Europe/TMS Brokers-accounts
  ondersteunen de v20 REST API niet - vervangen door een losse marktdata-provider;
  de bot blijft voor nu adviserend en handelt niet zelf)

## Fase 1 - Data-laag (klaar)
- JSON-opslag voor gegenereerde signalen/analyses (`data/signals.json`)
- Basis voor latere geschiedenis- en performance-tracking

## Fase 2 - Eerste micro-agent (klaar)
- `agents/analyst.js`: stuurt candle-data naar Claude, krijgt een gestructureerd
  signaal terug (bullish/bearish/neutral + zekerheid + onderbouwing)
- Resultaten worden gelogd via de data-laag

## Fase 3 - Discord-integratie (klaar)
- `/analyse`: haalt live candles op en laat de agent ze beoordelen
- `/geschiedenis`: toont de laatst gelogde signalen

## Fase 4 - Multi-agent orchestratie (klaar)
- `agents/riskManager.js`: tweede agent, geeft stop-loss/take-profit/positiegrootte-advies
- `agents/orchestrator.js`: combineert analyse-agent + risicobeheer-agent tot één
  samengesteld signaal en logt dit via de data-laag

## Fase 5 - Automatische signalering (klaar)
- `services/scheduler.js`: periodieke check (standaard elk uur) die proactief naar een
  Discord-kanaal post via `DISCORD_SIGNAL_CHANNEL_ID`

## Fase 7 - Multi-agent boardroom (klaar)
- Het team is uitgebreid van 2 naar 5 agents die onderling discussiëren voordat er een
  besluit valt:
  1. `agents/analyst.js` - eerste technische analyse
  2. `agents/riskManager.js`, `agents/devilsAdvocate.js`, `agents/macroAnalyst.js` -
     reageren parallel (risico-advies, tegenargument, marktsentiment)
  3. `agents/analyst.js` (`reviewDiscussion`) - weerwoord na de discussie
  4. `agents/ceo.js` - definitief besluit (signaal, SL/TP, positiegrootte), kan afwijken
     van de analist
- `agents/boardroom.js` orchestreert deze stappen en logt het volledige resultaat
  (`{ discussion, decision }`) via `data/store.js`
- `services/boardroomReporter.js` post elke stap van de discussie naar
  `DISCORD_TRACE_CHANNEL_ID` en het CEO-besluit naar `DISCORD_CEO_CHANNEL_ID`
- `services/scheduler.js` en `/analyse` draaien nu de volledige boardroom

## Fase 6 - Backtesting (historisch) (klaar)
- `scripts/backtest.js`: steekproef-aanpak (elke H1-candle backtesten is te duur qua
  Claude-calls) - haalt historische candles op via `getXauUsdCandles({ from, to })`
  en hergebruikt de live boardroom-logica (`agents/boardroom.js`'s `runDiscussion`)
  per sample, zonder `data/signals.json` te vervuilen
  - `LOOKBACK = 50` candles als input (zelfde als live `/analyse`), `HORIZON = 48`
    candles (~2 dagen) om de uitkomst te bepalen, `SAMPLE_STEP = 24` candles
    (~1x per dag)
  - Filtert synthetische weekend-candles eruit vóór het vensteren: Twelve Data vult
    vrijdagavond-zondagavond op met platte placeholder-candles (H-L < 1.0 i.p.v.
    normaal 10-40), die anders lookback- en horizon-vensters vervuilen
  - Per sample wordt het CEO-besluit afgezet tegen de horizon-candles: SL- of
    TP-hit (bij gelijktijdige hit telt SL, conservatief), of `geen`/`neutraal`
  - Retry per sample (max 3 pogingen) + incrementele opslag naar
    `data/backtests.json`, zodat een trage/mislukte Claude-call niet de hele run
    laat crashen
- Resultaten en agent-analyse van de steekproef: zie Fase 9 voor de actuele
  geaggregeerde cijfers en de analyse van welke agent-inbreng het meest
  samenhangt met TP- vs SL-uitkomsten. Details per sample in `data/backtests.json`
  (gitignored, runtime-gegenereerd)

## Fase 8 - Live performance-tracking (klaar)
- Sluit de cirkel voor live signalen: elk record in `data/signals.json` (via `/analyse`
  of de uurlijkse scheduler) krijgt periodiek een `outcome` op basis van de
  daadwerkelijke prijsbeweging die volgde.
- `agents/outcomeEvaluator.js` (nieuw, shared module): `evaluateOutcome`,
  `summarize`, `filterFlatCandles` en `HORIZON_CANDLES = 48` zijn uit
  `scripts/backtest.js` geëxtraheerd, zodat backtesting en live tracking exact
  dezelfde SL/TP-hit-logica gebruiken (SL telt bij gelijktijdige hit, conservatief).
- `services/performanceTracker.js` - `evaluateOpenSignals()`:
  - Pakt alle signalen zonder `outcome` of met `outcome.result === 'open'`. Niets te
    doen? Dan geen marktdata-call (geen onnodig API-verbruik).
  - Eén bulk-fetch van H1-candles vanaf het oudste open signaal t/m nu, gefilterd op
    synthetische candles.
  - Per signaal: candles ná `signal.timestamp` als horizon, gescand op SL/TP-hit
    (`tp`/`sl`, met `resolvedAt`), `geen` (volle horizon zonder hit), `open`
    (horizon nog niet compleet) of `neutraal` (bij een `neutral`-besluit).
  - **Sanity-check prijsschaal**: wijkt het midpoint van SL/TP meer dan 30% af van de
    actuele candle-prijs, dan `onbruikbaar` (vangt pre-Twelve-Data-migratie
    mock-signalen generiek op, zonder op record-id te filteren).
  - Resultaat wordt via `data/store.js`'s nieuwe `updateSignalOutcome(id, outcome)`
    teruggeschreven (zelfde schrijf-queue-patroon als `appendSignal`).
- `services/scheduler.js` roept `evaluateOpenSignals()` elke tick aan, na
  `reportToDiscord`, binnen de bestaande try/catch.
- Discord: `/geschiedenis` toont per signaal een outcome-indicator (✅ TP / ❌ SL /
  ➖ geen/neutraal / ⚠️ onbruikbaar / ⏳ open); nieuw commando `/performance` toont een
  samenvatting (afgeronde trades, TP/SL/geen, winRate, gem. zekerheid) plus
  tellingen voor open/neutraal/onbruikbaar.
- Gevalideerd: 7 unit-tests (`scripts/test-performanceTracker.js`, alle paden:
  tp/sl/geen/open/neutraal/onbruikbaar) + dry run tegen de echte
  `data/signals.json` (9 records: #1-4 en #8 - pre-migratie mock-prijzen ~2400 -
  correct `onbruikbaar`; #5/#7 -> `sl` na een echte pullback-candle; #6/#9 -> `open`)
  + live scheduler-tick (2x, signalen #10 en #11 meteen correct als `open` gelogd).

## Fase 9 - Grotere backtest-steekproef + agent-analyse (klaar)
- `scripts/backtest.js` logt per sample nu ook `entryPrice` (candle-close op het
  moment van het besluit) en de volledige `discussion` (analist, risicomanager,
  Devil's Advocate, marktcontext, weerwoord) - nodig om te onderzoeken welke
  agent-inbreng samenhangt met TP- vs SL-uitkomsten.
- `agents/agentAnalysis.js` (nieuw, pure/testbaar): classificeert elk sample met
  discussion-data op 6 dimensies en groepeert via `breakdown(samples, classifyFn,
  labelOrder)` (herbruikt `summarize()` uit Fase 8 per groep):
  - Devil's Advocate eens/oneens met het eindbesluit
  - Marktcontext-alignment (sentiment vs. besluitrichting): aligned/contrarian/neutraal
  - Zekerheidsverschuiving van de analist na het weerwoord: omlaag/gelijk/omhoog
  - CEO volgt eerste analyse of wijkt af
  - CEO-zekerheid in buckets: <60% / 60-70% / >70%
  - Risk/reward-ratio in buckets: <1.5 / 1.5-2.5 / >2.5
  Samples zonder `discussion` (van vóór Fase 9) worden voor deze breakdowns
  overgeslagen, maar tellen wel mee in het algemene overzicht.
- `scripts/analyzeBacktests.js` (nieuw) - CLI-rapport: algemeen overzicht, subset
  met discussion-data, en de 6 breakdowns, met disclaimer over kleine N per groep.
- Gevalideerd: 25 unit-tests (`scripts/test-agentAnalysis.js`).
- Steekproef vergroot met een extra run (28 nieuwe samples met discussion-data,
  1 mei - 11 juni 2026): totaal **47 samples** (16 TP / 30 SL / 1 geen) ->
  **winRate 34%** (gem. zekerheid TP 69%, SL 66%). Van de 31 samples met
  discussion-data: winRate 32,3% (10 TP / 21 SL).
- **Bevindingen agent-analyse** (indicatief, N per groep tussen 3 en 21 - geen
  statistische significantie):
  - Devil's Advocate, marktcontext-alignment en CEO-volggedrag tonen **geen
    variatie**: in alle 31 samples is de Devil's Advocate het "oneens" met het
    besluit, sluit de marktcontext aan ("aligned") en volgt de CEO de eerste
    analyse. Deze drie dimensies zijn met de huidige data niet onderscheidend - de
    agents zijn opvallend consistent met elkaar.
  - **Sterkste signaal - zekerheidsverschuiving na weerwoord**: zakt de zekerheid
    van de analist na het horen van het tegenargument/marktcontext (`omlaag`,
    N=13), dan winRate **7,7%** (1 TP / 12 SL). Stijgt de zekerheid juist (`omhoog`,
    N=18), dan winRate **50%** (9 TP / 9 SL). Een dalende zekerheid na het weerwoord
    hangt dus sterk samen met een SL-uitkomst - het meest bruikbare signaal uit deze
    steekproef.
  - **Risk/reward-ratio**: lagere ratio's (`<1.5`, N=10) winnen vaker (50%) dan
    hogere (`1.5-2.5`, N=16 -> 25%; `>2.5`, N=5 -> 20%) - logisch (een dichterbij
    take-profit wordt makkelijker geraakt), maar zegt op zichzelf niets over de
    verwachte waarde per trade.
  - **CEO-zekerheid**: niet monotoon - `60-70%` (N=21) presteert het best (38,1%),
    `>70%` (N=7) lager (28,6%), `<60%` (N=3) het slechtst (0%, maar zeer kleine N).
  - **Beperking van deze steekproef**: 27 van de 28 nieuwe samples zijn bearish
    (mei-juni 2026 was een dalende markt voor XAU/USD) - er is dus vrijwel geen data
    over bullish signalen. Conclusies gelden vooralsnog vooral voor bearish setups.
- Details per sample (incl. volledige discussie) in `data/backtests.json`
  (gitignored, runtime-gegenereerd, 5 records / 47 samples).

## Fase 10 - Actuele marktcontext (`newsContext`) + bugfix synthetische candles in live paden (klaar)

### `newsContext`: actueel nieuws meegeven aan het team
- `agents/boardroom.js`'s `runDiscussion(candles, { instrument, granularity,
  newsContext })` neemt een optionele `newsContext`-string (standaard `''`) en
  geeft die door als onderdeel van `opts` aan **alle 6 agent-gesprekken**
  (analyse, risicomanager, Devil's Advocate, marktcontext, weerwoord, CEO-besluit)
  - dezelfde aanpak als de bestaande `events` (economische kalender).
- Elke agent krijgt, als `newsContext` is opgegeven, een eigen toegespitste
  instructie om de meegegeven tekst als **bevestigd feit** te behandelen
  (in afwijking van de standaardinstructie om geen onbevestigd nieuws te claimen):
  - **analist**: kan het nieuws gebruiken om de recente prijsbeweging te verklaren.
  - **risicomanager**: houdt rekening met verhoogde volatiliteit bij SL/TP en
    positiegrootte.
  - **Devil's Advocate**: overweegt expliciet of de markt al "sell the news" heeft
    gespeeld, of dat het nieuws nog niet (volledig) in de prijs is verwerkt.
  - **marktcontext-analist**: beoordeelt of het sentiment en het koersgedrag in de
    candles met het nieuws overeenkomen.
  - **analist (weerwoord)**: weegt het nieuws mee in het al-dan-niet aanpassen van
    zekerheid/signaal na de discussie.
  - **CEO**: weegt het nieuws expliciet mee in het einbesluit.
- `/analyse` heeft een nieuwe optionele `context`-parameter
  (`SlashCommandBuilder().addStringOption(...)`) waarmee een gebruiker live
  marktcontext kan meegeven; die wordt 1-op-1 doorgegeven als `newsContext`.
- `scripts/analyseNow.js` (nieuw): CLI-variant -
  `node scripts/analyseNow.js "<contexttekst>"` - haalt live candles op, draait de
  boardroom met `newsContext`, en post de trace/CEO-berichten naar Discord (zelfde
  REST-aanpak als `scripts/test-boardroom.js`).

### Bugfix: synthetische weekend-candles vervuilden live analyses
- **Probleem ontdekt tijdens een live `/analyse`-achtige run** (via
  `scripts/analyseNow.js`) met de Trump/Iran-context: de Devil's Advocate
  signaleerde zelf dat ~33 van de 50 opgehaalde H1-candles een "microscopische
  bandbreedte van ~0,26 dollar" hadden - een teken van bevroren/synthetische
  prijzen.
- **Oorzaak**: `getXauUsdCandles({ granularity: 'H1', count: 50 })` haalt de
  laatste 50 candles op zonder de `filterFlatCandles`-stap (zie
  `agents/outcomeEvaluator.js`) die `scripts/backtest.js` en
  `services/performanceTracker.js` al wel toepassen. Twelve Data vult
  weekend-gaten (vrijdagavond - zondagavond) op met platte placeholder-candles
  (`high - low < FLAT_RANGE_THRESHOLD`). Vlak na een weekend bestond het
  analyse-venster van 50 candles daardoor voor **64% (32/50)** uit deze
  placeholders, en spande het venster maar 3 kalenderdagen (13-15 juni) i.p.v. ~2
  dagen aan echte marktbeweging.
- **Fix**: nieuwe `getRecentRealCandles({ granularity = 'H1', count = 50 })` in
  `services/marketData.js` - haalt `count + 70` ruwe candles op, filtert de platte
  candles eruit, en geeft de laatste `count` echte candles terug. `discord/bot.js`
  (`/analyse`), `services/scheduler.js` (periodieke tick) en
  `scripts/analyseNow.js` gebruiken nu allemaal `getRecentRealCandles` i.p.v.
  `getXauUsdCandles`.
- **Verificatie**: voor de fix - 50 candles, 32 flat (64%), venster 13-15 juni. Na
  de fix - 50 candles, 0 flat, venster 11-15 juni. Een herhaalde live run met
  dezelfde Trump/Iran-context na de fix gaf een ander (conservatiever) besluit -
  zie hieronder.

### Live resultaat (na de fix, met Trump/Iran-context)
Context: "Trump heeft aangekondigd vrede te willen sluiten met Iran; sindsdien is er
een sterke stijging in XAU/USD - de markt is momenteel bullish."

CEO-besluit: **BULLISH, zekerheid 72%**, SL 4300 / TP 4400 (RR ~1:1,6),
positiegrootte **klein**. De Devil's Advocate bracht in dat de markt het nieuws al
deels kan hebben ingeprijsd ("sell the news"); de CEO koos mede daardoor voor een
strakke SL en een kleine positie i.p.v. normaal/groot, ondanks de hoge zekerheid.
Gepost naar het #trace- en #ceo-kanaal.

## Fase 11 - Proactieve outcome-meldingen (klaar)

### Doel
Tot nu toe zag je TP/SL/geen-uitkomsten van eerder gegeven signalen alleen als je
zelf `/performance` of `/geschiedenis` opvroeg. `evaluateOpenSignals()` (aangeroepen
door de scheduler elke tick, en door `/performance`) wist intern al wanneer een open
signaal voor het eerst een definitieve uitkomst krijgt - die informatie ging eerder
verloren na het loggen. Fase 11 stuurt hiervoor automatisch een Discord-bericht naar
het #ceo-kanaal, zonder dat de gebruiker er om hoeft te vragen.

### Implementatie
- `services/performanceTracker.js`'s `evaluateOpenSignals(client)` neemt nu een
  optionele Discord-`client`. Voor elk `pending`-signaal dat in deze aanroep een
  **definitieve** uitkomst krijgt (`tp`, `sl` of `geen`), wordt een entry
  `{ id, timestamp, decision, outcome }` verzameld in `resolved`. Na de loop wordt,
  als `client` is opgegeven en `resolved` niet leeg is, `reportOutcomes(client,
  resolved)` aangeroepen.
- **`neutraal`** (CEO nam geen positie) en **`onbruikbaar`** (prijsschaal-mismatch)
  worden bewust **niet** gemeld: deze worden al bij de *eerste* evaluatie direct
  bepaald (geen "afgewacht" resultaat), en zouden dus meteen na het CEO-besluit
  zelf een (overbodige) tweede melding opleveren.
- Omdat een signaal alleen in `pending` voorkomt zolang `outcome.result === 'open'`
  (of nog geen outcome heeft), kan een signaal maximaal één keer in `resolved`
  belanden - geen risico op dubbele meldingen, ook niet als zowel de scheduler-tick
  als een handmatige `/performance` binnen hetzelfde uur draaien.
- `services/boardroomReporter.js` (nieuw): `formatOutcomeMessage(signal)` -
  formatteert "Signaal #N afgerond - ✅/❌/➖ <label> (na X candles)" + de
  originele signaal-details (richting, zekerheid, SL/TP, positiegrootte).
  `reportOutcomes(client, resolved)` post deze berichten naar `ceoChannelId`
  (zelfde kanaal als het oorspronkelijke CEO-besluit).
- Call-sites bijgewerkt: `services/scheduler.js`'s `tick()` geeft `client` door,
  `discord/bot.js`'s `/performance`-handler geeft `interaction.client` door.

### Validatie
- `scripts/test-boardroomReporter.js` (nieuw, 7 checks): `formatOutcomeMessage`
  voor tp/sl/geen (incl. met/zonder `candlesToHit`-suffix), en `reportOutcomes`
  met een mock-client (1 bericht per resolved signaal, juiste kanaal-id, juiste
  inhoud, geen channel-fetch bij een lege lijst).
- Live integratietest (2026-06-15): `evaluateOpenSignals(client)` met een echte
  Discord-client tegen de actuele 7 open signalen (#6, #9-#14) - alle 7 bleven
  `open` (nog binnen de horizon, geen TP/SL geraakt), dus `resolved` was leeg en er
  is terecht niets gepost. Bevestigt dat de nieuwe `client`-parameter geen
  bestaande flow breekt.

## Fase 12 - Setup-markering in CEO-berichten (klaar)

### Doel
Eerste stap richting het einddoel (proactieve setup-alerts): elk uur wordt al een
CEO-besluit gepost, maar zonder onderscheid tussen "dit is een kans om naar te
kijken" (bullish/bearish) en "het team neemt bewust geen positie" (neutral). Een
visuele markering maakt dit in één oogopslag duidelijk, zonder dat er al een
confidence-drempel of filter nodig is (die data is nog te dun/scheef, zie Fase 9).

### Implementatie
- `services/boardroomReporter.js`: nieuwe `formatSetupMarker(signal)` -
  `bullish`/`bearish` -> `🚨 Setup gevonden`, `neutral` -> `💤 Geen actie`.
- `formatCeoMessage` en de CEO-eindbeslissing in `formatTraceMessages` tonen nu
  `**👔 CEO-besluit - <marker>**` resp. `**👔 CEO - eindbeslissing - <marker>**`.
- `discord/bot.js`'s `/analyse`-antwoord toont dezelfde marker naast het
  CEO-besluit.
- Geen nieuwe configuratie/drempel: puur een afleiding van `decision.signal`,
  dat al verplicht aanwezig is in elk CEO-besluit.

### Validatie
- `scripts/test-boardroomReporter.js` (7 nieuwe checks, totaal 14):
  `formatSetupMarker` voor bullish/bearish/neutral, `formatCeoMessage` met
  marker voor bullish en neutral, en `formatTraceMessages` (6 berichten, CEO-bericht
  bevat de marker).
- Live verificatie (2026-06-15): `scripts/test-boardroom.js` gedraaid met
  mock-candles (bullish-uitkomst) - trace- en CEO-berichten met `🚨 Setup
  gevonden` correct gepost naar #trace en #ceo.
- Live bot (scheduler-proces) herstart zodat de lopende scheduler en
  slash-commands de nieuwe markering meteen gebruiken.

## Fase 13 - Technische indicatoren als context voor de agents (klaar)

### Doel
Vervolgstap richting het einddoel: de agents kregen tot nu toe alleen 50 losse
OHLC-regels (`formatCandles`) en moesten daar zelf trend/momentum/volatiliteit uit
afleiden - iets waar LLM's relatief zwak in zijn. Door veelgebruikte technische
indicatoren vooraf te berekenen en als context mee te geven, krijgen alle agents
een directer en consistenter signaal (bv. "RSI 83 = overbought" i.p.v. zelf 50
sluitprijzen moeten interpreteren).

### Implementatie
- Nieuw `agents/indicators.js` (pure, testbare functies, geen I/O):
  - `sma(values, period)`, `rsi(closes, period=14)`, `atr(candles, period=14)` -
    vallen netjes terug op minder periodes als er te weinig candles zijn (bv. bij
    mock-data met 12 candles), en geven `null` terug als er te weinig data is voor
    een betekenisvolle waarde (i.p.v. NaN/crash).
  - `computeIndicators(candles)` -> `{ lastClose, sma20, sma50, rsi14, atr14 }`.
  - `formatIndicatorsNote(indicators)` -> leesbaar tekstblok met RSI-label
    (overbought/oversold/neutraal vanaf >=70/<=30) en SMA20/50-trendpositie
    (prijs ligt "boven"/"onder").
- `agents/boardroom.js`'s `runDiscussion` berekent `indicatorsNote` één keer en
  geeft het - net als `events` en `newsContext` - door aan **alle 6
  agent-gesprekken** (analyse, risico, Devil's Advocate, marktcontext, weerwoord,
  CEO), die het toevoegen aan hun prompt.
- Geen nieuwe configuratie of databron nodig: indicatoren worden berekend uit de
  candles die elke live/`backtest`-aanroep al ophaalt.

### Validatie
- `scripts/test-indicators.js` (19 checks): `sma`/`rsi`/`atr` met handgeschreven
  fixtures (alleen winst -> RSI 100, alleen verlies -> RSI 0, gemengd -> RSI 60,
  constante true range -> ATR, fallback bij te weinig candles -> `null`,
  fallback bij periode > beschikbare data), `computeIndicators` +
  `formatIndicatorsNote` op een lineaire candle-reeks (verwachte SMA/RSI/ATR-
  waarden exact uitgerekend), en een check dat `null`-waarden niet als `"null"`
  in de prompt-tekst verschijnen.
- Regressietest: bestaande suites (`test-analyst.js`, `test-boardroomReporter.js`,
  `test-performanceTracker.js`, `test-agentAnalysis.js`) draaien nog steeds
  zonder fouten (indicatoren zijn optioneel/`indicatorsNote=''` als niet
  meegegeven).
- Live verificatie (2026-06-15): `scripts/test-boardroom.js` met mock-candles -
  alle 6 agents verwijzen expliciet naar de berekende indicatoren in hun
  redenering (bv. analist: "RSI(14) staat op 83.2, wat sterk overbought
  aangeeft"; risicomanager: SL/TP gebaseerd op "~1x ATR" / "~2x ATR", R:R
  ≈ 1:2). Berichten correct gepost naar #trace en #ceo.

## Fase 14 - Dollarcontext (EUR/USD als DXY-proxy) als extra factor voor de agents (klaar)

### Doel
Op verzoek van de gebruiker: de agents moeten ook rekening houden met de sterkte
van de Amerikaanse dollar, een belangrijke driver voor XAU/USD. Een directe
dollarindex (DXY) is niet beschikbaar via Twelve Data (geprobeerd: `DXY`,
`USDOLLAR`, `USD/DXY` -> allemaal 404). Als proxy is gekozen voor **EUR/USD**:
het grootste onderdeel (~58%) van de DXY-mand, met continue 24/5 H1-data (in
tegenstelling tot bv. de UUP-ETF die alleen tijdens NYSE-uren data heeft) en met
hetzelfde cadans als de XAU/USD-candles. Door de samenstelling van de DXY-formule
beweegt EUR/USD in dezelfde richting als goud: EUR/USD omhoog -> dollar verzwakt
-> doorgaans steun voor XAU/USD, en omgekeerd.

### Implementatie
- Nieuw `agents/dollarContext.js` (pure, testbare functies, geen I/O):
  - `computeDollarContext(candles)` -> `{ lastClose, firstClose, sma20 }`
    (hergebruikt `sma` uit `agents/indicators.js`).
  - `formatDollarContextNote(context)` -> leesbaar tekstblok: richting en
    percentage-verandering van EUR/USD over de getoonde periode, positie t.o.v.
    het 20-periode gemiddelde, en de vertaling naar dollarsterkte +
    implicatie voor XAU/USD ("steun voor"/"druk op").
- `services/marketData.js`: generieke `fetchCandles` helper, met
  `getXauUsdCandles` (bestaand gedrag) en nieuwe `getEurUsdCandles` als wrappers.
  Nieuwe `getRecentEurUsdCandles({ granularity, count })` haalt EUR/USD-candles op
  en filtert exact-platte candles (`high !== low`) - de bestaande
  `filterFlatCandles`/`FLAT_RANGE_THRESHOLD` (afgestemd op XAU/USD's prijsschaal
  van ~4350) is niet bruikbaar voor EUR/USD (~1.16) en zou daar alle candles als
  "plat" wegfilteren.
- `agents/boardroom.js`'s `runDiscussion` accepteert een optionele
  `dollarCandles`-parameter; als die >= 2 candles bevat wordt `dollarContextNote`
  berekend en - net als `indicatorsNote`, `events` en `newsContext` - doorgegeven
  aan **alle 6 agent-gesprekken**, die het toevoegen aan hun prompt.
- Alle 3 live aanroeppunten (`services/scheduler.js`, `discord/bot.js`'s
  `/analyse`-handler, `scripts/analyseNow.js`) halen nu ook
  `getRecentEurUsdCandles({ granularity: 'H1', count: 50 })` op en geven die door
  als `dollarCandles`.
- `scripts/backtest.js` haalt nu ook EUR/USD-candles op voor dezelfde
  `from`/`to`-periode en koppelt per sample-window de EUR/USD-candles op
  timestamp-range (`eurWindowFor`) - index-uitlijning met de XAU/USD-candles werkt
  niet, omdat `filterFlatCandles` (XAU/USD) weekend-candles wegfiltert terwijl het
  `high !== low`-filter (EUR/USD) dat niet doet. Zo krijgen ook nieuwe
  backtest-samples een `dollarContextNote`, consistent met de live agents.

### Validatie
- `scripts/test-dollarContext.js` (22 checks): `computeDollarContext` op een
  lineaire candle-reeks (exacte `lastClose`/`firstClose`/`sma20`-waarden), en
  `formatDollarContextNote` voor stijgende EUR/USD (bevat "gestegen"/"verzwakt"/
  "steun voor"/"boven"), dalende EUR/USD ("gedaald"/"versterkt"/"druk op"/"onder",
  geen negatief percentage door `Math.abs`), het randgeval `lastClose === sma20`
  (-> "onder", want `>` i.p.v. `>=`), en algemene structuur (begint met `\n\n`,
  bevat "Dollarcontext"/"EUR/USD"/"XAU/USD").
- Regressietest: alle bestaande suites (`test-indicators.js`,
  `test-boardroomReporter.js`, `test-performanceTracker.js`,
  `test-agentAnalysis.js`, 65 checks totaal) draaien nog steeds zonder fouten
  (dollarcontext is optioneel/`dollarContextNote=''` als geen `dollarCandles`
  meegegeven).
- Live verificatie (2026-06-15): `scripts/analyseNow.js` met echte XAU/USD- én
  EUR/USD-candles - alle 6 agents (incl. CEO-besluit) verwijzen expliciet naar de
  dollarcontext in hun redenering (bv. "De lichte dollarzwakte (EUR/USD +0.27%)
  geeft enige steun aan goud" / "biedt aanvullende, zij het beperkte tailwind
  voor goud"). Berichten correct gepost naar #trace en #ceo.
- Validatie `scripts/backtest.js` (2026-06-15): kleine run (`DAYS=7`, 1 nieuw
  sample, record #7) - analist verwijst expliciet naar "EUR/USD +0.10% en boven
  de slotkoers" in zijn redenering, bevestigt dat `dollarCandles` correct per
  sample-window wordt meegegeven. Daarna een grotere run (`DAYS=20`, ~11 nieuwe
  samples) gestart op de achtergrond voor meer data ter voorbereiding op de
  volgende analyse-ronde.

## Fase 15 - Renteklimaat (Amerikaanse 2-jaars rente) als extra factor voor de agents (klaar)

### Doel
Op verzoek van de gebruiker, na een audit van cruciale factoren die XAU/USD
beïnvloeden: Amerikaanse rentes/reële rente ontbraken nog als factor. Goud
levert zelf geen rente op, dus het renteklimaat bepaalt de "opportunity cost"
van het aanhouden van goud - een stijgende rente verhoogt die opportunity cost
(doorgaans bearish voor XAU/USD) en een dalende rente verlaagt die (doorgaans
bullish). De "klassieke" referentie hiervoor is de Amerikaanse 10-jaars
staatsobligatierente (US10Y), maar die is **niet beschikbaar** via Twelve Data op
dit plan (zowel `/price` als `/time_series` -> "symbol or figi parameter is
missing or invalid"). Als proxy is gekozen voor **US2Y** (Amerikaanse 2-jaars
rente): wél beschikbaar, en sterk gekoppeld aan rente-/Fed-verwachtingen, een van
de belangrijkste drivers van het renteklimaat.

### Implementatie
- Nieuw `agents/yieldContext.js` (pure, testbare functies, geen I/O):
  - `computeYieldContext(candles)` -> `{ lastClose, firstClose, sma20 }`
    (hergebruikt `sma` uit `agents/indicators.js`, zelfde vorm als
    `computeDollarContext`).
  - `formatYieldContextNote(context)` -> leesbaar tekstblok: huidige 2-jaars
    rente, verandering in basispunten over de getoonde periode, positie t.o.v.
    het 20-periode gemiddelde, en de vertaling naar opportunity cost +
    implicatie voor XAU/USD ("steun voor"/"druk op").
- **Dagcandles i.p.v. uurcandles** (in tegenstelling tot dollarcontext): de rente
  is een trage macro-achtergrond, en US2Y-uurdata van Twelve Data heeft een
  `:30`-minuten-uitlijning (i.p.v. `:00` zoals XAU/USD/EUR/USD) en mogelijk
  NYSE-uren-gaten. Dagdata is continu (geverifieerd over 10 dagen) en vermijdt
  beide problemen.
- `services/marketData.js`: nieuwe `getUsYieldCandles` (wrapper om `fetchCandles`
  met `symbol: 'US2Y'`) en `getRecentUsYieldCandles({ count = 25 })` - haalt
  dagcandles op en filtert exact-platte candles (`high !== low`) eruit, net als
  bij EUR/USD.
- `agents/boardroom.js`'s `runDiscussion` accepteert een optionele
  `yieldCandles`-parameter; als die >= 2 candles bevat wordt `yieldContextNote`
  berekend en - net als `indicatorsNote`, `dollarContextNote`, `events` en
  `newsContext` - doorgegeven aan **alle 6 agent-gesprekken**, die het toevoegen
  aan hun prompt.
- Alle 3 live aanroeppunten (`services/scheduler.js`, `discord/bot.js`'s
  `/analyse`-handler, `scripts/analyseNow.js`) halen nu ook
  `getRecentUsYieldCandles({ count: 25 })` op en geven die door als
  `yieldCandles`.
- `scripts/backtest.js` haalt nu ook US2Y-dagcandles op voor de periode
  `from - 30 dagen` t/m `to` (extra historie zodat ook de vroegste samples genoeg
  dagcandles hebben) en koppelt per sample de laatste 25 dagcandles vóór de
  sample-tijd (`yieldWindowFor`) - simpeler dan `eurWindowFor` omdat dagdata geen
  index- of tijdrange-matching met de H1-candles nodig heeft.

### Validatie
- `scripts/test-yieldContext.js` (23 checks): `computeYieldContext` op een
  lineaire candle-reeks (exacte `lastClose`/`firstClose`/`sma20`-waarden), en
  `formatYieldContextNote` voor stijgende rente (bevat "gestegen"/"verhoogt"/
  "druk op"/"boven"), dalende rente ("gedaald"/"verlaagt"/"steun voor"/"onder",
  geen negatieve basispunten door `Math.abs`), het randgeval
  `lastClose === sma20` (-> "onder", want `>` i.p.v. `>=`), en algemene structuur
  (begint met `\n\n`, bevat "Rente-context"/"2-jaars"/"XAU/USD"/"opportunity
  cost").
- Regressietest: alle bestaande suites (`test-indicators.js`,
  `test-dollarContext.js`, `test-boardroomReporter.js`,
  `test-performanceTracker.js`, `test-agentAnalysis.js`, 87 checks totaal) +
  nieuwe suite (110 checks totaal) draaien zonder fouten (renteklimaat is
  optioneel/`yieldContextNote=''` als geen `yieldCandles` meegegeven).
- Live verificatie (2026-06-15): `scripts/analyseNow.js` met echte XAU/USD-, EUR/
  USD- en US2Y-candles - meerdere agents verwijzen expliciet naar de
  renteklimaat-context in hun redenering (bv. analist: "gedaalde 2-jaars rente
  (-5 bps, onder 20-daags gemiddelde)"; Devil's Advocate en CEO noemen beide "de
  macro-tailwinds (zwakkere dollar, gedaalde 2-jaars rente onder het 20-daags
  gemiddelde)" als structurele steun voor goud). Berichten correct gepost naar
  #trace en #ceo.

## Interne refactor - gedeelde `contextNotes` (klaar)

### Doel
Na Fase 13/14/15 herhaalden alle 6 agent-functies exact dezelfde
`indicatorsNote + dollarContextNote + yieldContextNote`-destructuring en
-concatenatie, op exact dezelfde plek in de prompt (na `newsContextNote`), zonder
agent-specifieke logica ertussen. Dit maakte elke nieuwe context-factor (Fase 16+)
een wijziging in alle 6 agent-bestanden. Geconsolideerd tot één `contextNotes`-
string, één keer berekend in `agents/boardroom.js`.

### Implementatie
- `agents/boardroom.js`'s `runDiscussion` berekent
  `contextNotes = indicatorsNote + dollarContextNote + yieldContextNote` en geeft
  alleen `contextNotes` (i.p.v. de drie losse notes) door in `opts`.
- Alle 6 agent-functies (`analyst.js` x2, `riskManager.js`, `devilsAdvocate.js`,
  `macroAnalyst.js`, `ceo.js`) accepteren nu `contextNotes = ''` i.p.v. de drie
  losse `...Note = ''`-parameters, en gebruiken `${contextNotes}` op de plek waar
  voorheen `${indicatorsNote}${dollarContextNote}${yieldContextNote}` stond.
- Een nieuwe factor (Fase 16+) hoeft hierdoor alleen nog `boardroom.js` te wijzigen
  (de nieuwe note toevoegen aan de `contextNotes`-concatenatie), niet alle 6
  agent-bestanden.

### Validatie
- Regressietest: alle bestaande suites (110 checks, zie Fase 15) draaien zonder
  fouten.
- Live verificatie (2026-06-15): `scripts/analyseNow.js` - indicatoren-,
  dollar- en renteklimaat-context verschijnen nog correct in de redenering van
  alle agents. Berichten correct gepost naar #trace en #ceo.

## Fase 16 - 🌟-markering voor het combo-signaal (klaar)

### Doel
De Fase 9/10-backtest-analyses lieten een combo-signaal zien (zekerheid
analist omhoog na het weerwoord + risk/reward <1.5) dat samenhangt met een
duidelijk hogere winRate dan de rest (record #10: 81.8% N=12 vs. 31.9% N=74).
Dit wordt nu zichtbaar gemaakt in Discord als extra markering naast de
bestaande 🚨 Setup gevonden / 💤 Geen actie.

### Implementatie
- Nieuw `agents/agentAnalysis.js`'s `isComboSignal(sample)`: combineert
  `classifyRebuttalShift(sample) === 'omhoog'` en
  `classifyRiskReward(sample) === '<1.5'`.
- `agents/boardroom.js`'s `runDiscussion` retourneert nu ook `entryPrice`
  (candle-close op besluitmoment, nodig voor `classifyRiskReward`) en
  `comboSignal` (resultaat van `isComboSignal` op de eigen discussion/decision/
  entryPrice).
- `services/boardroomReporter.js`'s `formatSetupMarker(signal, comboSignal)`
  voegt ` 🌟` toe aan `🚨 Setup gevonden` als `comboSignal` waar is (bij
  `neutral`/💤 wordt `comboSignal` genegeerd). `formatCeoMessage` en
  `formatTraceMessages` geven `comboSignal` door. Geen hardcoded winRate-
  percentage in de tekst - dat cijfer leeft in de backtests en zou snel
  verouderen.
- Call sites (`discord/bot.js`'s `/analyse`-handler, `scripts/analyseNow.js`)
  geven `result.comboSignal` door aan `formatSetupMarker`/`formatCeoMessage`.
  `services/scheduler.js` had geen wijziging nodig (`reportToDiscord` haalt
  `comboSignal` al uit `result`).

### Validatie
- 10 nieuwe unit-tests (4 in `scripts/test-agentAnalysis.js` voor
  `isComboSignal`, 6 in `scripts/test-boardroomReporter.js` voor de 🌟-
  markering), alle 119 checks totaal groen.
- Live verificatie (2026-06-15): `scripts/analyseNow.js` op echte data gaf
  `comboSignal: true` (rebuttal-shift 45%→55% = "omhoog", R:R ≈1.12 = "<1.5"),
  bevestigd dat dit `🚨 Setup gevonden 🌟` oplevert in #trace/#ceo.
- Bot herstart 31400 -> 31821.

## Fase 17 - Proactieve 🌟-melding (klaar)

### Doel
Record #11 bevestigde het combo-signaal verder (N=14, winRate 84.6% vs.
31.8% voor de rest). De 🌟 uit Fase 16 was tot nu toe alleen een visuele
markering in het reguliere uur-bericht in #ceo - makkelijk te missen. Fase 17
maakt dit proactief: een directe Discord-mention zodra het combo-signaal
zich voordoet op een echte setup (🚨, niet bij 💤).

### Implementatie
- Nieuwe instelling `DISCORD_ALERT_USER_ID` (`config/index.js`'s
  `config.boardroom.alertUserId`, toegevoegd aan `.env`/`.env.example`) -
  jouw Discord user-ID om te pingen. Leeg = geen extra melding (graceful
  no-op, geen verplichte configuratie).
- Nieuwe pure functie `services/boardroomReporter.js`'s
  `formatComboAlert(signal, comboSignal, alertUserId)`: `null` als
  `signal === 'neutral'`, `comboSignal` niet waar is, of `alertUserId`
  ontbreekt; anders `🌟 <@alertUserId> Combo-signaal gedetecteerd - bekijk
  het CEO-besluit hierboven!`.
- `reportToDiscord` stuurt na het reguliere CEO-bericht
  (`formatCeoMessage`) optioneel dit extra alert-bericht naar hetzelfde
  #ceo-kanaal. `formatCeoMessage`/`formatTraceMessages`/`formatSetupMarker`
  (Fase 16) zijn ongewijzigd - de 🌟 in de besluittekst blijft, de mention is
  een aanvullend bericht ernaast.

### Validatie
- 6 nieuwe unit-tests in `scripts/test-boardroomReporter.js` (25 checks
  totaal, was 19): `formatComboAlert` voor alle combinaties van
  comboSignal/signal/alertUserId, plus een `reportToDiscord`-test die
  bevestigt dat zonder `DISCORD_ALERT_USER_ID` geen extra bericht wordt
  verstuurd.
- Volledige regressiesuite (alle `scripts/test-*.js`) groen.
- Bot herstart 31821 -> 32179.

### Status
`DISCORD_ALERT_USER_ID` is ingevuld (2026-06-15) - de mention is actief.
Test 10 in `scripts/test-boardroomReporter.js` is hierop aangepast: het
verwachte aantal CEO-berichten (1 of 2) en de inhoud van het 2e bericht
worden nu afgeleid van `formatComboAlert()` zelf, zodat de test correct
blijft of `DISCORD_ALERT_USER_ID` nu wel of niet geconfigureerd is (26
checks totaal, was 25). Bot herstart 32331 -> 32627.

## Fase 18 - US2Y-candles cachen (klaar)

### Doel
`services/scheduler.js` haalt elke tick (elk uur) `getRecentUsYieldCandles`
op voor de renteklimaat-context (Fase 15), maar dit zijn dagcandles die
hoogstens 1x per dag veranderen. Zonder cache kost dit een onnodige Twelve
Data-call per uur - bij een gratis plan met een rate limit (8/min) telt elke
vermeden call mee naarmate er meer candle-series per tick bijkomen.

### Implementatie
- Nieuwe pure functie `services/marketData.js`'s `isCacheValid(fetchedAt,
  ttlMs, now = Date.now())`: `fetchedAt != null && now - fetchedAt < ttlMs`.
  Los geëxporteerd zodat de cache-logica zonder API-calls te unit-testen is.
- `getRecentUsYieldCandles` houdt een module-level cache
  `{ count, data, fetchedAt }` bij met `YIELD_CACHE_TTL_MS = 24u`. Bij een
  geldige cache (zelfde `count`, binnen 24u) wordt de opgeslagen `data`
  teruggegeven zonder API-call; anders wordt opnieuw gefetcht en de cache
  bijgewerkt.
- Geen wijzigingen nodig in `services/scheduler.js`,
  `agents/yieldContext.js` of `discord/bot.js` - de cache zit volledig
  binnen `getRecentUsYieldCandles`, dus alle call sites profiteren
  automatisch.

### Validatie
- Nieuwe `scripts/test-marketDataCache.js` (7 checks): `isCacheValid` voor
  geen-cache, binnen-ttl, exact-op-de-grens, net-binnen-de-grens,
  buiten-ttl, en een klok-in-de-toekomst-edge-case.
- Live verificatie (2026-06-15): `getRecentUsYieldCandles({ count: 25 })`
  twee keer aanroepen - 1e call 372ms (echte API-call, 25 candles t/m
  2026-06-16), 2e call 0ms (cache-hit), identieke data.
- Volledige regressiesuite (alle `scripts/test-*.js`) groen.
- Bot herstart 32179 -> 32331.

## Fase 19 - Agent-onafhankelijkheid hersteld + volledige prompt-audit (klaar)

### Aanleiding
Backtest-analyse (N=18 combo-samples, records #10-#14) onthulde twee
structurele problemen:
1. **Drie van vijf agents toonden nul variatie** in alle 47+ samples:
   Devil's Advocate altijd "oneens" (100%), macro altijd "aligned" (100%),
   CEO altijd "volgt-analist" (100%). De boardroom-discussie had geen
   werkelijk effect op het besluit - de analist bepaalde alles.
   Root cause: de macro-analist kreeg het analist-signaal mee in zijn prompt
   en werd gevraagd of dit "ondersteunt of relativeert" → structureel
   afhankelijk, nooit onafhankelijk. De CEO stond de analist als input #1 én
   #5 (weerwoord) en kon "afwijken als de discussie dat rechtvaardigt" →
   impliciete default richting de analist.
2. **🌟-combo-signaal gebaseerd op dunne, niet-onafhankelijke data**: N=18
   samples alle uit dezelfde 30-daagse bearish periode (mei-juni 2026).
   WinRate daalde als N groeide: 90%→84.6%→73.3%→64.7%.

### Eerste fix - agent-onafhankelijkheid (commit 865229a)
- **`agents/macroAnalyst.js`**: analist-signaal volledig uit de prompt
  verwijderd (parameter hernoemd naar `_analysis`). Macro-analist vormt nu
  een volledig onafhankelijk sentiment-oordeel op basis van candles, dollar
  en rente - zonder te weten wat de technisch analist heeft geconcludeerd.
- **`agents/ceo.js`**: expliciete meerderheidsregel ingevoerd: als drie of
  vier invalshoeken dezelfde richting wijzen, is dat doorslaggevend. "Je mag
  afwijken als de discussie dat rechtvaardigt" vervangen door "er is geen
  standaard-standpunt".

### Volledige prompt-audit en correcties (commit 256fe11)
Na een zorgvuldige analyse van alle agent-prompts en context-bestanden
zijn de volgende aanvullende verbeteringen doorgevoerd:

- **Analist (`analyzeCandles`)**: events-noot toegevoegd (zelfde patroon als
  risicomanager en macro-analist) - analist weet nu van aankomende
  marktbewegende USD-events en past zijn zekerheid daarop aan.
- **Analist (`reviewDiscussion`)**: escape-hatch verwijderd. "Je mag bij je
  eigen analyse blijven als de tegenargumenten je niet overtuigen" is
  vervangen door: "Weeg elk argument inhoudelijk. Pas je
  zekerheidspercentage aan als andere invalshoeken steekhoudende punten
  maken - ook als je bij je richting blijft. Een onveranderd percentage is
  alleen gerechtvaardigd als je elk argument concreet kunt weerleggen."
- **Risicomanager**: kwalitatief risico-oordeel toegevoegd. Beoordeelt nu
  ook de kwaliteit van de trade (R:R-verhouding, te hoge volatiliteit) en
  kan expliciet adviseren voor "kleinste positiegrootte" als handelen niet
  verantwoord is - zodat de CEO een "skip this trade"-signaal kan ontvangen.
- **Devil's Advocate**: events-noot toegevoegd - kan aankomende grote events
  inzetten als sterkste tegenargument ("technische setups kunnen binnen
  uren worden omgekeerd").
- **Macro-analist**: parenthetische richting-toelichting verwijderd
  ("risk-on = goud onder druk"). Macro-analist redeneert nu zelf wat
  risk-on/off betekent voor XAU/USD in de specifieke marktomgeving.
- **CEO**: drie verbeteringen:
  (a) Risicomanager expliciet gelabeld als "sizing en niveaus, geen
      directioneel oordeel" - telt niet mee als directionele stem.
  (b) Zekerheidsschaal op basis van consensus: drie stemmen eensgezind
      → >70%; twee tegen één → 55-70%; verdeeld → overweeg neutraal.
  (c) Expliciete instructie: als CEO-signaal afwijkt van het analist-signaal,
      stel dan ook nieuwe SL/TP-niveaus in die bij de CEO-richting passen.
- **Economische kalender**: uitgebreid van 3 events (alleen 17 juni 2026)
  naar 12 events t/m augustus 2026 (NFP, CPI, FOMC juli/aug, Jackson Hole).

### Validatie
- 62 bestaande tests groen (geen nieuwe tests: dit zijn pure prompt-wijzigingen,
  geen logica-wijzigingen).
- Bot herstart na commit: PID 47992.
- Eerste backtest-run met Fase 19-prompts gestart als achtergrondproces
  (PID 55317, log `/tmp/backtest_fase19.log`, wordt record #15). Dit levert
  de eerste data waarbij de agents écht onafhankelijk redeneren - voor
  vergelijking met de pre-Fase-19-bevindingen (macro altijd aligned, CEO
  altijd volgt-analist).

### Validatie nacht-backtest (record #16)
- 19 samples, winRate 40% (15 trades: 6 TP / 8 SL / 1 geen).
- Fase 19 bewezen effectief: DA "eens" 7x (was 0x), macro "contrarian" 4x
  (was 0x), CEO "wijkt-af" 15x (was 0x) - alle drie voorheen-nul dimensies
  tonen nu reële variatie.

## Fase 20 - Signaalfilter op basis van drie kwaliteitscriteria (klaar)

### Aanleiding
Nacht-backtest (record #16, eerste Fase 19-run) + cumulatieve analyse van alle
records leverden drie statistisch onderbouwde "rode vlaggen" voor setup-kwaliteit:
- **CEO-zekerheid < 60%** (N=47 cumulatief) → 24% winRate
- **Macro contraireert de richting** (N=4) → 0% winRate
- **Rebuttal omlaag** (analist verloor vertrouwen na discussie, N=93) → 26% winRate

Live Discord-performance was aanleiding: 1 TP op 17 trades (~6%).

### Implementatie (commit e038fdc)
- **`agents/agentAnalysis.js`**: `assessSignalQuality(sample)` toegevoegd.
  Retourneert `{ passed: bool, blockers: string[] }`. Neutrale signalen / geen
  discussion → altijd `passed: true`. De drie filters worden onafhankelijk
  geëvalueerd (meerdere blockers mogelijk).
- **`agents/boardroom.js`**: `qualityResult` toegevoegd aan het return-object
  van `runDiscussion()`.
- **`services/boardroomReporter.js`**: alle vier format-functies bijgewerkt:
  - `formatSetupMarker`: `!qualityResult.passed` → `'🔶 Setup (gefilterd)'`
  - `formatCeoMessage`: voegt `⚠️ Niet geadviseerd: ...` toe bij blockers
  - `formatComboAlert`: retourneert `null` bij gefilterd signaal (geen ping)
  - `formatTraceMessages`: CEO-regel bevat marker + optionele blocker-tekst
  Alle parameters optioneel met safe defaults → geen bestaande tests gebroken.

### Marker-systeem na Fase 20
- 💤 Geen actie = neutraal CEO-besluit
- 🔶 Setup (gefilterd) = minstens één filter niet gehaald (zichtbaar, maar geen 🚨)
- 🚨 Setup gevonden = alle filters gehaald
- 🚨 Setup gevonden 🌟 = alle filters + combo-signaal (rebuttal omhoog + R:R <1.5)

### Validatie
- 36 tests in `scripts/test-agentAnalysis.js` (7 nieuw).
- 37 tests in `scripts/test-boardroomReporter.js` (11 nieuw).
- Alle overige test-suites ongewijzigd groen.
- Bot herstart: PID 64140.

## Fase 21 - D1-trendcontext + R:R >2.5 als vierde kwaliteitsfilter (klaar)

### Aanleiding
Na Fase 20 (drie kwaliteitsfilters) twee verdere verbeteringen gebundeld:
1. Agents zagen 50 H1-candles (~2 dagen) zonder hogere-tijdseenheid context — bij
   een sterke dagtrend konden ze bullish gaan terwijl de dag-structuur bearish was.
2. R:R >2.5 correleerde in de backtest-data al met lage winRates (16-20%) maar
   was nog geen harde filter.

### Implementatie (commit 28f3c33)
- **`agents/dailyContext.js`** (nieuw): `computeDailyContext` (huidige dagkoers,
  SMA20, 5-daagse verandering, ATR14, recente 5-daagse range) +
  `formatDailyContextNote` (tekstuele samenvatting voor alle agents).
- **`services/marketData.js`**: `getRecentXauD1Candles({ count: 30 })` met 24u-cache
  (zelfde patroon als US2Y-dagdata).
- **`agents/boardroom.js`**: `dailyContextNote` toegevoegd aan `contextNotes`;
  accepteert nu ook `d1Candles = null` als opt.
- **`agents/agentAnalysis.js`**: vierde blocker in `assessSignalQuality`:
  `classifyRiskReward === '>2.5'` → "risico/winst-verhouding te ambitieus (>2.5)".
  Guard op `sample.entryPrice != null` voorkomt false-trigger bij ontbrekende prijs.
- **Call sites** bijgewerkt: `scheduler.js`, `discord/bot.js`, `analyseNow.js`,
  `scripts/backtest.js` (met `d1WindowFor(sampleTime)`, zelfde patroon als yield).
- `analyseNow.js`: ook `result.qualityResult` doorgegeven aan `formatCeoMessage`.

### Tests
- 27 nieuwe tests (`scripts/test-dailyContext.js`).
- 3 nieuwe tests in `scripts/test-agentAnalysis.js` (R:R >2.5 filter + guard).
- Totaal 184 tests groen. Bot herstart: PID 64858.

### Validatie - backtest record #17 (eerste run met Fase 21-prompts)
14 samples (2 neutraal, 12 trades: 5 TP / 6 SL / 1 geen), winRate 41.7%.

**D1-context bevestigd actief**: analist schrijft expliciet "onder het 20-daags
daggemiddelde (4598.89)" en "5-daagse dagtrend -0.8%" in zijn redenering.

**Kwaliteitsfilter-impact (cumulatief, N=191 met discussion-data)**:
- Passed (alle 4 filters groen): N=90 → **winRate 55.1%** (TP:43, SL:30)
- Filtered (≥1 blocker): N=101 → **winRate 26.7%** (TP:27, SL:67)
- Scheiding: 2x verschil in winRate; filters werken zoals bedoeld.

**Record #17 filter-impact** (eerste echte Fase 21-run):
- Passed N=7 → winRate 60%; Filtered N=7 → winRate 28.6%

**Combo-signaal** (rebuttal omhoog + R:R <1.5): N=21, winRate 66.7%
(TP:12, SL:5, geen:1). Gestabiliseerd rond 65-67% na eerdere daling
(90%→84.6%→73.3%→64.7%→66.7%). Nog steeds ~1.85x boven rest (36%).

**Blocker-verdeling** (N=101 gefilterde trades):
- Rebuttal omlaag: 90 (meest voorkomend)
- CEO <60%: 39
- R:R >2.5: 17 (nieuwe filter, bevestigd: 17.6% winRate N=17)
- Macro contrarian: 4 (0% winRate, N=4)

**Kanttekening**: de filters zijn deels gedesigned op dezelfde dataset waarop we
ze nu evalueren (in-sample). Echte validatie volgt uit de live Discord-performance.

## Fase 22 - Geopolitieke/nieuws-agent als zesde boardroom-stem (klaar)

Zesde onafhankelijke agent toegevoegd: `agents/geopoliticalAnalyst.js` beoordeelt
XAU/USD-impact van actueel nieuws (oorlogen, centrale-bank-uitspraken, inflatie,
sancties) uitsluitend op basis van nieuwskoppen — zonder toegang tot candles,
indicatoren of conclusies van andere agents. Als er geen nieuws beschikbaar is,
retourneert het `NO_NEWS_RESULT` (confidence 0, neutraal) zodat de boardroom-flow
nooit blokkeert.

- `services/newsService.js`: nieuwsaggregator met goud-keyword-filter,
  deduplicatie en stille fallback bij API-fouten (NewsAPI, Finnhub, GNews parallel).
- `agents/boardroom.js`: `assessGeopolitical` parallel met de andere agents; het
  geopolitical-veld in het discussion-object. Analist-rebuttal en CEO wegen de
  geopolitieke stem alleen mee als `confidence > 0` (guard).
- `services/boardroomReporter.js`: 📰-regel in trace-berichten bij actief nieuws.
- 39 nieuwe tests: `test-newsService.js` (19) + `test-geopoliticalAnalyst.js` (21)
  + uitbreiding `test-boardroomReporter.js`. Totaal: 223 tests, 0 mislukt.

## Fase 23 - Multi-timeframe analyse (M30 + M15 naast H1) (klaar)

Drie onafhankelijke schedulers op eigen Discord-kanalen:
- H1: elke 60 min, 50 candles (bestaand, ongewijzigd)
- M30: elke 30 min, 100 candles → `#m30-ceo` / `#m30-trace`
- M15: elke 15 min, 100 candles → `#m15-ceo` / `#m15-trace`

Gestaggerde opstartvertraging (H1=0s, M30=75s, M15=150s) voorkomt gelijktijdige
Twelve Data-calls bij bot-herstart (8 credits/min limiet). `reportToDiscord`
accepteert nu optionele `{ ceoChannelId, traceChannelId }` override-parameters.

## Fase 24 - Condition-based setup-detector (klaar)

De bot analyseert niet meer blind op een klok maar alleen wanneer alle vier
voorwaarden tegelijk voldaan zijn — hoog-kansen setups in plaats van ruis:

1. **Sessiefilter**: alleen 08:00-17:00 UTC (London + NY overlap)
2. **Multi-timeframe alignment**: H1 + M30 + M15 moeten allen dezelfde richting
   laten zien (SMA20, RSI14, recente candle-structuur — meerderheid beslist)
3. **Trendfilter**: D1 en W1 moeten dezelfde richting wijzen (counter-trend geblokkeerd)
4. **Sleutelniveau-proximity**: prijs binnen 0.5×ATR(14) van een wekelijks pivot
   (PP/R1/S1/R2/S2, vorige week H/L) of rond getal ($50-interval)

Nieuwe bestanden: `agents/keyLevels.js`, `agents/multiTimeframeAlignment.js`,
`services/conditionChecker.js`. Poll elke 5 minuten, 4u cooldown na signaal.
69 nieuwe tests. Totaal: 292 tests, 0 mislukt.

**Kritieke bug (gelijktijdig opgelost)**: `isActiveSession()` werd in
`checkConditions()` pas na de API-calls gecheckt, waardoor de bot buiten
08:00-17:00 UTC iedere poll alle Twelve Data-credits verbruikte. Fix: check
vóór `Promise.all([...API-calls])` in `poll()`.

## Fase 25 - Discord-alerting: fouten, heartbeat, startup (klaar)

Tot Fase 25 was er geen terugkoppeling als de bot crashte, errors gooidde of
stil werd (bv. door kredietlimiet). Twee dagen productie-monitoring gingen
hierdoor verloren.

- `services/botAlerts.js`: `sendDedupedAlert` (max 1x/uur per error-key),
  `sendHeartbeat` (dagelijks 08:00 UTC), `sendStartupAlert` (bij deploy).
- `formatErrorAlert`: detecteert krediet-, rate-limit- en generieke fouten.
- `services/scheduler.js` bijgewerkt: heartbeat-check in `poll()`, startup-alert
  in `startSignalScheduler()`, `sendDedupedAlert` in de catch-block.
- 13 tests (`scripts/test-botAlerts.js`).

## Fase 26 - Prompt-verbeteringen op basis van N=240 backtest-analyse (klaar)

Gerichte verbeteringen op basis van gemeten patronen in `data/backtests.json`:
- **Analist-rebuttal**: expliciete regels voor zekerheidsaanpassing op basis van
  consensus (rebuttal omlaag → sterk waarschuwingssignaal voor CEO).
- **Devil's Advocate**: eerlijk oppositioneel mandaat toegevoegd; geforceerd
  tegenargument vervangen door "eerlijke oppositie is waardevoller dan kunstmatig
  challengen".
- **CEO**: minimale 65%-drempel voor directioneel signaal; neutraal bij dalende
  rebuttal tenzij overige stemmen onmiskenbaar dezelfde richting wijzen.
- **Risicomanager (26b)**: R:R-richtlijn 1:1.2–1:2.0 met expliciete waarschuwing
  dat >2.5 de trefkans sterk verlaagt; confidence-linked positiegrootte.

## Fase 27 - `/status` command + economische kalender uitgebreid (klaar)

- `/status` toont live alle 4 condities (sessie, M15/M30/H1-alignment,
  D1/W1-trend, proximity) met actuele marktdata.
- Economische kalender uitgebreid tot december 2026 (NFP, CPI, PPI,
  Retail Sales, FOMC, GDP).

## Fase 28 - Macro-briefing: contextuele voorbereiding voor alle agents (klaar)

**Filosifie**: "Als je alleen op basis van live data gaat traden, ben je in
principe in een casino." Pre-market context (macro-thesis, komende events,
marktsentiment) moet in het besluitvormingsproces mee.

- `services/macroBriefing.js`: opslag in `data/macroBriefing.json` met 7-daagse
  TTL. Functies: `getBriefing`, `setBriefing`, `clearBriefing`,
  `isBriefingValid`, `formatBriefingNote`.
- `/briefing` Discord-commando: set/view/clear.
- `agents/boardroom.js`: briefing-note toegevoegd aan `contextNotes` (alle agents).
- 15 tests (`scripts/test-macroBriefing.js`).

## Fase 29 - Complete agent-rewrites: XAU-specifieke expert personas (klaar)

Volledige herziening van alle 6 agent-prompts op basis van backtest-inzichten
(N=286, 22 runs) en gold-market expertise. Doel: generieke agents → specialisten
die redeneren zoals institutionele traders.

### Indicatoren (`agents/indicators.js`)
EMA50 en MACD(12,26,9) toegevoegd. 42 tests.

### Technisch analist (`agents/analyst.js`)
Senior XAU-specialist persona (15 jaar institutionele goudmarkt). 6-staps CoT
structuur (marktstructuur → trendbevestiging → sleutelniveaus → momentum →
entry trigger → conclusie). Gold-specifieke kennis: ronde $50-niveaus,
liquiditeitszones, order blocks, FVGs, London Fix (10:30 UTC), NY-false-break.
max_tokens: 512 → 1024.

### Macro-analist (`agents/macroAnalyst.js`)
4 goud-macro drivers gerangschikt op historisch belang: (1) reële rente,
(2) dollar inverse, (3) safe haven met USD-paradox, (4) inflatie hedge.
Gold-specifieke risk-on/off definitie (niet hetzelfde als equities).

### Bear Researcher (`agents/devilsAdvocate.js`)
Van "geforceerde oppositie" naar "eerlijk mandaat": lage counter-zekerheid is
waardevoller dan kunstmatige twijfel. Specifieke zoekgebieden: counter-trend
structuur, liquiditeitsvallen, macro-tegenwind, overbought/oversold extremen,
zwakke entry. Backtest-bevestiging: DA "eens" → 50% winRate (N=20) vs.
"oneens" → 38.9%.

### CEO (`agents/ceo.js`)
Expliciet 40/30/30 weegschema: technische analyse (analist + weerwoord) 40%,
macro/geopolitiek 30%, tegenscenario 30%. Zekerheidsdrempels per consensus-niveau:
alle eensgezind >70%, tech+macro eensgezind 60-70%, verdeeld → neutraal.
Twee vaste drempels: weerwoord omlaag → neutraal, minimaal 65% voor directie.
max_tokens: 1024 → 1536.

### Geopolitieke analist (`agents/geopoliticalAnalyst.js`, fase 29b)
Senior strateeg persona. 6 goud-nieuws drivers gerangschikt: centrale bankaankopen,
Fed-signalen, geopolitieke crises (met USD-paradox uitgelegd), inflatie/CPI-nuance,
dollarbeleid, sancties/embargo's.

### Risicomanager (`agents/riskManager.js`, fase 29c)
Senior institutioneel risicomanager. Gold-specifieke SL/TP: stop voorbij ronde
$50-niveaus (stop hunt preventie), minimum 0.5×ATR, TP max 2×ATR voor intraday.
Volatiliteitsdrempel: avg range >30 → positiegrootte één stap lager.

### Backtest #22 (klaar)
45-dagenrun (N=29), vergelijking Record #21 vs #22 (exacte zelfde periode):
- Record #21 (oude prompts): 37.5% winRate (9 TP / 10 SL / 0 neutraal / 10 neutral)
- Record #22 (Fase 29 prompts): **56.3% winRate** (9 TP / 7 SL / 13 neutraal)
- Verbetering: +18.8pp. Nieuwe prompts filteren agressiever (13 vs 1 neutraal)
  en winnen vaker wanneer ze wél handelen. Gedragsverandering correct.

### Cumulatieve analyse (N=313, 22 runs)
Sterkste voorspellers bevestigd:
- Rebuttal omhoog: 49.6% winRate vs. omlaag: 30.3% (19.3pp gap)
- R:R >2.5: 24% winRate (filter correct)
- DA "eens" met besluit: 50% (N=20)
- CEO confidence >70%: 43.3% vs. 60-70%: 43.2% (nauwelijks verschil)

## Fase 30 - ICT/SMC prompt-optimalisatie (klaar)

Op basis van online research naar ICT (Inner Circle Trader) en SMC (Smart Money
Concepts) frameworks, gevalideerd door backtest #22 (+18.8pp).

### Technisch analist (`agents/analyst.js`)
Volledige vervanging van generieke gold-kennis door ICT/SMC-framework:
- BOS (Break of Structure) vs CHoCH (Change of Character) — CHoCH is zwaarder
- Premium/Discount zones: equilibrium (50%-punt van recente range) als referentie
- Liquiditeitslogica: gelijke H/L als stop-clusters, institutioneel "sweepen"
- Judas Swing (London 07:00-10:00 UTC): valse breakout Aziatische range
- New York Kill Zone (12:00-15:00 UTC): echte institutionele beweging
- Inducement, Order Blocks, Breaker Blocks, Fair Value Gaps (FVG)
- Ronde $50-niveaus als harde institutionele zones
CoT uitgebreid van 6 naar 7 stappen — stap 4: SESSIE & MANIPULATIECONTEXT.
Weerwoord: specifieke reactie op elk van de 5 DA-categorieën verplicht;
Judas Swing (②) = zwaar wegende informatie.

### Bear Researcher (`agents/devilsAdvocate.js`)
5-categorieën mandaat nu gebaseerd op onderzoek ("Only the Devil's Advocate
Works" paper): expliciete structuur geeft 99.2% challenge-rate vs. 55% voor
zachte mandaten. Verplichte zoekgebieden met concrete ICT/SMC-criteria:
① Marktstructuur (CHoCH hogere TF), ② Liquiditeitsval/Judas Swing (stop-cluster,
premium/discount), ③ Macro-tegenwind, ④ Momentum-waarschuwing (RSI/MACD),
⑤ Entry-kwaliteit (trigger, te laat, SL logisch). max_tokens: 512 → 1024.

### Macro-analist (`agents/macroAnalyst.js`)
Sessie-context voor goud toegevoegd: Aziatische sessie (accumulatie, low
liquiditeit), London Kill Zone (manipulatiefase, Judas Swings), NY Kill Zone
(echte institutionele beweging), London Close (positie-sluiting).

### CEO (`agents/ceo.js`, Fase 30b)
Specifieke DA-categorie weging toegevoegd:
- Categorie ② (Judas Swing/liquiditeitsval) = zwaarste single-factor risico
  in goudhandel. Verlaag zekerheid significant of kies neutraal.
- Lage counter-zekerheid zonder argumenten in alle vijf categorieën = sterk
  bevestigingssignaal.
Vaste drempel 4 toegevoegd: sessie-check (London Kill Zone zonder bewijs van
afgeronde Judas Swing → zekerheid verlagen of neutraal).

### Backtest #23 (klaar)
Validatie van Fase 30 (ICT/SMC) op een verse 30-dagenperiode: **58.3% winRate**
(7 TP / 5 SL). Bevestigt dat ICT/SMC-framework stand houdt op een andere periode
dan het development-window van Fase 29.

## Fase 31 - Unieke agent-specialisaties: geen overlap, geen ja-knikkers (klaar)

### Aanleiding
Audit van de agent-prompts toonde structurele overlap: meerdere agents beoordeelden
dezelfde dimensies (o.a. sessie-context in zowel macro-analist als geo-analist, geen
strikte taakverdeling). Gevolg: agents bevestigden elkaar eerder dan dat ze echt
andere invalshoeken aandroegen. Elke agent heeft nu één exclusieve vraag die de
anderen níet beantwoorden.

### Exclusieve mandaten per agent

| Agent | Exclusieve vraag |
|---|---|
| Analyst [A] | "Wat zegt de marktstructuur en waar ligt de liquiditeit?" |
| RiskManager [B] | "Wat zijn de exacte trade-parameters incl. entry-zone?" |
| DevilsAdvocate [C] | "Stel de trade mislukt — wat hebben we gemist?" (pre-mortem) |
| MacroAnalyst [D] | "Wat is het macro-regime EN bevestigt het momentum dat?" |
| GeopoliticalAnalyst [E] | "Wat zeggen events + sessie-timing over betrouwbaarheid?" |
| CEO [F] | Weegt 5 unieke perspectieven; rapporteert als enige naar buiten |

### Pre-mortem methodologie (`agents/devilsAdvocate.js`)
Volledige transformatie: van "toon bezwaren" naar prospective hindsight. De DA
stelt zich voor dat de trade al gestopt is op de stop-loss en reconstrueert wat er
mis ging. 5 verplichte faalscenario's met concrete ICT/SMC-criteria:
① HTF-structuur fout (CHoCH genegeerd), ② Institutionele val/Judas Swing
(stop-cluster geraakt), ③ Timing mismatch (verkeerde sessie), ④ Zone al verwerkt
(OB/FVG al uitgeput), ⑤ Genegeerd bewijs (indicator-divergentie). Als na grondig
onderzoek geen overtuigend faalscenario gevonden wordt: lage counterConfidence
melden — "setup houdt stand tegen pre-mortem" is de meest waardevolle uitkomst.

### Momentum als regimebevestiging (`agents/macroAnalyst.js`)
Sessie-context verwijderd (verplaatst naar geo-analist). Nieuwe sectie toegevoegd:
TECHNISCH MOMENTUM ALS REGIMEBEVESTIGING — EMA50, RSI en MACD als bevestiging of
contradictie van het macro-regime. max_tokens: 512 → 1024.

### Sessie & timing (`agents/geopoliticalAnalyst.js`)
Nieuw exclusief mandaat: geopolitieke events + sessie-timing + near-term event risk.
Monetair beleid (Fed/rente) expliciet uitgesloten ("valt onder de macro-analist").
Sessie-timing inferred uit recente nieuwskoppen. max_tokens: 512 → 768.

### Entry-zone (`agents/riskManager.js`)
Nieuwe ENTRY-ZONE sectie: geeft een concrete prijsrange ("Optimale entry-zone:
$X–$Y") op basis van OB/FVG-locaties. Meldt expliciet als de huidige prijs al
te ver van de zone is ("entry te laat").

### CEO-weegschema bijgewerkt (`agents/ceo.js`)
Nieuwe gewichten op basis van de 5 exclusieve perspectieven:
- Structuur + Liquiditeit [A + F rebuttal]: 35%
- Macro + Momentum [D]: 25%
- Pre-mortem [C]: 20%
- Geo + Timing [E]: 20%
Vaste drempel 3 bijgewerkt: pre-mortem scenario ② (institutionele val/Judas Swing)
met hoge overtuigingskracht → zwaarste single-factor risico.

### Backtest #24 (klaar)
Validatie van Fase 31 (niet-overlappende specialisaties): **80.0% winRate**
(N=10 trades: 8 TP / 2 SL / 19 neutraal). Grootste sprong tot dan toe:
backtest-progressie #21→#22→#23→#24 = 37.5%→56.3%→58.3%→80.0%.

## Fase 32 - Pre-mortem counterConfidence als vijfde kwaliteitsfilter (klaar)

### Aanleiding
Pre-mortem scenario ② (institutionele val/Judas Swing) met counterConfidence >70%
was al het zwaarste single-factor risico in de CEO-weging (Fase 31). Consistente
toepassing vereist dat dit ook als harde blocker in `assessSignalQuality` zit,
zodat het filter ook buiten de CEO-redenering actief is.

### Implementatie (`agents/agentAnalysis.js`)
Vijfde blocker toegevoegd aan `assessSignalQuality`:
```javascript
if ((sample.discussion.devilsAdvocate?.counterConfidence ?? 0) > 70) {
  blockers.push('pre-mortem: duidelijk faalscenario gevonden (>70%)');
}
```
Optioneel chaining + nullish coalescing zorgt dat ontbrekende discussie-data
geen false trigger geeft.

### Vijf kwaliteitsfilters na Fase 32
1. CEO-zekerheid < 60%
2. Macro contraireert de richting
3. Analist verloor vertrouwen na discussie (rebuttal omlaag)
4. R:R > 2.5
5. **Pre-mortem: duidelijk faalscenario gevonden (counterConfidence > 70%)**

## Fase 33 - Momentum-contradictie regel + sessie-timing als pure context (klaar)

### Root-cause analyse SL-trades uit backtest #24
Twee SL-trades onderzocht op oorzaak:
- **SL Trade 2**: MacroAnalyst zag MACD-divergentie maar negeerde het vanwege
  sterke macro-drivers. Geen expliciete regel om momentum-contradictie te forceren.
- **SL Trade 1**: DevilsAdvocate counterConfidence 62% (net onder de nieuwe >70%
  blocker). Sessie-context ontbrak als aanvullend signaal.

### Momentum-contradictie regel (`agents/macroAnalyst.js`)
Verplichte cap: als technisch momentum de macro-richting tegenspreekt, max 55%
zekerheid ongeacht hoe sterk de macro-drivers lijken:
- Bearish macro MAAR MACD stijgt richting signaallijn → max 55%
- Bearish macro MAAR RSI boven 50 of stijgend → max 55%
- Bullish macro MAAR MACD daalt onder signaallijn → max 55%
- Bullish macro MAAR RSI onder 45 of dalend → max 55%
Reden: momentum-divergentie in een "bewezen" macro-regime is historisch een
van de sterkste reversal-signalen.

### Sessie-context als pure functie (`agents/sessionContext.js`, nieuw)
**Probleem ontdekt**: de geo-analist retourneert `NO_NEWS_RESULT` (confidence=0)
als `newsItems=[]` — in backtests waren er nooit nieuwsberichten, dus de
sessie-timing werd in géén enkele backtest-sample gebruikt. Fix: pure UTC-tijdfunctie
die volledig onafhankelijk van nieuws werkt.

```javascript
const SESSIONS = [
  { zone: 'Asian',           from: 0,  to: 7,  reliability: 'laag',   note: '...' },
  { zone: 'London Kill Zone',from: 7,  to: 10, reliability: 'RISICO', note: '...' },
  { zone: 'London-NY overlap',from: 10, to: 12, reliability: 'matig', note: '...' },
  { zone: 'NY Kill Zone',    from: 12, to: 15, reliability: 'hoog',   note: '...' },
  { zone: 'London Close',    from: 15, to: 17, reliability: 'matig',  note: '...' },
  { zone: 'Off-peak',        from: 17, to: 24, reliability: 'laag',   note: '...' },
];
```

### Integratie (`agents/boardroom.js`)
`sessionNote` toegevoegd aan `contextNotes` (alle agents ontvangen het):
```javascript
const sessionTime = currentTime ? new Date(currentTime) : new Date();
const sessionNote = formatSessionNote(assessSession(sessionTime));
const contextNotes = indicatorsNote + dollarContextNote + yieldContextNote
                   + dailyContextNote + briefingNote + sessionNote;
```
`scripts/backtest.js` geeft nu `currentTime: sampleTime` mee aan `runDiscussion`,
zodat historische samples de correcte sessie-timing gebruiken (niet "nu").

### Validatie
- `scripts/test-sessionContext.js` (nieuw): 19 tests voor alle 6 sessiezones,
  grenscondities (06:59/07:00, 09:59/10:00 etc.) en `formatSessionNote`.
- Totaal: 221 tests, 0 mislukt.

### Out-of-sample backtest resultaat (record #25)
150-dagenrun jan–jun 2026 voltooid: **N=24, WinRate 37.5%** (9 TP / 15 SL).
Teleurstellend — verklaring: 22/24 signalen bearish in een structurele bull-markt.
Root-cause: geen W1-weektrend-context, systematische bearish bias ICT/SMC-setup
detection tijdens een uptrend, regime-mismatch.

## Fase 34 - Weektrend-context + counter-trend kwaliteitsfilter (klaar)

### Root-cause analyse OOS 37.5%
- **Primaire oorzaak**: systeem miste W1-weektrend. D1+W1 beiden bullish, maar
  22/24 signalen waren bearish → counter-trend entry in een bull-markt.
- **Structurele gap**: backtest gebruikte geen W1-data; live condition checker had
  het al (Fase 24), backtest niet.
- **Consequentie**: agent-structuur was gecalibreerd op 2025-historische data met
  andere marktregimes; OOS-periode (2026 bull run) maakte dit zichtbaar.

### W1 weektrend-context (`agents/weeklyContext.js`, nieuw)
Zelfde patroon als `dailyContext.js` (Fase 21), maar voor W1-timeframe:
```javascript
export function computeWeeklyContext(candles) {
  // bias via computeTimeframeBias: price vs SMA20 + RSI vs 50 + 3-candle closes
  return { currentClose, sma20, priceVsSma, fiveWeekChangePct, trend };
}
export function formatWeeklyContextNote(ctx) { ... }
```
`scripts/backtest.js`: haalt 25 extra weken W1-candles op (vóór de testperiode),
geeft `w1Candles` mee aan `runDiscussion` via `w1WindowFor(sampleTime)`.

### Zesde kwaliteitsfilter: counter-trend blocker (`agents/agentAnalysis.js`)
Als D1 én W1 beide zelfde richting én het signaal is tegengesteld → geblokkeerd:
```javascript
if (dailyTrend && weeklyTrend && dailyTrend !== 'neutraal' && weeklyTrend !== 'neutraal'
    && dailyTrend === weeklyTrend) {
  const isContrarian = (signal === 'bullish' && dailyTrend === 'bearish')
                    || (signal === 'bearish' && dailyTrend === 'bullish');
  if (isContrarian) blockers.push(`counter-trend: signaal ${signal} tegen D1+W1 ${dailyTrend} trend`);
}
```

### CEO vaste drempel 5 (`agents/ceo.js`)
"Als W1+D1 beide zelfde richting → tegengesteld signaal max 55% zekerheid,
ongeacht hoe sterk de H1-structuur eruitziet."

### Structurele goudvraag in MacroAnalyst (Fase 34 aanvulling)
Nieuwe sectie in macroAnalyst.js-prompt: CB-aankopen, de-dollarisering,
correlatie-breuk detectie (als goud stijgt terwijl dollar ook stijgt → breuk
van historische correlatie, extra bullish signal).

### Validatie
- `scripts/test-weeklyContext.js` (nieuw): 23 tests
- `scripts/test-agentAnalysis.js`: +7 counter-trend tests (totaal 50)
- Totaal: 298 tests, 0 mislukt.

## Fase 35 - Volledige agent-audit: persona's, expertise en Chief of Staff (klaar)

### Aanleiding
OOS 37.5% + diepere analyse toonde aan dat agent-persona's te generiek waren.
CEO had geen onafhankelijk oordeel, geen historische marktkennis. RiskManager
miste portfolio-context bij verliesreeksen. DevilsAdvocate-kalibratie was impliciet.

### Per-agent audit en correcties

**CEO (`agents/ceo.js`)**
- **Persona**: 25 jaar trading director — floor trader jaren '90 → hoofd goud-desk
  twee tier-1 banken → eigen boutique macro-fonds XAU/USD kernstrategie.
- **Kennis**: 9/11-rally, GFC, decennium nulrentes, structurele bull-run 2022-2026.
- **Toevoeging**: CEO voegt eigen oordeel toe dat NIET louter aggregatie is.
  "Als jouw ervaring iets anders zegt dan de meerderheid — benoem dat expliciet."
- **Sub-agent**: Chief of Staff briefing (zie hieronder).

**Chief of Staff (`services/ceoPerformanceBriefing.js`, nieuw)**
CEO ontvangt vóór elke vergadering een performance-briefing:
- Laatste 10 afgeronde signalen: N TP / N SL, recente WinRate
- REEKS-ALERT bij ≥3 SL achtereen → verhoog drempel
- TP-reeks alert → behoud discipline
- RiskManager ontvangt aparte streakNote (≥3 SL → standaard 'klein')

**MarktstructuurAnalist (`agents/analyst.js`)**
- **Persona**: begon 2009, specifieke marktcycli (top 2011, beer 2015, rally
  2018-2020, 2024-2026 bull run). Multi-billion dollar goud hedge fund.
- `reviewDiscussion` max_tokens 512→768
- Rebuttal verplicht per-scenario reactie met severity-indicator (⚠️ bij >50%)
- ZEKERHEIDSREGEL: "Ongewijzigd percentage alleen gerechtvaardigd als je elk
  punt concreet kunt weerleggen."

**RiskManager (`agents/riskManager.js`)**
- **Persona**: 12j prop-trading desk, 3.000+ goud-trades beoordeeld.
- max_tokens 512→768
- `streakNote`-parameter: als ≥3 SL-reeks → standaard 'klein' positiegrootte.

**DevilsAdvocate (`agents/devilsAdvocate.js`)**
- **Persona**: voormalig prop trader, 8j macro hedge fund, gespecialiseerd in
  trade-autopsies.
- Expliciete counterConfidence-kalibratieschaal:
  - 0-30%: setup houdt volledig stand
  - 31-50%: zwak risico, aanwezig maar matig
  - 51-65%: matig risico, overweeg positieverkleining
  - 66-80%: sterk risico, team moet bezwaar expliciet weerleggen
  - 81-100%: zeker gevaar, neutraal tenzij weerlegging ijzersterk is

**MacroAnalyst (`agents/macroAnalyst.js`)**
- **Persona**: PhD econometrie, 12j global macro hedge fund; correlatie-breuk
  2022-2026 zelf geanalyseerd.
- Expliciete instructie: gebruik macro-briefing uit contextNotes als startpunt.

**GeopolitiekAnalist (`agents/geopoliticalAnalyst.js`)**
- **Persona**: voormalig sovereign wealth fund adviseur, 15j event-impact.
  Arabische Lente/Oekraïne/COVID/Rusland/BRICS+ direct geanalyseerd.
- Sessie-timing sectie verwijderd (overlap met sessionContext.js, Fase 33).
- Eigen EVENT-RISICO ANALYSE sectie: signaleer events die trade omverwerpen
  vóórdat TP geraakt wordt.

### Kwaliteitsfilters totaaloverzicht (na Fase 35)
1. CEO confidence <65%
2. Macro contradicteert richting
3. Weerwoord [F] significant lager dan [A]
4. R:R >2.5 niet gehaald
5. DevilsAdvocate counterConfidence >70% (pre-mortem blocker, Fase 32)
6. Counter-trend: signaal vs D1+W1 aligned trend (Fase 34)

### Validatie
Alle bestaande tests heruitgevoerd na audit:
- 50 + 23 + 42 + 46 + 7 + 19 + 15 + 27 + 13 + 7 + 22 + 23 + 27 = **298 tests, 0 mislukt**

## Fase 36 - ICT/SMC setup-kwaliteitscriteria: van vrije tekst naar gestructureerd veld (klaar)

### Aanleiding
Prompt-audit (Fase 35) toonde een gap: agents beoordeelden "setup-kwaliteit" impliciet
via vrije tekst in `reasoning`. Er was geen gedeeld, meetbaar kader voor wat een
goede ICT/SMC-setup definieert. CEO kon kwaliteitsoordeel niet objectief wegen.

### 6 ICT/SMC Setup-kwaliteitscriteria (Fase 36a)
Geïmplementeerd in `agents/analyst.js` als SETUP KWALITEITSOORDEEL-sectie (vóór structuuranalyse):
1. ① HTF-bias helder (D1/W1 richting eenduidig)
2. ② Correcte premium/discount zone (entry in discount bij bullish, premium bij bearish)
3. ③ Verse zone (OB of FVG nog niet retested)
4. ④ Liquiditeitssweep bevestigd (BSL/SSL geraakt vóór de move)
5. ⑤ LTF CHoCH trigger aanwezig (M15/M5 structuurbreuk als entrybevestiging)
6. ⑥ Kill Zone timing (entry valt in London 07:00–10:00 of NY 12:00–15:00 UTC)

`setupQualityScore` toegevoegd als verplicht integer-veld (0–6) aan ANALYSIS_TOOL schema.

### Prompt-consistentie fixes (Fase 36b)
- `analyst.js`: mandate-contradictie opgelost — "geen sessie-timing" conflicteerde met
  criterium ⑥; fixed: sessie-info komt uit contextNotes, uitsluitend voor criterium ⑥
- `ceo.js`: SETUP KWALITEIT-sectie verplaatst vóór BESLISSINGSGEWICHTEN (prerequisite)
- `ceo.js`: geo-analist-beschrijving gecorrigeerd (sessie-timing was in Fase 35 verwijderd)
- `riskManager.js`: expliciete koppeling `setupQualityScore <3 → altijd 'klein'`

### Algorithmische handhaving (Fase 36c)
7e kwaliteitsfilter toegevoegd in `agents/agentAnalysis.js`:
```
setupQualityScore < 3 → geblokkeerd ("setup-kwaliteit te laag (N/6 criteria aanwezig)")
```
Kwaliteitsfilters totaal na Fase 36:
1. CEO confidence <65%
2. Macro contradicteert richting
3. Weerwoord [F] significant lager dan [A]
4. R:R >2.5 niet gehaald
5. DevilsAdvocate counterConfidence >70%
6. Counter-trend: signaal vs D1+W1 aligned trend
7. setupQualityScore <3 (nieuw)

### CEO-drempelregels voor setupQualityScore
- Score <3 → altijd neutraal (algoritmisch geblokkeerd + CEO-instructie)
- Score 3–4 → maximaal 65% zekerheid
- Score 5–6 → high-quality setup; hogere zekerheid gerechtvaardigd

### Validatie
- `scripts/test-agentAnalysis.js`: +5 setupQualityScore-tests (totaal 55)
- Alle 22 testsuites: **378 tests, 0 mislukt**

## Fase 37 - Langetermijn-filosofie CEO + structurele gezondheidscheck (klaar)

### Aanleiding
Bot draait live; borgen dat het systeem niet naar hogere handelsfrequentie drijft
en dat structuurfouten in agent-outputs vroeg gesignaleerd worden.

### CEO langetermijn-filosofie
KERNPRINCIPE toegevoegd aan CEO-prompt (`agents/ceo.js`):
> "Dit systeem is gebouwd voor kwaliteit, niet voor handelsfrequentie. Één goede
> setup per week is waardevoller dan tien twijfelachtige. Selectief zijn is geen
> tekortkoming, het is de kern van het systeem. Forceer geen richting als de
> condities er niet zijn — neutraal is een besluit, geen mislukking."

### Structurele validator (`services/signalValidator.js`, nieuw)
Pure functies, geen I/O, volledig unit-testbaar:
- `validateSignalStructure(result)`: schema-checks (signal enum, confidence 0–100,
  positionSize enum, setupQualityScore 0–6, macro.sentiment enum,
  devilsAdvocate.counterConfidence 0–100) + logische consistentiechecks
  (score<3+passed=true → INCONSISTENTIE, conf<60+passed=true → INCONSISTENTIE,
  SL/TP richting vs signaal)
- `formatHealthReport(validation, context)`: leesbaar rapport per validatie-run
- `summarizeSignalHealth(signals)`: geaggregeerde gezondheid over N signalen
  incl. setupQualityScore-verdeling

Validator aangekoppeld in `agents/boardroom.js`: na elke run wordt het volledige
resultaat gevalideerd; fouten/waarschuwingen naar `console.warn`.

### Discord `/health` commando (`discord/bot.js`)
Nieuwe slash-command die de laatste 20 signalen valideert en toont:
- Structurele status (0 fouten of N fouten)
- Signaalverdeling (passed / geblokkeerd / neutraal)
- setupQualityScore-verdeling (0 t/m 6 + ontbrekend)
- Meest actieve kwaliteitsfilters (welke blockers het vaakst vuren)
- Gevonden structuurfouten indien aanwezig

### Winrate-filosofie (gecorrigeerd)
Gebruiker heeft expliciet aangegeven: winrate is een UITKOMST, geen DOEL.
De juiste vraag bij elke backtest: "Doen de agents precies wat ze zouden moeten doen?"
Een hoge winrate die voortkomt uit correct gedrag is waardevol; een hoge winrate
als target leidt tot overfitting en ondermijnt de systeemintegriteit.

### Validatie
- `scripts/test-signalValidator.js` (nieuw): 25 tests

## Fase 38 - Live testfase + conditie-diagnostiek + kritieke ATR-bugfix (klaar)

### Aanleiding
Live testfase gestart 2026-06-22 op Railway. Na 5 dagen: 0 getriggerde
signalen. Vraag: is dit terechte selectiviteit, of een verborgen probleem?

### Twee productie-bugs gevonden tijdens live testen
1. **`/health` crashte zonder live signalen** - `summarizeSignalHealth([])`
   miste `scoreDist`/`invalid` in de return-waarde. Fix in
   `services/signalValidator.js`.
2. **Geen persistent Railway-volume** - `data/signals.json` stond op
   tijdelijke container-filesystem; elke redeploy/restart wiste de live
   signaalhistorie. Fix: volume gemount op `/app/data/live` (niet `/app/data`
   zelf, dat zou `data/store.js` overschrijven). `data/store.js`,
   `services/macroBriefing.js`, `services/ceoPerformanceBriefing.js`
   verwijzen nu naar `data/live/`.

### Conditie-diagnostiek (`services/conditionDiagnostics.js`, nieuw)
Passieve logging per poll-cyclus van welke van de vier condities (sessie,
TF-alignment, D1/W1-trend, sleutelniveau) wel/niet klopten - beinvloedt de
triggerbeslissing niet. `/diagnose` Discord-commando toont de geaggregeerde
samenvatting (blocker-frequentie, slagingspercentage per conditie).

### Kritieke bug: sleutelniveau-conditie blokkeerde altijd
`agents/keyLevels.js`'s `checkKeyLevelProximity()` las `indicators.atr`
(bestaat niet) i.p.v. `indicators.atr14` (zie `agents/indicators.js`).
`isNearKeyLevel()`'s guard (`if (!atr ...)`) gaf hierdoor **altijd**
`near: false` terug, onafhankelijk van de daadwerkelijke prijsafstand tot een
sleutelniveau. Deze conditie was sinds de introductie (Fase 24, 20 juni)
structureel onmogelijk te halen - de 5 dagen zonder live signaal hadden dus
primair deze oorzaak, niet (alleen) marktomstandigheden of terechte
selectiviteit.

**Gevonden via `scripts/backfillConditions.js` (nieuw)**: simuleert de
conditie-checker met terugwerkende kracht op echte historische candles
(zelfde methodologie als de bestaande backtests, maar dan specifiek tegen de
conditie-checker i.p.v. de boardroom). Resultaat vóór de fix: sleutelniveau-
conditie 0% geslaagd over 45 gesimuleerde polls (22-27 juni). Na de fix:
64.4% geslaagd, met 8 momenten die de boardroom daadwerkelijk getriggerd
zouden hebben.

**Why dit relevant is**: `checkKeyLevelProximity()` had geen enkele unit-test
vóór deze fase - exact de reden dat de bug onopgemerkt bleef. 3 nieuwe
regressietests toegevoegd in `scripts/test-keyLevels.js`.

### Beslissing: 3 juli 2026 als ijkpunt
Gebruiker kiest 3 juli (in plaats van de eerder besproken twee-weken-
richtlijn) als laatste testdag met de huidige conditie-checker/filters.
Belangrijke kanttekening: omdat de ATR-bug tot 27 juni actief was, is de
periode 22-27 juni **geen valide test van het bedoelde systeem** geweest -
de eerste echte test loopt dus pas vanaf de fix (27 juni) tot 3 juli.

### Validatie
- 21 nieuwe tests (`scripts/test-conditionDiagnostics.js`)
- 3 nieuwe regressietests (`scripts/test-keyLevels.js`)
- Alle testsuites blijven groen na elke wijziging
- Alle 22 testsuites: **378 tests, 0 mislukt**

## Fase 39 - Eerste live triggers + Discord-berichtlengte-bugfix (klaar)

### Aanleiding
29 juni, 08:46 UTC: eerste live trigger sinds de Fase 38-fix. Crashte direct
met "Invalid Form Body / content[BASE_TYPE_MAX_LENGTH]: Must be 2000 or fewer
in length." CEO-reasoning kan makkelijk 1500-2500+ tekens zijn (gezien in
eerdere replay-analyses) en overschreed Discord's berichtlimiet.

### Root cause en fix
`services/boardroomReporter.js`'s `reportToDiscord`/`reportOutcomes` deden
`channel.send(msg)` zonder lengtecontrole. Nieuwe `truncateForDiscord(text)`
helper (max 2000 tekens, met afkap-notitie) toegepast op alle send-aanroepen.
5 nieuwe regressietests.

**Belangrijk**: het signaal zelf was al correct opgeslagen vóór de crash
(`appendSignal` loopt vóór `reportToDiscord` in `agents/boardroom.js`) - alleen
de Discord-melding ging verloren. Geen dataverlies, wel een gemiste melding.

### Proactieve uitbreiding naar alle Discord-commando's
Dezelfde kwetsbaarheid bestond in `discord/bot.js`'s eigen `editReply`-opbouw,
buiten `boardroomReporter.js` om:
- `/analyse`: embedde `decision.reasoning` rechtstreeks (zelfde veld als de
  crash)
- `/health`, `/diagnose`: kunnen theoretisch lang worden (tot ~27 TF-
  alignment-varianten bij `/diagnose`)
- `/briefing`: toont gebruikersinvoer die Discord's eigen 6000-tekenlimiet
  voor string-opties mag gebruiken, ruim boven de 2000-berichtlimiet

Alle vier nu gewrapt met `truncateForDiscord`. `/geschiedenis` en `/status`
ongewijzigd gelaten - al van nature bounded (max 10 korte regels resp.
briefing-tekst al afgekapt op 200 tekens).

### Live verificatie (29 juni)
Na de fix: tweede trigger (09:00-09:01 UTC) sloeg succesvol op **en** postte
succesvol naar Discord - BEARISH 62%, geblokkeerd door kwaliteitsfilter
(rebuttal-shift + pre-mortem >70%). Bevestigd via `/geschiedenis` in Discord
(niet via `railway run` - zie kanttekening hieronder).

**Kanttekening over verificatiemethode**: `railway run`-CLI-queries tegen
`data/store.js` lieten beide live signalen van 29 juni niet zien, ondanks dat
ze wel degelijk bestonden (bevestigd via het Discord-commando `/geschiedenis`,
dat rechtstreeks in de daadwerkelijk draaiende container leeft). Voor
toekomstige live-verificatie: vertrouw op Discord slash-commands of
`railway logs`, niet op `railway run`-introspectie van de volume-state.

### Validatie
- 5 nieuwe tests (`scripts/test-boardroomReporter.js`)
- Onafhankelijke bugfix: `scripts/test-macroBriefing.js` had een
  hardgecodeerde datum (2026-06-27) die inmiddels in het verleden lag -
  gefixt naar een relatieve datum t.o.v. nu
- Alle testsuites blijven groen

## Fase 39b - Retry-logica voor tijdelijke 5xx-fouten in marketData (klaar)

Twelve Data stuurt bij tijdelijke storingen soms een Cloudflare 520 terug.
Zonder retry werd dit direct als Discord-alert doorgestuurd (valse alarmen).
`services/marketData.js` probeert nu bij elke 5xx-fout nog 2× opnieuw (5s
tussenpoos) vóór de fout naar de scheduler en Discord wordt doorgestuurd.

## Fase 39c - `/diagnose` tijdlijn-modus (dag + uur) (klaar)

Dag- en uur-opties toegevoegd aan `/diagnose`:
- `/diagnose datum:gisteren` → per-uur overzicht van de dag
- `/diagnose datum:2026-07-01 uur:15` → per-poll detail voor dat uur

Nieuwe pure functies in `services/conditionDiagnostics.js`:
`filterConditionLog`, `formatDayReport`, `formatHourReport`. 33 tests groen.

## Fase 40 - Event/spike-trigger naast condition-based boardroom (klaar)

### Aanleiding
De condition-checker werkt op basis van structurele marktcondities (sessie,
alignment, trend). Maar grote macro-events (NFP, PMI, Fed-speeches) veroorzaken
plotse prijsbewegingen die de normale condities omzeilen terwijl de boardroom
wél bijeen geroepen zou moeten worden.

### Implementatie
- Nieuw `services/eventMonitor.js`: `detectPriceSpike(m15Candles)` signaleert
  M15-candles met `high - low >= 2 × ATR14` als event-indicator. Retourneert
  spike-data (candle, grootte, richting) of `null`. `formatSpikeContext` bouwt
  een EVENT-ALERT-string die de macro- en geopolitiek-analist opdraagt de aanleiding
  te identificeren.
- `services/scheduler.js`: aparte spike-cooldown van 2 uur, parallel aan de
  bestaande condition-cooldown van 4 uur. Spike-trigger en condition-trigger zijn
  onafhankelijk van elkaar.
- 21 tests (`scripts/test-eventMonitor.js`).

## Fase 41 - Live Forex Factory-koppeling vervangt statische kalender (klaar)

### Aanleiding
De economische kalender was een hardgecodeerde lijst van events t/m december 2026
(`agents/economicCalendar.js`). Deze had geen actuele waarden (werkelijk vs.
verwacht) en miste events die na de codering gepland werden.

### Implementatie
`agents/economicCalendar.js` volledig herschreven: haalt automatisch
High-impact USD-events op via de Forex Factory community JSON-feed
(`https://nfs.faireconomy.media/ff_calendar_thisweek.json`, 15 min gecached).

Agents ontvangen voortaan:
- Recent vrijgekomen events met werkelijke + verwachte waarden en een
  "beter/slechter dan verwacht"-label voor directe marktcontext
- Aankomende events (komende 48 uur) met verwachting en vorige waarde

De spike-trigger (Fase 40) combineert dit nu met FF-events om de aanleiding
van een beweging direct te identificeren (getest op de PMI van 1 juli 2026).

Gewijzigde bestanden: `agents/economicCalendar.js`, `agents/boardroom.js`,
`services/eventMonitor.js`, `services/scheduler.js`. 24 tests groen.

## Fase 41b - FF date-formaat fix + boardroom eventsNote (klaar)

De FF-feed geeft datums als ISO-timestamp met timezone-offset
(`2026-07-02T08:30:00-04:00`), niet als aparte `date`+`time`-velden.
`etToUtc()` detecteert nu beide formaten automatisch. 27 tests groen.

## Fase 42 - nearLevel optioneel: van harde gate naar zachte context (klaar)

### Aanleiding
`/diagnose` over 920 polls toonde: nearLevel-conditie blokkeerde **859× (93.4%)**
van alle polls. De sleutelniveau-proximity was daarmee de dominante reden waarom
de boardroom nooit bijeen werd geroepen — ook bij structureel sterke marktcondities.

### Implementatie (`services/conditionChecker.js`)
nearLevel verwijderd uit de `blockers`-array. De drie harde gates blijven:
1. Sessiefilter (08:00–17:00 UTC)
2. Multi-timeframe alignment (H1 + M30 + M15)
3. D1/W1 trendfilter (counter-trend geblokkeerd)

nearLevel wordt nog steeds berekend en als contextuele informatie aan de agents
meegegeven (onderdeel van setupQualityScore-criterium ④ — liquiditeitssweep
nabij sleutelniveau). Agents wegen het mee, maar het blokkeert de trigger niet meer.

### Resultaat
Boardroom-triggers begonnen direct na de deployment (29 juni was al gefixt, 5 juli
nearLevel-fix bevestigd actief via /diagnose dalende percentages).

## Fase 43 - Entry-zone als gestructureerd veld + model-upgrade (klaar)

### Entry-zone (`agents/riskManager.js`, `agents/ceo.js`, `services/boardroomReporter.js`)
De risicomanager had al een ENTRY-ZONE sectie in zijn prompt (Fase 31), maar gaf
de zone terug als vrije tekst in `reasoning`. De zone verdween zo in een lange
alinea en bereikte de CEO en het #ceo-kanaal niet consistent.

- `riskManager.js`: `entryZone` als verplicht string-veld in het schema
  (`"$4100–$4108"` of `"Wacht op pullback naar $4100–$4108"` bij late entry).
- `ceo.js`: `entryZone` verplicht overgenomen uit risicomanager-output, ongewijzigd.
  CEO-prompt: "Neem de entry-zone ongewijzigd over in je besluit."
- `boardroomReporter.js`: `formatDecisionBody` toont `Entry: ...` als eerste regel
  na Signaal in het #ceo-kanaal.

### Model-upgrade naar Opus 4.8
`config/index.js`: `ANTHROPIC_MODEL` default gewijzigd van `claude-sonnet-4-6`
naar `claude-opus-4-8`. Alle boardroom-agents (analyst, riskManager, devilsAdvocate,
macroAnalyst, geopoliticalAnalyst, ceo) draaien nu op Opus 4.8 voor diepere
redenering en betere ICT/SMC-interpretatie.

### Bugfix: retry bij netwerk-fouten (aborted/ECONNRESET)
`services/marketData.js` retried alleen bij `status >= 500`, maar netwerk-niveau
fouten (`aborted`, `ECONNRESET`) hebben `err.response === undefined` — `status`
was undefined, conditie was false, geen retry. Fix:
```javascript
if ((!err.response || status >= 500) && retriesLeft > 0) {
```
Fout verscheen in Discord als "Fout in setup-detector / aborted".

## Fase 44 - AMD-fase, sell-the-news decay, weekend-risico (klaar)

Drie aanvullingen op de agent-analyse, elk gericht op een specifieke categorie
van foute-timing-risico's die de bestaande agents nog niet expliciet noemden.

### AMD-fase (`agents/analyst.js`)
Power of Three (Accumulation → Manipulation → Distribution) als verplicht
gestructureerd veld in het ANALYSIS_TOOL schema:
```javascript
amdPhase: { type: 'string', enum: ['accumulation', 'manipulation', 'distribution', 'onduidelijk'] }
```
Stap 4b toegevoegd aan de STRUCTUURANALYSE-prompt:
- `distribution` is alleen handelbaar ná aantoonbaar afgeronde M-fase
  (sweep bevestigd + CHoCH). Als M niet afgerond is: zekerheid omlaag of neutraal.
- AMD-fase verschijnt in het #trace-kanaal naast het signaal van de analist.

### Sell-the-news risico (`agents/geopoliticalAnalyst.js`)
`sellTheNewsRisk` als verplicht enum-veld (laag/matig/hoog/n.v.t.) in het
GEOPOLITICAL_TOOL schema. Kalibratie:
- `laag`: event < 4 uur oud, prijs nog niet volledig gereageerd
- `matig`: event 4–24 uur oud of prijs al partieel bewogen
- `hoog`: event > 24 uur oud of grote move al achter de rug → reversal-risico
- `n.v.t.`: geen duidelijk marktbewegend event aanwijsbaar

Weergave in #trace alleen als het nìet `n.v.t.` is (ruisfilter).

### Weekend-risico (`agents/boardroom.js`)
Inline `weekendNote` die op vrijdag ≥ 12:00 UTC wordt toegevoegd aan `contextNotes`:
> "⚠️ WEEKEND-RISICO: XAU/USD gapt over het weekend — risicomanager: verlaag
> positiegrootte met één stap t.o.v. de normale berekening."

XAU/USD-gaps kunnen een technisch correcte SL raken zonder dat de structuur breekt.
De note zorgt dat de risicomanager dit meeweegt in de positiegrootte.

### Weergave in trace-kanaal
`services/boardroomReporter.js` bijgewerkt voor beide nieuwe velden:
- Analist: `AMD-fase: distribution` (of accumulation/manipulation/onduidelijk)
- Geopolitiek: `"Sell the news"-risico: hoog` (verborgen bij n.v.t.)
