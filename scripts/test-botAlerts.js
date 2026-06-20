import { formatErrorAlert, formatHeartbeat } from '../services/botAlerts.js';

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
function checkTrue(name, val) { check(name, val, true); }

// --- formatErrorAlert ---

// 1. Krediet-fout gedetecteerd
{
  const err = new Error('You have run out of API credits for the day. 864 API credits were used.');
  const msg = formatErrorAlert(err);
  checkTrue('formatErrorAlert - krediet: bevat KREDIET LIMIET', msg.includes('KREDIET LIMIET'));
  checkTrue('formatErrorAlert - krediet: bevat originele foutmelding', msg.includes('864 API credits'));
}

// 2. Rate limit fout
{
  const err = new Error('API rate limit exceeded. Please try again in 60 seconds.');
  const msg = formatErrorAlert(err);
  checkTrue('formatErrorAlert - rate limit: bevat Rate limit', msg.includes('Rate limit'));
}

// 3. 429-statuscode in bericht
{
  const err = new Error('Request failed with status 429');
  const msg = formatErrorAlert(err);
  checkTrue('formatErrorAlert - 429: bevat Rate limit', msg.includes('Rate limit'));
}

// 4. Generieke fout
{
  const err = new Error('Unexpected network error');
  const msg = formatErrorAlert(err);
  checkTrue('formatErrorAlert - generiek: bevat Fout in setup-detector', msg.includes('Fout in setup-detector'));
  checkTrue('formatErrorAlert - generiek: bevat originele foutmelding', msg.includes('Unexpected network error'));
}

// 5. Fout zonder message-property
{
  const msg = formatErrorAlert({ message: undefined });
  checkTrue('formatErrorAlert - geen message: returnt string', typeof msg === 'string' && msg.length > 0);
}

// --- formatHeartbeat ---

// 6. Zonder lastSignalTime → 'nog geen setup'
{
  const msg = formatHeartbeat(null);
  checkTrue('formatHeartbeat - geen signal: bevat nog geen setup', msg.includes('nog geen setup'));
  checkTrue('formatHeartbeat - bevat sessiestart', msg.includes('sessiestart'));
  checkTrue('formatHeartbeat - bevat monitoring', msg.includes('Monitoring actief'));
}

// 7. Met lastSignalTime → datum getoond
{
  const ts = new Date('2026-06-20T10:35:00Z').getTime();
  const msg = formatHeartbeat(ts);
  checkTrue('formatHeartbeat - met signal: bevat 2026-06-20', msg.includes('2026-06-20'));
  checkTrue('formatHeartbeat - met signal: bevat 10:35', msg.includes('10:35'));
}

// 8. Bevat altijd datumstring van vandaag
{
  const today = new Date().toISOString().slice(0, 10);
  const msg = formatHeartbeat(null);
  checkTrue('formatHeartbeat - bevat huidige datum', msg.includes(today));
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
