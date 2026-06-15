import { isCacheValid } from '../services/marketData.js';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-06-15T12:00:00Z');

check('geen cache (fetchedAt null) -> ongeldig', isCacheValid(null, DAY_MS, now), false);
check('geen cache (fetchedAt undefined) -> ongeldig', isCacheValid(undefined, DAY_MS, now), false);
check('1 uur geleden, ttl 1 dag -> nog geldig', isCacheValid(now - 60 * 60 * 1000, DAY_MS, now), true);
check('exact 1 dag geleden -> ongeldig (niet < ttl)', isCacheValid(now - DAY_MS, DAY_MS, now), false);
check('net binnen 1 dag (1ms voor de grens) -> nog geldig', isCacheValid(now - DAY_MS + 1, DAY_MS, now), true);
check('2 dagen geleden -> ongeldig', isCacheValid(now - 2 * DAY_MS, DAY_MS, now), false);
check('in de toekomst (klok teruggezet) -> geldig', isCacheValid(now + 1000, DAY_MS, now), true);

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
