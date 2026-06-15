# MRTFX

Multi-agent analyse- en signalenserver voor XAU/USD, met Discord als interface.

## Architectuur

- **discord/bot.js** - Discord bot met slash commands (`/status`, `/analyse`,
  `/geschiedenis`, `/performance`)
- **services/marketData.js** - haalt live prijzen en candles op via de Twelve Data API
- **services/scheduler.js** - draait periodiek de boardroom, rapporteert naar Discord
  en evalueert open signalen
- **services/boardroomReporter.js** - formatteert en post de teamdiscussie naar
  het #trace-kanaal en het CEO-besluit naar het #ceo-kanaal
- **services/performanceTracker.js** - `evaluateOpenSignals()`: zet open signalen in
  `data/signals.json` periodiek af tegen de daadwerkelijke prijsbeweging die volgde
  (`tp`/`sl`/`geen`/`open`/`neutraal`/`onbruikbaar`)
- **agents/analyst.js** - Claude-agent die candles analyseert (signaal + zekerheid +
  onderbouwing) en na de discussie een weerwoord geeft
- **agents/riskManager.js** - Claude-agent die stop-loss/take-profit/positiegrootte adviseert
- **agents/devilsAdvocate.js** - Claude-agent die actief het tegenargument zoekt
- **agents/macroAnalyst.js** - Claude-agent die marktsentiment inschat op basis van
  het prijsgedrag
- **agents/ceo.js** - Claude-agent die de teamdiscussie weegt en het definitieve
  besluit neemt
- **agents/boardroom.js** - orchestreert de multi-agent discussie (analyse -> risico/
  tegenargument/sentiment -> weerwoord -> CEO-besluit), geeft aankomende
  economische events (`agents/economicCalendar.js`) mee als context, en logt het
  resultaat
- **agents/outcomeEvaluator.js** - gedeelde evaluatielogica (SL/TP-hit over
  horizon-candles, filter voor synthetische weekend-candles), gebruikt door zowel
  backtesting als live performance-tracking
- **agents/agentAnalysis.js** - classificeert backtest-samples op 6 dimensies van de
  teamdiscussie (Devil's Advocate, marktcontext-alignment, zekerheidsverschuiving na
  weerwoord, CEO-volggedrag, CEO-zekerheid, risk/reward) en groepeert uitkomsten per
  label
- **data/store.js** - JSON-opslag voor gegenereerde signalen (`data/signals.json`)

Zie [PLAN.md](PLAN.md) voor de roadmap per fase.

## Setup

1. `npm install`
2. Kopieer `.env.example` naar `.env` en vul de waarden in:

| Variabele | Omschrijving |
|---|---|
| `DISCORD_TOKEN` | Bot-token uit de Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application/Client ID van de bot |
| `DISCORD_GUILD_ID` | Server-ID waar de slash commands geregistreerd worden |
| `TWELVE_DATA_API_KEY` | API-key van twelvedata.com (gratis Basic-plan) |
| `ANTHROPIC_API_KEY` | API-key van console.anthropic.com |
| `ANTHROPIC_MODEL` | Claude-model (standaard `claude-sonnet-4-6`) |
| `SIGNAL_INTERVAL_MINUTES` | Interval voor automatische boardroom-runs (standaard 60) |
| `DISCORD_CEO_CHANNEL_ID` | Kanaal-ID voor het officiële CEO-besluit (optioneel) |
| `DISCORD_TRACE_CHANNEL_ID` | Kanaal-ID voor de volledige teamdiscussie (optioneel) |

3. `npm start` (of `npm run dev` voor auto-restart bij wijzigingen)

## Commands

- `/status` - toont systeemstatus en huidige XAU/USD koers
- `/analyse` - laat het agententeam de huidige candles bespreken en toont het CEO-besluit
  (de volledige discussie wordt gepost in het #trace-kanaal, het besluit in het #ceo-kanaal)
- `/geschiedenis [aantal]` - toont de laatst gegenereerde CEO-besluiten (1-10, standaard 5),
  inclusief een outcome-indicator per signaal (✅ TP / ❌ SL / ➖ geen/neutraal /
  ⚠️ onbruikbaar / ⏳ open)
- `/performance` - evalueert open signalen tegen de actuele candles en toont een
  samenvatting (afgeronde trades, TP/SL/geen, winrate, gemiddelde zekerheid) plus
  tellingen voor open/neutraal/niet-evalueerbare signalen

## Backtesting

- `node scripts/backtest.js [dagen]` (standaard 10 dagen) - haalt historische H1-candles
  op, draait de volledige boardroom-discussie op steekproef-samples (1x per dag) en
  toetst elk CEO-besluit aan de candles die erna kwamen. Resultaten (incl. volledige
  discussie en entry-prijs per sample) worden incrementeel opgeslagen in
  `data/backtests.json` (gitignored), zodat een trage/mislukte run niet alle
  voortgang verliest.
- `node scripts/analyzeBacktests.js` - leest `data/backtests.json` en print een
  algemeen overzicht (winRate, gem. zekerheid TP/SL) plus, voor samples met
  teamdiscussie-data, een agent-analyse op de 6 dimensies uit
  `agents/agentAnalysis.js`.

## Testen zonder live marktdata

- `node scripts/test-analyst.js` - test de analyse-agent met mock-candles
- `node scripts/test-boardroom.js` - test de volledige boardroom-discussie (5 agents + CEO)
  met mock-candles, en post (optioneel) de trace-berichten en het CEO-besluit naar
  `DISCORD_TRACE_CHANNEL_ID` / `DISCORD_CEO_CHANNEL_ID`
- `node scripts/test-performanceTracker.js` - unit-tests voor `evaluateSignalOutcome`
  (tp/sl/geen/open/neutraal/onbruikbaar) met handgeschreven candle-fixtures
- `node scripts/test-agentAnalysis.js` - unit-tests voor de classificatiefuncties en
  de `breakdown()`-helper in `agents/agentAnalysis.js`

## Marktdata testen

- `node scripts/test-marketdata.js` - haalt de live XAU/USD-prijs en de laatste H1-candles
  op via Twelve Data (vereist `TWELVE_DATA_API_KEY`)
