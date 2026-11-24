/**
 * Filter-vergelijking: oude filters (pre-Fase 76) vs nieuwe filters (Fase 76-79)
 * Geen API-calls — puur lokale data opnieuw door de filterlogica halen.
 *
 * Wijzigingen die worden vergeleken:
 *   Fase 76: rebuttal-delta drempel -15 → -25 (minder agressief)
 *   Fase 78: R:R ondergrens <1.5 toegevoegd, AMD-filter (manipulation/onduidelijk) toegevoegd
 *   Fase 79: setupScore blokkeerdrempel <3 → <2 (score-schaal ook /6 → /5, maar numeriek
 *            maakt dit voor bestaande data dat score=2 niet meer blokkeert)
 *
 * Overige filters ongewijzigd: CEO-zekerheid <52%, macro contrarian, R:R >5.0,
 *   DA >70%, counter-trend D1+W1, ATR <13, SMA-gap >2.5×ATR.
 */

import { readFile } from 'fs/promises';

// ─── Gedeelde hulpfuncties ────────────────────────────────────────────────────

function parseEntryMidpoint(decision, entryPrice) {
  if (!decision?.entryZone) return entryPrice;
  const clean = decision.entryZone.replace(/\$/g, '').replace(/\s/g, '');
  const match = clean.match(/([\d.]+)[–\-]([\d.]+)/);
  if (!match) return entryPrice;
  const mid = (parseFloat(match[1]) + parseFloat(match[2])) / 2;
  return isNaN(mid) ? entryPrice : mid;
}

function classifyMacroAlignment(sample) {
  const { sentiment } = sample.discussion.macro;
  const { signal } = sample.decision;
  if (sentiment === 'neutraal' || signal === 'neutral') return 'neutraal';
  const aligned =
    (sentiment === 'risk-on' && signal === 'bullish') ||
    (sentiment === 'risk-off' && signal === 'bearish');
  return aligned ? 'aligned' : 'contrarian';
}

function classifyRiskReward(sample) {
  const { entryPrice, decision } = sample;
  const entry = parseEntryMidpoint(decision, entryPrice);
  const reward = Math.abs(decision.takeProfit - entry);
  const risk = Math.abs(entry - decision.stopLoss);
  if (risk === 0) return '<1.5';
  const rr = reward / risk;
  if (rr < 1.5) return '<1.5';
  if (rr <= 3.0) return '1.5-3.0';
  if (rr <= 5.0) return '3.0-5.0';
  return '>5.0';
}

function getRebuttalDelta(sample) {
  return (sample.discussion.analystRebuttal?.confidence ?? 0) -
         (sample.discussion.analyst?.confidence ?? 0);
}

// ─── OUDE filterlogica (pre-Fase 76) ─────────────────────────────────────────

function assessOld(sample) {
  if (!sample.discussion || sample.decision.signal === 'neutral') {
    return { passed: true, blockers: [] };
  }
  const blockers = [];

  if (sample.decision.confidence < 52) blockers.push('CEO-zekerheid onder 52%');
  if (classifyMacroAlignment(sample) === 'contrarian') blockers.push('macro contraireert de richting');

  // Oude Filter 3: drempel -15
  const delta = getRebuttalDelta(sample);
  if (delta <= -15) blockers.push(`analist verloor vertrouwen na discussie (−${Math.abs(delta)}%)`);

  if (sample.entryPrice != null && classifyRiskReward(sample) === '>5.0')
    blockers.push('R:R te ambitieus (>5.0)');
  // Geen R:R ondergrens <1.5 in oude versie

  if ((sample.discussion.devilsAdvocate?.counterConfidence ?? 0) > 70)
    blockers.push('pre-mortem: duidelijk faalscenario (>70%)');

  // Oude setupScore drempel: <3 (op /6 schaal)
  const score = sample.discussion.analyst?.setupQualityScore;
  if (score !== undefined && score !== null && score < 3)
    blockers.push(`setup-kwaliteit te laag (${score}/6)`);

  // Geen AMD-filter in oude versie

  // Counter-trend (ongewijzigd)
  const { dailyTrend, weeklyTrend } = sample;
  if (dailyTrend && weeklyTrend && dailyTrend !== 'neutraal' && weeklyTrend !== 'neutraal' && dailyTrend === weeklyTrend) {
    const isContrarian =
      (sample.decision.signal === 'bullish' && dailyTrend === 'bearish') ||
      (sample.decision.signal === 'bearish' && dailyTrend === 'bullish');
    if (isContrarian) blockers.push(`counter-trend: ${sample.decision.signal} vs D1+W1 ${dailyTrend}`);
  }

  const ATR_MIN = 13;
  if (sample.atr14 != null && sample.atr14 < ATR_MIN)
    blockers.push(`ATR te laag ($${sample.atr14.toFixed(1)} < $${ATR_MIN})`);

  const smaGapMax = sample.atr14 != null ? sample.atr14 * 2.5 : 50;
  if (sample.sma20H1 != null && sample.entryPrice != null) {
    const gap = sample.entryPrice - sample.sma20H1;
    if (sample.decision.signal === 'bearish' && gap < -smaGapMax)
      blockers.push('move overextended (bearish)');
    if (sample.decision.signal === 'bullish' && gap > smaGapMax)
      blockers.push('move overextended (bullish)');
  }

  return { passed: blockers.length === 0, blockers };
}

// ─── NIEUWE filterlogica (Fase 76-79) ────────────────────────────────────────

function assessNew(sample) {
  if (!sample.discussion || sample.decision.signal === 'neutral') {
    return { passed: true, blockers: [] };
  }
  const blockers = [];

  if (sample.decision.confidence < 52) blockers.push('CEO-zekerheid onder 52%');
  if (classifyMacroAlignment(sample) === 'contrarian') blockers.push('macro contraireert de richting');

  // Nieuwe Filter 3: drempel -25
  const delta = getRebuttalDelta(sample);
  if (delta <= -25) blockers.push(`analist verloor vertrouwen na discussie (−${Math.abs(delta)}%)`);

  if (sample.entryPrice != null && classifyRiskReward(sample) === '>5.0')
    blockers.push('R:R te ambitieus (>5.0)');

  // Nieuwe R:R ondergrens
  if (sample.entryPrice != null && classifyRiskReward(sample) === '<1.5')
    blockers.push('R:R te laag (<1.5)');

  if ((sample.discussion.devilsAdvocate?.counterConfidence ?? 0) > 70)
    blockers.push('pre-mortem: duidelijk faalscenario (>70%)');

  // Nieuwe setupScore drempel: <2 (na /5-schaalwijziging)
  const score = sample.discussion.analyst?.setupQualityScore;
  if (score !== undefined && score !== null && score < 2)
    blockers.push(`setup-kwaliteit te laag (${score})`);

  // Nieuwe AMD-filter
  const amdPhase = sample.discussion?.analyst?.amdPhase;
  if (amdPhase === 'manipulation') blockers.push('AMD-fase: manipulatie niet afgerond');
  if (amdPhase === 'onduidelijk') blockers.push('AMD-fase onduidelijk');

  // Counter-trend (ongewijzigd)
  const { dailyTrend, weeklyTrend } = sample;
  if (dailyTrend && weeklyTrend && dailyTrend !== 'neutraal' && weeklyTrend !== 'neutraal' && dailyTrend === weeklyTrend) {
    const isContrarian =
      (sample.decision.signal === 'bullish' && dailyTrend === 'bearish') ||
      (sample.decision.signal === 'bearish' && dailyTrend === 'bullish');
    if (isContrarian) blockers.push(`counter-trend: ${sample.decision.signal} vs D1+W1 ${dailyTrend}`);
  }

  const ATR_MIN = 13;
  if (sample.atr14 != null && sample.atr14 < ATR_MIN)
    blockers.push(`ATR te laag ($${sample.atr14.toFixed(1)} < $${ATR_MIN})`);

  const smaGapMax = sample.atr14 != null ? sample.atr14 * 2.5 : 50;
  if (sample.sma20H1 != null && sample.entryPrice != null) {
    const gap = sample.entryPrice - sample.sma20H1;
    if (sample.decision.signal === 'bearish' && gap < -smaGapMax)
      blockers.push('move overextended (bearish)');
    if (sample.decision.signal === 'bullish' && gap > smaGapMax)
      blockers.push('move overextended (bullish)');
  }

  return { passed: blockers.length === 0, blockers };
}

// ─── Uitkomst-helpers ─────────────────────────────────────────────────────────

function outcomeLabel(sample) {
  const r = sample.outcome?.result ?? sample.outcome;
  if (!r || r === 'open') return '⏳ open';
  if (r === 'tp') return '✅ TP';
  if (r === 'sl') return '❌ SL';
  if (r === 'geen') return '➖ geen';
  if (r === 'neutraal') return '💤 neutraal';
  return `? ${r}`;
}

function winRateSummary(samples) {
  const tp = samples.filter(s => (s.outcome?.result ?? s.outcome) === 'tp').length;
  const sl = samples.filter(s => (s.outcome?.result ?? s.outcome) === 'sl').length;
  const total = tp + sl;
  if (total === 0) return `(geen afgeronde trades, n=${samples.length})`;
  return `WR ${Math.round(tp / total * 100)}% (${tp}TP / ${sl}SL van ${total} afgerond, n=${samples.length})`;
}

// ─── Hoofdlogica ──────────────────────────────────────────────────────────────

async function main() {
  // Laad alle beschikbare data met discussion-velden
  const liveRaw = JSON.parse(await readFile('./data/live/signals.json', 'utf-8').catch(() => '[]'));
  const legacyRaw = JSON.parse(await readFile('./data/signals.json', 'utf-8').catch(() => '[]'));
  const btRaw = JSON.parse(await readFile('./data/backtests.json', 'utf-8').catch(() => '[]'));
  const btSamples = btRaw.flatMap(r => r.samples ?? []).map(s => ({
    ...s,
    decision: s.decision,
    entryPrice: s.entryPrice ?? null,
    dailyTrend: s.dailyTrend ?? null,
    weeklyTrend: s.weeklyTrend ?? null,
    atr14: s.atr14 ?? null,
    sma20H1: s.sma20H1 ?? null,
  }));

  // Combineer alles — alleen directionale signalen met discussion
  const all = [
    ...liveRaw.map(s => ({ ...s, _src: 'live' })),
    ...legacyRaw.map(s => ({ ...s, _src: 'legacy' })),
    ...btSamples.map(s => ({ ...s, _src: 'backtest' })),
  ].filter(s => s.discussion && s.decision?.signal !== 'neutral');

  console.log(`\n═══════════════════════════════════════════════════════`);
  console.log(` FILTER-VERGELIJKING: oud (pre-Fase 76) vs nieuw (Fase 76-79)`);
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(` Signalen geanalyseerd: ${all.length} (live: ${liveRaw.filter(s=>s.discussion).length}, legacy: ${legacyRaw.filter(s=>s.discussion).length}, backtest: ${btSamples.filter(s=>s.discussion).length})`);
  console.log(` Datum range: ${all[0]?.timestamp ?? all[0]?.sampleTime ?? '?'} → ${all[all.length-1]?.timestamp ?? all[all.length-1]?.sampleTime ?? '?'}`);
  console.log('');

  // Categoriseer elke signaal
  const geblokkeerd_naar_door = [];   // was geblokkeerd, nu doorgelaten
  const door_naar_geblokkeerd = [];   // was doorgelaten, nu geblokkeerd
  const altijd_geblokkeerd = [];      // beide versies blokkeren
  const altijd_door = [];             // beide versies laten door

  for (const s of all) {
    const oud = assessOld(s);
    const nieuw = assessNew(s);
    s._oud = oud;
    s._nieuw = nieuw;

    if (!oud.passed && nieuw.passed)       geblokkeerd_naar_door.push(s);
    else if (oud.passed && !nieuw.passed)  door_naar_geblokkeerd.push(s);
    else if (!oud.passed && !nieuw.passed) altijd_geblokkeerd.push(s);
    else                                    altijd_door.push(s);
  }

  // ── Samenvatting ──
  console.log(`SAMENVATTING`);
  console.log(`─────────────────────────────────────────────────────`);
  console.log(` Oud doorgelaten:   ${altijd_door.length + door_naar_geblokkeerd.length} signalen`);
  console.log(` Nieuw doorgelaten: ${altijd_door.length + geblokkeerd_naar_door.length} signalen`);
  console.log('');
  console.log(` 🟢 Geblokkeerd → doorgelaten (voordeel nieuwe filters): ${geblokkeerd_naar_door.length}`);
  console.log(` 🔴 Doorgelaten → geblokkeerd (strengere nieuwe filter):  ${door_naar_geblokkeerd.length}`);
  console.log(` ⚪ Altijd doorgelaten (geen verandering):                 ${altijd_door.length}`);
  console.log(` ⚫ Altijd geblokkeerd (geen verandering):                 ${altijd_geblokkeerd.length}`);

  // ── Geblokkeerd → Doorgelaten (meest relevant: waren deze goed?) ──
  if (geblokkeerd_naar_door.length > 0) {
    console.log(`\n🟢 GEBLOKKEERD → DOORGELATEN (nieuwe filters zijn minder streng)`);
    console.log(`─────────────────────────────────────────────────────`);
    console.log(` ${winRateSummary(geblokkeerd_naar_door)}`);
    console.log(` (Was dit terecht geblokkeerd? Hoge WR hier = goede versoepeling)`);
    console.log('');

    // Groepeer op welke filter de verandering veroorzaakte
    const oorzaken = new Map();
    for (const s of geblokkeerd_naar_door) {
      // Welke blockers had het oud maar niet nieuw?
      const weggevallen = s._oud.blockers.filter(b => !s._nieuw.blockers.includes(b));
      for (const b of weggevallen) {
        const key = b.startsWith('analist verloor') ? 'Filter 3: rebuttal delta ≤-15 (nu -25)' :
                    b.includes('setup-kwaliteit') ? 'Setup-score drempel (was <3, nu <2)' : b;
        oorzaken.set(key, (oorzaken.get(key) ?? []).concat(s));
      }
    }
    for (const [oorzaak, signalen] of [...oorzaken.entries()].sort((a,b) => b[1].length - a[1].length)) {
      console.log(` • ${oorzaak}: ${signalen.length}× — ${winRateSummary(signalen)}`);
    }

    console.log('\n Top-10 signalen die nu doorgelaten worden:');
    for (const s of geblokkeerd_naar_door.slice(0, 10)) {
      const datum = (s.timestamp ?? s.sampleTime ?? '?').slice(0, 16);
      const score = s.discussion?.analyst?.setupQualityScore ?? '?';
      const delta = getRebuttalDelta(s);
      console.log(`  ${datum} | ${s.decision.signal.toUpperCase()} ${s.decision.confidence}% | score ${score} | delta ${delta > 0 ? '+' : ''}${delta} | ${outcomeLabel(s)} | was geblokkeerd: ${s._oud.blockers.slice(0,2).join('; ')}`);
    }
  }

  // ── Doorgelaten → Geblokkeerd ──
  if (door_naar_geblokkeerd.length > 0) {
    console.log(`\n🔴 DOORGELATEN → GEBLOKKEERD (nieuwe filters zijn strenger)`);
    console.log(`─────────────────────────────────────────────────────`);
    console.log(` ${winRateSummary(door_naar_geblokkeerd)}`);
    console.log(` (Lage WR hier = goede aanscherping; hoge WR = te streng)`);
    console.log('');

    const oorzaken = new Map();
    for (const s of door_naar_geblokkeerd) {
      const nieuwBlockers = s._nieuw.blockers.filter(b => !s._oud.blockers.includes(b));
      for (const b of nieuwBlockers) {
        const key = b.includes('AMD') ? 'AMD-filter (manipulation/onduidelijk)' :
                    b.includes('<1.5') ? 'R:R ondergrens <1.5 (nieuw)' : b;
        oorzaken.set(key, (oorzaken.get(key) ?? []).concat(s));
      }
    }
    for (const [oorzaak, signalen] of [...oorzaken.entries()].sort((a,b) => b[1].length - a[1].length)) {
      console.log(` • ${oorzaak}: ${signalen.length}× — ${winRateSummary(signalen)}`);
    }

    console.log('\n Top-10 signalen die nu geblokkeerd worden:');
    for (const s of door_naar_geblokkeerd.slice(0, 10)) {
      const datum = (s.timestamp ?? s.sampleTime ?? '?').slice(0, 16);
      const score = s.discussion?.analyst?.setupQualityScore ?? '?';
      const amd = s.discussion?.analyst?.amdPhase ?? '?';
      console.log(`  ${datum} | ${s.decision.signal.toUpperCase()} ${s.decision.confidence}% | score ${score} | AMD: ${amd} | ${outcomeLabel(s)} | nieuw geblokkeerd: ${s._nieuw.blockers.filter(b => !s._oud.blockers.includes(b)).slice(0,2).join('; ')}`);
    }
  }

  // ── Altijd doorgelaten: winrate als referentie ──
  if (altijd_door.length > 0) {
    console.log(`\n⚪ REFERENTIE: altijd doorgelaten (geen filterwijziging)`);
    console.log(`─────────────────────────────────────────────────────`);
    console.log(` ${winRateSummary(altijd_door)}`);
  }

  // ── Nettoeffect op winrate ──
  const oudDoorgelaten = [...altijd_door, ...door_naar_geblokkeerd];
  const nieuwDoorgelaten = [...altijd_door, ...geblokkeerd_naar_door];
  console.log(`\nNETTO-EFFECT OP WINRATE (afgeronde trades)`);
  console.log(`─────────────────────────────────────────────────────`);
  console.log(` Oud systeem (doorgelaten): ${winRateSummary(oudDoorgelaten)}`);
  console.log(` Nieuw systeem (doorgelaten): ${winRateSummary(nieuwDoorgelaten)}`);

  // ── Per filter: hoeveel blokkeerde het oud vs nieuw ──
  console.log(`\nBLOKKER-FREQUENTIE (hoeveel signalen blokkeerde elke filter?)`);
  console.log(`─────────────────────────────────────────────────────`);
  const directional = all.filter(s => s.decision?.signal !== 'neutral');
  const oudBlockerMap = new Map();
  const nieuwBlockerMap = new Map();
  for (const s of directional) {
    for (const b of s._oud.blockers) {
      const key = b.startsWith('analist verloor') ? 'rebuttal delta ≤-15' :
                  b.includes('setup-kwaliteit') ? 'setup-score <3' :
                  b.includes('CEO-zekerheid') ? 'CEO-zekerheid <52%' :
                  b.includes('macro contraireert') ? 'macro contrarian' :
                  b.includes('pre-mortem') ? 'DA >70%' :
                  b.includes('counter-trend') ? 'counter-trend D1+W1' :
                  b.includes('ATR te laag') ? 'ATR <$13' :
                  b.includes('overextended') ? 'overextended SMA' :
                  b.includes('R:R te ambitieus') ? 'R:R >5.0' : b.slice(0, 40);
      oudBlockerMap.set(key, (oudBlockerMap.get(key) ?? 0) + 1);
    }
    for (const b of s._nieuw.blockers) {
      const key = b.startsWith('analist verloor') ? 'rebuttal delta ≤-25' :
                  b.includes('setup-kwaliteit') ? 'setup-score <2' :
                  b.includes('CEO-zekerheid') ? 'CEO-zekerheid <52%' :
                  b.includes('macro contraireert') ? 'macro contrarian' :
                  b.includes('pre-mortem') ? 'DA >70%' :
                  b.includes('counter-trend') ? 'counter-trend D1+W1' :
                  b.includes('ATR te laag') ? 'ATR <$13' :
                  b.includes('overextended') ? 'overextended SMA' :
                  b.includes('R:R te ambitieus') ? 'R:R >5.0' :
                  b.includes('<1.5') ? 'R:R <1.5 (nieuw)' :
                  b.includes('AMD') ? 'AMD-filter (nieuw)' : b.slice(0, 40);
      nieuwBlockerMap.set(key, (nieuwBlockerMap.get(key) ?? 0) + 1);
    }
  }

  const alleKeys = new Set([...oudBlockerMap.keys(), ...nieuwBlockerMap.keys()]);
  const n = directional.length;
  console.log(` (n=${n} directionale signalen)\n`);
  for (const key of [...alleKeys].sort((a,b) => (nieuwBlockerMap.get(b)??0) - (nieuwBlockerMap.get(a)??0))) {
    const oud = oudBlockerMap.get(key) ?? 0;
    const nieuw = nieuwBlockerMap.get(key) ?? 0;
    const diff = nieuw - oud;
    const arrow = diff > 0 ? `↑+${diff}` : diff < 0 ? `↓${diff}` : '=';
    console.log(`  ${key.padEnd(35)} oud: ${String(oud).padStart(3)}×  nieuw: ${String(nieuw).padStart(3)}×  ${arrow}`);
  }

  console.log('\n═══════════════════════════════════════════════════════\n');
}

main().catch(err => { console.error(err); process.exit(1); });
