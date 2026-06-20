const UPCOMING_EVENTS = [
  // Juni 2026
  { time: '2026-06-17T12:30:00Z', name: 'Retail Sales m/m & Core Retail Sales m/m (USD)' },
  { time: '2026-06-17T18:00:00Z', name: 'Federal Funds Rate, FOMC Statement & FOMC Economic Projections (USD)' },
  { time: '2026-06-17T18:30:00Z', name: 'FOMC Press Conference (USD)' },
  { time: '2026-06-26T12:30:00Z', name: 'GDP q/q (Final) (USD)' },
  // Juli 2026
  { time: '2026-07-03T12:30:00Z', name: 'Non-Farm Payrolls & Unemployment Rate (USD)' },
  { time: '2026-07-10T12:30:00Z', name: 'CPI m/m & Core CPI m/m (USD)' },
  { time: '2026-07-11T12:30:00Z', name: 'PPI m/m & Core PPI m/m (USD)' },
  { time: '2026-07-15T12:30:00Z', name: 'Retail Sales m/m (USD)' },
  { time: '2026-07-29T18:00:00Z', name: 'Federal Funds Rate & FOMC Statement (USD)' },
  { time: '2026-07-29T18:30:00Z', name: 'FOMC Press Conference (USD)' },
  { time: '2026-07-30T12:30:00Z', name: 'GDP q/q (Advance) (USD)' },
  // Augustus 2026
  { time: '2026-08-07T12:30:00Z', name: 'Non-Farm Payrolls & Unemployment Rate (USD)' },
  { time: '2026-08-13T12:30:00Z', name: 'CPI m/m & Core CPI m/m (USD)' },
  { time: '2026-08-14T12:30:00Z', name: 'PPI m/m & Core PPI m/m (USD)' },
  { time: '2026-08-14T12:30:00Z', name: 'Retail Sales m/m (USD)' },
  { time: '2026-08-22T14:00:00Z', name: 'Jackson Hole Symposium - Fed Chair Speech (USD)' },
  // September 2026 (indicatieve data — verifieer vóór gebruik)
  { time: '2026-09-04T12:30:00Z', name: 'Non-Farm Payrolls & Unemployment Rate (USD)' },
  { time: '2026-09-10T12:30:00Z', name: 'CPI m/m & Core CPI m/m (USD)' },
  { time: '2026-09-11T12:30:00Z', name: 'PPI m/m & Core PPI m/m (USD)' },
  { time: '2026-09-16T12:30:00Z', name: 'Retail Sales m/m (USD)' },
  { time: '2026-09-16T18:00:00Z', name: 'Federal Funds Rate & FOMC Statement (USD)' },
  { time: '2026-09-16T18:30:00Z', name: 'FOMC Press Conference (USD)' },
  { time: '2026-09-30T12:30:00Z', name: 'GDP q/q (Final) (USD)' },
  // Oktober 2026
  { time: '2026-10-02T12:30:00Z', name: 'Non-Farm Payrolls & Unemployment Rate (USD)' },
  { time: '2026-10-08T12:30:00Z', name: 'CPI m/m & Core CPI m/m (USD)' },
  { time: '2026-10-09T12:30:00Z', name: 'PPI m/m & Core PPI m/m (USD)' },
  { time: '2026-10-15T12:30:00Z', name: 'Retail Sales m/m (USD)' },
  { time: '2026-10-29T12:30:00Z', name: 'GDP q/q (Advance) (USD)' },
  // November 2026
  { time: '2026-11-05T18:00:00Z', name: 'Federal Funds Rate & FOMC Statement (USD)' },
  { time: '2026-11-05T18:30:00Z', name: 'FOMC Press Conference (USD)' },
  { time: '2026-11-06T12:30:00Z', name: 'Non-Farm Payrolls & Unemployment Rate (USD)' },
  { time: '2026-11-12T12:30:00Z', name: 'CPI m/m & Core CPI m/m (USD)' },
  { time: '2026-11-13T12:30:00Z', name: 'PPI m/m & Core PPI m/m (USD)' },
  { time: '2026-11-17T13:30:00Z', name: 'Retail Sales m/m (USD)' },
  // December 2026
  { time: '2026-12-04T13:30:00Z', name: 'Non-Farm Payrolls & Unemployment Rate (USD)' },
  { time: '2026-12-10T13:30:00Z', name: 'CPI m/m & Core CPI m/m (USD)' },
  { time: '2026-12-11T13:30:00Z', name: 'PPI m/m & Core PPI m/m (USD)' },
  { time: '2026-12-16T13:30:00Z', name: 'Retail Sales m/m (USD)' },
  { time: '2026-12-16T19:00:00Z', name: 'Federal Funds Rate & FOMC Statement (USD)' },
  { time: '2026-12-16T19:30:00Z', name: 'FOMC Press Conference (USD)' },
];

export function upcomingEvents(referenceTime, hours = 48) {
  const now = new Date(referenceTime);
  const horizon = new Date(now.getTime() + hours * 60 * 60 * 1000);

  return UPCOMING_EVENTS.filter((event) => {
    const eventTime = new Date(event.time);
    return eventTime >= now && eventTime <= horizon;
  });
}
