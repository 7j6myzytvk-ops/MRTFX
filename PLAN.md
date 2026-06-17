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
