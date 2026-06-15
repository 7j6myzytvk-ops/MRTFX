const UPCOMING_EVENTS = [
  { time: '2026-06-17T12:30:00Z', name: 'Retail Sales m/m & Core Retail Sales m/m (USD)' },
  { time: '2026-06-17T18:00:00Z', name: 'Federal Funds Rate, FOMC Statement & FOMC Economic Projections (USD)' },
  { time: '2026-06-17T18:30:00Z', name: 'FOMC Press Conference (USD)' },
];

export function upcomingEvents(referenceTime, hours = 48) {
  const now = new Date(referenceTime);
  const horizon = new Date(now.getTime() + hours * 60 * 60 * 1000);

  return UPCOMING_EVENTS.filter((event) => {
    const eventTime = new Date(event.time);
    return eventTime >= now && eventTime <= horizon;
  });
}
