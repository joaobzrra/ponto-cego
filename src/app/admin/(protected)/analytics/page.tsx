import { sql } from "drizzle-orm";
import Link from "next/link";
import { db, tables } from "@/db";
import { BAND_LABEL } from "@/components/bias";
import { Sparkline } from "@/components/sparkline";
import type { Band } from "@/db/schema";
import { requireSection } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * First-party analytics dashboard (2026-07-14). Reads the raw events table
 * (≤90d windows; long-term trends will come from events_daily once it has
 * history). Bots are excluded everywhere; days bucket in America/Fortaleza,
 * matching the spend-ceiling day boundary.
 */

const TZ = "America/Fortaleza";

type WindowStats = {
  visitors: number;
  pageviews: number;
  clickouts: number;
  searches: number;
  feedbacks: number;
};

async function windowStats(since: Date): Promise<WindowStats> {
  const r = await db.execute(sql`
    select
      count(distinct session_id) filter (where type = 'pageview')::int as visitors,
      count(*) filter (where type = 'pageview')::int as pageviews,
      count(*) filter (where type = 'clickout')::int as clickouts,
      count(*) filter (where type = 'search')::int as searches,
      count(*) filter (where type = 'feedback')::int as feedbacks
    from ${tables.events}
    where not is_bot and created_at > ${since}
  `);
  return r.rows[0] as WindowStats;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

/** Local midnight (the server runs in the site's home timezone). */
function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div style={{ background: "var(--bg-inset)", borderRadius: 2, height: 8, minWidth: 120 }}>
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: "var(--text-faint)",
          borderRadius: 2,
        }}
      />
    </div>
  );
}

export default async function AdminAnalytics() {
  await requireSection("analytics");

  const [today, week, month, series, topPages, byOutlet, topArticles, byBand, topSearches, zeroSearches, referrers, utms] =
    await Promise.all([
      windowStats(todayStart()),
      windowStats(daysAgo(7)),
      windowStats(daysAgo(30)),
      db.execute(sql`
        select (created_at at time zone ${TZ})::date::text as day,
               count(*) filter (where type = 'pageview')::int as pageviews,
               count(distinct session_id) filter (where type = 'pageview')::int as visitors
        from ${tables.events}
        where not is_bot and created_at > ${daysAgo(30)}
        group by 1 order by 1
      `),
      db.execute(sql`
        select path, count(*)::int as n
        from ${tables.events}
        where not is_bot and type = 'pageview' and created_at > ${daysAgo(7)}
        group by path order by n desc limit 12
      `),
      db.execute(sql`
        select o.name, o.slug, count(*)::int as n
        from ${tables.events} e join ${tables.outlets} o on o.id = e.outlet_id
        where not e.is_bot and e.type = 'clickout' and e.created_at > ${daysAgo(7)}
        group by o.name, o.slug order by n desc limit 12
      `),
      db.execute(sql`
        select a.id, a.title, o.name as outlet, count(*)::int as n
        from ${tables.events} e
          join ${tables.articles} a on a.id = e.article_id
          join ${tables.outlets} o on o.id = a.outlet_id
        where not e.is_bot and e.type = 'clickout' and e.created_at > ${daysAgo(7)}
        group by a.id, a.title, o.name order by n desc limit 10
      `),
      db.execute(sql`
        select band, count(*)::int as n
        from ${tables.events}
        where not is_bot and type = 'clickout' and band is not null
          and created_at > ${daysAgo(7)}
        group by band order by n desc
      `),
      db.execute(sql`
        select query, count(*)::int as n, min(result_count)::int as min_results
        from ${tables.events}
        where not is_bot and type = 'search' and created_at > ${daysAgo(30)}
        group by query order by n desc limit 12
      `),
      db.execute(sql`
        select query, count(*)::int as n
        from ${tables.events}
        where not is_bot and type = 'search' and result_count = 0
          and created_at > ${daysAgo(30)}
        group by query order by n desc limit 12
      `),
      db.execute(sql`
        select referrer_host, count(*)::int as n
        from ${tables.events}
        where not is_bot and referrer_host is not null and created_at > ${daysAgo(30)}
        group by referrer_host order by n desc limit 12
      `),
      db.execute(sql`
        select coalesce(utm_source, '(sem source)') as source,
               coalesce(utm_campaign, '—') as campaign, count(*)::int as n
        from ${tables.events}
        where not is_bot and created_at > ${daysAgo(30)}
          and (utm_source is not null or utm_campaign is not null)
        group by 1, 2 order by n desc limit 12
      `),
    ]);

  const seriesRows = series.rows as Array<{ day: string; pageviews: number; visitors: number }>;
  const pageRows = topPages.rows as Array<{ path: string; n: number }>;
  const outletRows = byOutlet.rows as Array<{ name: string; slug: string; n: number }>;
  const articleRows = topArticles.rows as Array<{ id: number; title: string; outlet: string; n: number }>;
  const bandRows = byBand.rows as Array<{ band: string; n: number }>;
  const searchRows = topSearches.rows as Array<{ query: string; n: number; min_results: number }>;
  const zeroRows = zeroSearches.rows as Array<{ query: string; n: number }>;
  const refRows = referrers.rows as Array<{ referrer_host: string; n: number }>;
  const utmRows = utms.rows as Array<{ source: string; campaign: string; n: number }>;

  const maxPage = Math.max(1, ...pageRows.map((r) => r.n));
  const maxOutlet = Math.max(1, ...outletRows.map((r) => r.n));

  const statCard = (label: string, s: WindowStats) => (
    <div className="card stat">
      <div className="n">{s.visitors}</div>
      <div className="muted">{label}</div>
      <div className="muted" style={{ fontSize: "0.75rem", marginTop: "0.35rem" }}>
        {s.pageviews} views · {s.clickouts} cliques p/ veículo · {s.searches} buscas ·{" "}
        {s.feedbacks} votos
      </div>
    </div>
  );

  return (
    <>
      <h1 style={{ fontWeight: 400, marginTop: 0 }}>Analytics</h1>
      <p className="muted" style={{ marginTop: "-0.5rem" }}>
        Medição em primeira mão (events, sem bots) — sessões anônimas, sem IP, sem terceiros.
        Números grandes = visitantes únicos.
      </p>

      <div className="stat-row">
        {statCard("hoje", today)}
        {statCard("7 dias", week)}
        {statCard("30 dias", month)}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Últimos 30 dias</h2>
        <Sparkline
          days={seriesRows.map((r) => r.day.slice(8, 10) + "/" + r.day.slice(5, 7))}
          series={[
            { label: "pageviews", color: "var(--text-dim)", values: seriesRows.map((r) => r.pageviews) },
            { label: "visitantes", color: "var(--ok, #5da06d)", values: seriesRows.map((r) => r.visitors) },
          ]}
        />
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Funil (7 dias)</h2>
        <table>
          <tbody>
            <tr>
              <td>Pageviews</td>
              <td className="mono">{week.pageviews}</td>
            </tr>
            <tr>
              <td>Cartões de artigo vistos</td>
              <td className="mono">
                {pageRows.filter((r) => r.path.startsWith("/a/")).reduce((s, r) => s + r.n, 0)}
                <span className="muted"> (top 12 páginas)</span>
              </td>
            </tr>
            <tr>
              <td>Cliques para o veículo</td>
              <td className="mono">{week.clickouts}</td>
            </tr>
            <tr>
              <td>Votos de viés</td>
              <td className="mono">{week.feedbacks}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Páginas mais vistas (7 dias)</h2>
        <table>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.path}>
                <td className="mono" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis" }}>{r.path}</td>
                <td className="mono">{r.n}</td>
                <td><Bar value={r.n} max={maxPage} /></td>
              </tr>
            ))}
            {pageRows.length === 0 && <tr><td className="muted">Sem pageviews ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Cliques para veículos (7 dias)</h2>
        <table>
          <tbody>
            {outletRows.map((r) => (
              <tr key={r.slug}>
                <td>{r.name}</td>
                <td className="mono">{r.n}</td>
                <td><Bar value={r.n} max={maxOutlet} /></td>
              </tr>
            ))}
            {outletRows.length === 0 && <tr><td className="muted">Sem cliques ainda.</td></tr>}
          </tbody>
        </table>
        {bandRows.length > 0 && (
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            Por faixa:{" "}
            {bandRows.map((b) => `${BAND_LABEL[b.band as Band] ?? b.band} ${b.n}`).join(" · ")}
          </p>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontWeight: 400 }}>Artigos mais clicados (7 dias)</h2>
        <table>
          <tbody>
            {articleRows.map((r) => (
              <tr key={r.id}>
                <td style={{ maxWidth: 460, overflow: "hidden", textOverflow: "ellipsis" }}>
                  <Link href={`/a/${r.id}`}>{r.title}</Link>
                </td>
                <td className="muted">{r.outlet}</td>
                <td className="mono">{r.n}</td>
              </tr>
            ))}
            {articleRows.length === 0 && <tr><td className="muted">Sem cliques ainda.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="stat-row">
        <div className="card" style={{ flex: 1 }}>
          <h2 style={{ marginTop: 0, fontWeight: 400 }}>Buscas (30 dias)</h2>
          <table>
            <tbody>
              {searchRows.map((r) => (
                <tr key={r.query}>
                  <td className="mono">{r.query}</td>
                  <td className="mono">{r.n}</td>
                </tr>
              ))}
              {searchRows.length === 0 && <tr><td className="muted">Sem buscas ainda.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ flex: 1 }}>
          <h2 style={{ marginTop: 0, fontWeight: 400 }}>Buscas sem resultado</h2>
          <p className="muted" style={{ fontSize: "0.8rem" }}>
            O que os leitores procuram e não encontram — candidatos a novos veículos/tópicos.
          </p>
          <table>
            <tbody>
              {zeroRows.map((r) => (
                <tr key={r.query}>
                  <td className="mono">{r.query}</td>
                  <td className="mono">{r.n}</td>
                </tr>
              ))}
              {zeroRows.length === 0 && <tr><td className="muted">Nenhuma — bom sinal.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="stat-row">
        <div className="card" style={{ flex: 1 }}>
          <h2 style={{ marginTop: 0, fontWeight: 400 }}>Origens (30 dias)</h2>
          <table>
            <tbody>
              {refRows.map((r) => (
                <tr key={r.referrer_host}>
                  <td className="mono">{r.referrer_host}</td>
                  <td className="mono">{r.n}</td>
                </tr>
              ))}
              {refRows.length === 0 && <tr><td className="muted">Só tráfego direto até agora.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="card" style={{ flex: 1 }}>
          <h2 style={{ marginTop: 0, fontWeight: 400 }}>Campanhas (UTM, 30 dias)</h2>
          <table>
            <tbody>
              {utmRows.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{r.source}</td>
                  <td className="mono">{r.campaign}</td>
                  <td className="mono">{r.n}</td>
                </tr>
              ))}
              {utmRows.length === 0 && <tr><td className="muted">Nenhuma campanha ainda.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
