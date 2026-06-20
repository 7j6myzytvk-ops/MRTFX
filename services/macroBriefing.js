import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'macroBriefing.json');
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dagen

export function isBriefingValid(briefing, now = Date.now()) {
  if (!briefing || !briefing.text || !briefing.expiresAt) return false;
  return new Date(briefing.expiresAt).getTime() > now;
}

export function formatBriefingNote(briefing) {
  if (!isBriefingValid(briefing)) return '';
  const expires = new Date(briefing.expiresAt).toISOString().slice(0, 10);
  return (
    `\n\nMACRO-BRIEFING (ingesteld door het team, geldig t/m ${expires}):\n` +
    `"${briefing.text}"\n` +
    `Gebruik deze context als achtergrondkennis bij je analyse. ` +
    `Het vervangt niet de candle-data — het geeft de bredere marktomgeving aan ` +
    `waarbinnen je signaal zich afspeelt.`
  );
}

export async function getBriefing() {
  try {
    const raw = await readFile(FILE, 'utf-8');
    const briefing = JSON.parse(raw);
    return isBriefingValid(briefing) ? briefing : null;
  } catch {
    return null;
  }
}

export async function setBriefing(text, setBy = 'onbekend') {
  const now = new Date();
  const briefing = {
    text: text.trim(),
    setBy,
    setAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TTL_MS).toISOString(),
  };
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(briefing, null, 2));
  return briefing;
}

export async function clearBriefing() {
  try {
    await writeFile(FILE, JSON.stringify({ text: '', expiresAt: new Date(0).toISOString() }, null, 2));
  } catch {}
}
