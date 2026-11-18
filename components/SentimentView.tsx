"use client";

import { useState } from "react";
import { MOOD_LABEL, SMALL_SAMPLE, summarize, TOPIC_LABEL, verdict, type MoodSplit, type Timeline, type TimeBucket } from "@/lib/sentiment";
import { ago } from "@/lib/format";
import { MOODS, reactionSourceId, type Mood, type ReactionPlatform, type SourceId, type SourceStatus, type StreamsPayload, type Topic } from "@/lib/types";
import { ReactionCard, ScoringNotice, signed } from "./ReactionsView";
import { REACTION_LABEL } from "./shared";

const pct = (n: number, total: number) => (total === 0 ? 0 : (n / total) * 100);
const fmtPct = (n: number, total: number) => `${Math.round(pct(n, total))}%`;
const positive = (s: MoodSplit) => s.counts.positive + s.counts["very-positive"];
const negative = (s: MoodSplit) => s.counts.negative + s.counts["very-negative"];

/** "12 positive, 5 neutral, 3 negative": every count, for tooltips and accessible names. */
const breakdown = (s: MoodSplit) => `${positive(s)} positive, ${s.counts.neutral} neutral, ${negative(s)} negative`;

/** One whole, split into the five moods: a tall segmented bar with shares printed where they fit. */
function MoodBar({ split }: { split: MoodSplit }) {
  return (
    <div className="moodbar" role="img" aria-label={MOODS.map((m) => `${MOOD_LABEL[m]} ${fmtPct(split.counts[m], split.total)}`).join(", ")}>
      {MOODS.map((m) =>
        split.counts[m] === 0 ? null : (
          <span key={m} className="seg" data-mood={m} style={{ flexGrow: split.counts[m] }} title={`${MOOD_LABEL[m]}: ${split.counts[m]}`}>
            {pct(split.counts[m], split.total) >= 8 ? fmtPct(split.counts[m], split.total) : null}
          </span>
        ),
      )}
    </div>
  );
}

function MoodLegend() {
  return (
    <ul className="mood-legend" aria-label="Legend">
      {MOODS.map((m) => (
        <li key={m}>
          <i data-mood={m} /> {MOOD_LABEL[m]}
        </li>
      ))}
    </ul>
  );
}

/**
 * A diverging stacked bar centred on neutral: negative moods grow left from
 * the centre line, positive right, neutral split across it. `scale` is the
 * largest share each side reaches across all rows, so every row reads on one
 * axis and the longest bar on each side reaches its end of the track.
 */
function DivergingBar({ split, left, right }: { split: MoodSplit; left: number; right: number }) {
  const c = split.counts;
  const seg = (m: Mood, n: number, key: string, side: number) =>
    n === 0 ? null : <span key={key} className="seg" data-mood={m} style={{ width: `${(pct(n, split.total) / side) * 100}%` }} />;
  return (
    <div className="diverging" aria-hidden="true" style={{ gridTemplateColumns: `${left}fr ${right}fr` }}>
      <div className="half left">
        {seg("very-negative", c["very-negative"], "vn", left)}
        {seg("negative", c.negative, "n", left)}
        {seg("neutral", c.neutral / 2, "zl", left)}
      </div>
      <div className="half right">
        {seg("neutral", c.neutral / 2, "zr", right)}
        {seg("positive", c.positive, "p", right)}
        {seg("very-positive", c["very-positive"], "vp", right)}
      </div>
    </div>
  );
}

const leftShare = (s: MoodSplit) => pct(negative(s) + s.counts.neutral / 2, s.total);
const rightShare = (s: MoodSplit) => pct(positive(s) + s.counts.neutral / 2, s.total);

function MoodTable({ caption, rows }: { caption: string; rows: { label: string; split: MoodSplit }[] }) {
  return (
    <details className="table-view">
      <summary>Show as table</summary>
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Group</th>
            {MOODS.map((m) => (
              <th key={m} scope="col">
                {MOOD_LABEL[m]}
              </th>
            ))}
            <th scope="col">Scored</th>
            <th scope="col">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              {MOODS.map((m) => (
                <td key={m}>{r.split.counts[m]}</td>
              ))}
              <td>{r.split.total}</td>
              <td>{signed(r.split.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

const clock = (t: number, withMinutes: boolean) =>
  new Date(t).toLocaleTimeString([], withMinutes ? { hour: "numeric", minute: "2-digit" } : { hour: "numeric" });
const bucketLabel = (b: TimeBucket, ms: number) => {
  const withMinutes = ms < 60 * 60 * 1000;
  return `${clock(b.start, withMinutes)} – ${clock(b.end, withMinutes)}`;
};

/** How each reaction feed picks what it returns: platform comparisons only make sense next to this. */
const SAMPLE_RULE: Record<ReactionPlatform, string> = {
  x: "Posts since yesterday with 25+ likes",
  reddit: "r/GTA6 front page",
  youtube: "Top comments on today's most-watched uploads",
  instagram: "Top #gta6 posts, any age",
  linkedin: "Public posts matching “GTA 6”",
};

/** Round up to a clean, even axis value just above n (2, 4, 6, 8, 10, 12, 16, 20, 30, 40...), so its half is whole too. */
function niceCeil(n: number): number {
  if (n <= 2) return 2;
  const p = 10 ** Math.floor(Math.log10(n));
  return [1, 1.2, 1.6, 2, 3, 4, 6, 8, 10].map((m) => Math.round(m * p)).find((v) => v >= n && v % 2 === 0) ?? 10 * p;
}

/**
 * Mood over time as diverging columns: positive reactions stack up from the
 * line, negative ones down, neutral split across it. Column height is volume,
 * so a quiet hour can't look as loud as a busy one, and empty buckets just
 * leave a gap. Each column is focusable and names its own counts.
 */
function MoodColumns({ tl }: { tl: Timeline }) {
  const sides = tl.buckets.map((b) => ({ up: positive(b) + b.counts.neutral / 2, down: negative(b) + b.counts.neutral / 2 }));
  const max = niceCeil(Math.max(1, ...sides.flatMap((s) => [s.up, s.down])));
  const h = (n: number) => `${(n / max) * 100}%`;
  const labelEvery = Math.max(1, Math.ceil(tl.buckets.length / 6));
  const withMinutes = tl.bucketMs < 60 * 60 * 1000;
  const last = tl.buckets.length - 1;

  return (
    <div className="cols-chart">
      <div className="cols-axis" aria-hidden="true">
        <span>{max}</span>
        <span>{max / 2}</span>
        <span>0</span>
        <span>{max / 2}</span>
        <span>{max}</span>
      </div>
      <div className="cols-plot" role="group" aria-label="Reactions per time bucket. Focus a column for its counts.">
        {tl.buckets.map((b, i) => {
          const tip = b.total === 0 ? `${bucketLabel(b, tl.bucketMs)}: no scored reactions` : `${bucketLabel(b, tl.bucketMs)}: net ${signed(b.net)}, ${breakdown(b)}`;
          return (
            <div
              key={b.start}
              className="col"
              role="img"
              tabIndex={b.total === 0 ? -1 : 0}
              aria-label={tip}
              data-tip={b.total === 0 ? undefined : tip}
              data-tip-align={i < 2 ? "start" : i > last - 2 ? "end" : undefined}
            >
              <div className="col-half up">
                {b.counts["very-positive"] ? <span className="seg" data-mood="very-positive" style={{ height: h(b.counts["very-positive"]) }} /> : null}
                {b.counts.positive ? <span className="seg" data-mood="positive" style={{ height: h(b.counts.positive) }} /> : null}
                {b.counts.neutral ? <span className="seg" data-mood="neutral" style={{ height: h(b.counts.neutral / 2) }} /> : null}
              </div>
              <div className="col-half down">
                {b.counts.neutral ? <span className="seg" data-mood="neutral" style={{ height: h(b.counts.neutral / 2) }} /> : null}
                {b.counts.negative ? <span className="seg" data-mood="negative" style={{ height: h(b.counts.negative) }} /> : null}
                {b.counts["very-negative"] ? <span className="seg" data-mood="very-negative" style={{ height: h(b.counts["very-negative"]) }} /> : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="cols-x" aria-hidden="true">
        {tl.buckets.map((b, i) => (
          <span key={b.start}>
            {i % labelEvery === 0 || (i === last && last % labelEvery >= Math.ceil(labelEvery / 2)) ? clock(b.start, withMinutes) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SentimentView({
  payload,
  now,
  statuses,
}: {
  payload: StreamsPayload | null;
  now: number;
  statuses: Map<SourceId, SourceStatus>;
}) {
  const [topic, setTopic] = useState<Topic | null>(null);
  const reactions = payload?.reactions ?? [];
  const loaded = payload ? payload.sections.includes("reactions") : false;
  const clockNow = now || Date.now();
  const sum = summarize(reactions, clockNow);
  const quotes = topic ? summarize(reactions.filter((r) => r.topic === topic), clockNow) : sum;
  const platformRows = sum.byPlatform.filter((p) => p.total > 0);
  const leftMax = Math.max(1, ...platformRows.map(leftShare));
  const rightMax = Math.max(1, ...platformRows.map(rightShare));
  const topTopic = Math.max(1, ...sum.byTopic.map((t) => t.total));
  const tl = sum.timeline;
  const inWindow = tl.buckets.reduce((n, b) => n + b.total, 0);
  const cov = sum.coverage;

  if (!loaded || sum.overall.total === 0) {
    return (
      <div className="sentiment">
        {payload ? <ScoringNotice payload={payload} /> : null}
        <div className="empty">
          <i className="spinner" aria-hidden="true" />
          {loaded && reactions.length > 0
            ? "Reactions are in. Scoring the first batch takes about 10 seconds."
            : "Pulling reactions and scoring them. About 30 seconds the first time."}
        </div>
      </div>
    );
  }

  const o = sum.overall;
  return (
    <div className="sentiment">
      {payload ? <ScoringNotice payload={payload} /> : null}

      <section className="panel hero-panel" aria-labelledby="mood-title">
        <div className="hero">
          <p className="script">Street word</p>
          <h2 id="mood-title" className="hero-title">
            Mood of {o.total} sampled reactions
          </h2>
          <p className="hero-caption">
            {cov.counted} counted of {cov.loaded} loaded
            {cov.offTopic ? ` · ${cov.offTopic} not about GTA VI, left out` : ""}
            {cov.unscored ? ` · ${cov.unscored} not scored yet` : ""}.
          </p>
          <p className="hero-caption">
            Each reaction counts once, whatever its likes. Moods come from an AI model reading each post, and haven't been checked
            against human labels. Read this as the mood of what the feeds returned, not of everyone.
          </p>
          {o.total < SMALL_SAMPLE ? <p className="hero-warning">Small sample: a few posts move these numbers a lot.</p> : null}
        </div>
        <div className="hero-split">
          <MoodBar split={o} />
          <MoodLegend />
          <div className="hero-stats">
            <div>
              <span className="hero-stat">{fmtPct(positive(o), o.total)}</span>
              <span className="stat-label">Positive</span>
            </div>
            <div>
              <span className="hero-stat">{fmtPct(o.counts.neutral, o.total)}</span>
              <span className="stat-label">Neutral</span>
            </div>
            <div>
              <span className="hero-stat">{fmtPct(negative(o), o.total)}</span>
              <span className="stat-label">Negative</span>
            </div>
            <div title="Share positive minus share negative, -100 to +100. 50 positive and 50 negative score 0, the same as all neutral.">
              <span className="hero-stat">{signed(o.net)}</span>
              <span className="stat-label">Net · {verdict(o.net)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="panel" aria-labelledby="time-title">
        <h2 id="time-title" className="panel-title">
          Mood over time
        </h2>
        <p className="panel-sub">
          Counted reactions by the hour they were posted. Positive stack up, negative down, neutral sits across the line. This
          shows what the feeds returned for each hour, so loading more pages can change it.
        </p>
        <p className="panel-sub coverage">
          {inWindow} in the last 24 hours
          {tl.approximate ? ` · ${tl.approximate} with approximate times (YouTube shows "3 hours ago")` : ""}
          {tl.older ? ` · ${tl.older} older, left out` : ""}
          {tl.untimed ? ` · ${tl.untimed} without a time, left out` : ""}
        </p>
        {inWindow >= 3 ? (
          <>
            <MoodColumns tl={tl} />
            <MoodLegend />
            <MoodTable
              caption="Reactions per time bucket, by mood"
              rows={tl.buckets.filter((b) => b.total > 0).map((b) => ({ label: bucketLabel(b, tl.bucketMs), split: b }))}
            />
          </>
        ) : (
          <div className="empty small">Not enough recent reactions yet. Load more on the Reactions tab.</div>
        )}
      </section>

      <div className="sentiment-grid">
        <section className="panel" aria-labelledby="platform-title">
          <h2 id="platform-title" className="panel-title">
            Mood by platform
          </h2>
          <p className="panel-sub">
            Negative to the left of the line, positive to the right. Each platform is sampled its own way, so compare with care.
          </p>
          <ul className="diverging-list">
            {platformRows.map((p) => {
              const fetched = statuses.get(reactionSourceId(p.platform))?.fetchedAt ?? null;
              return (
              <li className="diverging-row" key={p.platform} data-platform={p.platform}>
                <span className="drow-label">
                  <span className="drow-name">
                    <i className="dot" aria-hidden="true" />
                    {REACTION_LABEL[p.platform]}
                  </span>
                  <small className="drow-rule">
                    {SAMPLE_RULE[p.platform]} · {p.total} counted{p.total < 15 ? " · small sample" : ""}
                    {fetched ? ` · ${ago(fetched, now)}` : ""}
                  </small>
                </span>
                <span className="drow-side neg">{fmtPct(negative(p), p.total)}</span>
                <DivergingBar split={p} left={leftMax} right={rightMax} />
                <span className="drow-side pos">{fmtPct(positive(p), p.total)}</span>
                <span className="drow-net">{signed(p.net)}</span>
                <span className="sr-only">
                  {REACTION_LABEL[p.platform]}: {breakdown(p)}
                </span>
              </li>
              );
            })}
          </ul>
          <MoodLegend />
          <MoodTable caption="Mood by platform" rows={platformRows.map((p) => ({ label: REACTION_LABEL[p.platform], split: p }))} />
        </section>

        <section className="panel" aria-labelledby="topic-title">
          <h2 id="topic-title" className="panel-title">
            What people talk about
          </h2>
          <p className="panel-sub">Bar length is how often a topic comes up; colour is its mood. Pick one to filter the reactions below.</p>
          <ul className="topic-list">
            {sum.byTopic.map((t) => (
              <li key={t.topic}>
                <button
                  type="button"
                  aria-pressed={topic === t.topic}
                  onClick={() => setTopic(topic === t.topic ? null : t.topic)}
                  aria-label={`${TOPIC_LABEL[t.topic]}: ${t.total} reactions, net ${signed(t.net)}, ${breakdown(t)}`}
                >
                  <span className="topic-name">{TOPIC_LABEL[t.topic]}</span>
                  <span className="topic-track">
                    <span className="topic-bar" style={{ width: `${(t.total / topTopic) * 100}%` }}>
                      {MOODS.map((m) => (t.counts[m] === 0 ? null : <span key={m} className="seg" data-mood={m} style={{ flexGrow: t.counts[m] }} />))}
                    </span>
                    <span className="topic-count">{t.total}</span>
                  </span>
                  <span className="topic-net">{signed(t.net)}</span>
                </button>
              </li>
            ))}
          </ul>
          <MoodTable caption="Mood by topic" rows={sum.byTopic.map((t) => ({ label: TOPIC_LABEL[t.topic], split: t }))} />
        </section>
      </div>

      <div className="sentiment-grid">
        <section className="panel" aria-labelledby="love-title">
          <h2 id="love-title" className="panel-title">
            Loudest love{topic ? ` · ${TOPIC_LABEL[topic]}` : ""}
          </h2>
          <p className="panel-sub">Most-liked positive reactions.</p>
          {quotes.loudestLove.length === 0 ? (
            <div className="empty small">None yet.</div>
          ) : (
            <div className="quote-list">
              {quotes.loudestLove.map((r) => (
                <ReactionCard key={r.id} reaction={r} now={now} />
              ))}
            </div>
          )}
        </section>
        <section className="panel" aria-labelledby="gripe-title">
          <h2 id="gripe-title" className="panel-title">
            Loudest gripes{topic ? ` · ${TOPIC_LABEL[topic]}` : ""}
          </h2>
          <p className="panel-sub">Most-liked negative reactions.</p>
          {quotes.loudestGripes.length === 0 ? (
            <div className="empty small">None yet.</div>
          ) : (
            <div className="quote-list">
              {quotes.loudestGripes.map((r) => (
                <ReactionCard key={r.id} reaction={r} now={now} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
