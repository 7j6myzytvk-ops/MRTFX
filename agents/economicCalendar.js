/**
 * Live Forex Factory-koppeling via de community JSON-feed.
 * Filtert op USD High-impact events — dit zijn de events die XAU/USD bewegen.
 * Cache: 15 minuten (de feed updatet niet sneller dan dit).
 *
 * Vervangen de voormalige statische UPCOMING_EVENTS-lijst.
 */
import axios from 'axios';

const FF_FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const CACHE_TTL_MS = 15 * 60 * 1000;

let _cache = null; // { data, fetchedAt }

/**
 * Zet een ET-tijdstring ("8:30am", "3:45pm") + datumstring ("2026-07-01")
 * om naar een UTC ISO-string. Gebruikt DST-benadering: maart-november = EDT (UTC-4),
 * rest = EST (UTC-5).
 */
export function etToUtc(dateStr, timeStr) {
  if (!timeStr || !dateStr) return null;
  const clean = timeStr.trim().toLowerCase();
  if (clean === 'all day' || clean === 'tentative' || clean === '') return null;

  const match = clean.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3];

  if (period === 'pm' && hours !== 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;

  // DST-benadering: maand 2 (maart) t/m maand 10 (november) = EDT = UTC-4
  const month = new Date(dateStr + 'T00:00:00Z').getUTCMonth();
  const offsetHours = month >= 2 && month <= 10 ? 4 : 5;
  const utcHours = hours + offsetHours;

  // Kan over middernacht gaan (bv. 11pm ET + 4 = 03:00 UTC volgende dag)
  const base = new Date(`${dateStr}T00:00:00Z`);
  base.setUTCHours(utcHours, minutes, 0, 0);
  return base.toISOString();
}

/**
 * Haalt High-impact USD-events op van Forex Factory.
 * Bij netwerk-/parse-fout: stille fallback naar vorige cache (of lege array).
 */
export async function fetchForexFactoryEvents() {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) return _cache.data;

  try {
    const { data } = await axios.get(FF_FEED_URL, { timeout: 8000 });
    const events = data
      .filter((e) => e.country === 'USD' && e.impact === 'High')
      .map((e) => ({
        title: e.title,
        utcTime: etToUtc(e.date, e.time),
        impact: e.impact,
        forecast: e.forecast?.trim() || null,
        previous: e.previous?.trim() || null,
        actual: e.actual?.trim() || null,
        hasActual: !!(e.actual && e.actual.trim()),
      }));

    _cache = { data: events, fetchedAt: Date.now() };
    return events;
  } catch (err) {
    console.error('[economicCalendar] Forex Factory fetch mislukt:', err.message);
    return _cache?.data ?? [];
  }
}

/** Events die nog niet zijn vrijgegeven, binnen de komende N uur. */
export function getUpcomingEvents(events, windowHours = 48, now = new Date()) {
  const nowStr = now.toISOString();
  const horizon = new Date(now.getTime() + windowHours * 3_600_000).toISOString();
  return events.filter(
    (e) => e.utcTime && e.utcTime >= nowStr && e.utcTime <= horizon && !e.hasActual,
  );
}

/** Events die in de afgelopen N minuten zijn vrijgegeven (actual beschikbaar). */
export function getRecentlyReleasedEvents(events, lookbackMinutes = 60, now = new Date()) {
  const cutoff = new Date(now.getTime() - lookbackMinutes * 60_000).toISOString();
  return events.filter(
    (e) => e.utcTime && e.utcTime >= cutoff && e.utcTime <= now.toISOString() && e.hasActual,
  );
}

/**
 * Formatteert recent vrijgegeven én aankomende events als context-noot voor agents.
 * Recent vrijgegeven events krijgen een "beter/slechter/conform verwachting"-label
 * zodat agents direct de marktimpact kunnen inschatten.
 */
export function formatEventsNote(upcoming, recent) {
  const lines = [];

  if (recent.length > 0) {
    lines.push('\n\nHigh-impact events (zojuist vrijgegeven, Forex Factory):');
    for (const e of recent) {
      let comparison = '';
      if (e.forecast !== null && e.actual !== null) {
        const act = parseFloat(e.actual);
        const fct = parseFloat(e.forecast);
        if (!isNaN(act) && !isNaN(fct)) {
          const label = act > fct ? 'beter dan verwacht' : act < fct ? 'slechter dan verwacht' : 'conform verwachting';
          comparison = ` → Uitkomst: ${e.actual} (Verwacht: ${e.forecast}, ${label})`;
        } else {
          comparison = ` → Uitkomst: ${e.actual} (Verwacht: ${e.forecast})`;
        }
      } else if (e.actual) {
        comparison = ` → Uitkomst: ${e.actual}`;
      }
      lines.push(`- ${e.utcTime?.slice(11, 16)} UTC: ${e.title}${comparison}`);
    }
  }

  if (upcoming.length > 0) {
    lines.push('\n\nAankomende High-impact events (komende 48u, Forex Factory):');
    for (const e of upcoming) {
      const forecastNote = e.forecast ? ` | Verwacht: ${e.forecast}` : '';
      const prevNote = e.previous ? ` | Vorige: ${e.previous}` : '';
      lines.push(`- ${e.utcTime?.slice(0, 16).replace('T', ' ')} UTC: ${e.title}${forecastNote}${prevNote}`);
    }
  }

  return lines.join('\n');
}
