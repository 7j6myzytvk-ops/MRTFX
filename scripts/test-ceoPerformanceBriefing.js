import {
  computeStreak,
  computeBriefingStats,
  formatCeoPerformanceBriefingNote,
  formatRiskStreakNote,
} from '../services/ceoPerformanceBriefing.js';

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

function sig(result) {
  return { outcome: { result } };
}

// --- computeStreak ---
check('streak - leeg -> type null, count 0', computeStreak([]), { type: null, count: 0 });
check('streak - 1x tp', computeStreak([sig('tp')]), { type: 'tp', count: 1 });
check('streak - 3x sl achtereen', computeStreak([sig('tp'), sig('sl'), sig('sl'), sig('sl')]), { type: 'sl', count: 3 });
check('streak - afgewisseld, eindigt op tp', computeStreak([sig('sl'), sig('tp'), sig('tp')]), { type: 'tp', count: 2 });
check('streak - 1x geen', computeStreak([sig('sl'), sig('geen')]), { type: 'geen', count: 1 });

// --- computeBriefingStats ---
check('stats - leeg -> null', computeBriefingStats([]), null);

const mixed = [sig('tp'), sig('tp'), sig('sl'), sig('sl'), sig('tp')];
const stats = computeBriefingStats(mixed);
check('stats - n = 5', stats.n, 5);
check('stats - tp = 3', stats.tp, 3);
check('stats - sl = 2', stats.sl, 2);
check('stats - winRate = 60', stats.winRate, 60);
check('stats - streak type tp', stats.streak.type, 'tp');
check('stats - streak count 1', stats.streak.count, 1);

const allSl = [sig('sl'), sig('sl'), sig('sl'), sig('sl')];
const slStats = computeBriefingStats(allSl);
check('stats - 4x sl winRate = 0', slStats.winRate, 0);
check('stats - 4x sl streak count 4', slStats.streak.count, 4);

// --- formatCeoPerformanceBriefingNote ---
check('format - null -> lege string', formatCeoPerformanceBriefingNote(null), '');

const noteGoed = formatCeoPerformanceBriefingNote(stats);
check('format - bevat CHIEF OF STAFF', noteGoed.includes('CHIEF OF STAFF'), true);
check('format - bevat winRate 60', noteGoed.includes('60%'), true);
check('format - begint met \\n\\n', noteGoed.startsWith('\n\n'), true);

const noteSlecht = formatCeoPerformanceBriefingNote(slStats);
check('format - lage winRate -> waarschuwing', noteSlecht.includes('ruim onder doelstelling'), true);

const highStats = computeBriefingStats([sig('tp'), sig('tp'), sig('tp'), sig('tp'), sig('tp'), sig('sl')]);
const noteHoog = formatCeoPerformanceBriefingNote(highStats);
check('format - hoge winRate -> positieve noot', noteHoog.includes('boven verwachting'), true);

// Verliesreeks ≥ 3 → REEKS-ALERT
const slStreakStats = computeBriefingStats([sig('tp'), sig('sl'), sig('sl'), sig('sl')]);
const noteStreak = formatCeoPerformanceBriefingNote(slStreakStats);
check('format - 3x sl streak -> REEKS-ALERT', noteStreak.includes('REEKS-ALERT'), true);

// TP-reeks ≥ 3
const tpStreakStats = computeBriefingStats([sig('sl'), sig('tp'), sig('tp'), sig('tp')]);
const noteTpStreak = formatCeoPerformanceBriefingNote(tpStreakStats);
check('format - 3x tp streak -> discipline boodschap', noteTpStreak.includes('Reeks'), true);

// --- formatRiskStreakNote ---
check('riskStreak - null -> lege string', formatRiskStreakNote(null), '');
check('riskStreak - geen reeks -> lege string', formatRiskStreakNote(stats), '');
check('riskStreak - 3x sl -> heeft note', formatRiskStreakNote(slStreakStats).includes('klein'), true);
check('riskStreak - tp reeks -> lege string (geen impact)', formatRiskStreakNote(tpStreakStats), '');

// Reeks van 2 sl → nog geen note
const sl2 = computeBriefingStats([sig('tp'), sig('sl'), sig('sl')]);
check('riskStreak - 2x sl -> lege string', formatRiskStreakNote(sl2), '');

console.log(`\n${pass} geslaagd, ${fail} mislukt.`);
if (fail > 0) process.exit(1);
