const UPCOMING_EVENTS = [
  // Juni 2026
  { time: '2026-06-17T12:30:00Z', name: 'Retail Sales m/m & Core Retail Sales m/m (USD)' },
  { time: '2026-06-17T18:00:00Z', name: 'Federal Funds Rate, FOMC Statement & FOMC Economic Projections (USD)' },
  { time: '2026-06-17T18:30:00Z', name: 'FOMC Press Conference (USD)' },
  // Juli 2026
  { time: '2026-07-03T12:30:00Z', name: 'Non-Farm Payrolls & Unemployment Rate (USD)' },
  { time: '2026-07-10T12:30:00Z', name: 'CPI m/m & Core CPI m/m (USD)' },
  { time: '2026-07-15T12:30:00Z', name: 'Retail Sales m/m (USD)' },
  { time: '2026-07-29T18:00:00Z', name: 'Federal Funds Rate & FOMC Statement (USD)' },
  { time: '2026-07-29T18:30:00Z', name: 'FOMC Press Conference (USD)' },
  // Augustus 2026
  { time: '2026-08-07T12:30:00Z', name: 'Non-Farm Payrolls & Unemployment Rate (USD)' },
  { time: '2026-08-13T12:30:00Z', name: 'CPI m/m & Core CPI m/m (USD)' },
  { time: '2026-08-14T12:30:00Z', name: 'Retail Sales m/m (USD)' },
  { time: '2026-08-22T14:00:00Z', name: 'Jackson Hole Symposium - Fed Chair Speech (USD)' },
];

export function upcomingEvents(referenceTime, hours = 48) {
  const now = new Date(referenceTime);
  const horizon = new Date(now.getTime() + hours * 60 * 60 * 1000);

  return UPCOMING_EVENTS.filter((event) => {
    const eventTime = new Date(event.time);
    return eventTime >= now && eventTime <= horizon;
  });
}
