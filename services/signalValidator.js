// Structuurvalidatie na elke boardroom-run.
// Controleert schema-integriteit, geldig bereik van alle velden en logische
// consistentie tussen agent-outputs en het algorithmische kwaliteitsfilter.
// Pure functies — geen I/O, volledig unit-testbaar.

export function validateSignalStructure(result) {
  const issues = [];
  const { decision, discussion, qualityResult, entryPrice } = result ?? {};
  const signal = decision?.signal;
  const passed = qualityResult?.passed;

  // --- Schema: decision ---
  if (!['bullish', 'bearish', 'neutral'].includes(signal)) {
    issues.push(`decision.signal ongeldig: "${signal}"`);
  }
  if (typeof decision?.confidence !== 'number' || decision.confidence < 0 || decision.confidence > 100) {
    issues.push(`decision.confidence buiten bereik: ${decision?.confidence}`);
  }
  if (typeof decision?.stopLoss !== 'number' || typeof decision?.takeProfit !== 'number') {
    issues.push('decision.stopLoss of takeProfit ontbreekt of is geen getal');
  }
  if (!['klein', 'normaal', 'groot'].includes(decision?.positionSize)) {
    issues.push(`decision.positionSize ongeldig: "${decision?.positionSize}"`);
  }

  // --- Schema: analyst ---
  if (typeof discussion?.analyst?.confidence !== 'number') {
    issues.push('discussion.analyst.confidence ontbreekt of is geen getal');
  }
  const score = discussion?.analyst?.setupQualityScore;
  if (score !== undefined && score !== null) {
    if (typeof score !== 'number' || score < 0 || score > 5 || !Number.isInteger(score)) {
      issues.push(`setupQualityScore buiten bereik of geen geheel getal: ${score}`);
    }
  } else {
    // Waarschuwing (geen harde fout): veld ontbreekt op oude signalen vóór Fase 36c
    issues.push('setupQualityScore ontbreekt — agent heeft het veld niet gevuld (check analyst-prompt)');
  }

  // --- Schema: macro ---
  if (!['risk-on', 'risk-off', 'neutraal'].includes(discussion?.macro?.sentiment)) {
    issues.push(`macro.sentiment ongeldig: "${discussion?.macro?.sentiment}"`);
  }

  // --- Schema: devilsAdvocate ---
  const daConf = discussion?.devilsAdvocate?.counterConfidence;
  if (typeof daConf !== 'number' || daConf < 0 || daConf > 100) {
    issues.push(`devilsAdvocate.counterConfidence buiten bereik: ${daConf}`);
  }

  // --- Logische consistentie (alleen bij directionele signalen) ---
  if (signal !== 'neutral') {
    // Setup-score < 2 maar toch passed → algorithmische filter gemist (/6 schaal, drempel <3)
    if (typeof score === 'number' && score < 2 && passed === true) {
      issues.push(`INCONSISTENTIE: setupQualityScore ${score}/6 < 2 maar qualityResult.passed=true`);
    }
    // CEO confidence < 52 maar toch passed → filter gemist (drempel: 52, zie agentAnalysis.js)
    if (typeof decision?.confidence === 'number' && decision.confidence < 52 && passed === true) {
      issues.push(`INCONSISTENTIE: decision.confidence ${decision.confidence}<52 maar qualityResult.passed=true`);
    }
    // SL/TP richting vs signaal
    if (typeof entryPrice === 'number' && typeof decision?.stopLoss === 'number') {
      if (signal === 'bullish' && decision.stopLoss >= entryPrice) {
        issues.push(`INCONSISTENTIE: bullish maar SL ${decision.stopLoss} >= entryPrice ${entryPrice}`);
      }
      if (signal === 'bearish' && decision.stopLoss <= entryPrice) {
        issues.push(`INCONSISTENTIE: bearish maar SL ${decision.stopLoss} <= entryPrice ${entryPrice}`);
      }
    }
    // SL/TP onderlinge richting-check
    if (typeof decision?.stopLoss === 'number' && typeof decision?.takeProfit === 'number') {
      if (signal === 'bullish' && decision.takeProfit <= decision.stopLoss) {
        issues.push(`INCONSISTENTIE: bullish maar TP ${decision.takeProfit} <= SL ${decision.stopLoss}`);
      }
      if (signal === 'bearish' && decision.takeProfit >= decision.stopLoss) {
        issues.push(`INCONSISTENTIE: bearish maar TP ${decision.takeProfit} >= SL ${decision.stopLoss}`);
      }
    }
  }

  const warnings = issues.filter(i => i.startsWith('setupQualityScore ontbreekt'));
  const errors = issues.filter(i => !i.startsWith('setupQualityScore ontbreekt'));
  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
  };
}

export function formatHealthReport(validation, context = '') {
  const label = context ? ` (${context})` : '';
  if (validation.valid && validation.warnings.length === 0) {
    return `✅ Structuurcheck geslaagd${label}.`;
  }
  if (validation.valid && validation.warnings.length > 0) {
    return `⚠️ Structuurcheck geslaagd met waarschuwingen${label}:\n` +
      validation.warnings.map(w => `• ${w}`).join('\n');
  }
  return (
    `🚨 Structuurcheck MISLUKT${label}:\n` +
    validation.errors.map(e => `• ${e}`).join('\n') +
    (validation.warnings.length > 0
      ? '\nWaarschuwingen:\n' + validation.warnings.map(w => `• ${w}`).join('\n')
      : '')
  );
}

// Samenvatting van meerdere signalen — voor /health rapport
export function summarizeSignalHealth(signals) {
  if (!signals || signals.length === 0) {
    return {
      n: 0,
      valid: 0,
      invalid: 0,
      issues: [],
      scoreDist: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, ontbreekt: 0 },
    };
  }
  const results = signals.map(s => validateSignalStructure(s));
  const valid = results.filter(r => r.valid).length;
  const allIssues = results.flatMap(r => r.errors);
  const scoreDist = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, ontbreekt: 0 };
  for (const s of signals) {
    const sc = s.discussion?.analyst?.setupQualityScore;
    if (sc === undefined || sc === null) scoreDist.ontbreekt++;
    else scoreDist[Math.min(6, Math.max(0, sc))]++;
  }
  return { n: signals.length, valid, invalid: signals.length - valid, issues: allIssues, scoreDist };
}
