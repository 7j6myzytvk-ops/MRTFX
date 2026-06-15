import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'signals.json');

async function readAll() {
  try {
    const raw = await readFile(FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Schrijf-queue: voorkomt dat gelijktijdige appendSignal-calls (bv. de scheduler en een
// /analyse-command op hetzelfde moment) elkaars read-modify-write overschrijven.
let queue = Promise.resolve();

export function appendSignal(record) {
  const result = queue.then(() => writeEntry(record));
  queue = result.catch(() => {});
  return result;
}

async function writeEntry(record) {
  const all = await readAll();
  const entry = { id: all.length + 1, timestamp: new Date().toISOString(), ...record };
  all.push(entry);

  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 2));

  return entry;
}

export async function getRecentSignals(limit = 5) {
  const all = await readAll();
  return all.slice(-limit).reverse();
}

export async function getAllSignals() {
  return readAll();
}

export function updateSignalOutcome(id, outcome) {
  const result = queue.then(() => writeOutcome(id, outcome));
  queue = result.catch(() => {});
  return result;
}

async function writeOutcome(id, outcome) {
  const all = await readAll();
  const entry = all.find((s) => s.id === id);
  if (!entry) return null;

  entry.outcome = outcome;
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 2));

  return entry;
}
