// Bepaalt de huidige XAU/USD-handelssessie op basis van UTC-tijd.
// Pure functie — geen I/O, geen API-calls, altijd beschikbaar.

const SESSIONS = [
  {
    zone: 'Asian',
    from: 0,
    to: 7,
    reliability: 'laag',
    note:
      'Aziatische sessie (00:00–07:00 UTC): lage liquiditeit, accumulatie/range. ' +
      'Geen directioneel momentum — entries hier zijn minder betrouwbaar.',
  },
  {
    zone: 'London Kill Zone',
    from: 7,
    to: 10,
    reliability: 'RISICO',
    note:
      'London Kill Zone (07:00–10:00 UTC): MANIPULATIEFASE. Hoog risico op Judas Swing — ' +
      'London open breekt vaak de Aziatische range vals om retail-stops te triggeren. ' +
      'Entry zonder bevestiging dat de Judas Swing al afgerond is = gevaarlijk.',
  },
  {
    zone: 'London-NY overlap',
    from: 10,
    to: 12,
    reliability: 'matig',
    note:
      'London-NY overlap (10:00–12:00 UTC): transitiefase. Richting begint te consolideren, ' +
      'maar de echte NY-institutionele beweging is nog niet gestart.',
  },
  {
    zone: 'NY Kill Zone',
    from: 12,
    to: 15,
    reliability: 'hoog',
    note:
      'New York Kill Zone (12:00–15:00 UTC): echte institutionele beweging — hoogste liquiditeit, ' +
      'macro-events clusteren hier. Het meest betrouwbare window voor entries.',
  },
  {
    zone: 'London Close',
    from: 15,
    to: 17,
    reliability: 'matig',
    note:
      'London Close (15:00–17:00 UTC): posities worden gesloten — tijdelijke reversals mogelijk. ' +
      'Entries voorzichtig, trend kan kort keren.',
  },
  {
    zone: 'Off-peak',
    from: 17,
    to: 24,
    reliability: 'laag',
    note:
      'Off-peak (17:00–00:00 UTC): lage liquiditeit buiten de hoofdsessies. ' +
      'Bewegingen zijn minder representatief voor de institutionele richting.',
  },
];

export function assessSession(now = new Date()) {
  const decimal = now.getUTCHours() + now.getUTCMinutes() / 60;
  const session = SESSIONS.find((s) => decimal >= s.from && decimal < s.to) ?? SESSIONS[SESSIONS.length - 1];
  return { zone: session.zone, reliability: session.reliability, note: session.note };
}

export function formatSessionNote(session) {
  return (
    `\n\nSESSIE-CONTEXT (automatisch bepaald op UTC-tijd):\n` +
    `Huidige sessie: ${session.zone} — betrouwbaarheid: ${session.reliability}\n` +
    `${session.note}`
  );
}
