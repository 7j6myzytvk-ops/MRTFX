import { assessSession, formatSessionNote } from '../agents/sessionContext.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? 'OK  ' : 'FAIL'), label);
  if (!ok) {
    console.log('  verwacht:', JSON.stringify(expected));
    console.log('  ontvangen:', JSON.stringify(actual));
    fail++;
  } else {
    pass++;
  }
}

function utc(h, m = 0) {
  const d = new Date('2026-01-01T00:00:00Z');
  d.setUTCHours(h, m, 0, 0);
  return d;
}

// Asian sessie
check('assessSession - 03:00 UTC = Asian', assessSession(utc(3)).zone, 'Asian');
check('assessSession - Asian reliability = laag', assessSession(utc(3)).reliability, 'laag');
check('assessSession - 06:59 UTC = Asian', assessSession(utc(6, 59)).zone, 'Asian');

// London Kill Zone
check('assessSession - 07:00 UTC = London Kill Zone', assessSession(utc(7)).zone, 'London Kill Zone');
check('assessSession - London Kill Zone reliability = RISICO', assessSession(utc(8)).reliability, 'RISICO');
check('assessSession - 09:59 UTC = London Kill Zone', assessSession(utc(9, 59)).zone, 'London Kill Zone');

// London-NY overlap
check('assessSession - 10:00 UTC = London-NY overlap', assessSession(utc(10)).zone, 'London-NY overlap');
check('assessSession - 11:30 UTC = London-NY overlap', assessSession(utc(11, 30)).zone, 'London-NY overlap');

// NY Kill Zone
check('assessSession - 12:00 UTC = NY Kill Zone', assessSession(utc(12)).zone, 'NY Kill Zone');
check('assessSession - NY Kill Zone reliability = hoog', assessSession(utc(13)).reliability, 'hoog');
check('assessSession - 14:59 UTC = NY Kill Zone', assessSession(utc(14, 59)).zone, 'NY Kill Zone');

// London Close
check('assessSession - 15:00 UTC = London Close', assessSession(utc(15)).zone, 'London Close');
check('assessSession - 16:30 UTC = London Close', assessSession(utc(16, 30)).zone, 'London Close');

// Off-peak
check('assessSession - 17:00 UTC = Off-peak', assessSession(utc(17)).zone, 'Off-peak');
check('assessSession - 23:00 UTC = Off-peak', assessSession(utc(23)).zone, 'Off-peak');

// Default (geen argument)
check('assessSession - geen argument = object met zone', typeof assessSession().zone, 'string');

// formatSessionNote
const note = formatSessionNote(assessSession(utc(13)));
check('formatSessionNote - bevat NY Kill Zone', note.includes('NY Kill Zone'), true);
check('formatSessionNote - bevat SESSIE-CONTEXT', note.includes('SESSIE-CONTEXT'), true);
check('formatSessionNote - bevat reliability', note.includes('hoog'), true);

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
