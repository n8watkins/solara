# Running Costs

_Last reviewed: 2026-10-28._
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
| Cloud Functions: billing, account export and deletion, calendar feed, notification registration, forecast proxy and place search, maintenance job, budget kill switch | No | Yes |
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
| Cloud Scheduler | 3 jobs a month, per billing account | 3 jobs (`maintenance`, `alerts` and `eventSubscriptionsRefresh`) | Never | $0.10 per job a month |
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
- Linked calendars (switched off until `EVENTS_SUBSCRIPTIONS_ENABLED`): each link is fetched every 6 hours, so 4 refreshes a day (REVIEW5 M2 corrected these numbers).
  A refresh whose calendar has not changed (an answer of 304, or the same bytes as the last fetch) costs about 7 Firestore reads and 3 writes and is not parsed; once a day the same bytes are parsed again, which reads the link's stored events once (N reads for N stored events) and writes only events that changed.
  A changed calendar costs N + 7 reads and one write per new or changed event, plus 3; nothing is written for an event that did not change.
  So a link of N stored events costs at most about N + 30 reads and 12 writes a day while it does not change: at 1,000 links of 50 events about 80,000 reads and 12,000 writes a day (about $0.02 a day above the free quotas), at 1,000 links of 200 events about 230,000 reads (about $0.11 a day).
  CPU: a fetch takes well under a second of waiting, and a parse about 0.5 vCPU-seconds for a full 1 MB calendar (typical calendars are 10-100 KB); 4,000 refreshes a day of 100 KB calendars are a few hundred vCPU-seconds, far inside the free tier.
  LOCATION texts are looked up once per link and kept (REVIEW5 M1), from their own budget of 50 searches an hour and 300 a day (`EVENT_PLACE_LOOKUPS_PER_HOUR`, `EVENT_PLACE_LOOKUPS_PER_DAY`, about 1% of the Standard plan), 10 an hour per account, never from place search's; event forecasts for heads-ups come out of the server's side of the forecasts' 20,000 a day (at most two thirds, shared with the calendar feed) through each account's share.
  Capacity (REVIEW5 M4): every 30 minutes the refresh job takes every due link, oldest due first, 16 at a time for up to 200 seconds and 3,000 links a run; at about 2 seconds a link that is about 1,600 links a run, enough for roughly 19,000 links on the 6-hour cycle.
  The scale point is the job's fractional CPU when many large calendars change at once (about 3 seconds a 1 MB parse); when a link waits a whole extra 6 hours, the job logs the ERROR `linked calendar refresh is falling behind`, which emails the owner ([RUNBOOK.md](RUNBOOK.md#linked-calendars)), and the lever is a larger CPU for that one job.
  Pro event heads-ups add one state read and one events query per Pro account per alerts run (at least 192 reads a day per Pro account, plus one read per event starting in the next 3 hours; none for 3 hours after a heads-up) and a cached forecast per event place.
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

- every function has a small fixed size and a launch-sized instance cap (16 HTTP instances in all), so CPU-seconds and billed requests cannot grow without limit;
- every browser endpoint needs App Check and has per-address and per-account rate limits and a body size cap, and turns a request away before any Firestore read or upstream call;
- rejections are logged once a minute, not once per request, and `infra/logging.sh` drops 99% of Cloud Run's request logs for rejected requests;
- the forecast proxy, the calendar feed and the alerts share one cache per place and hour, so traffic does not multiply upstream calls, and a global budget caps the paid forecast calls of the proxy, the feed and event heads-ups at 1,500 an hour and 20,000 a day (about 60% of the Standard plan), so a script walking new places cannot spend the plan's quota;
- that budget has two sides, each allowed at most two thirds of it (1,000 an hour, 13,333 a day): the browser's forecasts, and the server's own work for accounts (the calendar feed and event heads-ups), so a flood of browser callers cannot stop the feed or Pro heads-ups, and the server side cannot leave guests without forecasts for new places (REVIEW5 L1, REVIEW6 L3);
- within each budget every caller (an IPv4 address and its /24 at 4 times as much, or an IPv6 /64 and its /48 at 4 times as much, or an account for heads-ups) may cause only 20 paid calls an hour, so one caller or one network cannot spend everyone's hour, and place search has its own budget (200 an hour, 2,000 a day, about 6% of the plan), so searches and forecasts cannot starve each other; while a budget is spent, people get the last good forecast up to 12 hours old instead of an error (REVIEW4 H1);
- the Firestore rules cap list sizes, and every server-owned record and scheduled activity expires;
- linked calendars are bounded per account: at most 5 links, each fetched every 6 hours by the refresh job and within 10 seconds and 1 MB; adding or refreshing by hand is limited to 20 fetches an hour per account; their place lookups have their own budget (50 an hour, 300 a day), so they cannot take place search from guests.

The budget kill switch is the last line ([runbook](RUNBOOK.md#budget-kill-switch)), with three tiers (defaults, owner may change):

- a Cloud Billing budget of $25 a month publishes to Pub/Sub, and the `budgetAlert` Function logs a warning at 50%;
- at 100% it turns off the paths an outsider's traffic drives (calendar feed, feed links, notification registration, forecast proxy upstream calls) within a minute, until the next budget period starts; the scheduled Pro alerts keep running, because their cost is bounded by the number of Pro accounts, so an attacker cannot pause paying customers' alerts;
- at 300% ($75) it detaches the project from its billing account: the hard stop.
  The Functions stop (checkout, the webhook, the feed, the alerts), while Hosting, sign-in and Firestore keep serving within the no-cost quotas until the owner re-attaches billing.

$25 is far above the expected Google bill up to about 1,000 daily users (a few cents to about $10 a month in the table above; the Open-Meteo plan is billed separately), so ordinary growth does not trip it; raise it as traffic grows.
Budget data arrives hours after the usage, so the switch caps a runaway bill rather than preventing every cent.

## Worst case under a flood

What an attacker can make Solara spend by flooding the Functions from many addresses (finding H1 of the October 2026 security review), with the limits above.
These are planning estimates from public list prices, not measurements on a deployed project.

- Rejecting a request costs about 10 microseconds of the handler's CPU (measured locally), so the instances' throughput, not their CPU bill, is the ceiling.
  Assuming a conservative 1,000 requests a second per instance, the 16 HTTP instances serve at most about 16,000 a second, or 1.4 billion a day.
- Cloud Run bills $0.40 per million requests beyond the free 2 million a month, so that is about $550 a day in request fees, plus about $32 a day of vCPU time and $1 of memory.
  Requests Cloud Run turns away because every instance is busy are not billed.
- Logs: about 1 KB per request log line.
  Without `infra/logging.sh`, Cloud Run's request logs alone would be about 1.4 TB a day (about $690 a day at $0.50 per GiB); with it, 1% are kept (about $7 a day), and the Functions' own rejection logs are a few lines a minute.
- Firestore, Stripe and the forecast provider: nothing, because no rejected request reaches them.
- Accepted cache misses: each one charges a caller's share in one Firestore transaction (two reads and writes: the address and its /24 or /48; one for an account), and every 10 misses take a lease from the budget's counters in one more (four reads and writes with the side's own counters); the misses are bounded by the forecast, place search and linked calendar place lookup budgets (at most 1,750 an hour: 1,500, 200 and 50), so a few cents a day; a caller past its share costs one more transaction per instance and hour, then nothing.
- Linked calendars, which an account can drive by hand (REVIEW5 M2): the worst is an account with 5 links whose site changes every one of 200 events on every fetch, refreshed 20 times an hour, which makes about 100,000 Firestore reads and 100,000 writes a day (about $0.25 a day); unchanged calendars write nothing.
  This grows with the number of Google accounts an attacker signs in, not with requests, and is the reason linking could be limited to Pro if it is ever abused.

So a sustained, distributed flood costs at most about $590 a day, about $25 an hour, against $1,900 a day or more before these limits (37 instances and a log line per request).
The budget kill switch is what ends it ([above](#abuse-and-the-kill-switch)): billing is detached once the month's spend reaches $75, and since Cloud Billing reports spend hours late (often 6-24 hours), the worst month is roughly $75 plus that lag at $25 an hour, about $225-$675, before nothing more can be billed.
A cheaper first line in front of the Functions (Cloud Armor rate limiting on an external HTTPS load balancer, from about $18 a month plus per-request fees, or API Gateway quotas) is the next step if a real attack ever happens, and needs `TRUSTED_PROXY_HOPS` changed with it ([DEPLOYMENT.md](DEPLOYMENT.md#check-the-client-address-at-the-first-deploy)).

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
