import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { makeClient } from '../agents/anthropicClient.js';
import { config } from '../config/index.js';
import { formatCandles } from '../agents/formatCandles.js';
import { computeIndicators } from '../agents/indicators.js';
import { computeDollarContext, formatDollarContextNote } from '../agents/dollarContext.js';
import { computeYieldContext, formatYieldContextNote } from '../agents/yieldContext.js';
import {
  getRecentXauW1Candles,
  getRecentXauD1Candles,
  getRecentXauH4Candles,
  getRecentEurUsdCandles,
  getRecentUsYieldCandles,
} from './marketData.js';

const FILE = path.join(process.cwd(), 'data', 'live', 'weeklyRegime.json');
const TTL_MS = 8 * 24 * 60 * 60 * 1000; // 8 dagen zodat ook maandagmorgen nog geldig

const REGIME_TOOL = {
  name: 'leg_regime_vast',
  description: 'Sla de wekelijkse XAU/USD marktregime-analyse vast.',
  input_schema: {
    type: 'object',
    properties: {
      phase: {
        type: 'string',
        enum: ['bearish_trend', 'bullish_trend', 'range_contractie', 'transitie_bullish', 'transitie_bearish'],
        description: 'Huidige marktfase voor XAU/USD',
      },
      direction: {
        type: 'string',
        enum: ['bearish', 'bullish', 'neutraal'],
        description: 'Dominante wekelijkse bias',
      },
      keyResistance: {
        type: 'array',
        items: { type: 'number' },
        description: 'Max 3 key resistance levels (hoog → laag)',
        maxItems: 3,
      },
      keySupport: {
        type: 'array',
        items: { type: 'number' },
        description: 'Max 3 key support levels (laag → hoog)',
        maxItems: 3,
      },
      macroSummary: {
        type: 'string',
        description: '2-3 zinnen: renteklimaat, dollarkracht, institutionele structuur op W1/D1',
      },
      tradingImplication: {
        type: 'string',
        description: '2 zinnen: welk type setup heeft prioriteit deze week, wat te vermijden',
      },
      avoidZones: {
        type: 'string',
        description: 'Prijs- of tijdzones die je deze week moet mijden (bv. "short boven $3680 — supply-muur", "long in premium boven $3650")',
      },
      confidence: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
      },
    },
    required: ['phase', 'direction', 'keyResistance', 'keySupport', 'macroSummary', 'tradingImplication', 'avoidZones', 'confidence'],
  },
};

function buildRegimePrompt({ w1Candles, d1Candles, h4Candles, dollarNote, yieldNote }) {
  const h4Ind = computeIndicators(h4Candles);
  const d1Ind = computeIndicators(d1Candles);
  const w1Recent = w1Candles.slice(-6);
  const w1High = Math.max(...w1Recent.map((c) => c.high)).toFixed(2);
  const w1Low = Math.min(...w1Recent.map((c) => c.low)).toFixed(2);

  return (
    `Je bent een senior macro-strateeg bij een goud hedge fund. Je taak: bepaal het wekelijkse marktregime voor XAU/USD. ` +
    `Dit wordt gebruikt als vaste context voor alle intraday boardroom-analyses deze week. ` +
    `Wees concreet en beknopt — geef geen vage "het hangt af van"-antwoorden.\n\n` +

    `ANALYSEER IN DEZE VOLGORDE:\n` +
    `1. W1-STRUCTUUR: Is er een aantoonbare trend (hogere highs/lows of lagere highs/lows) ` +
    `of beweegt de markt zijwaarts? Wat is de dominante richting van de laatste 4-6 weekcandles?\n` +
    `2. D1-STRUCTUUR: Welke richting op dagbasis? Is de W1-trend intact of is er een D1-trendbreuk?\n` +
    `3. 4H-STRUCTUUR: Bevestigt of contradicteert H4 de hogere timeframes?\n` +
    `4. SLEUTELNIVEAUS: Welke prijszones zijn institutioneel relevant deze week ` +
    `(swing highs/lows, ronde getallen op $50-interval, recente OB/FVG)?\n` +
    `5. HANDELSIMPLICATIE: Welke richting heeft de hoogste setup-kans deze week? ` +
    `Welke setups moet een intraday-analist deze week juist vermijden?\n\n` +

    `${dollarNote}${yieldNote}\n\n` +
    `W1-candles (laatste 6, oudste eerst) — range: $${w1Low}–$${w1High}:\n${formatCandles(w1Recent)}\n\n` +
    `D1-candles (laatste 20, oudste eerst) — SMA20: $${d1Ind.sma20?.toFixed(2) ?? 'n.v.t.'}, RSI14: ${d1Ind.rsi14?.toFixed(1) ?? 'n.v.t.'}:\n${formatCandles(d1Candles.slice(-20))}\n\n` +
    `4H-candles (laatste 15, oudste eerst) — SMA20: $${h4Ind.sma20?.toFixed(2) ?? 'n.v.t.'}, RSI14: ${h4Ind.rsi14?.toFixed(1) ?? 'n.v.t.'}:\n${formatCandles(h4Candles.slice(-15))}`
  );
}

export async function getWeeklyRegime() {
  try {
    const raw = await readFile(FILE, 'utf-8');
    const regime = JSON.parse(raw);
    if (regime?.expiresAt && new Date(regime.expiresAt).getTime() > Date.now()) {
      return regime;
    }
    return null;
  } catch {
    return null;
  }
}

export function formatRegimeNote(regime) {
  if (!regime) return '';
  const phaseLabels = {
    bearish_trend: 'BEARISH TREND',
    bullish_trend: 'BULLISH TREND',
    range_contractie: 'RANGE/CONTRACTIE',
    transitie_bullish: 'TRANSITIE → BULLISH',
    transitie_bearish: 'TRANSITIE → BEARISH',
  };
  const phase = phaseLabels[regime.phase] ?? regime.phase.toUpperCase();
  const expires = new Date(regime.generatedAt).toISOString().slice(0, 10);
  const resistance = regime.keyResistance?.map((l) => `$${l}`).join(' / ') ?? 'onbekend';
  const support = regime.keySupport?.map((l) => `$${l}`).join(' / ') ?? 'onbekend';
  return (
    `\n\nWEEKLIJKS MARKTREGIME (gegenereerd ${expires}, zekerheid ${regime.confidence}%):\n` +
    `Fase: ${phase} | Bias: ${regime.direction?.toUpperCase()}\n` +
    `Key resistance: ${resistance}\n` +
    `Key support: ${support}\n` +
    `Macro: ${regime.macroSummary}\n` +
    `Prioriteit deze week: ${regime.tradingImplication}\n` +
    `Vermijd: ${regime.avoidZones}`
  );
}

export async function runWeeklyRegime() {
  console.log('[weeklyRegime] Wekelijkse regime-analyse starten...');
  const [w1Candles, d1Candles, h4Candles, dollarCandles, yieldCandles] = await Promise.all([
    getRecentXauW1Candles({ count: 20 }),
    getRecentXauD1Candles({ count: 30 }),
    getRecentXauH4Candles({ count: 50 }),
    getRecentEurUsdCandles({ granularity: 'H1', count: 50 }),
    getRecentUsYieldCandles({ count: 25 }),
  ]);

  const dollarNote = dollarCandles.length >= 2 ? formatDollarContextNote(computeDollarContext(dollarCandles)) : '';
  const yieldNote = yieldCandles.length >= 2 ? formatYieldContextNote(computeYieldContext(yieldCandles)) : '';

  const prompt = buildRegimePrompt({ w1Candles, d1Candles, h4Candles, dollarNote, yieldNote });

  const client = makeClient();
  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 1024,
    tools: [REGIME_TOOL],
    tool_choice: { type: 'tool', name: REGIME_TOOL.name },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Regime-tool niet aangeroepen door het model');

  const regime = {
    ...toolUse.input,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TTL_MS).toISOString(),
  };

  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(regime, null, 2));
  console.log(`[weeklyRegime] Opgeslagen: ${regime.phase} | ${regime.direction} | zekerheid ${regime.confidence}%`);
  return regime;
}
