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
- Resultaten van de steekproef (12 samples, periode 19 mei - 11 juni 2026, XAU/USD
  H1): 11x bearish / 1x bullish signaal, 5 TP / 7 SL -> **winRate 41,7%**
  (gem. zekerheid TP 69%, SL 66%). Details per sample in `data/backtests.json`
  (gitignored, runtime-gegenereerd) - script kan later opnieuw gedraaid worden voor
  een grotere steekproef
- Met Fase 7 logt elk record nu ook de volledige discussie (`discussion`), niet alleen
  het eindbesluit - bruikbaar om te analyseren welke agent-inbreng het meest voorspellend was

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
