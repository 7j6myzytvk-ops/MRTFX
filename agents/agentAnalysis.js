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
  if (risk === 0) return '<1.0';
  const rr = reward / risk;
  if (rr < 1.0) return '<1.0';
  if (rr <= 3.0) return '1.0-3.0';
  if (rr <= 5.0) return '3.0-5.0';
  return '>5.0';
}

// Premium-signaal: analist won vertrouwen na de teamdiscussie (rebuttal shift omhoog)
// EN de setup had hoge kwaliteit (setupQualityScore ≥ 4/5). Backtest toont dat
// deze combinatie samenhangt met de hoogste WR. Score < 5 of shift niet omhoog = geen combo.
export function isComboSignal(sample) {
  return (
    sample.decision?.signal !== 'neutral' &&
    classifyRebuttalShift(sample) === 'omhoog' &&
    (sample.discussion?.analyst?.setupQualityScore ?? 0) >= 4
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

  // Filter 1: CEO-zekerheid te laag. Drempel verlaagd van 52% naar 50% (Fase 97): CEO-prompt
  // geeft nu minimaal 55% voor directionele signalen. Filter 50% vangt alleen systeem-anomalieën.
  if (sample.decision.confidence < 50) {
    blockers.push('CEO-zekerheid onder 50%');
  }
  // Macro contrarian blocker verwijderd (Fase 97): CEO weegt macro al mee op 20% in zijn
  // beslissingsgewichten. Een aparte mechanische blokkade telt macro dubbel en verhinderde
  // valid signals met CEO-confidence 59-61% die daadwerkelijk TP raakten (jul 23 data).
  // Filter 3: significant verlies van overtuiging na de boardroom-discussie.
  // Drempel verhoogd van -15 naar -25 (Fase 76): in live-omstandigheden triggerde -15 bij
  // 20% van de signalen (4×/20) terwijl backtest slechts 0,3% (1×/310) gaf. Meerdere
  // geblokkeerde signalen haalden TP — de filter was te agressief. Bij -25 blokkeren we
  // alleen extremen (analist trekt meer dan een kwart van zijn zekerheid in).
  const rebuttalDelta =
    (sample.discussion.analystRebuttal?.confidence ?? 0) - (sample.discussion.analyst?.confidence ?? 0);
  if (rebuttalDelta <= -25) {
    blockers.push(`analist verloor significant vertrouwen na discussie (−${Math.abs(rebuttalDelta)}%)`);
  }
  // R:R >5.0 filter verwijderd: CEO stelt soms een precision entry zone in (dicht bij SL)
  // wat een hoge R:R geeft — dat is een geldige setup, geen reden om te blokkeren.
  // R:R ondergrens: bij R:R < 1.0 is de verwachte waarde structureel negatief.
  // Drempel verlaagd van 1.5 naar 1.0: backtest toonde dat setups met R:R 1.0–1.4
  // vaker naar TP gingen dan de 1.5-drempel suggereerde.
  if (sample.entryPrice != null && classifyRiskReward(sample) === '<1.0') {
    blockers.push('risico/winst-verhouding te laag (<1.0) — negatieve verwachte waarde');
  }
  if ((sample.discussion.devilsAdvocate?.counterConfidence ?? 0) > 70) {
    blockers.push('pre-mortem: duidelijk faalscenario gevonden (>70%)');
  }

  // Setup-kwaliteitsscore: als de analist minder dan 3 van de 6 ICT/SMC-criteria
  // aanwezig vindt, is er geen handelbare setup — altijd blokkeren ongeacht de rest.
  // Drempel hersteld naar 3 (Fase 91): ⑥ kill-zone-timing terug als kwaliteitscriterium,
  // schaal is weer /6. Score 0-2 = geen setup, score 3+ = minimaal voldoende.
  const setupScore = sample.discussion.analyst?.setupQualityScore;
  if (setupScore !== undefined && setupScore !== null && setupScore < 3) {
    blockers.push(`setup-kwaliteit te laag (${setupScore}/6 criteria aanwezig)`);
  }

  // AMD-fase filter: alleen 'onduidelijk' blokkeert mechanisch.
  // 'manipulation' (Judas Swing) wordt niet meer mechanisch geblokkeerd — de analist
  // en CEO beoordelen dit al via AMD-fase en setup-criteria. London KZ werkt structureel
  // via manipulatie naar distributie; mechanisch blokkeren snijdt de beste entries weg.
  const amdPhase = sample.discussion?.analyst?.amdPhase;
  if (amdPhase === 'onduidelijk') {
    blockers.push('AMD-fase onduidelijk — geen handelbare marktstructuur');
  }

  // Counter-trend blocker: als H4 én D1 beide dezelfde richting wijzen én het signaal
  // is tegengesteld, blokkeert de filter — de institutionele trend wint bijna altijd.
  // W1 is macro-context voor de CEO, geen mechanische blokkade: als D1 draait maar W1
  // nog niet, mag het systeem wél een bullish/bearish setup doorgeven.
  const { h4Trend, dailyTrend } = sample;
  if (
    h4Trend && dailyTrend &&
    h4Trend !== 'neutraal' && dailyTrend !== 'neutraal' &&
    h4Trend === dailyTrend
  ) {
    const isContrarian =
      (sample.decision.signal === 'bullish' && dailyTrend === 'bearish') ||
      (sample.decision.signal === 'bearish' && dailyTrend === 'bullish');
    if (isContrarian) {
      blockers.push(`counter-trend: signaal ${sample.decision.signal} tegen H4+D1 ${dailyTrend} trend`);
    }
  }

  // Filter 8: ATR te laag — markt te kalm voor betrouwbare SL/TP.
  // Oorspronkelijk $13 op basis van 18-daagse backtest (22 jun–10 jul). Verlaagd naar $10
  // na live-observatie: signalen met ATR $11–12 op 23 jul troffen TP (WR 83% geblokkeerde signalen).
  // $10 filtert echt slapende markten, laat licht-rustiger uren met voldoende beweging door.
  const ATR_MIN = 10;
  if (sample.atr14 != null && sample.atr14 < ATR_MIN) {
    blockers.push(`ATR te laag ($${sample.atr14.toFixed(1)} < $${ATR_MIN}) — markt te kalm voor betrouwbare uitvoering`);
  }

  // Filter 9: Overextended move — koers te ver verwijderd van H1 SMA20.
  // Drempel verhoogd van 2.5 naar 3.0×ATR: live data (23 jul) toonde dat signalen bij
  // 2.7–3.1×ATR nog TP raakten. 2.5×ATR blokkeerde te vroeg in lopende trends.
  // Fallback naar $60 als ATR ontbreekt (oude backtest-runs vóór Fase 68).
  const smaGapMax = sample.atr14 != null ? sample.atr14 * 3.0 : 60;
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
