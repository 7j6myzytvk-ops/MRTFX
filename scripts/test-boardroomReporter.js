import { formatOutcomeMessage, reportOutcomes } from '../services/boardroomReporter.js';
import { config } from '../config/index.js';

const decision = { signal: 'bullish', confidence: 72, stopLoss: 4300, takeProfit: 4400, positionSize: 'klein' };

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) {
    console.log(`     verwacht: ${expected}`);
    console.log(`     gekregen: ${actual}`);
    fail++;
  } else {
    pass++;
  }
}

// 1. TP-hit
{
  const signal = { id: 14, timestamp: '2026-06-15T10:00:00Z', decision, outcome: { result: 'tp', candlesToHit: 6 } };
  check(
    'tp-melding',
    formatOutcomeMessage(signal),
    '**Signaal #14 afgerond - ✅ Take-profit geraakt (na 6 candles)**\n' +
      'Origineel signaal (2026-06-15 10:00 UTC): BULLISH (zekerheid 72%) - SL 4300 / TP 4400 (klein)',
  );
}

// 2. SL-hit
{
  const signal = { id: 14, timestamp: '2026-06-15T10:00:00Z', decision, outcome: { result: 'sl', candlesToHit: 3 } };
  check(
    'sl-melding',
    formatOutcomeMessage(signal),
    '**Signaal #14 afgerond - ❌ Stop-loss geraakt (na 3 candles)**\n' +
      'Origineel signaal (2026-06-15 10:00 UTC): BULLISH (zekerheid 72%) - SL 4300 / TP 4400 (klein)',
  );
}

// 3. Geen hit binnen horizon (geen candlesToHit)
{
  const signal = { id: 14, timestamp: '2026-06-15T10:00:00Z', decision, outcome: { result: 'geen', candlesToHit: null } };
  check(
    'geen-melding (zonder candlesToHit-suffix)',
    formatOutcomeMessage(signal),
    '**Signaal #14 afgerond - ➖ Geen TP/SL geraakt binnen de horizon**\n' +
      'Origineel signaal (2026-06-15 10:00 UTC): BULLISH (zekerheid 72%) - SL 4300 / TP 4400 (klein)',
  );
}

// 4. reportOutcomes - post per resolved signaal naar het CEO-kanaal, geen
// extra calls bij een lege lijst, en geen calls als ceoChannelId ontbreekt.
{
  const sent = [];
  const mockClient = {
    channels: { fetch: async (id) => ({ send: async (content) => sent.push({ id, content }) }) },
  };
  const resolved = [
    { id: 14, timestamp: '2026-06-15T10:00:00Z', decision, outcome: { result: 'tp', candlesToHit: 6 } },
    { id: 13, timestamp: '2026-06-15T09:00:00Z', decision, outcome: { result: 'sl', candlesToHit: 2 } },
  ];

  await reportOutcomes(mockClient, resolved);
  check('reportOutcomes - 1 bericht per resolved signaal', sent.length, resolved.length);
  check('reportOutcomes - juiste kanaal-id', sent[0]?.id, config.boardroom.ceoChannelId);
  check('reportOutcomes - bericht-inhoud komt overeen met formatOutcomeMessage', sent[1]?.content, formatOutcomeMessage(resolved[1]));
}

// 5. reportOutcomes - lege lijst -> geen channel-fetch
{
  let fetched = false;
  const mockClient = { channels: { fetch: async () => { fetched = true; return { send: async () => {} }; } } };
  await reportOutcomes(mockClient, []);
  check('reportOutcomes - geen channel-fetch bij lege lijst', fetched, false);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
