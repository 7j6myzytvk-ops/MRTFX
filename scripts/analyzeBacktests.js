import { readFile } from 'fs/promises';
import path from 'path';
import { summarize } from '../agents/outcomeEvaluator.js';
import {
  classifyDevilsAdvocate,
  classifyMacroAlignment,
  classifyRebuttalShift,
  classifyCeoAgreement,
  classifyConfidenceBucket,
  classifyRiskReward,
  breakdown,
} from '../agents/agentAnalysis.js';

const FILE = path.join(process.cwd(), 'data', 'backtests.json');

function printSummary(title, stats) {
  console.log(`\n${title}`);
  const winRate = stats.winRate !== null ? `${stats.winRate}%` : '-';
  console.log(
    `  N=${stats.totalSamples} (${stats.neutraal} neutraal, ${stats.trades} trades: ` +
      `${stats.tp} TP / ${stats.sl} SL / ${stats.geen} geen) -> winRate ${winRate}`,
  );
  console.log(`  gem. zekerheid TP: ${stats.avgConfidenceTp ?? '-'}% | SL: ${stats.avgConfidenceSl ?? '-'}%`);
}

function printBreakdown(title, results) {
  console.log(`\n${title}`);
  for (const r of results) {
    const winRate = r.winRate !== null ? `${r.winRate}%` : '-';
    console.log(
      `  ${r.label.padEnd(14)} N=${r.totalSamples} (${r.tp} TP / ${r.sl} SL / ${r.geen} geen / ` +
        `${r.neutraal} neutraal) -> winRate ${winRate}`,
    );
  }
}

const all = JSON.parse(await readFile(FILE, 'utf-8'));
const samples = all.flatMap((r) => r.samples);
const withDiscussion = samples.filter((s) => s.discussion);

console.log(`Backtest-analyse: ${all.length} run(s), ${samples.length} samples totaal.`);

printSummary('Algemeen overzicht (alle samples)', summarize(samples));
printSummary(`Subset met teamdiscussie-data (sinds Fase 9, N=${withDiscussion.length})`, summarize(withDiscussion));

if (withDiscussion.length === 0) {
  console.log('\nGeen samples met discussion-data - agent-analyse wordt overgeslagen.');
} else {
  console.log('\n--- Agent-analyse ---');
  console.log('Let op: bij kleine N per groep (vaak <5) zijn deze cijfers indicatief, geen statistische significantie.');

  printBreakdown("Devil's Advocate t.o.v. eindbesluit", breakdown(samples, classifyDevilsAdvocate, ['eens', 'oneens']));
  printBreakdown(
    'Marktcontext-alignment (sentiment vs. besluitrichting)',
    breakdown(samples, classifyMacroAlignment, ['aligned', 'contrarian', 'neutraal']),
  );
  printBreakdown(
    'Zekerheidsverschuiving van analist na weerwoord',
    breakdown(samples, classifyRebuttalShift, ['omlaag', 'gelijk', 'omhoog']),
  );
  printBreakdown('CEO t.o.v. eerste analyse', breakdown(samples, classifyCeoAgreement, ['volgt-analist', 'wijkt-af']));
  printBreakdown('CEO-zekerheid', breakdown(samples, classifyConfidenceBucket, ['<60%', '60-70%', '>70%']));
  printBreakdown('Risk/reward-ratio', breakdown(samples, classifyRiskReward, ['<1.5', '1.5-2.5', '>2.5']));
}
