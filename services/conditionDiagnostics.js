// Passieve diagnostiek voor de conditie-checker. Logt bij elke poll-cyclus welke
// van de vier voorwaarden wel/niet klopten, zonder de besluitvorming zelf te
// beinvloeden. Doel: na verloop van tijd objectief kunnen zien welke voorwaarde
// het vaakst de blokkerende factor is, in plaats van te gokken.
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'live', 'conditionLog.json');
const MAX_ENTRIES = 5000; // voorkomt onbeperkte groei (~5000 polls = >2 maanden bij 1/5min binnen sessie)

async function readAll() {
  try {
    const raw = await readFile(FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Zet een ruwe checkConditions()-uitkomst om in een compact logregel.
export function toLogEntry(conditions, now = new Date()) {
  const { details } = conditions;
  return {
    timestamp: now.toISOString(),
    triggered: conditions.triggered,
    direction: conditions.triggered ? conditions.direction : null,
    blockers: conditions.blockers,
    details: {
      session: details.session,
      tfAligned: details.tfAlignment?.aligned ?? false,
      trendAligned: details.trendBias?.aligned ?? false,
      directionConsistent:
        details.tfAlignment?.aligned && details.trendBias?.aligned
          ? details.tfAlignment.direction === details.trendBias.direction
          : null, // niet van toepassing als TF of trend al niet aligned is
      nearLevel: details.nearLevel?.near ?? false,
    },
  };
}

export async function recordConditionCheck(conditions, now = new Date()) {
  const entry = toLogEntry(conditions, now);
  const all = await readAll();
  all.push(entry);
  const trimmed = all.length > MAX_ENTRIES ? all.slice(all.length - MAX_ENTRIES) : all;

  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(trimmed, null, 2));

  return entry;
}

export async function getConditionLog() {
  return readAll();
}

// Pure aggregatiefunctie - los van I/O, dus zonder bestandstoegang te unit-testen.
export function summarizeConditionLog(entries) {
  if (!entries || entries.length === 0) {
    return { n: 0, triggered: 0, blockerCounts: {}, conditionPassRate: {} };
  }

  const blockerCounts = {};
  const conditionTotals = { session: 0, tfAligned: 0, trendAligned: 0, directionConsistent: 0, nearLevel: 0 };
  const conditionApplicable = { session: 0, tfAligned: 0, trendAligned: 0, directionConsistent: 0, nearLevel: 0 };
  let triggered = 0;

  for (const entry of entries) {
    if (entry.triggered) triggered++;
    for (const blocker of entry.blockers ?? []) {
      blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
    }
    for (const key of Object.keys(conditionTotals)) {
      const value = entry.details?.[key];
      if (value === null || value === undefined) continue; // niet van toepassing (bv. directionConsistent)
      conditionApplicable[key]++;
      if (value) conditionTotals[key]++;
    }
  }

  const conditionPassRate = {};
  for (const key of Object.keys(conditionTotals)) {
    conditionPassRate[key] = conditionApplicable[key] > 0
      ? Math.round((conditionTotals[key] / conditionApplicable[key]) * 1000) / 10
      : null;
  }

  return { n: entries.length, triggered, blockerCounts, conditionPassRate };
}

export function formatDiagnosticsReport(summary) {
  if (summary.n === 0) return 'Nog geen diagnostiek-data verzameld.';

  const blockerLines = Object.entries(summary.blockerCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `  • ${k}: ${v}× (${Math.round((v / summary.n) * 1000) / 10}%)`)
    .join('\n') || '  geen blockers geregistreerd';

  const passRateLines = Object.entries(summary.conditionPassRate)
    .map(([k, v]) => `  ${k}: ${v === null ? 'n.v.t.' : v + '%'} geslaagd`)
    .join('\n');

  return (
    `**Conditie-diagnostiek** (${summary.n} polls, ${summary.triggered} getriggerd)\n\n` +
    `**Meest voorkomende blokkades:**\n${blockerLines}\n\n` +
    `**Slagingspercentage per conditie:**\n${passRateLines}`
  );
}
