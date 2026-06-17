import { assessGeopolitical } from '../agents/geopoliticalAnalyst.js';

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

// --- NO_NEWS_RESULT tests (geen API-call, pure logica) ---

// 1. Lege array → NO_NEWS_RESULT (geen Claude-API call)
{
  const result = await assessGeopolitical([]);
  check('assessGeopolitical([]) - assessment is neutraal', result.assessment, 'neutraal');
  check('assessGeopolitical([]) - confidence is 0', result.confidence, 0);
  checkTrue('assessGeopolitical([]) - heeft reasoning', typeof result.reasoning === 'string' && result.reasoning.length > 0);
  checkTrue('assessGeopolitical([]) - keyEvents is array', Array.isArray(result.keyEvents));
  check('assessGeopolitical([]) - keyEvents is leeg', result.keyEvents.length, 0);
}

// 2. null → NO_NEWS_RESULT
{
  const result = await assessGeopolitical(null);
  check('assessGeopolitical(null) - assessment is neutraal', result.assessment, 'neutraal');
  check('assessGeopolitical(null) - confidence is 0', result.confidence, 0);
}

// 3. undefined → NO_NEWS_RESULT
{
  const result = await assessGeopolitical(undefined);
  check('assessGeopolitical(undefined) - assessment is neutraal', result.assessment, 'neutraal');
  check('assessGeopolitical(undefined) - confidence is 0', result.confidence, 0);
}

// 4. Resultaatstructuur is correct (field-checks op NO_NEWS_RESULT)
{
  const result = await assessGeopolitical([]);
  checkTrue('assessGeopolitical - retourneert object', typeof result === 'object' && result !== null);
  checkTrue('assessGeopolitical - heeft assessment-veld', 'assessment' in result);
  checkTrue('assessGeopolitical - heeft confidence-veld', 'confidence' in result);
  checkTrue('assessGeopolitical - heeft reasoning-veld', 'reasoning' in result);
  checkTrue('assessGeopolitical - heeft keyEvents-veld', 'keyEvents' in result);
}

// 5. Standaard opties (geen instrument/granularity meegegeven) → zelfde NO_NEWS_RESULT
{
  const result = await assessGeopolitical();
  check('assessGeopolitical() zonder args - assessment is neutraal', result.assessment, 'neutraal');
  check('assessGeopolitical() zonder args - confidence is 0', result.confidence, 0);
}

// --- Live API-test (optioneel, enkel structuurvalidatie) ---
// Stuurt een echte Claude-API call. Overgeslagen als NO_NEWS_RESULT wordt teruggegeven
// (wat ook geldig is als er geen nieuws beschikbaar is).
{
  const testItems = [
    {
      source: 'TestFixture',
      publishedAt: '2026-06-17T10:00:00Z',
      title: 'Federal Reserve holds interest rates steady amid inflation concerns',
      url: 'https://example.com/1',
    },
    {
      source: 'TestFixture',
      publishedAt: '2026-06-17T09:00:00Z',
      title: 'Gold prices rise as geopolitical tensions escalate in Middle East',
      url: 'https://example.com/2',
    },
  ];

  console.log('\nassessGeopolitical live structuurtest (Claude API-call)...');
  try {
    const result = await assessGeopolitical(testItems, { instrument: 'XAU_USD', granularity: 'H1' });
    checkTrue('assessGeopolitical live - retourneert object', typeof result === 'object' && result !== null);
    checkTrue('assessGeopolitical live - assessment is bullish/bearish/neutraal', ['bullish', 'bearish', 'neutraal'].includes(result.assessment));
    checkTrue('assessGeopolitical live - confidence is getal 0-100', typeof result.confidence === 'number' && result.confidence >= 0 && result.confidence <= 100);
    checkTrue('assessGeopolitical live - reasoning is string', typeof result.reasoning === 'string' && result.reasoning.length > 0);
    checkTrue('assessGeopolitical live - keyEvents is array', Array.isArray(result.keyEvents));
    console.log(`     assessment: ${result.assessment} (${result.confidence}%)`);
    if (result.keyEvents.length > 0) {
      console.log(`     keyEvent: ${result.keyEvents[0]}`);
    }
  } catch (err) {
    console.log(`FAIL assessGeopolitical live - fout: ${err.message}`);
    fail++;
  }
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
