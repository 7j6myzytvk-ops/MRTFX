import { fetchGoldNews, formatNewsNote } from '../services/newsService.js';

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) {
    console.log(`     verwacht: ${JSON.stringify(expected)}`);
    console.log(`     gekregen: ${JSON.stringify(actual)}`);
    fail++;
  } else {
    pass++;
  }
}

function checkTrue(name, value) {
  check(name, value, true);
}

// --- formatNewsNote tests (pure, geen API-call) ---

// 1. Lege lijst
check('formatNewsNote - lege array geeft lege string', formatNewsNote([]), '');

// 2. null/undefined
check('formatNewsNote - null geeft lege string', formatNewsNote(null), '');
check('formatNewsNote - undefined geeft lege string', formatNewsNote(undefined), '');

// 3. Één item → contains datum, bron, titel
{
  const items = [
    { source: 'NewsAPI', publishedAt: '2026-06-17T10:00:00Z', title: 'Gold prices rise on Iran tensions', url: 'https://example.com' },
  ];
  const result = formatNewsNote(items);
  checkTrue('formatNewsNote - bevat datum', result.includes('2026-06-17'));
  checkTrue('formatNewsNote - bevat bron', result.includes('[NewsAPI]'));
  checkTrue('formatNewsNote - bevat titel', result.includes('Gold prices rise on Iran tensions'));
  checkTrue('formatNewsNote - begint met lege regel', result.startsWith('\n\n'));
}

// 4. Meerdere items → elk item in resultaat
{
  const items = [
    { source: 'Finnhub', publishedAt: '2026-06-17T09:00:00Z', title: 'Fed holds rates steady', url: 'https://a.com' },
    { source: 'GNews', publishedAt: '2026-06-17T08:00:00Z', title: 'XAU/USD breaks resistance', url: 'https://b.com' },
  ];
  const result = formatNewsNote(items);
  checkTrue('formatNewsNote - meerdere items: Finnhub aanwezig', result.includes('[Finnhub]'));
  checkTrue('formatNewsNote - meerdere items: GNews aanwezig', result.includes('[GNews]'));
  checkTrue('formatNewsNote - meerdere items: beide titels', result.includes('Fed holds rates steady') && result.includes('XAU/USD breaks resistance'));
}

// 5. Item met volledige ISO-datum → alleen datum (10 chars) getoond
{
  const items = [
    { source: 'NewsAPI', publishedAt: '2026-01-15T14:30:00.000Z', title: 'Dollar weakens', url: 'https://c.com' },
  ];
  const result = formatNewsNote(items);
  checkTrue('formatNewsNote - toont datum zonder tijd', result.includes('2026-01-15'));
  checkTrue('formatNewsNote - bevat geen volledige ISO-tijdstempel', !result.includes('14:30:00'));
}

// --- fetchGoldNews structuurtest (live API, kleine N) ---
// We testen alleen de structuur van het resultaat, niet de inhoud.
// Mislukte API-calls worden stilzwijgend overgeslagen — het resultaat mag leeg zijn.
{
  console.log('\nfetchGoldNews live structuurtest (kan leeg zijn als API-keys niet werken)...');
  try {
    const items = await fetchGoldNews({ maxItems: 5 });
    checkTrue('fetchGoldNews - retourneert een array', Array.isArray(items));
    checkTrue('fetchGoldNews - maximaal 5 items', items.length <= 5);
    if (items.length > 0) {
      const item = items[0];
      checkTrue('fetchGoldNews - item heeft source', typeof item.source === 'string');
      checkTrue('fetchGoldNews - item heeft publishedAt', typeof item.publishedAt === 'string');
      checkTrue('fetchGoldNews - item heeft title', typeof item.title === 'string');
      checkTrue('fetchGoldNews - item heeft url', typeof item.url === 'string');
      checkTrue('fetchGoldNews - gesorteerd meest recent eerst', items.length < 2 || new Date(items[0].publishedAt) >= new Date(items[1].publishedAt));
    } else {
      console.log('     (lege array ontvangen - API niet beschikbaar of geen relevante items)');
    }
  } catch (err) {
    console.log(`FAIL fetchGoldNews - onverwachte fout: ${err.message}`);
    fail++;
  }
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
