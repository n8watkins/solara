# Running Costs

_Last reviewed: 2026-10-23._
_All figures are planning estimates; confirm current quotas on each provider's pricing page before relying on them._

## Principle

Solara stays on free tiers until it has paying users.
The first paid feature (Pro billing) is what requires the Firebase Blaze plan, so paid infrastructure starts when revenue starts.

## What runs on which plan

| Piece | Free (Spark) today | Needs Blaze |
| --- | --- | --- |
| Hosting, sign-in, Firestore, static app | Yes | No |
| Forecasts (Open-Meteo, fetched by each user's browser) | Yes, non-commercial terms | No, but commercial use needs a paid Open-Meteo plan (see below) |
| App Check with reCAPTCHA (bot protection) | Yes | No |
| Error reporting (Sentry) | Yes, Sentry free plan | No |
| Cloud Functions: billing, account export and deletion, calendar feed, notification registration | No | Yes |
| Pro-only morning alerts (scheduled Function plus Cloud Messaging) | No | Yes |

## Assumptions behind the estimates

- An active user causes about 20 Firestore reads and 3 writes per day.
- A first visit downloads about 0.5 MB; repeat visits are mostly cached.
- Morning alerts run as one scheduled job every 15 minutes that serves every time zone (about 2,900 runs per month), not one job per user.
- App Check tokens are cached for about an hour, and App Check starts only after sign-in, so reCAPTCHA checks roughly equal signed-in session-hours.
- Free quotas used: Firestore about 50k reads and 20k writes per day; Hosting about 10 GB transfer per month; Cloud Functions about 2M invocations per month; Cloud Messaging free; reCAPTCHA 10k assessments per month, then an $8 flat fee up to 100k, then $0.001 each.

## Estimated monthly cost by daily active users

| Daily active users | Firestore | Hosting bandwidth | Alerts (Functions, Pro only) | Push (FCM) | reCAPTCHA | Forecasts (Open-Meteo) | Estimated total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | about 2k reads and 300 writes a day: free | about 1-2 GB: free | about 2.9k runs: free | free | about 3k: free | free tier until Pro; $29 after | $0 before Pro, about $29 after |
| 1,000 | about 20k reads and 3k writes a day: free | about 10-15 GB: at the free limit | free | free | about 30k: $8 | $29 | about $30-40 |
| 5,000 | about 100k reads and 15k writes a day: about $1-3 | about 50-75 GB: about $6-10 | free | free | about 150k: about $58 | $29, or $99 above 1M calls | about $95-170 |

## Break-even

At $2.99 per month, about 5 Pro subscribers per 100 daily active users covers every row above.
The Open-Meteo commercial plan alone ($29 per month) is covered by about 10 subscribers.

## Cost levers

- reCAPTCHA is the first cost to grow; keep App Check limited to signed-in users and backend calls.
- Firestore reads: keep the account load to one document read and avoid listeners on large collections.
- Hosting: hashed assets are cached for a year; keep first-load JavaScript small.
- Set a Google Cloud budget alert (for example $5 per month) as soon as Blaze is enabled.

## Forecast providers

Open-Meteo is the current provider: the best data and no API key, but the free tier is non-commercial only.
Its commercial plans start at about $29 per month for 1M calls (Standard) and $99 per month (Professional).
Decision D5: stay on the free tier until Pro launches, then buy the commercial plan from the first revenue.

Free alternatives that allow commercial use, kept as fallback options:

| Provider | Free commercial allowance | Limits |
| --- | --- | --- |
| [Weather Metro](https://weathermetro.com/) | 100k calls a month, hourly forecast with UV | Attribution required; smaller provider |
| [WeatherAPI.com](https://www.weatherapi.com/) | Commercial use allowed | Free forecasts only 3 days, which breaks Pro's 10-day view |
| [uvindexapi.com](https://uvindexapi.com/) | Free commercial use, hourly UV forecast | UV only, no temperature or conditions; attribution required |
| [currentuvindex.com](https://currentuvindex.com/api) | Free commercial use, about 120 hours of hourly UV | UV only; 500 requests per IP per day; attribution required |

Because each browser fetches its own forecast, per-IP limits scale with users, but smaller providers carry reliability risk.
Re-check every provider's current terms before switching.

## Sources

- [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)
- [reCAPTCHA billing information](https://docs.cloud.google.com/recaptcha/docs/billing-information)
- [Open-Meteo pricing](https://open-meteo.com/en/pricing)
- [Open-Meteo commercial plans announcement](https://openmeteo.substack.com/p/api-subscriptions-for-commercial)
