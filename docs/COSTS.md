# Running Costs

_Last reviewed: 2026-10-27._
_Free quotas below were checked on the providers' pricing pages on that date (see [Sources](#sources)); all usage figures are planning estimates._

## Principle

Solara stays on free tiers until it has paying users.
The first paid feature (Pro billing) is what requires the Firebase Blaze plan, so paid infrastructure starts when revenue starts.
On Blaze, every product keeps its free quota; you pay only for usage above it.

## What runs on which plan

| Piece | Free (Spark) today | Needs Blaze |
| --- | --- | --- |
| Hosting, sign-in, Firestore, static app | Yes | No |
| Forecasts (Open-Meteo, fetched by each user's browser) | Yes, non-commercial terms | No, but commercial use needs a paid Open-Meteo plan (see below) |
| App Check with reCAPTCHA (bot protection) | Yes | No |
| Error reporting (Sentry) | Yes, Sentry free plan | No |
| Cloud Functions: billing, account export and deletion, calendar feed, notification registration, forecast proxy, maintenance job, budget kill switch | No | Yes |
| Firestore TTL deletes, point-in-time recovery and backups | No | Yes |
| Pro-only morning and UV alerts (scheduled Function plus Cloud Messaging) | No | Yes |

## How many users before Blaze costs money

The free quotas on Blaze, and the daily active users (DAU) at which each one runs out, with the assumptions below.
Quotas marked "per billing account" are shared by every project on that billing account.

| Product | Free quota | Solara's use | Free up to about | Then |
| --- | --- | --- | --- | --- |
| reCAPTCHA (App Check) | 10,000 assessments a month, per organization | About 1 per signed-in session-hour; with the forecast proxy on, guests count too | 330 DAU | $8 a month flat up to 100,000 (about 3,300 DAU), then $1 per 1,000 |
| Hosting | 10 GB storage; 360 MB a day transfer | About 0.35 MB a day per active user (first visits download about 0.5 MB, repeat visits are mostly cached) | 1,000 DAU | $0.15 per GB |
| Cloud Firestore | 50,000 reads, 20,000 writes and 20,000 deletes a day; 1 GiB stored; 10 GiB a month egress | About 22 reads and 4 writes per active user a day, plus about 1,200 reads a day for the maintenance job; the forecast proxy adds one read per cache miss and one write per place and hour | 2,200 DAU (reads run out first) | $0.03 per 100,000 reads, $0.09 per 100,000 writes (us-central1) |
| Cloud Functions (Cloud Run functions) | 2 million requests, 180,000 vCPU-seconds and 360,000 GiB-seconds a month, per billing account | About 6 requests per active user a day with the forecast proxy on (3 without), at about 0.2 vCPU-seconds each; the maintenance job uses about 3,000 vCPU-seconds a month | 5,000 DAU (CPU runs out first) | Tier 1 rates per vCPU-second and GiB-second |
| Cloud Scheduler | 3 jobs a month, per billing account | 2 jobs (`maintenance` and `alerts`) | Never | $0.10 per job a month |
| Pub/Sub | 10 GiB of message delivery a month, per billing account | A few budget notifications a day for the kill switch | Never | Per GiB |
| Artifact Registry (Functions container images) | 0.5 GB of storage, per billing account | One image per function; the cleanup policy keeps 1 day of images (set by the deploy, or `infra/backups.sh`) | Usually within it; at most about $0.10 a month | About $0.10 per GB a month |
| Cloud Messaging (push) | No charge | Pro morning and UV alerts | Never | - |
| Authentication | 50,000 monthly active users | Google sign-in only | 50,000 MAU | Per MAU |
| Cloud Logging | 50 GiB ingested a month, per project | Structured logs; the calendar feed's request logs are excluded | Far beyond any plan here | $0.50 per GiB |
| Cloud Monitoring | Uptime checks: 1 million executions a month per project; alerting: free until September 1, 2027 | 2 uptime checks every 5 minutes (about 52,000 executions); 2 alert policies | Never for uptime | Alerting: $0.35 a month per metric reference from September 2027 (about $0.35-0.70) |
| Firestore TTL deletes, PITR, backups | No free quota | TTL deletes of expired records; PITR and daily backups of a database well under 1 GiB | Cents from the first month | $0.01 per 100,000 TTL deletes; PITR and backups by GiB stored |

So the first Google bill comes from reCAPTCHA at roughly 330 daily users (once App Check is on), then Hosting transfer around 1,000, Firestore around 2,200 and Functions around 5,000.
Below about 300 daily users the expected Google bill is a few cents a month (Artifact Registry, PITR and backups).
The Open-Meteo commercial plan ($29 a month, below) is a fixed cost on top, paid from the first revenue.

## Assumptions behind the estimates

- An active user causes about 20 Firestore reads and 3 writes per day from the app; the forecast proxy and server bookkeeping add the rest.
- A first visit downloads about 0.5 MB; repeat visits are mostly cached.
- Morning and UV alerts run as one scheduled job every 15 minutes that serves every time zone (about 2,900 runs per month), not one job per user.
  Each run reads every Pro account once (96 reads per Pro account a day), plus the alert state, devices and a cached forecast only for accounts with an alert due; at 300 Pro accounts that is about 30,000 reads a day, and the forecasts come from the forecast proxy's shared cache.
- App Check tokens are cached for about an hour, and App Check starts only after sign-in (or, with the forecast proxy on, at a guest's first forecast fetch), so reCAPTCHA assessments roughly equal session-hours.
- Function requests are small (under 300 ms of CPU each) and share instances (concurrency 20-40); background jobs run on a fractional CPU.

## Estimated monthly cost by daily active users

| Daily active users | Firestore | Hosting bandwidth | Functions | Push (FCM) | reCAPTCHA | Forecasts (Open-Meteo) | Estimated total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | about 2.2k reads and 400 writes a day: free | about 1 GB: free | free | free | about 3k: free | free tier until Pro; $29 after | under $1 before the forecast plan, about $29 after |
| 1,000 | about 22k reads and 4k writes a day: free | about 10 GB: at the free limit | free | free | about 30k: $8 | $29 | about $37-40 |
| 5,000 | about 110k reads and 20k writes a day: about $1-2 | about 50 GB: about $6 | about at the free limit | free | about 150k: about $58 | $29, or $99 above 1M calls | about $95-110 |

## Break-even

At $2.99 per month, about 5 Pro subscribers per 100 daily active users covers every row above.
The Open-Meteo commercial plan alone ($29 per month) is covered by about 10 subscribers.

## Abuse and the kill switch

Free quotas protect nothing once billing is attached, so the Functions are built to bound what any burst or attacker can cost ([Cost and abuse limits](DEPLOYMENT.md#cost-and-abuse-limits)):

- every function has a small fixed size and at most 1-5 instances, so CPU-seconds cannot grow without limit;
- every browser endpoint needs App Check and has per-address and per-account rate limits and a body size cap;
- the forecast proxy caches per place and hour, so traffic does not multiply upstream calls;
- the Firestore rules cap list sizes, and every server-owned record and scheduled activity expires.

The budget kill switch is the last line ([runbook](RUNBOOK.md#budget-kill-switch)): a Cloud Billing budget (for example $5 a month) publishes to Pub/Sub, and when spend reaches the budget the `budgetAlert` Function turns off the traffic-driven paths (calendar feed, feed links, notification registration, forecast proxy upstream calls) within a minute.
Detaching billing entirely at twice the budget is an opt-in last resort, because it also takes checkout, the webhook and the site's paid capacity down.
Budget data arrives hours after the usage, so the switch caps a runaway bill rather than preventing every cent.

## Cost levers

- reCAPTCHA is the first cost to grow; keep App Check limited to signed-in users and backend calls, and weigh it when switching the forecast proxy on (guests then need App Check too).
- Firestore reads: keep the account load to one document read and avoid listeners on large collections.
- Hosting: hashed assets are cached for a year; keep first-load JavaScript small.
  The 51 city pages (`/uv/`) are static HTML of about 4 KB gzip each with no JavaScript, sharing the cached stylesheet and font, so search traffic costs little transfer; they add a few seconds to the build and make no API calls (their data is checked in).
- Keep the Cloud Billing budget and its kill switch in place from the day Blaze is enabled.

## Forecast providers

Open-Meteo is the current provider: the best data and no API key, but the free tier is non-commercial only.
Its commercial plans are API Standard (1M calls a month) and API Professional (5M calls a month), at about $29 and $99 a month; the pricing page lists the call limits and the key's use (the customer API host with an `apikey` parameter), and the prices are in Open-Meteo's dashboard.
Decision D5: stay on the free tier until Pro launches, then buy the commercial plan from the first revenue; the forecast proxy ([DEPLOYMENT.md](DEPLOYMENT.md#forecast-proxy)) keeps the key on the server and makes about one upstream call per place and hour.

Free alternatives that allow commercial use, kept as fallback options:

| Provider | Free commercial allowance | Limits |
| --- | --- | --- |
| [Weather Metro](https://weathermetro.com/) | 100k calls a month, hourly forecast with UV | Attribution required; smaller provider |
| [WeatherAPI.com](https://www.weatherapi.com/) | Commercial use allowed | Free forecasts only 3 days, which breaks Pro's 10-day view |
| [uvindexapi.com](https://uvindexapi.com/) | Free commercial use, hourly UV forecast | UV only, no temperature or conditions; attribution required |
| [currentuvindex.com](https://currentuvindex.com/api) | Free commercial use, about 120 hours of hourly UV | UV only; 500 requests per IP per day; attribution required |

A new provider is one more adapter in `packages/core/src/forecast.ts` that answers in the same shape; re-check every provider's current terms before switching.

## Sources

Checked 2026-10-27:

- [Firebase pricing](https://firebase.google.com/pricing): Firestore, Hosting, Cloud Functions, Authentication and Cloud Messaging quotas.
- [Firestore pricing](https://cloud.google.com/firestore/pricing): daily free quota, us-central1 rates, and that TTL deletes, PITR and backups have no free usage.
- [Cloud Run pricing](https://cloud.google.com/run/pricing): the request-based free tier (2 million requests, 180,000 vCPU-seconds, 360,000 GiB-seconds a month) that Cloud Functions (2nd gen) use.
- [Cloud Scheduler pricing](https://cloud.google.com/scheduler/pricing): 3 free jobs a month per billing account, $0.10 per job after.
- [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing): 0.5 GiB free storage per billing account.
- [Pub/Sub pricing](https://cloud.google.com/pubsub/pricing): the first 10 GiB of message delivery a month free.
- [Google Cloud Observability pricing](https://cloud.google.com/stackdriver/pricing): 50 GiB of logs a month, 1 million uptime check executions, alerting charges from September 1, 2027.
- [reCAPTCHA pricing](https://cloud.google.com/recaptcha/pricing): 10,000 free assessments a month per organization, then $8 flat up to 100,000.
- [Open-Meteo pricing](https://open-meteo.com/en/pricing) and the [commercial plans announcement](https://openmeteo.substack.com/p/api-subscriptions-for-commercial).
- [Disable billing usage with notifications](https://cloud.google.com/billing/docs/how-to/disable-billing-with-notifications) and [budget notifications](https://cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications): the kill switch's design.
