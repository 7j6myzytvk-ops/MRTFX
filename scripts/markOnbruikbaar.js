/**
 * Markeer een live signaal als 'onbruikbaar' zodat het buiten
 * forward-test statistieken valt en niet als trade meetelt.
 *
 * Gebruik:
 *   node scripts/markOnbruikbaar.js --id 7
 *   node scripts/markOnbruikbaar.js --sl 3524 --signal bearish
 *   node scripts/markOnbruikbaar.js --ts 2026-11-25
 *
 * Minstens één zoekparameter verplicht (id, sl, of ts).
 * Bij meerdere matches krijg je een overzicht en wordt niets gewijzigd.
 */

import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const SIGNALS_FILE = path.join(process.cwd(), 'data', 'live', 'signals.json');

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { a[argv[i].slice(2)] = argv[i + 1] ?? true; i++; }
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { id, sl, signal: signalArg, ts } = args;

  if (!id && !sl && !ts) {
    console.error('Minimaal één zoekparameter vereist: --id, --sl, of --ts');
    process.exit(1);
  }

  let db;
  try {
    db = JSON.parse(await readFile(SIGNALS_FILE, 'utf-8'));
  } catch {
    console.error(`Kan ${SIGNALS_FILE} niet lezen.`);
    process.exit(1);
  }

  const signals = Array.isArray(db) ? db : (db.signals ?? []);

  const matches = signals.filter((s) => {
    if (id  && String(s.id) !== String(id)) return false;
    if (sl  && Math.abs((s.decision?.stopLoss ?? NaN) - parseFloat(sl)) > 1) return false;
    if (signalArg && s.decision?.signal !== signalArg) return false;
    if (ts  && !(s.timestamp ?? '').startsWith(ts)) return false;
    return true;
  });

  if (matches.length === 0) {
    console.log('Geen signaal gevonden met de opgegeven criteria.');
    console.log('Beschikbare signalen:');
    signals.forEach((s) =>
      console.log(`  id=${s.id} | ${s.timestamp?.slice(0, 16)} | ${s.decision?.signal} | SL ${s.decision?.stopLoss} | onbruikbaar=${s.onbruikbaar ?? false}`),
    );
    process.exit(1);
  }

  if (matches.length > 1) {
    console.log(`${matches.length} signalen gevonden — voeg een extra filter toe:`);
    matches.forEach((s) =>
      console.log(`  id=${s.id} | ${s.timestamp?.slice(0, 16)} | ${s.decision?.signal} | SL ${s.decision?.stopLoss}`),
    );
    process.exit(1);
  }

  const target = matches[0];
  if (target.onbruikbaar === true) {
    console.log(`Signaal id=${target.id} was al gemarkeerd als onbruikbaar.`);
    process.exit(0);
  }

  target.onbruikbaar = true;
  target.onbruikbaarReden = 'SL/TP aan verkeerde kant van entry — handmatig gemarkeerd';

  const updated = Array.isArray(db) ? signals : { ...db, signals };
  await writeFile(SIGNALS_FILE, JSON.stringify(updated, null, 2));

  console.log(`✅ Signaal id=${target.id} (${target.timestamp?.slice(0, 16)} | ${target.decision?.signal} | SL ${target.decision?.stopLoss}) gemarkeerd als onbruikbaar.`);
  console.log('Dit signaal telt niet meer mee in de forward-test statistieken.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
