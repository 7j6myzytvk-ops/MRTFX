import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getXauUsdCandles, getEurUsdCandles, getUsYieldCandles } from '../services/marketData.js';
import { runDiscussion } from '../agents/boardroom.js';
import { filterFlatCandles, HORIZON_CANDLES, evaluateOutcome, summarize } from '../agents/outcomeEvaluator.js';

const LOOKBACK = 50; // candles als input voor runDiscussion, zelfde als live /analyse
const HORIZON = HORIZON_CANDLES; // candles (~2 dagen) om de uitkomst te bepalen
const SAMPLE_STEP = 24; // candles tussen samples (~1x per dag)

const DAYS = Number(process.argv[2]) || 10;

const FILE = path.join(process.cwd(), 'data', 'backtests.json');

async function readAll() {
  try {
    const raw = await readFile(FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const to = new Date();
const from = new Date(to.getTime() - DAYS * 24 * 60 * 60 * 1000);

console.log(`Candles ophalen van ${from.toISOString()} t/m ${to.toISOString()}...`);
const rawCandles = await getXauUsdCandles({ granularity: 'H1', from: from.toISOString(), to: to.toISOString() });
const candles = filterFlatCandles(rawCandles);
console.log(
  `${rawCandles.length} candles ontvangen, ${rawCandles.length - candles.length} synthetische ` +
    `(weekend-)candles gefilterd, ${candles.length} resterend.`,
);

// EUR/USD-candles voor dezelfde periode (dollarcontext, zie agents/dollarContext.js).
// Index-uitlijning met `candles` werkt niet (XAU/USD filtert weekend-candles weg,
// EUR/USD niet), dus per sample-window koppelen we op timestamp-range.
const rawEurCandles = await getEurUsdCandles({ granularity: 'H1', from: from.toISOString(), to: to.toISOString() });
const eurCandles = rawEurCandles.filter((c) => c.high !== c.low);
console.log(`${eurCandles.length} EUR/USD-candles voor dollarcontext.`);

function eurWindowFor(window) {
  const startTime = window[0].time;
  const endTime = window[window.length - 1].time;
  return eurCandles.filter((c) => c.time >= startTime && c.time <= endTime);
}

// Amerikaanse 2-jaars rente (US2Y, dagcandles) voor renteklimaat-context (zie
// agents/yieldContext.js). Dagdata is traag, dus per sample pakken we de laatste
// 25 dagcandles vóór de sample-tijd (i.p.v. een index- of range-match zoals bij
// EUR/USD). We halen extra historie op (30 dagen vóór `from`) zodat ook de
// vroegste samples genoeg dagcandles hebben.
const yieldFrom = new Date(from.getTime() - 30 * 24 * 60 * 60 * 1000);
const rawYieldCandles = await getUsYieldCandles({
  granularity: 'D',
  from: yieldFrom.toISOString(),
  to: to.toISOString(),
});
const yieldCandles = rawYieldCandles.filter((c) => c.high !== c.low);
console.log(`${yieldCandles.length} rente-candles (US2Y, dag) voor renteklimaat-context.`);

function yieldWindowFor(sampleTime) {
  return yieldCandles.filter((c) => c.time <= sampleTime).slice(-25);
}

// XAU/USD dagcandles voor D1-trendcontext (zie agents/dailyContext.js).
// Zelfde aanpak als yield: laatste 30 dagcandles vóór de sample-tijd.
const d1From = new Date(from.getTime() - 40 * 24 * 60 * 60 * 1000);
const rawD1Candles = await getXauUsdCandles({
  granularity: 'D',
  from: d1From.toISOString(),
  to: to.toISOString(),
});
const d1AllCandles = rawD1Candles.filter((c) => c.high !== c.low);
console.log(`${d1AllCandles.length} D1-candles (XAU/USD, dag) voor dagtrendcontext.`);

function d1WindowFor(sampleTime) {
  return d1AllCandles.filter((c) => c.time <= sampleTime).slice(-30);
}

// Schrijf na elke sample weg, zodat een trage/vastlopende Claude-call (de
// boardroom-loop kan lang duren) niet betekent dat reeds voltooide samples
// verloren gaan als het script crasht of wordt afgebroken.
const all = await readAll();
const record = {
  id: all.length + 1,
  timestamp: new Date().toISOString(),
  instrument: 'XAU_USD',
  granularity: 'H1',
  rangeFrom: from.toISOString(),
  rangeTo: to.toISOString(),
  config: { lookback: LOOKBACK, horizon: HORIZON, sampleStep: SAMPLE_STEP },
  samples: [],
  summary: null,
};
all.push(record);
await mkdir(path.dirname(FILE), { recursive: true });

// De Anthropic API kan af en toe een APIConnectionTimeoutError geven op een
// individuele call (transiënte hapering, geen codefout) - bij een lange
// steekproef-run is een enkele mislukte poging zonde om de hele run te laten
// crashen, dus retry per sample voordat we 'm overslaan.
const MAX_ATTEMPTS = 3;

const samples = record.samples;
for (let i = LOOKBACK; i + HORIZON < candles.length; i += SAMPLE_STEP) {
  const window = candles.slice(i - LOOKBACK, i);
  const horizonCandles = candles.slice(i, i + HORIZON);
  const sampleTime = window[window.length - 1].time;
  const dollarCandles = eurWindowFor(window);
  const yieldCandlesForSample = yieldWindowFor(sampleTime);
  const d1CandlesForSample = d1WindowFor(sampleTime);

  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      result = await runDiscussion(window, {
        instrument: 'XAU_USD',
        granularity: 'H1',
        dollarCandles,
        yieldCandles: yieldCandlesForSample,
        d1Candles: d1CandlesForSample,
      });
      break;
    } catch (err) {
      console.log(`  poging ${attempt}/${MAX_ATTEMPTS} voor ${sampleTime} mislukt: ${err.message}`);
      if (attempt === MAX_ATTEMPTS) break;
    }
  }

  if (!result) {
    console.log(`[${samples.length + 1}] ${sampleTime} -> OVERGESLAGEN (na ${MAX_ATTEMPTS} mislukte pogingen)`);
    continue;
  }

  const { decision, discussion } = result;
  const entryPrice = window[window.length - 1].close;
  const outcome = evaluateOutcome(decision, horizonCandles);
  samples.push({ sampleTime, entryPrice, decision, discussion, outcome });
  console.log(
    `[${samples.length}] ${sampleTime} -> ${decision.signal.toUpperCase()} (${decision.confidence}%)` +
      ` -> ${outcome.result}${outcome.candlesToHit ? ` (na ${outcome.candlesToHit} candles)` : ''}`,
  );

  record.summary = summarize(samples);
  await writeFile(FILE, JSON.stringify(all, null, 2));
}

console.log('\nSamenvatting:', record.summary);
console.log(`\nOpgeslagen in data/backtests.json (record #${record.id})`);
