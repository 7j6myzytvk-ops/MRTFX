import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'data', 'live', 'blockedSignals.json');

async function readLog() {
  try {
    const raw = await readFile(LOG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeLog(entries) {
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await writeFile(LOG_FILE, JSON.stringify(entries, null, 2));
}

// Sla een geblokkeerd signaal op met tijdstempel, richting, zekerheid, blockers en
// setupScore. Na 4 weken geeft dit het inzicht dat ontbrak: hoe vaak was het systeem
// bijna klaar maar niet, en welke filters blokkeerden het vaakst?
export async function logBlockedSignal({ decision, qualityResult, discussion, entryPrice, atr14 }) {
  if (!qualityResult || qualityResult.passed) return;

  const entries = await readLog();
  entries.push({
    timestamp: new Date().toISOString(),
    signal: decision.signal,
    confidence: decision.confidence,
    blockers: qualityResult.blockers ?? [],
    setupScore: discussion?.analyst?.setupQualityScore ?? null,
    amdPhase: discussion?.analyst?.amdPhase ?? null,
    entryPrice: entryPrice ?? null,
    atr14: atr14 ?? null,
  });

  await writeLog(entries);
}

export async function getBlockedSignals() {
  return readLog();
}
