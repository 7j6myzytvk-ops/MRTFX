import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { makeClient } from '../agents/anthropicClient.js';
import { config } from '../config/index.js';
import { getAllSignals } from '../data/store.js';
import { getBlockedSignals } from './blockedSignalLog.js';

const LESSONS_FILE = path.join(process.cwd(), 'data', 'live', 'lessons.json');

// Minimale sample-grootte per subgroep voor een hypothese.
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

function formatSignalsForPrompt(signals, blocked) {
  const resolved = signals.filter(
    (s) => s.outcome && ['tp', 'sl', 'geen'].includes(s.outcome.result) && s.decision?.signal !== 'neutral',
  );
  const resolvedBlocked = blocked.filter(
    (b) => b.outcome && ['tp', 'sl', 'geen'].includes(b.outcome.result) && b.signal && b.signal !== 'neutral',
  );

  const formatRow = (s) => {
    const dir     = s.decision?.signal ?? s.signal;
    const result  = s.outcome?.result;
    const score   = s.discussion?.analyst?.setupQualityScore ?? s.setupScore ?? '?';
    const trend   = s.trendMode ? 'TREND' : 'REVERSAL';
    const conf    = s.decision?.confidence ?? s.confidence ?? '?';
    const rMult   = s.outcome?.rMultiple != null ? `${s.outcome.rMultiple}R` : '-';
    const mfe     = s.outcome?.mfe     != null ? `MFE ${s.outcome.mfe}R`   : '';
    const mae     = s.outcome?.mae     != null ? `MAE ${s.outcome.mae}R`   : '';
    const macro   = s.discussion?.macro?.sentiment ?? '-';
    const da      = s.discussion?.devilsAdvocate?.counterConfidence ?? '-';
    const ts      = (s.timestamp ?? '').slice(0, 10);
    const blocked = s.qualityResult?.passed === false ? ' [GEBLOKKEERD]' : '';
    return `${ts} | ${dir?.toUpperCase().padEnd(7)} | ${result?.padEnd(4)} | score ${score} | ${trend} | CEO ${conf}% | macro ${macro} | DA ${da}% | ${rMult} ${mfe} ${mae}${blocked}`;
  };

  const rows = [
    ...resolved.map(formatRow),
    ...resolvedBlocked.map((b) => formatRow({
      ...b,
      decision: { signal: b.signal, confidence: b.confidence },
      qualityResult: { passed: false },
    })),
  ].sort();

  return rows.join('\n');
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
    `Kolommen: datum | richting | uitkomst (tp/sl/geen) | setupscore | mode | CEO-zekerheid | macro | DA-overtuiging | rMultiple MFE MAE\n\n` +
    signalRows +
    existing +

    `\n\nSYSTEEMREGELS (mag je NIET omzeilen in hypotheses):\n` +
    `• Parameter-freeze actief — geen drempelwijzigingen zonder ≥100 doorgelaten signalen\n` +
    `• MIN_SETUP_SCORE = 3 (harde grens in code)\n` +
    `• Hypotheses worden pas 'accepted' na een boardroomBacktest-run op een andere periode\n\n` +

    `TAAK: schrijf maximaal 3 nieuwe, concrete hypotheses die NIET in de bestaande lijst staan.\n\n` +
    `Vereisten per hypothese:\n` +
    `1. text: één duidelijke bewering (bijv. "Bearish score 3/6 signalen in TREND-modus ` +
    `hebben een significant hogere WR dan in REVERSAL-modus")\n` +
    `2. condition: de subgroep-definitie in meetbare termen (bijv. "signal=bearish AND ` +
    `trendMode=true AND setupScore=3")\n` +
    `3. sampleSize: het EXACT aantal trades in jouw dataset dat aan de condition voldoet. ` +
    `Schrijf de hypothese NIET als sampleSize < ${MIN_SUBGROUP_SIZE}.\n` +
    `4. observedWinRate: de geobserveerde WR (tp/sl, exclusief 'geen') in deze subgroep\n` +
    `5. reasoning: 2-3 zinnen met mechanistische verklaring (niet alleen correlatie)\n\n` +

    `Geef je antwoord als JSON-array:\n` +
    `[\n` +
    `  {\n` +
    `    "text": "...",\n` +
    `    "condition": "...",\n` +
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
  const signalRows = formatSignalsForPrompt(signals, blocked);

  const resolvedCount = signals.filter(
    (s) => s.outcome && ['tp', 'sl', 'geen'].includes(s.outcome.result) && s.decision?.signal !== 'neutral',
  ).length;

  if (resolvedCount < MIN_SUBGROUP_SIZE) {
    console.log(`[lessonAgent] Te weinig opgeloste signalen (${resolvedCount} < ${MIN_SUBGROUP_SIZE}) — overgeslagen.`);
    return null;
  }

  const db = await readLessons();
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
    if (!h.text || h.sampleSize < MIN_SUBGROUP_SIZE) continue;
    const hypothesis = {
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: now,
      text: h.text,
      condition: h.condition ?? '',
      sampleSize: h.sampleSize,
      observedWinRate: h.observedWinRate ?? null,
      reasoning: h.reasoning ?? '',
      status: 'open',
      backtestResult: null,
      acceptedAt: null,
    };
    db.hypotheses.push(hypothesis);
    added.push(hypothesis);
    console.log(`[lessonAgent] Hypothese toegevoegd: ${hypothesis.id} — "${hypothesis.text}"`);
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
