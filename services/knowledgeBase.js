import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_PATH = join(__dirname, '../knowledge/market-regime.json');

function load() {
  try {
    return JSON.parse(readFileSync(KB_PATH, 'utf8'));
  } catch {
    return { lastUpdated: null, processedVideoIds: [], insights: [] };
  }
}

function save(data) {
  data.lastUpdated = new Date().toISOString();
  writeFileSync(KB_PATH, JSON.stringify(data, null, 2));
}

export function isVideoProcessed(videoId) {
  return load().processedVideoIds.includes(videoId);
}

export function markVideoProcessed(videoId) {
  const db = load();
  if (!db.processedVideoIds.includes(videoId)) {
    db.processedVideoIds.push(videoId);
  }
  save(db);
}

export function addInsight({ bron, bronType, inzicht, implicatie, markt = 'XAU/USD', geldigDagen = 30 }) {
  const db = load();
  const nu = new Date();
  const geldigTot = new Date(nu.getTime() + geldigDagen * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  db.insights.push({
    id: `${Date.now()}`,
    datum: nu.toISOString().split('T')[0],
    bronType,
    bron,
    markt,
    inzicht,
    implicatie,
    geldigTot,
  });
  save(db);
}

// Geeft actieve insights terug (niet verlopen), gefilterd op markt.
export function getActiveInsights(markt = 'XAU/USD') {
  const db = load();
  const vandaag = new Date().toISOString().split('T')[0];
  return db.insights.filter(
    (i) => i.geldigTot >= vandaag && (i.markt === markt || i.markt === 'algemeen'),
  );
}

// Formateert actieve insights als injecteerbare context-string voor agents.
export function formatInsightsForPrompt() {
  const insights = getActiveInsights();
  if (insights.length === 0) return '';
  const regels = insights.map(
    (i) => `• [${i.datum} — ${i.bron}] ${i.inzicht} → Implicatie: ${i.implicatie}`,
  );
  return (
    `\n\n📚 MARKTREGIME-KENNISBANK (geëxtraheerd uit externe bronnen):\n` +
    regels.join('\n') +
    `\nWeeg deze inzichten mee als macro-context naast je eigen analyse.`
  );
}
