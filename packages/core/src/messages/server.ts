// What the Functions write for an account, in its language (server-language.ts): the Pro
// morning and UV alerts (alerts.ts), the daily UV push (daily-uv.ts), event heads-ups
// (event-heads-up.ts) and the calendar feed's event text (functions/src/feed/sun.ts).
// The reapply reminder's words are the timer's (./sunscreen), shared with the browser.
import { defineMessages, plural } from '../i18n'

export default defineMessages('server', {
  /** A push about a place saved without a name. */
  yourArea: 'your area',
  /** Every forecast push ends with it. */
  recheck: 'Recheck current conditions.',

  // The Pro morning alert: the day's briefing, led by its lowest-UV window.
  morningDay: (city: string) => `Today in ${city}`,
  morningTitle: (city: string) => `☀️ UV today in ${city}`,
  morningWindowTitle: (icon: string, activity: string, from: string, to: string) =>
    `${icon} ${activity}: ${from} to ${to}`,

  // The Pro UV alert, when the UV reaches the person's threshold.
  uvSoonTitle: (threshold: number, time: string) => `☀️ UV reaches ${threshold} around ${time}`,
  uvNowTitle: (threshold: number) => `☀️ UV is ${threshold} or higher now`,
  uvBody: (place: string, threshold: number, to: string, peak: string, peakTime: string) =>
    `Forecast for ${place}: UV ${threshold}+ until about ${to}, peaking at ${peak} around ${peakTime}. Plan shade and sun protection, and recheck current conditions.`,

  // The free daily UV push.
  dailyFromTo: (from: string, to: string) => `☀️ Protect from ${from} to ${to} today`,
  dailyUntil: (to: string) => `☀️ Protect until ${to} today`,
  dailyPeak: (uv: string, label: string, time: string, place: string) =>
    `UV peaks at ${uv} (${label}) around ${time} in ${place}.`,
  dailyPeakIfClear: (uv: string, label: string, time: string, place: string, clearSky: string) =>
    `UV peaks at ${uv} (${label}) around ${time} in ${place}, or ${clearSky} if the sky clears.`,
  dailyTip: 'Sunscreen, a hat and shade while the UV is moderate or higher.',
  dailyTipIfClear: 'Sunscreen, a hat and shade in case the sky clears.',

  // The Pro heads-up before an event with high UV. The event's name is the publisher's.
  eventSoon: 'your event soon',
  eventTomorrowAt: (time: string) => `your event tomorrow at ${time}`,
  eventAt: (time: string) => `your ${time} event`,
  eventTitle: (uv: string, event: string) => `🗓️ UV up to ${uv} during ${event}`,
  eventName: (name: string) => `Event: “${name}”.`,
  eventPeak: (uv: string, time: string) => `UV peaks at ${uv} around ${time}.`,
  eventPeakAt: (place: string, uv: string, time: string) =>
    `Forecast for ${place}: UV peaks at ${uv} around ${time}.`,
  eventAdvice:
    'Apply sunscreen 15 to 30 minutes before you go, reapply every 2 hours, and plan for shade.',
  eventHot: (feelsLike: string) => `It may feel like ${feelsLike}: bring water and take breaks.`,
  eventMore: (count: number) =>
    plural(count, {
      one: `${count} more of your events coming up reaches high UV too.`,
      other: `${count} more of your events coming up reach high UV too.`,
    }),

  // The calendar feed: each activity's best window as an event.
  feedDescription: (from: string, to: string, uv: string, sunscreen: boolean) =>
    `Estimated lower-UV window ${from}–${to} (avg UV ${uv})${sunscreen ? ', assumes SPF 30+' : ', no sunscreen'}. Forecast-based estimate only. Recheck current UV and use sun protection. Planned by Solara.`,
})
