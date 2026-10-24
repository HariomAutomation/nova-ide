# Airport Retail Media Platform

A locally runnable prototype of an airport retail media platform: ads on airport
screens, timed to the passengers actually in front of them, driven by live flight
and passenger-flow data.

This is a TopCoder Development challenge deliverable and is **self-contained** —
nothing in here imports from the repository it currently lives in. That is
deliberate: it makes extracting this directory into its own repository a copy, not
a refactor.

## Layout

```
backend/          Node + TypeScript
  src/model/      canonical model — the only shapes the core ever sees
  src/adapters/   source adapters (AODB, AIDX, ACRIS), each with a mock
  src/engine/     crowd profiling, the decision pipeline
  test/           runnable checks, including the brief's worked example
frontend/         (in progress) the five role views and the screen simulator
docker-compose.yml
```

## Run

```
docker compose up --build      # brings everything up on localhost with seeded data
```

Backend checks, no server needed:

```
npm run build:backend
npm run test:backend
```

## Architecture, in one paragraph

The brief's core requirement is that going live means writing one new adapter and
nothing else. So the app core only ever sees a canonical model
(`backend/src/model/canonical.ts`); adapters translate AODB CSV, AIDX XML and ACRIS
NGSI-LD JSON into it and are the only place that knows those formats. Every value
that came from a source carries provenance (source, observedAt, ingestedAt),
because the decision pipeline is evidence-first and evidence you cannot trace is not
evidence. The one derived signal everything depends on is `ZonePresence`: how many
people are in a zone, where they are going, and for how long, per 5-minute window.

## Extracting this into its own repository

Because nothing here imports from the host repo, this is enough:

```bash
# with history
git subtree split --prefix=apps/airport-retail-media -b airport-export
git push <new-remote> airport-export:main

# or, without history
cp -r apps/airport-retail-media ../airport-retail-media
```

## Status

See the repository's own notes for what is verified against a real service versus
what is covered by tests only. In short: the canonical model, crowd profiling, the
decision pipeline and the AODB adapter are implemented and checked; the AIDX and
ACRIS adapters, the presence wiring, the server and the frontend are in progress.
