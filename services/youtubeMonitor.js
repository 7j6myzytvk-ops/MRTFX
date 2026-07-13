import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'data', 'live', 'youtubeState.json');

// Kanalen om te monitoren. Channel ID ophalen via:
// curl -sL "https://www.youtube.com/@handle" | grep -o 'UC[a-zA-Z0-9_-]\{22\}'
const CHANNELS = [
  { id: 'UCAmRpu9rH2NzUD2h7U42uqQ', name: 'Camille Van Merrienboer', handle: '@camillevanmerrienboer' },
];

async function readState() {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function writeState(state) {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

function parseRssFeed(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const videoId = (block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) ?? [])[1];
    const rawTitle = (block.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? '';
    const published = (block.match(/<published>([^<]+)<\/published>/) ?? [])[1];
    const title = rawTitle
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
    if (videoId && title) entries.push({ videoId, title, published });
  }
  return entries;
}

async function fetchFeed(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube RSS ${channelId}: HTTP ${res.status}`);
  return parseRssFeed(await res.text());
}

// Haal recente video's op (laatste 7 dagen) — voor context in dagrapport.
export async function getRecentVideos(days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = [];
  for (const ch of CHANNELS) {
    try {
      const videos = await fetchFeed(ch.id);
      const recent = videos.filter((v) => v.published >= cutoff);
      for (const v of recent) {
        result.push({ channel: ch.name, ...v });
      }
    } catch (err) {
      console.error(`[youtube] ${ch.name}: ${err.message}`);
    }
  }
  return result.sort((a, b) => b.published.localeCompare(a.published));
}

// Controleer op nieuwe video's t.o.v. vorige check. Retourneert nieuwe video's.
export async function checkForNewVideos() {
  const state = await readState();
  const newVideos = [];

  for (const ch of CHANNELS) {
    try {
      const videos = await fetchFeed(ch.id);
      if (videos.length === 0) continue;

      const lastSeenId = state[ch.id]?.lastVideoId;
      const latest = videos[0];

      // Update state altijd, ook als er niets nieuws is
      state[ch.id] = { name: ch.name, lastVideoId: latest.videoId, lastChecked: new Date().toISOString() };

      if (lastSeenId && latest.videoId !== lastSeenId) {
        // Alles nieuwer dan de vorige bekende video
        const newOnes = [];
        for (const v of videos) {
          if (v.videoId === lastSeenId) break;
          newOnes.push({ channel: ch.name, handle: ch.handle, ...v });
        }
        newVideos.push(...newOnes);
      }
    } catch (err) {
      console.error(`[youtube] ${ch.name}: ${err.message}`);
    }
  }

  await writeState(state);
  return newVideos;
}

export function formatNewVideoAlert(video) {
  const date = video.published ? video.published.slice(0, 10) : '?';
  return (
    `**📺 Nieuwe video — ${video.channel}**\n` +
    `"${video.title}"\n` +
    `Gepubliceerd: ${date} | https://www.youtube.com/watch?v=${video.videoId}`
  );
}
