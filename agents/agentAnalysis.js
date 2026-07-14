import { summarize } from './outcomeEvaluator.js';

// Stond de Devil's Advocate uiteindelijk "aan dezelfde kant" als het CEO-besluit
// (zeldzaam - de DA wordt expliciet gevraagd het besluit uit te dagen)?
export function classifyDevilsAdvocate(sample) {
  const { counterSignal } = sample.discussion.devilsAdvocate;
  return counterSignal === sample.decision.signal ? 'eens' : 'oneens';
}

// Komt de marktcontext (risk-on/risk-off) overeen met de richting van het besluit?
export function classifyMacroAlignment(sample) {
  const { sentiment } = sample.discussion.macro;
  const { signal } = sample.decision;
  if (sentiment === 'neutraal' || signal === 'neutral') return 'neutraal';
  const aligned =
    (sentiment === 'risk-on' && signal === 'bullish') || (sentiment === 'risk-off' && signal === 'bearish');
  return aligned ? 'aligned' : 'contrarian';
}

// Ging de zekerheid van de analist omhoog/omlaag/gelijk na het weerwoord op de discussie?
export function classifyRebuttalShift(sample) {
  const { analyst, analystRebuttal } = sample.discussion;
  const delta = analystRebuttal.confidence - analyst.confidence;
  if (delta < 0) return 'omlaag';
  if (delta > 0) return 'omhoog';
  return 'gelijk';
}

// Volgt het CEO-besluit de richting van de eerste analyse, of wijkt het af?
export function classifyCeoAgreement(sample) {
  return sample.decision.signal === sample.discussion.analyst.signal ? 'volgt-analist' : 'wijkt-af';
}

export function classifyConfidenceBucket(sample) {
  const { confidence } = sample.decision;
  if (confidence < 60) return '<60%';
  if (confidence <= 70) return '60-70%';
  return '>70%';
}

// Parseert entry-zone string ("$4066-$4074") naar het midpoint.
// Valt terug op entryPrice (slotkoers) als de zone ontbreekt of niet parseerbaar is.
function parseEntryMidpoint(decision, entryPrice) {
  if (!decision?.entryZone) return entryPrice;
  const clean = decision.entryZone.replace(/\$/g, '').replace(/\s/g, '');
  const match = clean.match(/([\d.]+)[–\-]([\d.]+)/);
  if (!match) return entryPrice;
  const mid = (parseFloat(match[1]) + parseFloat(match[2])) / 2;
  return isNaN(mid) ? entryPrice : mid;
}

export function classifyRiskReward(sample) {
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

// Premium-signaal: analist won vertrouwen na de teamdiscussie (rebuttal shift omhoog)
// EN de setup had hoge kwaliteit (setupQualityScore ≥ 5/6). Backtest toont dat
// deze combinatie samenhangt met de hoogste WR. Score < 5 of shift niet omhoog = geen combo.
export function isComboSignal(sample) {
  return (
    sample.decision?.signal !== 'neutral' &&
    classifyRebuttalShift(sample) === 'omhoog' &&
    (sample.discussion?.analyst?.setupQualityScore ?? 0) >= 5
  );
}

// Kwaliteitsfilter: drie onafhankelijk vastgestelde signalen die sterk
// samenhangen met SL-uitkomsten. Geeft { passed, blockers } terug.
// - passed: true = alle filters groen, signal mag gemeld worden als actie
// - blockers: lijst van redenen bij passed=false (leeg als passed=true)
// Neutrale besluiten altijd doorgelaten (geen positie, niets te filteren).
export function assessSignalQuality(sample) {
  if (!sample.discussion || sample.decision.signal === 'neutral') {
    return { passed: true, blockers: [] };
  }

  const blockers = [];

  // Filter 1: CEO-zekerheid te laag. Drempel verlaagd van 58% naar 52%: backtest (4 signalen
  // met confidence 54–55%) gaf 75% WR — te hoog om te blokkeren. Signalen onder 52% (volle
  // twijfel) worden nog steeds tegengehouden.
  if (sample.decision.confidence < 52) {
    blockers.push('CEO-zekerheid onder 52%');
  }
  if (classifyMacroAlignment(sample) === 'contrarian') {
    blockers.push('macro contraireert de richting');
  }
  // Filter 3: significant verlies van overtuiging na de boardroom-discussie.
  // Backtest (11 omlaag-shifts, runs 27-30): deltas waren -1 t/m -6 punten — te klein
  // om onderscheid te maken. Drempel van -15 vangt alleen echte twijfel op (agent
  // trekt actief conclusies in), niet de marginale aanpassingen die het systeem altijd maakt.
  const rebuttalDelta =
    (sample.discussion.analystRebuttal?.confidence ?? 0) - (sample.discussion.analyst?.confidence ?? 0);
  if (rebuttalDelta <= -15) {
    blockers.push(`analist verloor significant vertrouwen na discussie (−${Math.abs(rebuttalDelta)}%)`);
  }
  if (sample.entryPrice != null && classifyRiskReward(sample) === '>5.0') {
    blockers.push('risico/winst-verhouding te ambitieus (>5.0)');
  }
  if ((sample.discussion.devilsAdvocate?.counterConfidence ?? 0) > 70) {
    blockers.push('pre-mortem: duidelijk faalscenario gevonden (>70%)');
  }

  // Setup-kwaliteitsscore: als de analist minder dan 3 van de 6 ICT/SMC-criteria
  // aanwezig vindt, is er geen handelbare setup — altijd blokkeren ongeacht de rest.
  const setupScore = sample.discussion.analyst?.setupQualityScore;
  if (setupScore !== undefined && setupScore !== null && setupScore < 3) {
    blockers.push(`setup-kwaliteit te laag (${setupScore}/6 criteria aanwezig)`);
  }

  // Counter-trend blocker: als D1 én W1 beide dezelfde richting wijzen én het signaal
  // is tegengesteld, is de kans op succes historisch laag — de hogere trend wint vrijwel altijd.
  const { dailyTrend, weeklyTrend } = sample;
  if (
    dailyTrend && weeklyTrend &&
    dailyTrend !== 'neutraal' && weeklyTrend !== 'neutraal' &&
    dailyTrend === weeklyTrend
  ) {
    const isContrarian =
      (sample.decision.signal === 'bullish' && dailyTrend === 'bearish') ||
      (sample.decision.signal === 'bearish' && dailyTrend === 'bullish');
    if (isContrarian) {
      blockers.push(`counter-trend: signaal ${sample.decision.signal} tegen D1+W1 ${dailyTrend} trend`);
    }
  }

  // Filter 8: ATR te laag — markt te kalm voor betrouwbare SL/TP.
  // Backtest (22 jun–10 jul 2026): ATR < $13 correleerde met 4 extra SL-trades.
  // Reden: SL/TP-niveaus worden zo krap dat normaal marktgeluid de SL raakt
  // voordat de koers richting TP beweegt. Geen edge in een slapende markt.
  const ATR_MIN = 13;
  if (sample.atr14 != null && sample.atr14 < ATR_MIN) {
    blockers.push(`ATR te laag ($${sample.atr14.toFixed(1)} < $${ATR_MIN}) — markt te kalm voor betrouwbare uitvoering`);
  }

  // Filter 9: Overextended move — koers te ver verwijderd van H1 SMA20.
  // Drempel: 2.5×ATR14 (dynamisch). Vaste $50 blokkeerde Feb 9 (gap $56, ATR $30 → 1.9×ATR
  // → TP): normale marktbeweging bij hoge volatiliteit, geen reversal-signaal.
  // Fallback naar $50 als ATR ontbreekt (oude backtest-runs vóór Fase 68).
  const smaGapMax = sample.atr14 != null ? sample.atr14 * 2.5 : 50;
  if (sample.sma20H1 != null && sample.entryPrice != null) {
    const gap = sample.entryPrice - sample.sma20H1;
    if (sample.decision.signal === 'bearish' && gap < -smaGapMax) {
      blockers.push(`move overextended: koers $${Math.abs(gap).toFixed(0)} onder H1 SMA20 — reversal-risico`);
    }
    if (sample.decision.signal === 'bullish' && gap > smaGapMax) {
      blockers.push(`move overextended: koers $${gap.toFixed(0)} boven H1 SMA20 — reversal-risico`);
    }
  }

  return { passed: blockers.length === 0, blockers };
}

// Groepeert samples per classificatie-label en berekent per groep de outcome-stats
// via summarize(). Samples zonder discussion-data (oude backtests, vóór Fase 9)
// worden overgeslagen - deze breakdowns hebben de teamdiscussie nodig.
// labelOrder is optioneel: geeft een vaste volgorde (incl. lege groepen) voor
// overzichtelijke rapportage.
export function breakdown(samples, classifyFn, labelOrder) {
  const withDiscussion = samples.filter((s) => s.discussion);
  const groups = new Map();
  for (const s of withDiscussion) {
    const label = classifyFn(s);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(s);
  }
  const labels = labelOrder || [...groups.keys()];
  return labels.map((label) => ({ label, ...summarize(groups.get(label) ?? []) }));
}
