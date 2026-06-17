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

// 10. reportToDiscord - bij comboSignal stuurt het CEO-kanaal het reguliere
// bericht plus (afhankelijk van DISCORD_ALERT_USER_ID) een extra
// combo-alert, exact zoals formatComboAlert() dat voorschrijft.
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
  const expectedAlert = formatComboAlert(decision.signal, true, config.boardroom.alertUserId);
  check('reportToDiscord - aantal CEO-berichten komt overeen met formatComboAlert', ceoMessages.length, expectedAlert ? 2 : 1);
  if (expectedAlert) {
    check('reportToDiscord - 2e CEO-bericht is de combo-alert', ceoMessages[1]?.content, expectedAlert);
  }
}

// 11. formatSetupMarker - gefilterd signaal krijgt 🔶
{
  const filtered = { passed: false, blockers: ['CEO-zekerheid onder 60%'] };
  check('formatSetupMarker bullish + gefilterd -> 🔶', formatSetupMarker('bullish', false, filtered), '🔶 Setup (gefilterd)');
  check('formatSetupMarker bearish + comboSignal + gefilterd -> 🔶', formatSetupMarker('bearish', true, filtered), '🔶 Setup (gefilterd)');
  check('formatSetupMarker neutral + gefilterd (genegeerd) -> 💤', formatSetupMarker('neutral', false, filtered), '💤 Geen actie');
}

// 12. formatCeoMessage - gefilterd signaal bevat ⚠️-waarschuwing
{
  const filtered = { passed: false, blockers: ['CEO-zekerheid onder 60%', 'macro contraireert de richting'] };
  const msg = formatCeoMessage(decision, false, filtered);
  check('formatCeoMessage - gefilterd: marker is 🔶', msg.startsWith('**👔 CEO-besluit - 🔶 Setup (gefilterd)**'), true);
  check('formatCeoMessage - gefilterd: bevat ⚠️-waarschuwing', msg.includes('⚠️ Niet geadviseerd:'), true);
  check('formatCeoMessage - gefilterd: bevat eerste blocker', msg.includes('CEO-zekerheid onder 60%'), true);

  // Passed signaal geen waarschuwing
  const passedMsg = formatCeoMessage(decision, false, { passed: true, blockers: [] });
  check('formatCeoMessage - passed: geen ⚠️', passedMsg.includes('⚠️'), false);
}

// 13. formatComboAlert - gefilterd comboSignal geeft geen ping
{
  const filtered = { passed: false, blockers: ['analist verloor vertrouwen na discussie'] };
  check(
    'formatComboAlert - comboSignal + gefilterd -> null',
    formatComboAlert('bullish', true, '123456789', filtered),
    null,
  );
  check(
    'formatComboAlert - comboSignal + passed -> mention',
    formatComboAlert('bullish', true, '123456789', { passed: true }),
    '🌟 <@123456789> Combo-signaal gedetecteerd - bekijk het CEO-besluit hierboven!',
  );
}

// 14. formatTraceMessages - gefilterd signaal: CEO-regel heeft 🔶 + ⚠️
{
  const discussion = {
    analyst: { signal: 'bullish', confidence: 70, reasoning: 'r1' },
    riskManager: { stopLoss: 4300, takeProfit: 4400, positionSize: 'klein', reasoning: 'r2' },
    devilsAdvocate: { counterSignal: 'bearish', counterConfidence: 40, argument: 'r3' },
    macro: { sentiment: 'risk-on', confidence: 60, reasoning: 'r4' },
    analystRebuttal: { signal: 'bullish', confidence: 65, reasoning: 'r5' },
  };
  const filtered = { passed: false, blockers: ['macro contraireert de richting'] };
  const msgs = formatTraceMessages({ discussion, decision, qualityResult: filtered });
  check('formatTraceMessages - gefilterd: CEO-regel heeft 🔶', msgs[5].startsWith('**👔 CEO - eindbeslissing - 🔶 Setup (gefilterd)**'), true);
  check('formatTraceMessages - gefilterd: CEO-regel heeft ⚠️', msgs[5].includes('⚠️ Niet geadviseerd:'), true);
}

// 15. formatTraceMessages - geopolitieke agent aanwezig + confidence > 0 → 7 berichten
{
  const discussion = {
    analyst: { signal: 'bullish', confidence: 70, reasoning: 'r1' },
    riskManager: { stopLoss: 4300, takeProfit: 4400, positionSize: 'klein', reasoning: 'r2' },
    devilsAdvocate: { counterSignal: 'bearish', counterConfidence: 40, argument: 'r3' },
    macro: { sentiment: 'risk-on', confidence: 60, reasoning: 'r4' },
    geopolitical: { assessment: 'bullish', confidence: 75, reasoning: 'Iran-spanningen stijgen.', keyEvents: ['Iran-sancties uitgebreid'] },
    analystRebuttal: { signal: 'bullish', confidence: 65, reasoning: 'r5' },
  };
  const msgs = formatTraceMessages({ discussion, decision });
  check('formatTraceMessages - geo actief: 7 berichten', msgs.length, 7);
  check('formatTraceMessages - geo actief: bericht 5 is geopolitiek', msgs[4].startsWith('**📰 Geopolitieke/nieuws-analyse**'), true);
  check('formatTraceMessages - geo actief: bevat assessment', msgs[4].includes('bullish (zekerheid: 75%)'), true);
  check('formatTraceMessages - geo actief: bevat keyEvents', msgs[4].includes('Iran-sancties uitgebreid'), true);
  check('formatTraceMessages - geo actief: laatste bericht is CEO', msgs[6].startsWith('**👔 CEO - eindbeslissing'), true);
}

// 16. formatTraceMessages - geopolitieke agent aanwezig maar confidence === 0 → 6 berichten
{
  const discussion = {
    analyst: { signal: 'bullish', confidence: 70, reasoning: 'r1' },
    riskManager: { stopLoss: 4300, takeProfit: 4400, positionSize: 'klein', reasoning: 'r2' },
    devilsAdvocate: { counterSignal: 'bearish', counterConfidence: 40, argument: 'r3' },
    macro: { sentiment: 'risk-on', confidence: 60, reasoning: 'r4' },
    geopolitical: { assessment: 'neutraal', confidence: 0, reasoning: 'Geen nieuws.', keyEvents: [] },
    analystRebuttal: { signal: 'bullish', confidence: 65, reasoning: 'r5' },
  };
  const msgs = formatTraceMessages({ discussion, decision });
  check('formatTraceMessages - geo inactief (conf=0): 6 berichten', msgs.length, 6);
  check('formatTraceMessages - geo inactief: geen geo-bericht', msgs.every((m) => !m.startsWith('**📰')), true);
}

// 17. formatTraceMessages - geopolitieke agent zonder keyEvents
{
  const discussion = {
    analyst: { signal: 'bearish', confidence: 65, reasoning: 'r1' },
    riskManager: { stopLoss: 4500, takeProfit: 4350, positionSize: 'normaal', reasoning: 'r2' },
    devilsAdvocate: { counterSignal: 'bullish', counterConfidence: 30, argument: 'r3' },
    macro: { sentiment: 'risk-off', confidence: 70, reasoning: 'r4' },
    geopolitical: { assessment: 'bearish', confidence: 55, reasoning: 'Vrede-akkoord nabij.', keyEvents: [] },
    analystRebuttal: { signal: 'bearish', confidence: 60, reasoning: 'r5' },
  };
  const msgs = formatTraceMessages({ discussion, decision });
  check('formatTraceMessages - geo zonder keyEvents: 7 berichten', msgs.length, 7);
  check('formatTraceMessages - geo zonder keyEvents: geen keyEvents-regel', !msgs[4].includes('Sleutel-events:'), true);
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
