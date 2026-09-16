# Ponto Cego

A Brazilian news aggregator that classifies political bias **per article**, not
per outlet — and shows its work.

Live at **[pontocego.app](https://pontocego.app)**. This repository is a public
extract of the production codebase: application source, the test suite, the CI
pipeline and the design documents. Deployment configuration and operational
runbooks are not included.

## The problem

Bias ratings normally get attached to publications. *This outlet is left, that
one is right.* That is convenient and mostly useless: it tells you nothing about
the article in front of you, it cannot notice an outlet breaking its own
pattern, and it asks you to trust a label with no reasoning attached.

Ponto Cego classifies each article on its own, publishes the rubric it judges
by, and shows the model's confidence and reasoning next to every verdict. You
are meant to be able to disagree with it *specifically*.

## Four rules, enforced in code

**Full article text is never stored.** The classifier fetches the article at
classification time, reads it in memory, and writes only the structured result.
Nothing durable, nothing indexed, nothing displayed. `robots.txt` is honoured on
every fetch, and a failed fetch degrades to title-plus-excerpt with the article
flagged low-confidence input rather than silently guessed.
→ `src/lib/fulltext.ts:1-10`

**Low confidence is shown, not hidden.** Below `0.65` confidence a banded
article is publicly marked *"Viés em Debate"* — bias under debate. An honesty
signal that doubles as an invitation to vote. Non-political and unclassified
articles never show it.
→ `src/components/debate-badge.tsx:7`

**The rubric is public and versioned.** The exact text the model receives is
published at [/rubrica](https://pontocego.app/rubrica), and is editable and
audited without a deploy. If you think the rubric is wrong, you can read the
thing you disagree with.

**Reasoning ships with the verdict.** Every classification carries its
confidence and its stated reasoning.

## How it works

```
RSS feeds → dedup → NC pre-gate → paid classifier → clustering → reader
                    (local BERTimbau)  (DeepSeek V3.2)  (local bge-m3)
```

**The pre-gate is the interesting part.** Most articles in a general news feed
are not political, and paying a frontier model to tell you so is the largest
avoidable cost in the system. A locally fine-tuned BERTimbau classifier
(ROC-AUC 0.94) runs first; anything scoring below `P(política) = 0.05` never
reaches the paid model. That removes **~44% of paid calls**.

The threshold is tuned on *leakage*, not accuracy — wrongly dropping a political
article costs far more than wrongly paying for a non-political one.
→ `src/worker/nc-gate.ts:6,23,25` (threshold is env-configurable)

Clustering uses local `bge-m3` embeddings to group articles covering the same
event, so a reader sees how one story was framed across outlets instead of the
same story twenty times.

## Stack

TypeScript throughout, ~22k lines. Next.js 15.5 / React 19, PostgreSQL with
pgvector, Drizzle ORM over 26 tables, and a separate Node worker for ingestion
and classification. Docker on a VPS behind Caddy. Python appears only in the
model-training scripts.

## Tests and CI

19 test suites — the classifier gate, blind-spot detection, newsletter rendering
rules, SSRF protection in the HTTP client, the login guard, SEO, snapshot
encoding, topic extraction. GitHub Actions runs typecheck, tests and a full
Next.js build on every push (`.github/workflows/ci.yml`).

## Three problems worth describing

**A missing temperature setting that looked like a rubric flaw.** The same
article came back in opposite bands at 90% confidence. A whole rubric revision
was designed, tested and discarded before the real cause surfaced. The lesson
was about diagnosis order, not rubrics.

**A pre-filter that must never drop political news.** Tuning it on accuracy
would have been the obvious move and the wrong one.

**A cost metric that was 13x wrong**, because failed batches were counted as
completed work. The number looked plausible for weeks.

## Differences from production

`src/lib/rubric-default.ts` here is a **placeholder**. In production it holds the
bootstrap rubric seeded into an empty database; that text is not published. This
costs nothing in transparency — the rubric that actually classifies articles is
the active database row, published in full at
[/rubrica](https://pontocego.app/rubrica). The placeholder keeps the project
type-checking; replace it before classifying anything.

`npx tsc --noEmit` passes on this tree as published.

## Licence

MIT. See [LICENSE](LICENSE).
