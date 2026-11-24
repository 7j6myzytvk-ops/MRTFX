import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { makeClient } from '../agents/anthropicClient.js';
import { config } from '../config/index.js';
import { getAllSignals } from '../data/store.js';
import { getBlockedSignals } from './blockedSignalLog.js';

const LESSONS_FILE = path.join(process.cwd(), 'data', 'live', 'lessons.json');
const MIN_SUBGROUP_SIZE = 15;

async function readLessons() {
  try {
    const raw = await readFile(LESSONS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { lastUpdated: null, hypotheses: [] };
  }
}

async function writeLessons(data) {
  await mkdir(path.dirname(LESSONS_FILE), { recursive: true });
  data.lastUpdated = new Date().toISOString();
  await writeFile(LESSONS_FILE, JSON.stringify(data, null, 2));
}

// Uniforme record-shape voor alle signalen (doorgelaten én geblokkeerd).
function normalizeRecords(signals, blocked) {
  const resolved = signals.filter(
    (s) => s.outcome && ['tp', 'sl', 'geen'].includes(s.outcome.result) && s.decision?.signal !== 'neutral',
  ).map((s) => ({
    signal:       s.decision.signal,
    result:       s.outcome.result,
    setupScore:   s.discussion?.analyst?.setupQualityScore ?? null,
    trendMode:    s.trendMode ?? false,
    passed:       s.qualityResult?.passed !== false,
    macroSentiment: s.discussion?.macro?.sentiment ?? null,
    ceoConf:      s.decision.confidence,
    daConviction: s.discussion?.devilsAdvocate?.counterConfidence ?? null,
    rMultiple:    s.outcome?.rMultiple ?? null,
    mfe:          s.outcome?.mfe ?? null,
    mae:          s.outcome?.mae ?? null,
    timestamp:    s.timestamp,
  }));

  const resolvedBlocked = blocked.filter(
    (b) => b.outcome && ['tp', 'sl', 'geen'].includes(b.outcome.result) && b.signal && b.signal !== 'neutral',
  ).map((b) => ({
    signal:       b.signal,
    result:       b.outcome.result,
    setupScore:   b.setupScore ?? null,
    trendMode:    b.trendMode ?? false,
    passed:       false,
    macroSentiment: null,
    ceoConf:      b.confidence ?? null,
    daConviction: null,
    rMultiple:    b.outcome?.rMultiple ?? null,
    mfe:          b.outcome?.mfe ?? null,
    mae:          b.outcome?.mae ?? null,
    timestamp:    b.timestamp,
  }));

  return [...resolved, ...resolvedBlocked];
}

// Telt het werkelijke aantal records dat voldoet aan een machine-leesbare conditie.
// Ondersteunde velden: signal, trendMode, setupScore, passed, result, macroSentiment.
// 'directional' als signal-waarde matcht alle non-neutral richtingen.
export function countMatchingRecords(records, conditionObj) {
  if (!conditionObj || typeof conditionObj !== 'object') return 0;
  return records.filter((r) => {
    if (conditionObj.signal !== undefined) {
      if (conditionObj.signal === 'directional') {
        if (r.signal === 'neutral') return false;
      } else if (r.signal !== conditionObj.signal) return false;
    }
    if (conditionObj.trendMode !== undefined && r.trendMode !== conditionObj.trendMode) return false;
    if (conditionObj.setupScore !== undefined && r.setupScore !== conditionObj.setupScore) return false;
    if (conditionObj.passed !== undefined && r.passed !== conditionObj.passed) return false;
    if (conditionObj.result !== undefined && r.result !== conditionObj.result) return false;
    if (conditionObj.macroSentiment !== undefined && r.macroSentiment !== conditionObj.macroSentiment) return false;
    return true;
  }).length;
}

function formatSignalsForPrompt(records) {
  return records.map((r) => {
    const rMult = r.rMultiple != null ? `${r.rMultiple}R` : '-';
    const mfe   = r.mfe != null ? `MFE ${r.mfe}R` : '';
    const mae   = r.mae != null ? `MAE ${r.mae}R` : '';
    const passedLabel = r.passed ? '' : ' [GEBLOKKEERD]';
    return (
      `${(r.timestamp ?? '').slice(0, 10)} | ${r.signal?.toUpperCase().padEnd(7)} | ` +
      `${r.result?.padEnd(4)} | score ${r.setupScore ?? '?'} | ` +
      `${r.trendMode ? 'TREND' : 'REVERSAL'} | CEO ${r.ceoConf ?? '?'}% | ` +
      `macro ${r.macroSentiment ?? '-'} | DA ${r.daConviction ?? '-'}% | ` +
      `${rMult} ${mfe} ${mae}${passedLabel}`
    );
  }).sort().join('\n');
}

function buildLessonPrompt(signalRows, existingHypotheses) {
  const existing = existingHypotheses.length > 0
    ? `\n\nBESTAANDE HYPOTHESES (schrijf GEEN duplicaten):\n` +
      existingHypotheses.map((h, i) => `${i + 1}. ${h.text} [status: ${h.status}]`).join('\n')
    : '';

  return (
    `Je bent een kwantitatief analist die de leerloop sluit van een geautomatiseerd ` +
    `XAU/USD-handelssysteem. Je taak: identificeer patroonmatige afwijkingen in de ` +
    `signaaldata die de winrate structureel kunnen verklaren of verbeteren.\n\n` +

    `SIGNAALDATA (doorgelaten + geblokkeerde signalen met uitkomst):\n` +
    `Kolommen: datum | richting | uitkomst | setupscore | mode | CEO-zekerheid | macro | DA-overtuiging | rMultiple MFE MAE\n\n` +
    signalRows +
    existing +

    `\n\nSYSTEEMREGELS:\n` +
    `• Parameter-freeze actief — geen drempelwijzigingen zonder ≥100 doorgelaten signalen\n` +
    `• Hypotheses worden gevalideerd via boardroomBacktest op een andere periode dan de trainingsdata\n\n` +

    `TAAK: schrijf maximaal 3 nieuwe, concrete hypotheses die NIET in de bestaande lijst staan.\n\n` +

    `Vereisten per hypothese:\n` +
    `1. text: één duidelijke bewering\n` +
    `2. condition: mensleesbare omschrijving van de subgroep\n` +
    `3. conditionObj: machine-leesbare versie met ALLEEN de velden die relevant zijn:\n` +
    `   Beschikbare velden:\n` +
    `   - signal: "bullish" | "bearish" | "directional" (alles non-neutral)\n` +
    `   - trendMode: true | false\n` +
    `   - setupScore: getal (exacte match)\n` +
    `   - passed: true (doorgelaten) | false (geblokkeerd)\n` +
    `   - result: "tp" | "sl" | "geen"\n` +
    `   - macroSentiment: "risk-on" | "risk-off" | "neutraal"\n` +
    `4. sampleSize: het EXACT aantal rijen in de dataset dat aan conditionObj voldoet\n` +
    `   Schrijf de hypothese NIET als sampleSize < ${MIN_SUBGROUP_SIZE}.\n` +
    `5. observedWinRate: de geobserveerde WR (tp/sl, exclusief 'geen') in deze subgroep\n` +
    `6. reasoning: 2-3 zinnen met mechanistische verklaring (niet alleen correlatie)\n\n` +

    `Geef je antwoord als JSON-array:\n` +
    `[\n` +
    `  {\n` +
    `    "text": "...",\n` +
    `    "condition": "signal=bearish AND trendMode=true AND setupScore=3",\n` +
    `    "conditionObj": {"signal": "bearish", "trendMode": true, "setupScore": 3},\n` +
    `    "sampleSize": 42,\n` +
    `    "observedWinRate": 0.63,\n` +
    `    "reasoning": "..."\n` +
    `  }\n` +
    `]\n\n` +
    `Als er geen nieuwe hypotheses zijn met voldoende sample-grootte: retourneer [].`
  );
}

export async function runLessonAgent() {
  console.log('[lessonAgent] Starten...');

  const [signals, blocked] = await Promise.all([getAllSignals(), getBlockedSignals()]);
  const records = normalizeRecords(signals, blocked);

  if (records.length < MIN_SUBGROUP_SIZE) {
    console.log(`[lessonAgent] Te weinig opgeloste signalen (${records.length} < ${MIN_SUBGROUP_SIZE}) — overgeslagen.`);
    return null;
  }

  const db = await readLessons();
  const signalRows = formatSignalsForPrompt(records);
  const prompt = buildLessonPrompt(signalRows, db.hypotheses);

  const client = makeClient();
  const message = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content.find((b) => b.type === 'text')?.text ?? '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.log('[lessonAgent] Geen JSON gevonden in antwoord — overgeslagen.');
    return null;
  }

  let newHypotheses;
  try {
    newHypotheses = JSON.parse(jsonMatch[0]);
  } catch {
    console.log('[lessonAgent] JSON-parse mislukt — overgeslagen.');
    return null;
  }

  if (!Array.isArray(newHypotheses) || newHypotheses.length === 0) {
    console.log('[lessonAgent] Geen nieuwe hypotheses gegenereerd.');
    return null;
  }

  const now = new Date().toISOString();
  const added = [];

  for (const h of newHypotheses.slice(0, 3)) {
    if (!h.text) continue;

    // Verifieer sampleSize zelf tegen de werkelijke data — vertrouw niet blind op Claude's telling.
    const verified = h.conditionObj ? countMatchingRecords(records, h.conditionObj) : 0;
    if (verified < MIN_SUBGROUP_SIZE) {
      console.log(
        `[lessonAgent] Hypothese verworpen: geverifieerde sample ${verified} < ${MIN_SUBGROUP_SIZE} ` +
        `(Claude claimde ${h.sampleSize ?? '?'}): "${h.text}"`,
      );
      continue;
    }

    // Herbereken WR op basis van geverifieerde records.
    const matchingRecords = records.filter((r) => {
      if (!h.conditionObj) return false;
      return countMatchingRecords([r], h.conditionObj) > 0;
    });
    const tpCount = matchingRecords.filter((r) => r.result === 'tp').length;
    const slCount = matchingRecords.filter((r) => r.result === 'sl').length;
    const verifiedWR = (tpCount + slCount) > 0 ? Math.round((tpCount / (tpCount + slCount)) * 1000) / 1000 : null;

    const hypothesis = {
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: now,
      text: h.text,
      condition: h.condition ?? '',
      conditionObj: h.conditionObj ?? null,
      sampleSize: verified,          // onze telling, niet Claude's
      observedWinRate: verifiedWR,   // onze berekening
      reasoning: h.reasoning ?? '',
      status: 'open',
      backtestResult: null,
      acceptedAt: null,
    };

    db.hypotheses.push(hypothesis);
    added.push(hypothesis);
    console.log(
      `[lessonAgent] Hypothese toegevoegd: ${hypothesis.id} | n=${verified} | WR=${verifiedWR ?? '-'} — "${hypothesis.text}"`,
    );
  }

  if (added.length > 0) {
    await writeLessons(db);
    console.log(`[lessonAgent] ${added.length} nieuwe hypothese(s) opgeslagen in data/live/lessons.json`);
  }

  return added;
}

export async function getLessons() {
  return readLessons();
}
