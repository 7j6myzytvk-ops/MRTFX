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
