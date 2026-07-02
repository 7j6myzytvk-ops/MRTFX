import {
  etToUtc,
  getUpcomingEvents,
  getRecentlyReleasedEvents,
  formatEventsNote,
} from '../agents/economicCalendar.js';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(ok ? 'OK  ' : 'FAIL', label);
  if (!ok) {
    console.log('  verwacht:', JSON.stringify(expected));
    console.log('  ontvangen:', JSON.stringify(actual));
    fail++;
  } else {
    pass++;
  }
}

// --- etToUtc: nieuw ISO-formaat (huidige FF-feed) ---
check('ISO met -04:00 offset -> UTC', etToUtc('2026-07-02T08:30:00-04:00', undefined), '2026-07-02T12:30:00.000Z');
check('ISO met -05:00 offset -> UTC', etToUtc('2026-01-09T08:30:00-05:00', undefined), '2026-01-09T13:30:00.000Z');
check('ISO 15:15 ET -> 19:15 UTC', etToUtc('2026-07-01T15:15:00-04:00', undefined), '2026-07-01T19:15:00.000Z');

// --- etToUtc: oud am/pm-formaat (fallback) ---
// Juli = maand 6 (0-indexed) → EDT = UTC-4
check('8:30am ET juli -> 12:30 UTC', etToUtc('2026-07-03', '8:30am'), '2026-07-03T12:30:00.000Z');
check('3:45pm ET juli -> 19:45 UTC', etToUtc('2026-07-01', '3:45pm'), '2026-07-01T19:45:00.000Z');
check('12:00pm ET (middag) -> 16:00 UTC', etToUtc('2026-07-01', '12:00pm'), '2026-07-01T16:00:00.000Z');
check('12:00am ET (middernacht) -> 04:00 UTC', etToUtc('2026-07-01', '12:00am'), '2026-07-01T04:00:00.000Z');
// Januari = maand 0 → EST = UTC-5
check('8:30am ET januari -> 13:30 UTC', etToUtc('2026-01-09', '8:30am'), '2026-01-09T13:30:00.000Z');
// Laat tijdstip dat over middernacht gaat
check('11:00pm ET juli -> 03:00 UTC volgende dag', etToUtc('2026-07-01', '11:00pm'), '2026-07-02T03:00:00.000Z');
// Edge cases
check('etToUtc null timeStr -> null', etToUtc('2026-07-01', null), null);
check('etToUtc All Day -> null', etToUtc('2026-07-01', 'All Day'), null);
check('etToUtc lege string -> null', etToUtc('2026-07-01', ''), null);

// --- Test-fixtures ---
const now = new Date('2026-07-01T16:00:00.000Z');

const events = [
  // 30 min geleden vrijgegeven, actual beschikbaar
  { title: 'Final Manufacturing PMI', utcTime: '2026-07-01T15:45:00.000Z', hasActual: true, actual: '51.2', forecast: '51.7', previous: '52.0' },
  // Komende 2u, nog niet vrijgegeven
  { title: 'ISM Manufacturing PMI', utcTime: '2026-07-01T17:00:00.000Z', hasActual: false, actual: null, forecast: '49.8', previous: '48.7' },
  // Morgen
  { title: 'Non-Farm Payrolls', utcTime: '2026-07-02T12:30:00.000Z', hasActual: false, actual: null, forecast: '180K', previous: '175K' },
  // Meer dan 60 min geleden — buiten lookback
  { title: 'ADP Employment', utcTime: '2026-07-01T13:30:00.000Z', hasActual: true, actual: '155K', forecast: '160K', previous: '152K' },
];

// --- getRecentlyReleasedEvents ---
const recent = getRecentlyReleasedEvents(events, 60, now);
check('getRecentlyReleasedEvents -> 1 event binnen 60 min', recent.length, 1);
check('getRecentlyReleasedEvents -> correcte titel', recent[0].title, 'Final Manufacturing PMI');

const recent30 = getRecentlyReleasedEvents(events, 30, now);
check('getRecentlyReleasedEvents 30min -> ook 1 (net binnen)', recent30.length, 1);

// --- getUpcomingEvents ---
const upcoming48 = getUpcomingEvents(events, 48, now);
check('getUpcomingEvents 48u -> 2 events', upcoming48.length, 2);

const upcoming1 = getUpcomingEvents(events, 1, now);
check('getUpcomingEvents 1u -> 1 event (ISM)', upcoming1.length, 1);
check('getUpcomingEvents 1u -> ISM', upcoming1[0].title, 'ISM Manufacturing PMI');

// --- formatEventsNote ---
const note = formatEventsNote(upcoming48, recent);
check('formatEventsNote bevat "zojuist vrijgegeven"', note.includes('zojuist vrijgegeven'), true);
check('formatEventsNote bevat PMI-titel', note.includes('Final Manufacturing PMI'), true);
check('formatEventsNote bevat actual waarde', note.includes('51.2'), true);
check('formatEventsNote bevat "slechter dan verwacht"', note.includes('slechter dan verwacht'), true);
check('formatEventsNote bevat aankomende events', note.includes('Aankomende'), true);
check('formatEventsNote bevat NFP', note.includes('Non-Farm Payrolls'), true);

// Lege invoer
const emptyNote = formatEventsNote([], []);
check('formatEventsNote leeg -> lege string', emptyNote, '');

// Alleen recent, geen upcoming
const onlyRecentNote = formatEventsNote([], recent);
check('formatEventsNote alleen recent -> geen aankomende sectie', onlyRecentNote.includes('Aankomende'), false);
check('formatEventsNote alleen recent -> wel zojuist-sectie', onlyRecentNote.includes('zojuist vrijgegeven'), true);

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
