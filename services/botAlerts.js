import { config } from '../config/index.js';

// Maximaal 1 alert per uur per uniek fouttype — voorkomt spam bij herhaalde fouten
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const alertCooldowns = new Map(); // key → timestamp van laatste verzending

async function sendToChannel(client, channelId, message) {
  if (!client || !channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    await channel.send(message);
  } catch (err) {
    console.error('[botAlerts] Kon bericht niet naar Discord sturen:', err.message);
  }
}

export async function sendSystemAlert(client, message) {
  await sendToChannel(client, config.boardroom.ceoChannelId, message);
}

// Stuurt alert maximaal 1x per uur voor hetzelfde key — voorkomt spam bij poll-fouten
export async function sendDedupedAlert(client, key, message) {
  const now = Date.now();
  if (now - (alertCooldowns.get(key) ?? 0) < ALERT_COOLDOWN_MS) return;
  alertCooldowns.set(key, now);
  await sendSystemAlert(client, message);
}

export function formatErrorAlert(err) {
  const msg = err.message ?? String(err);
  if (msg.toLowerCase().includes('credit')) {
    return (
      `⛔ **KREDIET LIMIET BEREIKT**\n` +
      `Twelve Data-credits zijn op voor vandaag. De bot stopt met monitoren tot 00:00 UTC.\n` +
      `> ${msg}`
    );
  }
  if (msg.toLowerCase().includes('rate') || msg.toLowerCase().includes('429')) {
    return `⚠️ **Rate limit** — te veel Twelve Data-requests per minuut.\n> ${msg}`;
  }
  return `⚠️ **Fout in setup-detector**\n> ${msg}`;
}

export function formatHeartbeat(lastSignalTime) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const lastSetup = lastSignalTime
    ? `⏱️ Laatste setup: ${new Date(lastSignalTime).toISOString().replace('T', ' ').slice(0, 16)} UTC`
    : `⏱️ Laatste setup: nog geen setup gevonden`;
  return (
    `🟢 **Setup-detector — sessiestart ${dateStr}**\n` +
    `${lastSetup}\n` +
    `Monitoring actief: 08:00–17:00 UTC | Interval: 5 min`
  );
}

export async function sendHeartbeat(client, lastSignalTime) {
  await sendSystemAlert(client, formatHeartbeat(lastSignalTime));
}

export async function sendStartupAlert(client) {
  const time = new Date().toISOString().replace('T', ' ').slice(0, 16);
  await sendSystemAlert(client, `🔄 **Bot herstart** — ${time} UTC\nSetup-detector actief, monitoring 08:00–17:00 UTC.`);
}
