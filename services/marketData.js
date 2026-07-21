import axios from 'axios';
import { config } from '../config/index.js';
import { filterFlatCandles } from '../agents/outcomeEvaluator.js';

const BASE_URL = 'https://api.twelvedata.com';

const GRANULARITY_TO_INTERVAL = {
  M1: '1min',
  M5: '5min',
  M15: '15min',
  M30: '30min',
  H1: '1h',
  H4: '4h',
  D: '1day',
  W: '1week',
};

function client() {
  return axios.create({ baseURL: BASE_URL });
}

// Twelve Data geeft foutmeldingen (bv. rate limit) terug als JSON-body met
// status: 'error', soms gecombineerd met een niet-2xx HTTP-status. In beide
// gevallen geven we hier het eigen bericht van Twelve Data door, in plaats van
// axios' generieke "Request failed with status code ...".
async function request(endpoint, params, retriesLeft = 2) {
  try {
    const { data } = await client().get(endpoint, {
      params: { ...params, apikey: config.marketData.apiKey },
    });

    if (data.status === 'error') {
      throw new Error(data.message || 'Twelve Data API-fout');
    }

    return data;
  } catch (err) {
    const status = err.response?.status;
    // Retry bij tijdelijke server-side fouten (5xx, bv. Cloudflare 520) én 404
    // (Twelve Data geeft soms een kortdurende 404 bij routing-haperingen).
    // Wacht 5 seconden tussen pogingen — geeft de externe server de kans te herstellen.
    if ((!err.response || status >= 500 || status === 404) && retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 5000));
      return request(endpoint, params, retriesLeft - 1);
    }
    const message = err.response?.data?.message;
    if (message) throw new Error(message);
    throw err;
  }
}

export async function getXauUsdPrice() {
  const data = await request('/price', { symbol: 'XAU/USD' });

  return {
    price: Number(data.price),
    time: new Date().toISOString(),
  };
}

async function fetchCandles({ symbol, granularity = 'H1', count = 50, from, to }) {
  const params = {
    symbol,
    interval: GRANULARITY_TO_INTERVAL[granularity] || granularity,
    timezone: 'UTC',
  };

  if (from || to) {
    if (from) params.start_date = from.replace('T', ' ').replace('Z', '');
    if (to) params.end_date = to.replace('T', ' ').replace('Z', '');
  } else {
    params.outputsize = count;
  }

  const data = await request('/time_series', params);

  return data.values
    .map((v) => ({
      time: v.datetime.includes(' ')
        ? `${v.datetime.replace(' ', 'T')}Z`
        : `${v.datetime}T00:00:00Z`,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
    }))
    .reverse();
}

export async function getXauUsdCandles(opts = {}) {
  return fetchCandles({ symbol: 'XAU/USD', ...opts });
}

export async function getEurUsdCandles(opts = {}) {
  return fetchCandles({ symbol: 'EUR/USD', ...opts });
}

// Voor de live boardroom (`/analyse`, scheduler) willen we `count` echte candles,
// niet `count` ruwe candles. Twelve Data vult weekend-gaten op met synthetische
// platte placeholder-candles (zie agents/outcomeEvaluator.js), die anders het
// analyse-venster vervuilen - met name net na een weekend kan dat een groot deel
// van de meest recente candles zijn. We vragen daarom extra candles op (genoeg om
// een volledig weekend te overbruggen), filteren de platte candles eruit en geven
// de laatste `count` echte candles terug.
export async function getRecentRealCandles({ granularity = 'H1', count = 50 } = {}) {
  const raw = await getXauUsdCandles({ granularity, count: count + 70 });
  return filterFlatCandles(raw).slice(-count);
}

// EUR/USD (~1,16) heeft een veel kleinere candle-range dan XAU/USD (~4350), dus
// `filterFlatCandles`/`FLAT_RANGE_THRESHOLD` (afgestemd op XAU/USD) is hier niet
// bruikbaar - dat zou alle EUR/USD-candles als "plat" wegfilteren. EUR/USD-data
// van Twelve Data lijkt geen synthetische platte weekend-candles te hebben, maar
// als extra check filteren we exact-platte candles (high === low) eruit.
export async function getRecentEurUsdCandles({ granularity = 'H1', count = 50 } = {}) {
  const raw = await getEurUsdCandles({ granularity, count: count + 10 });
  return raw.filter((c) => c.high !== c.low).slice(-count);
}

export async function getUsYieldCandles(opts = {}) {
  return fetchCandles({ symbol: 'US2Y', ...opts });
}

// Amerikaanse 2-jaars rente (US2Y) als renteklimaat-context (zie
// agents/yieldContext.js). We gebruiken dagcandles i.p.v. uurcandles: de rente
// is een trage macro-achtergrond, en dagdata vermijdt de :30-minuten-uitlijning
// en mogelijke NYSE-uren-gaten van de uurdata van deze bron. Als extra check
// filteren we exact-platte candles (high === low) eruit, net als bij EUR/USD.

// `fetchedAt` is geldig zolang `now - fetchedAt < ttlMs`. Los geëxporteerd
// zodat de cache-logica zonder API-calls te unit-testen is.
export function isCacheValid(fetchedAt, ttlMs, now = Date.now()) {
  return fetchedAt != null && now - fetchedAt < ttlMs;
}

// Dagcandles veranderen maar 1x per dag, maar de scheduler draait elk uur
// (Fase 5) - zonder cache zou dit elk uur een extra Twelve Data-call kosten
// voor data die nog niet is gewijzigd. Eén dag cache-geldigheid is ruim
// genoeg (een nieuwe dagcandle verschijnt hooguit 1x per 24u).
const YIELD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let yieldCandlesCache = null; // { count, data, fetchedAt }

export async function getRecentUsYieldCandles({ count = 25 } = {}) {
  if (
    yieldCandlesCache &&
    yieldCandlesCache.count === count &&
    isCacheValid(yieldCandlesCache.fetchedAt, YIELD_CACHE_TTL_MS)
  ) {
    return yieldCandlesCache.data;
  }

  const raw = await getUsYieldCandles({ granularity: 'D', count: count + 10 });
  const data = raw.filter((c) => c.high !== c.low).slice(-count);
  yieldCandlesCache = { count, data, fetchedAt: Date.now() };
  return data;
}

// XAU/USD weekcandles als W1-trendcontext (zie agents/multiTimeframeAlignment.js).
// Weekdata verandert maar 1x per week, dus 24u-cache is ruim voldoende.
const W1_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let w1CandlesCache = null;

export async function getRecentXauW1Candles({ count = 20 } = {}) {
  if (
    w1CandlesCache &&
    w1CandlesCache.count === count &&
    isCacheValid(w1CandlesCache.fetchedAt, W1_CACHE_TTL_MS)
  ) {
    return w1CandlesCache.data;
  }
  const raw = await getXauUsdCandles({ granularity: 'W', count: count + 5 });
  const data = raw.filter((c) => c.high !== c.low).slice(-count);
  w1CandlesCache = { count, data, fetchedAt: Date.now() };
  return data;
}

// XAU/USD H1-candles: sluit 1x per uur, 10 minuten cache is voldoende voor
// alignment-check en boardroom-analyse. Scheelt ~216 calls per handelsdag.
const H1_CACHE_TTL_MS = 10 * 60 * 1000;
let h1CandlesCache = null;

export async function getRecentXauH1Candles({ count = 50 } = {}) {
  if (h1CandlesCache && h1CandlesCache.count === count && isCacheValid(h1CandlesCache.fetchedAt, H1_CACHE_TTL_MS)) {
    return h1CandlesCache.data;
  }
  const raw = await getXauUsdCandles({ granularity: 'H1', count: count + 70 });
  const data = filterFlatCandles(raw).slice(-count);
  h1CandlesCache = { count, data, fetchedAt: Date.now() };
  return data;
}

// XAU/USD 4H-candles als institutionele structuur-timeframe (zie agents/boardroom.js).
// Een 4H-candle sluit maar 1x per 4 uur — cachen met 4u TTL is correct en scheelt
// ~180 Twelve Data-calls per handelsdag (van 810 naar ~540).
const H4_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
let h4CandlesCache = null;

export async function getRecentXauH4Candles({ count = 50 } = {}) {
  if (h4CandlesCache && h4CandlesCache.count === count && isCacheValid(h4CandlesCache.fetchedAt, H4_CACHE_TTL_MS)) {
    return h4CandlesCache.data;
  }
  const raw = await getXauUsdCandles({ granularity: 'H4', count: count + 70 });
  const data = filterFlatCandles(raw).slice(-count);
  h4CandlesCache = { count, data, fetchedAt: Date.now() };
  return data;
}

// XAU/USD dagcandles als D1-trendcontext (zie agents/dailyContext.js). Dagdata
// verandert maar 1x per dag, dus 24u-cache voorkomt onnodige calls per tick.
const D1_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let d1CandlesCache = null; // { count, data, fetchedAt }

export async function getRecentXauD1Candles({ count = 30 } = {}) {
  if (
    d1CandlesCache &&
    d1CandlesCache.count === count &&
    isCacheValid(d1CandlesCache.fetchedAt, D1_CACHE_TTL_MS)
  ) {
    return d1CandlesCache.data;
  }

  const raw = await getXauUsdCandles({ granularity: 'D', count: count + 10 });
  const data = raw.filter((c) => c.high !== c.low).slice(-count);
  d1CandlesCache = { count, data, fetchedAt: Date.now() };
  return data;
}
