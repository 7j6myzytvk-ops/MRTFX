import { YoutubeTranscript } from 'youtube-transcript';
import { extractInsights } from '../agents/contentAnalyst.js';
import { isVideoProcessed, markVideoProcessed, addInsight } from './knowledgeBase.js';

const CHANNELS = [
  {
    id: 'UCAmRpu9rH2NzUD2h7U42uqQ',
    naam: 'Trading Wizard (Camille van Merrienboer)',
  },
];

async function fetchRecentVideos(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url);
  const xml = await res.text();

  const videos = [];
  const entries = xml.split('<entry>').slice(1);
  for (const entry of entries) {
    const idMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
    const pubMatch = entry.match(/<published>([^<]+)<\/published>/);
    if (idMatch && titleMatch) {
      videos.push({
        videoId: idMatch[1],
        titel: titleMatch[1],
        gepubliceerd: pubMatch?.[1] ?? '',
      });
    }
  }
  return videos;
}

async function processVideo(video, kanaalNaam) {
  if (isVideoProcessed(video.videoId)) return null;

  let transcript;
  try {
    const segmenten = await YoutubeTranscript.fetchTranscript(video.videoId);
    transcript = segmenten.map((s) => s.text).join(' ');
  } catch {
    markVideoProcessed(video.videoId);
    return null;
  }

  const bron = `${kanaalNaam} — "${video.titel}" (${video.gepubliceerd.split('T')[0]})`;
  const resultaat = await extractInsights({ tekst: transcript, bron, bronType: 'youtube' });

  markVideoProcessed(video.videoId);

  if (!resultaat.relevant || resultaat.inzichten.length === 0) return null;

  for (const i of resultaat.inzichten) {
    addInsight({
      bron,
      bronType: 'youtube',
      inzicht: i.inzicht,
      implicatie: i.implicatie,
      markt: i.markt,
      geldigDagen: i.geldigDagen,
    });
  }

  return { video, inzichten: resultaat.inzichten };
}

// Hoofd-functie: check alle kanalen op nieuwe video's en verwerk ze.
// Geeft lijst van verwerkte video's met hun inzichten terug.
export async function checkYoutubeChannels() {
  const verwerkt = [];

  for (const kanaal of CHANNELS) {
    let videos;
    try {
      videos = await fetchRecentVideos(kanaal.id);
    } catch (e) {
      console.error(`[YouTube] Fout bij ophalen ${kanaal.naam}:`, e.message);
      continue;
    }

    for (const video of videos) {
      const resultaat = await processVideo(video, kanaal.naam);
      if (resultaat) verwerkt.push(resultaat);
    }
  }

  return verwerkt;
}
