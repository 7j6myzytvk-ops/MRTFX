/**
 * Markeer één of meer live signalen als 'onbruikbaar' zodat ze buiten
 * forward-test statistieken vallen en niet als trade meetellen.
 *
 * Gebruik:
 *   node scripts/markOnbruikbaar.js --id 7
 *   node scripts/markOnbruikbaar.js --ids 830,831,832,833
 *   node scripts/markOnbruikbaar.js --sl 3524 --signal bearish
 *   node scripts/markOnbruikbaar.js --ts 2026-11-25
 *   node scripts/markOnbruikbaar.js --id 7 --reden "duplicaat"
 *
 * --ids   : komma-gescheiden lijst van ID's voor bulk-markering (allemaal dezelfde reden)
 * --reden : vrije omschrijving (standaard: 'SL/TP aan verkeerde kant van entry')
 * Minstens één zoekparameter verplicht (id, ids, sl, of ts).
 * Bij meerdere matches op --id/--sl/--ts krijg je een overzicht en wordt niets gewijzigd.
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
  const { id, ids, sl, signal: signalArg, ts, reden } = args;
  const defaultReden = 'SL/TP aan verkeerde kant van entry — handmatig gemarkeerd';

  if (!id && !ids && !sl && !ts) {
    console.error('Minimaal één zoekparameter vereist: --id, --ids, --sl, of --ts');
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

  // Bulk-modus: --ids 830,831,832,833
  if (ids) {
    const idList = String(ids).split(',').map((x) => x.trim()).filter(Boolean);
    let changed = 0;
    for (const targetId of idList) {
      const s = signals.find((x) => String(x.id) === targetId);
      if (!s) { console.log(`⚠️  Signaal id=${targetId} niet gevonden — overgeslagen.`); continue; }
      if (s.onbruikbaar === true) { console.log(`ℹ️  Signaal id=${targetId} was al onbruikbaar.`); continue; }
      s.onbruikbaar = true;
      s.onbruikbaarReden = typeof reden === 'string' ? reden : defaultReden;
      console.log(`✅ id=${targetId} | ${s.timestamp?.slice(0, 16)} | ${s.decision?.signal} → onbruikbaar (${s.onbruikbaarReden})`);
      changed++;
    }
    if (changed > 0) {
      const updated = Array.isArray(db) ? signals : { ...db, signals };
      await writeFile(SIGNALS_FILE, JSON.stringify(updated, null, 2));
      console.log(`${changed} signaal/signalen gemarkeerd. Tellen niet meer mee in de forward-test.`);
    }
    return;
  }

  // Enkel-modus: --id / --sl / --ts filter
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
  target.onbruikbaarReden = typeof reden === 'string' ? reden : defaultReden;

  const updated = Array.isArray(db) ? signals : { ...db, signals };
  await writeFile(SIGNALS_FILE, JSON.stringify(updated, null, 2));

  console.log(`✅ Signaal id=${target.id} (${target.timestamp?.slice(0, 16)} | ${target.decision?.signal} | SL ${target.decision?.stopLoss}) gemarkeerd als onbruikbaar.`);
  console.log(`Reden: ${target.onbruikbaarReden}`);
  console.log('Dit signaal telt niet meer mee in de forward-test statistieken.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
