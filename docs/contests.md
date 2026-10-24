# Contests — TopCoder, Kaggle and Penpot

Nova can work a contest end to end: ingest a brief, turn it into a tracked
checklist, produce the deliverable, and package or submit it. This document covers
the three tracks, how to run each one, and — importantly — **what has been proven
against the real service versus what is only covered by tests.**

The README covers the IDE. This covers the contest workflows, which the README does
not mention.

---

## The shape they share

All three reuse one workflow, in `electron/tools/challenge.ts`:

```
spec  ->  checklist  ->  produce  ->  package / submit
```

A contest brief is treated like a set of requirements. It is ingested once, stored
per workspace, tracked item by item, and only then packaged. The agent works against
the checklist instead of a wall of markdown, because the most common way to lose a
contest is not a bad deliverable — it is a missing one.

Storage lives outside the repo, under the app's config directory, keyed by
workspace path. Re-ingesting a brief **keeps the status of items already done**.

---

## TopCoder

**Status: machinery verified, no live run.** There has been no open Development or
QA challenge to point it at, so the loop has never been executed against a real
contest. The code path is covered by tests; the outcome is not proven.

Tools: `challenge_find`, `challenge_spec`, `challenge_check`, `challenge_pack`.

- `challenge_find` lists open contests. It defaults to the tracks Nova can deliver
  and **excludes Design**, because a Design brief wants a `.fig` and no agent here
  can author one. Duplicate rows from the API collapse by name; dead statuses drop;
  soonest deadline first.
- `challenge_spec` ingests a URL or a pasted brief into the checklist. It also
  reports **deliverability**: a Design track is flagged with why and what to pick
  instead, rather than letting the checklist imply the work is doable.
- `challenge_pack` bundles deliverables into a zip and **refuses while items are
  open**, listing what is missing.

Every track also brings its own **submission playbook**, merged into the checklist
at ingest. For Development that includes the deployment guide and the patch-email
requirement; for QA, reproduction steps and per-defect evidence. These are general
— drawn from how briefs are written — so an item that does not apply gets marked
skipped.

**Deadlines** are reported as remaining time and urgency (`critical` under 6h,
`soon` under 24h). A missing or unparseable deadline reads as `unknown`, never as
`closed` — reading a blank date as closed would make the agent abandon a contest
that is still open.

---

## Kaggle

**Status: live verified.** The full loop has been run against the real API:
discovery → dataset download → local training → submit → score read-back, ending at
public score **0.79904** on Titanic.

Tools: `kaggle_data`, `kaggle_submit` (plus `challenge_find source=kaggle`).

### Credentials

Four places, in the order the official client checks them:

```
1. KAGGLE_API_TOKEN              -> Bearer
2. KAGGLE_USERNAME + KAGGLE_KEY  -> Basic
3. ~/.kaggle/access_token        -> Bearer   (the file Kaggle's token screen creates)
4. ~/.kaggle/kaggle.json         -> Basic    (the classic username/key pair)
```

`KAGGLE_CONFIG_DIR` moves the directory. A corrupt or partial file is not an error —
it just means no credentials there. The resolver returns where the credential came
from, never the value.

A 401 comes back as `authRequired` with the setup steps, not a bare error. And a
failed submit carries **Kaggle's own message**: the most common real failure is
submitting without having joined, and Kaggle says so in the body.

### The submit is three calls

Verified against the Kaggle client source, because the obvious guess is wrong:

```
1. POST competitions/{ref}/submissions/url/{contentLength}/{lastModifiedDateUtc}
   multipart fileName   -> { createUrl, token }
2. PUT <createUrl> with the raw body
   (legacy: if the response carries isComplete, the createUrl encodes
    guid/length/timestamp and the bytes go to
    POST competitions/submissions/upload/{guid}/{len}/{ts})
3. POST competitions/submissions/submit/{ref}
   multipart blobFileTokens=<token>, submissionDescription=<msg>
```

The file **name** goes in the body, not the path. The path carries the byte length
and the mtime in seconds. An empty file is refused before any network call.

### Measuring a model honestly

`scripts/train_competitive_model.py` runs the pipeline and reports two numbers.
Read them with care:

```
naive leave-one-out : 0.8474   (optimistic)
GroupKFold (5)      : 0.8350
public leaderboard  : 0.79904   <- ground truth
```

The strong feature is "did the rest of my family/ticket group survive?", read off
the training labels. How often that feature is *available* differs by split:

| split | group-mates | feature | like test? |
|---|---|---|---|
| leave-one-out | stay in training | available | closer |
| GroupKFold | held out whole | **never** available | more conservative |
| test | some groups span train/test | available for some rows | — |

GroupKFold holds out whole groups, so the signal never fires in validation — the
script prints that as `0/891 (0.0%)` alongside the score. It measures the
**hand-written rules alone**, which is not what test does.

Both CV numbers sit **above** the leaderboard, so the remaining gap is not the thing
GroupKFold fixed. It comes from the hand-derived rules being fitted to train (they
are code, not features, so no split removes them) and from a public leaderboard of
only 418 rows.

The lesson worth keeping: **a CV number is only as honest as its match to the test
condition.** The script now prints the breakdown so the mismatch is visible instead
of hidden. `--selftest` proves the grouping property on synthetic data rather than
asserting it.

```bash
python3 scripts/train_competitive_model.py --selftest              # proves no leakage
python3 scripts/train_competitive_model.py --data data/titanic     # CV + submission
```

---

## Penpot

**Status: live verified.** A generated file imports cleanly into production Penpot
(`design.penpot.app`).

Figma cannot be targeted at all — the format is proprietary and there is no way to
write one. Penpot's format is open (a ZIP of JSON) and Penpot publishes
`@penpot/library`, so a file can be built in memory and exported. That difference is
the whole reason this exists.

Tool: `penpot_create`. It takes a plain description — boards, each with rects,
circles and text at real coordinates — and writes `design/<name>.penpot`.

Two things learned against the real importer, not from docs:

- **Text must be the v2 rich-text AST**, not a string. A bare string is rejected:
  `root -> paragraph-set -> paragraph -> text`. A board-and-rect-only file imported
  fine while the text version failed, which is what narrowed it down.
- Missing `revn`/`createdAt`/`modifiedAt` in the file metadata did **not** block the
  import; Penpot defaults them, even though the spec marks them required.

**Honest limit:** this produces **structure** — boards, boxes, type, coordinates —
not craft. And if a brief demands `.fig`, the design still has to be finished in
Figma by hand. `deliverability('DESIGN')` stays `false` for that reason.

---

## Tool gating, and why it exists

Tool schemas are the bulk of every request, so the follow-up tools load only when
the state that needs them exists:

| tools | when |
|---|---|
| `challenge_check`, `challenge_pack` | a challenge spec is saved |
| `security_triage`, `security_report` | a scan produced findings |
| `kaggle_data`, `kaggle_submit` | the workspace track is kaggle |
| `penpot_create` | the workspace track is design |

Entry points are always offered, so the agent can always start. Measured size:

```
base              21 tools  12,422 chars
design workspace  24 tools  14,459 chars
kaggle workspace  25 tools  14,995 chars     (budget 15,000)
```

The tracks are mutually exclusive — a design workspace does not carry the kaggle
tools and vice versa — which is what keeps each under budget.

**Note:** the kaggle workspace sits 5 characters under the ceiling. Any further tool
needs another gate or a shorter description, not another trim.

---

## Verification status, plainly

| track | live against the real service? |
|---|---|
| Kaggle | **yes** — submit and score read-back on Titanic |
| Penpot | **yes** — import into production Penpot |
| TopCoder | **no** — tested, but never run against an open contest |

Two things are explicitly **not** claimed:

- The public leaderboard **rank** ("top 8.7%") has not been independently verified.
  The score 0.79904 is verified; the rank is a report.
- The Kaggle flow was verified on one competition. Others may differ.

---

## Outstanding

- TopCoder needs an open Development or QA contest to prove the loop end to end.
- The Kaggle token and any Penpot session token used during testing should be
  rotated; they were handled in plain text during development.
