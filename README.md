<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/wordmark-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/wordmark-light.png">
  <img src="assets/wordmark-light.png" alt="Ponto Cego" width="340">
</picture>

### A Brazilian news aggregator that classifies political bias<br>per _article_, not per outlet — and shows its work.

<p>
<img alt="Next.js 15" src="https://img.shields.io/badge/Next.js-15.5-000000?style=flat-square&logo=nextdotjs&logoColor=white">
<img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black">
<img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-~22k%20LOC-3178C6?style=flat-square&logo=typescript&logoColor=white">
<img alt="PostgreSQL + pgvector" src="https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?style=flat-square&logo=postgresql&logoColor=white">
<img alt="19 test suites" src="https://img.shields.io/badge/tests-19%20suites-2DC6BB?style=flat-square">
<img alt="Licence MIT" src="https://img.shields.io/badge/licence-MIT-F5A623?style=flat-square">
</p>

<a href="https://pontocego.app"><b>pontocego.app →</b></a>

</div>

---

This repository is a **public extract** of the production codebase: application
source, the test suite, the CI pipeline and the design documents. Deployment
configuration and operational runbooks are not included.

## The problem

Bias ratings normally get attached to publications. *This outlet is left, that
one is right.* That is convenient and mostly useless: it tells you nothing about
the article in front of you, it cannot notice an outlet breaking its own
pattern, and it asks you to trust a label with no reasoning attached.

Ponto Cego classifies each article on its own, publishes the rubric it judges
by, and shows the model's confidence and reasoning next to every verdict.

**You are meant to be able to disagree with it specifically.**

## Four rules, enforced in code

<table>
<tr><td width="32%"><b>Full article text is never stored</b></td><td>
The classifier fetches the article at classification time, reads it in memory,
and writes only the structured result. Nothing durable, nothing indexed, nothing
displayed. <code>robots.txt</code> is honoured on every fetch, and a failed
fetch degrades to title-plus-excerpt with the article flagged low-confidence
input rather than silently guessed.<br>
<sub><code>src/lib/fulltext.ts:1-10</code></sub>
</td></tr>
<tr><td><b>Low confidence is shown, not hidden</b></td><td>
Below <code>0.65</code> confidence a banded article is publicly marked
<i>"Viés em Debate"</i> — bias under debate. An honesty signal that doubles as
an invitation to vote. Non-political and unclassified articles never show it.<br>
<sub><code>src/components/debate-badge.tsx:7</code></sub>
</td></tr>
<tr><td><b>The rubric is public and versioned</b></td><td>
The exact text the model receives is published at
<a href="https://pontocego.app/rubrica">/rubrica</a>, editable and audited
without a deploy. If you think the rubric is wrong, you can read the thing you
disagree with.
</td></tr>
<tr><td><b>Reasoning ships with the verdict</b></td><td>
Every classification carries its confidence and its stated reasoning.
</td></tr>
</table>

## How it works

```
RSS feeds ─► dedup ─► NC pre-gate ─► paid classifier ─► clustering ─► reader
                      local BERTimbau   DeepSeek V3.2    local bge-m3
```

**The pre-gate is the interesting part.** Most articles in a general news feed
are not political, and paying a frontier model to say so is the largest
avoidable cost in the system. A locally fine-tuned BERTimbau classifier
(**ROC-AUC 0.94**) runs first; anything scoring below `P(política) = 0.05` never
reaches the paid model.

That removes **~44% of paid calls**.

The threshold is tuned on **leakage, not accuracy** — wrongly dropping a
political article costs far more than wrongly paying for a non-political one.

<sub>`src/worker/nc-gate.ts:6,23,25` — threshold is env-configurable</sub>

Clustering uses local `bge-m3` embeddings to group articles covering the same
event, so a reader sees how one story was framed across outlets instead of the
same story twenty times.

## Stack

TypeScript throughout, ~22k lines. Next.js 15.5 / React 19, PostgreSQL with
pgvector, Drizzle ORM over **26 tables**, and a separate Node worker for
ingestion and classification. Docker on a VPS behind Caddy. Python appears only
in the model-training scripts.

## Tests and CI

19 test suites — the classifier gate, blind-spot detection, newsletter rendering
rules, SSRF protection in the HTTP client, the login guard, SEO, snapshot
encoding, topic extraction. GitHub Actions runs typecheck, tests and a full
Next.js build on every push (`.github/workflows/ci.yml`).

## Three problems worth describing

<details>
<summary><b>A missing temperature setting that looked like a rubric flaw</b></summary>

The same article came back in opposite bands at 90% confidence. A whole rubric
revision was designed, tested and discarded before the real cause surfaced. The
lesson was about diagnosis order, not rubrics.
</details>

<details>
<summary><b>A pre-filter that must never drop political news</b></summary>

Tuning it on accuracy would have been the obvious move and the wrong one. The
asymmetry between the two error types is the whole design.
</details>

<details>
<summary><b>A cost metric that was 13x wrong</b></summary>

Failed batches were being counted as completed work. The number looked plausible
for weeks.
</details>

## Differences from production

> [!NOTE]
> `src/lib/rubric-default.ts` here is a **placeholder**. In production it holds
> the bootstrap rubric seeded into an empty database; that text is not
> published.

This costs nothing in transparency — the rubric that actually classifies
articles is the active database row, published in full at
[/rubrica](https://pontocego.app/rubrica). The placeholder keeps the project
type-checking; replace it before classifying anything.

`npx tsc --noEmit` passes on this tree as published.

## Licence

MIT. See [LICENSE](LICENSE).
