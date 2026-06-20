import { isBriefingValid, formatBriefingNote } from '../services/macroBriefing.js';

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

const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const PAST   = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

// --- isBriefingValid ---

check('isBriefingValid - null', isBriefingValid(null), false);
check('isBriefingValid - undefined', isBriefingValid(undefined), false);
check('isBriefingValid - geen text', isBriefingValid({ expiresAt: FUTURE }), false);
check('isBriefingValid - geen expiresAt', isBriefingValid({ text: 'test' }), false);
check('isBriefingValid - verlopen', isBriefingValid({ text: 'test', expiresAt: PAST }), false);
check('isBriefingValid - geldig', isBriefingValid({ text: 'test', expiresAt: FUTURE }), true);
check('isBriefingValid - lege text', isBriefingValid({ text: '', expiresAt: FUTURE }), false);

// --- formatBriefingNote ---

// Verlopen → lege string
check('formatBriefingNote - verlopen: lege string', formatBriefingNote({ text: 'test', expiresAt: PAST }), '');

// null → lege string
check('formatBriefingNote - null: lege string', formatBriefingNote(null), '');

// Geldig → bevat de tekst
{
  const b = { text: 'Iran-deal gesloten, PCE donderdag', expiresAt: FUTURE };
  const note = formatBriefingNote(b);
  checkTrue('formatBriefingNote - bevat tekst', note.includes('Iran-deal gesloten'));
  checkTrue('formatBriefingNote - bevat MACRO-BRIEFING label', note.includes('MACRO-BRIEFING'));
  checkTrue('formatBriefingNote - bevat vervaldatum', note.includes('geldig t/m'));
  checkTrue('formatBriefingNote - bevat gebruiksinstructie', note.includes('achtergrondkennis'));
  checkTrue('formatBriefingNote - is niet leeg', note.length > 100);
}

// Vervaldatum correct geformatteerd (YYYY-MM-DD)
{
  const expiresAt = '2026-06-27T17:00:00.000Z';
  const b = { text: 'test', expiresAt };
  const note = formatBriefingNote(b);
  checkTrue('formatBriefingNote - datum formaat YYYY-MM-DD', note.includes('2026-06-27'));
}

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
