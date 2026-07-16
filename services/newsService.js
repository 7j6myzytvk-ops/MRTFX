import axios from 'axios';
import { config } from '../config/index.js';

// Keywords die een headline relevant maken voor XAU/USD.
// Vier hoofddrijfveren: monetair beleid, economische data, geopolitiek, dollar/debt.
const GOLD_KEYWORDS = [
  // Goud direct
  'gold', 'xau', 'bullion', 'gold reserve', 'central bank buying',

  // Monetair beleid (Fed)
  'federal reserve', 'fed ', 'fomc', 'interest rate', 'rate cut', 'rate hike',
  'powell', 'monetary policy',

  // Economische data VS die goud beweegt
  'inflation', 'cpi', 'ppi', 'pce', 'deflation', 'stagflation',
  'nonfarm', 'jobs report', 'unemployment', 'jobless claims', 'gdp', 'retail sales',

  // Dollar & rente
  'dollar', 'dxy', 'treasury', 'yield', 'debt ceiling', 'us debt', 'deficit',
  'credit rating', 'downgrade',

  // Geopolitiek
  'iran', 'israel', 'ukraine', 'russia', 'china', 'north korea', 'taiwan',
  'tariff', 'sanction', 'war', 'peace', 'ceasefire', 'geopolit',
  'central bank', 'safe haven', 'trump', 'military strike', 'escalat',

  // Scheepvaart & energietoevoer (directe olieprijsimpact → inflatie → goud)
  'tanker', 'vessel', 'shipping', 'maritime', 'red sea', 'hormuz',
  'blockade', 'oil supply', 'houthi',
];

function isRelevant(text = '') {
  const lower = text.toLowerCase();
  return GOLD_KEYWORDS.some((kw) => lower.includes(kw));
}

function cleanTitle(title = '') {
  // Verwijder trailing bron-vermeldingen als " - Reuters" of " | Bloomberg"
  return title.replace(/\s[-|]\s[^-|]{2,40}$/, '').trim();
}

async function fetchFromNewsApi({ maxItems = 10 } = {}) {
  const key = config.news.newsApiKey;
  if (!key) return [];
  try {
    const { data } = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: 'gold OR "XAU" OR "Federal Reserve" OR "geopolitical" OR "safe haven" OR "CPI" OR "NFP" OR "PCE" OR "PPI" OR tanker OR "Red Sea" OR Hormuz OR Houthi OR "debt ceiling" OR "credit rating"',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 50,
        apiKey: key,
      },
      timeout: 8000,
    });
    return (data.articles || [])
      .filter((a) => isRelevant(a.title) || isRelevant(a.description))
      .slice(0, maxItems)
      .map((a) => ({
        source: 'NewsAPI',
        publishedAt: a.publishedAt,
        title: cleanTitle(a.title),
        url: a.url,
      }));
  } catch {
    return [];
  }
}

async function fetchFromFinnhub({ maxItems = 10 } = {}) {
  const key = config.news.finnhubApiKey;
  if (!key) return [];
  try {
    const [general, forex] = await Promise.all([
      axios.get('https://finnhub.io/api/v1/news', {
        params: { category: 'general', token: key },
        timeout: 8000,
      }),
      axios.get('https://finnhub.io/api/v1/news', {
        params: { category: 'forex', token: key },
        timeout: 8000,
      }),
    ]);

    const all = [...(general.data || []), ...(forex.data || [])];
    return all
      .filter((a) => isRelevant(a.headline))
      .slice(0, maxItems)
      .map((a) => ({
        source: 'Finnhub',
        publishedAt: new Date(a.datetime * 1000).toISOString(),
        title: cleanTitle(a.headline),
        url: a.url,
      }));
  } catch {
    return [];
  }
}

async function fetchFromGNews({ maxItems = 10 } = {}) {
  const key = config.news.gNewsApiKey;
  if (!key) return [];
  try {
    const { data } = await axios.get('https://gnews.io/api/v4/search', {
      params: {
        q: 'gold OR XAU OR "Federal Reserve" OR geopolitical OR war OR Iran OR CPI OR NFP OR tanker OR "Red Sea" OR Houthi OR "debt ceiling"',
        lang: 'en',
        max: maxItems,
        token: key,
      },
      timeout: 8000,
    });
    return (data.articles || []).map((a) => ({
      source: 'GNews',
      publishedAt: a.publishedAt,
      title: cleanTitle(a.title),
      url: a.url,
    }));
  } catch {
    return [];
  }
}

// Verwijder duplicaten op basis van titelsimilariteit (eerste 40 tekens).
function deduplicate(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.title.slice(0, 40).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Haalt recente goud-relevante nieuws op uit alle geconfigureerde bronnen,
// combineert, sorteert op tijd en geeft de `maxItems` meest recente terug.
// Bronnen die niet beschikbaar zijn (geen key, timeout, fout) worden
// stilzwijgend overgeslagen — de functie gooit nooit een error.
export async function fetchGoldNews({ maxItems = 12 } = {}) {
  const [newsApi, finnhub, gnews] = await Promise.all([
    fetchFromNewsApi({ maxItems }),
    fetchFromFinnhub({ maxItems }),
    fetchFromGNews({ maxItems }),
  ]);

  const all = deduplicate([...newsApi, ...finnhub, ...gnews]);
  all.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return all.slice(0, maxItems);
}

// Formatteert de nieuwslijst als een compacte tekst voor de agent-prompt.
// Lege lijst → lege string (agent hoeft er dan niets mee te doen).
export function formatNewsNote(items) {
  if (!items || items.length === 0) return '';
  const lines = items.map(
    (item) => `- ${item.publishedAt.slice(0, 10)} [${item.source}] ${item.title}`,
  );
  return `\n\nActueel nieuws (automatisch opgehaald, meest recent eerst):\n${lines.join('\n')}`;
}
