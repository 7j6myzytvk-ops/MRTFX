import {
  formatOutcomeMessage,
  reportOutcomes,
  reportToDiscord,
  formatSetupMarker,
  formatCeoMessage,
  formatComboAlert,
  formatTraceMessages,
} from '../services/boardroomReporter.js';
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

// 6. formatSetupMarker - bullish/bearish krijgen de setup-marker, neutral niet
{
  check('formatSetupMarker bullish', formatSetupMarker('bullish'), '🚨 Setup gevonden');
  check('formatSetupMarker bearish', formatSetupMarker('bearish'), '🚨 Setup gevonden');
  check('formatSetupMarker neutral', formatSetupMarker('neutral'), '💤 Geen actie');
  check('formatSetupMarker bullish + comboSignal', formatSetupMarker('bullish', true), '🚨 Setup gevonden 🌟');
  check('formatSetupMarker bearish + comboSignal', formatSetupMarker('bearish', true), '🚨 Setup gevonden 🌟');
  check('formatSetupMarker neutral + comboSignal (genegeerd)', formatSetupMarker('neutral', true), '💤 Geen actie');
}

// 7. formatCeoMessage - bevat de setup-marker
{
  check('formatCeoMessage - bullish krijgt setup-marker', formatCeoMessage(decision).startsWith('**👔 CEO-besluit - 🚨 Setup gevonden**'), true);

  const neutralDecision = { ...decision, signal: 'neutral' };
  check(
    'formatCeoMessage - neutral krijgt geen-actie-marker',
    formatCeoMessage(neutralDecision).startsWith('**👔 CEO-besluit - 💤 Geen actie**'),
    true,
  );

  check(
    'formatCeoMessage - comboSignal voegt 🌟 toe',
    formatCeoMessage(decision, true).startsWith('**👔 CEO-besluit - 🚨 Setup gevonden 🌟**'),
    true,
  );
}

// 8. formatTraceMessages - de CEO-eindbeslissing krijgt ook de setup-marker
{
  const discussion = {
    analyst: { signal: 'bullish', confidence: 70, reasoning: 'r1' },
    riskManager: { stopLoss: 4300, takeProfit: 4400, positionSize: 'klein', reasoning: 'r2' },
    devilsAdvocate: { counterSignal: 'bearish', counterConfidence: 40, argument: 'r3' },
    macro: { sentiment: 'risk-on', confidence: 60, reasoning: 'r4' },
    analystRebuttal: { signal: 'bullish', confidence: 65, reasoning: 'r5' },
  };
  const messages = formatTraceMessages({ discussion, decision });
  check('formatTraceMessages - 6 berichten', messages.length, 6);
  check(
    'formatTraceMessages - laatste bericht heeft setup-marker',
    messages[5].startsWith('**👔 CEO - eindbeslissing - 🚨 Setup gevonden**'),
    true,
  );

  const comboMessages = formatTraceMessages({ discussion, decision, comboSignal: true });
  check(
    'formatTraceMessages - comboSignal voegt 🌟 toe aan laatste bericht',
    comboMessages[5].startsWith('**👔 CEO - eindbeslissing - 🚨 Setup gevonden 🌟**'),
    true,
  );
}

// 9. formatComboAlert - mention alleen bij comboSignal + niet-neutraal + alertUserId
{
  check(
    'formatComboAlert - bullish + comboSignal + alertUserId -> mention',
    formatComboAlert('bullish', true, '123456789'),
    '🌟 <@123456789> Combo-signaal gedetecteerd - bekijk het CEO-besluit hierboven!',
  );
  check(
    'formatComboAlert - bearish + comboSignal + alertUserId -> mention',
    formatComboAlert('bearish', true, '123456789'),
    '🌟 <@123456789> Combo-signaal gedetecteerd - bekijk het CEO-besluit hierboven!',
  );
  check('formatComboAlert - geen comboSignal -> null', formatComboAlert('bullish', false, '123456789'), null);
  check('formatComboAlert - neutral + comboSignal -> null', formatComboAlert('neutral', true, '123456789'), null);
  check('formatComboAlert - geen alertUserId -> null', formatComboAlert('bullish', true, undefined), null);
}

// 10. reportToDiscord - zonder DISCORD_ALERT_USER_ID-config wordt bij een
// comboSignal geen extra ping verstuurd naar het CEO-kanaal (alleen het
// reguliere CEO-bericht).
{
  const sent = [];
  const mockClient = {
    channels: { fetch: async (id) => ({ send: async (content) => sent.push({ id, content }) }) },
  };
  const discussion = {
    analyst: { signal: 'bullish', confidence: 70, reasoning: 'r1' },
    riskManager: { stopLoss: 4300, takeProfit: 4400, positionSize: 'klein', reasoning: 'r2' },
    devilsAdvocate: { counterSignal: 'bearish', counterConfidence: 40, argument: 'r3' },
    macro: { sentiment: 'risk-on', confidence: 60, reasoning: 'r4' },
    analystRebuttal: { signal: 'bullish', confidence: 65, reasoning: 'r5' },
  };

  await reportToDiscord(mockClient, { discussion, decision, comboSignal: true });

  const ceoMessages = sent.filter((s) => s.id === config.boardroom.ceoChannelId);
  check('reportToDiscord - zonder alertUserId geen extra ping bij comboSignal', ceoMessages.length, 1);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
