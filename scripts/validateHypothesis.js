/**
 * Valideer een hypothese uit data/live/lessons.json met harde criteria.
 *
 * Gebruik:
 *   node scripts/validateHypothesis.js \
 *     --id h_xxx \
 *     --status accepted|rejected \
 *     --trades 45 \
 *     --expectancyR 0.42 \
 *     --period "2026-06-01/2026-08-31" \
 *     [--summary "Optionele toelichting"]
 *
 * Harde weigeringsregels voor 'accepted':
 *   1. --trades < 30            → te weinig trades voor statistische conclusie
 *   2. --expectancyR <= 0       → negatieve of nul verwachtingswaarde na kosten
 *   3. --period overlapt de periode waaruit de hypothese is geformuleerd
 *
 * ExpectancyR-berekening: (WR × R:R) − ((1−WR) × 1) − kosten_per_trade_in_R
 * Kosten: $0,70 per trade. Typische SL-afstand $10–20 → kosten = 0,70/15 ≈ 0,047R.
 * Geef --expectancyR al INCLUSIEF aftrek van kosten.
 */

import { readFile, writeFile } from 'fs/promises';
import path from 'path';

const LESSONS_FILE = path.join(process.cwd(), 'data', 'live', 'lessons.json');
const MIN_TRADES_FOR_ACCEPTED = 30;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] ?? true;
      i++;
    }
  }
  return args;
}

function periodsOverlap(hypothesisCreatedAt, testPeriod) {
  if (!testPeriod || !hypothesisCreatedAt) return false;
  const [fromStr, toStr] = testPeriod.split('/');
  if (!fromStr || !toStr) return false;
  const from = new Date(fromStr.trim());
  const to   = new Date(toStr.trim());
  const created = new Date(hypothesisCreatedAt);
  // Hypothese is gecreëerd op basis van data tot en met createdAt.
  // Als de testperiode eindigt VOOR de creatiedatum, is er geen overlap.
  // Als de testperiode begint VOOR de creatiedatum, overlapt hij de trainingsperiode.
  return from < created;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const { id, status, trades, expectancyR, period, summary = '' } = args;

  if (!id || !status || !trades || expectancyR === undefined || !period) {
    console.error(
      'Gebruik: node scripts/validateHypothesis.js --id <id> --status <accepted|rejected> ' +
      '--trades <n> --expectancyR <getal> --period <van/tot> [--summary "tekst"]\n' +
      'Voorbeeld: --period "2026-06-01/2026-08-31"',
    );
    process.exit(1);
  }

  if (!['accepted', 'rejected'].includes(status)) {
    console.error('--status moet "accepted" of "rejected" zijn.');
    process.exit(1);
  }

  const tradesNum     = Number(trades);
  const expectancyNum = Number(expectancyR);

  if (isNaN(tradesNum) || isNaN(expectancyNum)) {
    console.error('--trades en --expectancyR moeten getallen zijn.');
    process.exit(1);
  }

  // Lees lessons.json
  let db;
  try {
    const raw = await readFile(LESSONS_FILE, 'utf-8');
    db = JSON.parse(raw);
  } catch {
    console.error(`Kan ${LESSONS_FILE} niet lezen. Voer eerst lessonAgent uit.`);
    process.exit(1);
  }

  const hypothesis = db.hypotheses.find((h) => h.id === id);
  if (!hypothesis) {
    const ids = db.hypotheses.map((h) => h.id).join(', ');
    console.error(`Hypothese "${id}" niet gevonden. Beschikbare IDs:\n${ids}`);
    process.exit(1);
  }

  if (hypothesis.status !== 'open') {
    console.error(`Hypothese "${id}" heeft al status "${hypothesis.status}" — kan niet opnieuw gevalideerd worden.`);
    process.exit(1);
  }

  // Harde weigeringsregels voor 'accepted'
  if (status === 'accepted') {
    const errors = [];

    if (tradesNum < MIN_TRADES_FOR_ACCEPTED) {
      errors.push(`Te weinig trades: ${tradesNum} < ${MIN_TRADES_FOR_ACCEPTED} (minimum voor 'accepted')`);
    }

    if (expectancyNum <= 0) {
      errors.push(`Verwachtingswaarde ≤ 0 (${expectancyNum}R na $0,70 kosten per trade) — systeem verliest geld op deze subgroep`);
    }

    if (periodsOverlap(hypothesis.createdAt, period)) {
      errors.push(
        `Testperiode "${period}" overlapt de periode waaruit de hypothese is geformuleerd ` +
        `(hypothese gecreëerd: ${hypothesis.createdAt.slice(0, 10)}). ` +
        `Gebruik een out-of-sample periode die EINDIGT na de creatiedatum.`,
      );
    }

    if (errors.length > 0) {
      console.error('❌ Validatie geweigerd:\n' + errors.map((e) => `  • ${e}`).join('\n'));
      process.exit(1);
    }
  }

  // Validatie geslaagd — sla op
  hypothesis.status = status;
  hypothesis.backtestResult = {
    trades: tradesNum,
    expectancyR: expectancyNum,
    period,
    summary: summary || null,
    validatedAt: new Date().toISOString(),
  };
  if (status === 'accepted') {
    hypothesis.acceptedAt = new Date().toISOString();
  }

  db.lastUpdated = new Date().toISOString();
  await writeFile(LESSONS_FILE, JSON.stringify(db, null, 2));

  const icon = status === 'accepted' ? '✅' : '❌';
  console.log(`\n${icon} Hypothese "${id}" gemarkeerd als ${status.toUpperCase()}.`);
  console.log(`   Text:        ${hypothesis.text}`);
  console.log(`   Trades:      ${tradesNum}`);
  console.log(`   ExpectancyR: ${expectancyNum}R (na $0,70 kosten)`);
  console.log(`   Periode:     ${period}`);
  if (summary) console.log(`   Toelichting: ${summary}`);
  console.log(`\nOpgeslagen in ${LESSONS_FILE}`);
}

main().catch((err) => {
  console.error('Validatie mislukt:', err.message);
  process.exit(1);
});
