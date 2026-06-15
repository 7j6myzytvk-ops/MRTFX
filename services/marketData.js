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
async function request(endpoint, params) {
  try {
    const { data } = await client().get(endpoint, {
      params: { ...params, apikey: config.marketData.apiKey },
    });

    if (data.status === 'error') {
      throw new Error(data.message || 'Twelve Data API-fout');
    }

    return data;
  } catch (err) {
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
