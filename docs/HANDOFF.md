# Solara handoff

This page is the entry point for an agent starting in this repository with no other context.
It keeps no state of its own, so it cannot go stale: the current state lives in the docs below, and the live work queue lives with the coordinating session.

## What Solara is and where it lives

Solara is a personalized UV and outdoor-activity planner (Next.js on Firebase Hosting, Firestore, Firebase Functions).
It is live at https://solara-uv.web.app; the old https://uv-activity-planner.web.app redirects there.
The Firebase project is `uv-activity-planner`, on the free Spark plan until the Pro launch.
Every merge to `main` deploys automatically.

## Where the current state is

Read these, in this order:

1. [status.md](status.md): what is live, what is built but switched off, CI/CD, the latest deploy checked, and which owner actions are done or open.
2. [ROADMAP.md](ROADMAP.md): where each wave stands ("Where we are"), the engineering items in "Next up", and every owner decision or default under "Decisions".
3. [OWNER_CHECKLIST.md](OWNER_CHECKLIST.md): every step only the owner can do, as one ordered list ([Next steps, in order](OWNER_CHECKLIST.md#next-steps-in-order)), and the manual release checks.
4. [CONTRIBUTING-AGENTS.md](CONTRIBUTING-AGENTS.md): how parallel lanes run, the agent contract and the checks to run before pushing.
5. [DEPLOYMENT.md](DEPLOYMENT.md), [RUNBOOK.md](RUNBOOK.md) and [COSTS.md](COSTS.md) for how deploys, incidents and costs work.

Open pull requests and CI are the live truth for anything in flight: `gh pr list --repo n8watkins/solara` and `gh run list --repo n8watkins/solara --branch main`.

## The handoff process

Work is run by a coordinating session that launches parallel lanes, each in its own worktree from `origin/main`, and merges their pull requests.
It keeps its notes outside the repository, in `/home/natkins/projects/solara/handoff/`: its HANDOFF.md (the live merge queue and the next steps), lane-common.md (the rules every lane follows), the review reports and their probes, and per-lane notes.
Read that folder's HANDOFF.md before launching lanes or merging, and do not merge or rebase another lane's pull request without checking it first.
When a session ends, it updates that folder's HANDOFF.md; anything that changes what is live, built or decided goes into status.md, ROADMAP.md or the owner checklist in the same pull request as the change, never only into a handoff note.

## Standing notes

These are facts that rarely change and are not tracked elsewhere.

- No release tagging: `package.json` stays at `0.1.0` and the site ships by deploy, not by release.
  Solara is not on release-kit (`github:n8watkins/release-kit`, the owner's release tool used by most of their repos); adopt it as its own change once there is a mobile build to version.
- The guest first load has a tight budget: `tests/e2e/guest.spec.ts` holds it under 186 KB gzip (about 182 KB today), so new dashboard code that a new guest does not see should load on demand (`components/deferred.tsx`).
- The Lab entry on n8builds.dev says "no sign-up", while Solara has a Pro plan; "free to start" would be exact, and that copy lives in the n8builds.dev repository, not here.
- Deferred feature ideas are in [ROADMAP item 12](ROADMAP.md#12-wave-5-features) (an AI-written briefing, Strava, a returning visitor's plan over a city link) and in [EVENTS.md](integrations/EVENTS.md) (a Web Share Target for .ics files, a "better window" for events the person controls).
- The Android plan is [integrations/ANDROID.md](integrations/ANDROID.md) ([ROADMAP item 13](ROADMAP.md#13-wave-6-mobile-app-owners-learning-project)).
- Always work in a fresh worktree from `origin/main`.
