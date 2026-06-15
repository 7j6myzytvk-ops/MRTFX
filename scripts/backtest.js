import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getXauUsdCandles } from '../services/marketData.js';
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

  let decision;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      ({ decision } = await runDiscussion(window, { instrument: 'XAU_USD', granularity: 'H1' }));
      break;
    } catch (err) {
      console.log(`  poging ${attempt}/${MAX_ATTEMPTS} voor ${sampleTime} mislukt: ${err.message}`);
      if (attempt === MAX_ATTEMPTS) break;
    }
  }

  if (!decision) {
    console.log(`[${samples.length + 1}] ${sampleTime} -> OVERGESLAGEN (na ${MAX_ATTEMPTS} mislukte pogingen)`);
    continue;
  }

  const outcome = evaluateOutcome(decision, horizonCandles);
  samples.push({ sampleTime, decision, outcome });
  console.log(
    `[${samples.length}] ${sampleTime} -> ${decision.signal.toUpperCase()} (${decision.confidence}%)` +
      ` -> ${outcome.result}${outcome.candlesToHit ? ` (na ${outcome.candlesToHit} candles)` : ''}`,
  );

  record.summary = summarize(samples);
  await writeFile(FILE, JSON.stringify(all, null, 2));
}

console.log('\nSamenvatting:', record.summary);
console.log(`\nOpgeslagen in data/backtests.json (record #${record.id})`);
