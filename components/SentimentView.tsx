"use client";

import { useState, type PointerEvent } from "react";
import { MIN_PER_HOUR, MOOD_LABEL, summarize, TOPIC_LABEL, verdict, type HourBucket, type MoodSplit } from "@/lib/sentiment";
import { MOODS, type Mood, type StreamsPayload, type Topic } from "@/lib/types";
import { ReactionCard, ScoringNotice, signed } from "./ReactionsView";
import { REACTION_LABEL } from "./shared";

const pct = (n: number, total: number) => (total === 0 ? 0 : (n / total) * 100);
const fmtPct = (n: number, total: number) => `${Math.round(pct(n, total))}%`;

/** One whole, split into the five moods: a tall segmented bar with shares printed where they fit. */
function MoodBar({ split }: { split: MoodSplit }) {
  return (
    <div className="moodbar" role="img" aria-label={MOODS.map((m) => `${MOOD_LABEL[m]} ${fmtPct(split.counts[m], split.total)}`).join(", ")}>
      {MOODS.map((m) =>
        split.counts[m] === 0 ? null : (
          <span
            key={m}
            className="seg"
            data-mood={m}
            style={{ flexGrow: split.counts[m] }}
            tabIndex={0}
            data-tip={`${MOOD_LABEL[m]}: ${split.counts[m]} (${fmtPct(split.counts[m], split.total)})`}
          >
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
 * A row of a diverging stacked bar, centred on neutral: negative moods grow
 * left from the centre line, positive right, neutral split across it. `scale`
 * is the largest one-side share across all rows, so rows compare on one axis.
 */
function DivergingBar({ split, scale, label }: { split: MoodSplit; scale: number; label: string }) {
  const c = split.counts;
  const t = split.total;
  const w = (n: number) => `${(pct(n, t) / scale) * 50}%`;
  const seg = (m: Mood, n: number, key: string) =>
    n === 0 ? null : (
      <span
        key={key}
        className="seg"
        data-mood={m}
        style={{ width: w(n) }}
        tabIndex={0}
        data-tip={`${label} · ${MOOD_LABEL[m]}: ${c[m]} (${fmtPct(c[m], t)})`}
      />
    );
  return (
    <div className="diverging" aria-hidden="true">
      <div className="half left">
        {seg("very-negative", c["very-negative"], "vn")}
        {seg("negative", c.negative, "n")}
        {seg("neutral", c.neutral / 2, "zl")}
      </div>
      <div className="half right">
        {seg("neutral", c.neutral / 2, "zr")}
        {seg("positive", c.positive, "p")}
        {seg("very-positive", c["very-positive"], "vp")}
      </div>
    </div>
  );
}

const sideShare = (s: MoodSplit) =>
  Math.max(
    pct(s.counts["very-negative"] + s.counts.negative + s.counts.neutral / 2, s.total),
    pct(s.counts["very-positive"] + s.counts.positive + s.counts.neutral / 2, s.total),
  );

function MoodTable({ rows }: { rows: { label: string; split: MoodSplit }[] }) {
  return (
    <details className="table-view">
      <summary>Show as table</summary>
      <table>
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

const W = 720;
const H = 230;
const PAD = { top: 16, right: 16, bottom: 28, left: 44 };
const VOL_H = 46;

const hourLabel = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric" });

/** Net mood per hour over the last 24 hours: one line against a zero baseline, volume beneath on its own scale. */
function Timeline({ hours }: { hours: HourBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (hours.length <= 1 ? innerW / 2 : (i / (hours.length - 1)) * innerW);
  const y = (net: number) => PAD.top + ((100 - net) / 200) * innerH;
  const maxVol = Math.max(1, ...hours.map((h) => h.total));

  // Break the line where an hour has no scored reactions.
  const runs: { i: number; net: number }[][] = [];
  hours.forEach((h, i) => {
    if (h.net === null || h.total < MIN_PER_HOUR) {
      runs.push([]);
      return;
    }
    if (runs.length === 0) runs.push([]);
    runs[runs.length - 1].push({ i, net: h.net });
  });

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = Math.round(((px - PAD.left) / innerW) * (hours.length - 1));
    setHover(Math.max(0, Math.min(hours.length - 1, i)));
  };

  const h = hover === null ? null : hours[hover];
  return (
    <div className="timeline">
      <svg
        viewBox={`0 0 ${W} ${H + VOL_H}`}
        role="img"
        aria-label="Net mood per hour over the last 24 hours"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {[100, 50, 0, -50, -100].map((v) => (
          <g key={v}>
            <line className={v === 0 ? "axis zero" : "axis"} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="tick" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
              {v > 0 ? `+${v}` : v}
            </text>
          </g>
        ))}
        {hours.map((b, i) =>
          i % 4 === 0 ? (
            <text key={b.start} className="tick" x={x(i)} y={H - 8} textAnchor="middle">
              {hourLabel(b.start)}
            </text>
          ) : null,
        )}
        {runs
          .filter((r) => r.length > 0)
          .map((run) => (
            <polyline key={run[0].i} className="line" points={run.map((p) => `${x(p.i)},${y(p.net)}`).join(" ")} />
          ))}
        {runs.flat().map((p) => (
          <circle key={p.i} className="dot" cx={x(p.i)} cy={y(p.net)} r={hover === p.i ? 6 : 4} />
        ))}
        {/* Volume strip: its own small scale, labelled, not a second axis on the line. */}
        {hours.map((b, i) => {
          const bh = (b.total / maxVol) * (VOL_H - 14);
          return b.total === 0 ? null : (
            <rect key={b.start} className="vol" x={x(i) - 6} y={H + VOL_H - bh} width={12} height={bh} rx={2} />
          );
        })}
        <text className="tick" x={PAD.left - 8} y={H + 14} textAnchor="end">
          {maxVol}
        </text>
        {hover !== null ? <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H + VOL_H} /> : null}
      </svg>
      <div className="timeline-key">
        <span>Net mood (% positive minus % negative)</span>
        <span>Bars: reactions scored that hour (top of scale: {maxVol})</span>
        <span>Hours with fewer than {MIN_PER_HOUR} show volume only</span>
      </div>
      {h ? (
        <div className="tooltip" style={{ left: `${(x(hover as number) / W) * 100}%` }}>
          <strong>{h.net === null ? "No scored reactions" : h.total < MIN_PER_HOUR ? "Too few to call" : `${signed(h.net)} net`}</strong>
          <span>
            {hourLabel(h.start)} · {h.total} {h.total === 1 ? "reaction" : "reactions"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function SentimentView({ payload, now }: { payload: StreamsPayload | null; now: number }) {
  const [topic, setTopic] = useState<Topic | null>(null);
  const reactions = payload?.reactions ?? [];
  const loaded = payload ? payload.snapshot || payload.sections.includes("reactions") : false;
  const sum = summarize(reactions, now || Date.now());
  const quotes = topic ? summarize(reactions.filter((r) => r.topic === topic), now || Date.now()) : sum;
  const platformRows = sum.byPlatform.filter((p) => p.total > 0);
  const platformScale = Math.max(1, ...platformRows.map(sideShare));
  const hoursWithData = sum.hours.filter((b) => b.total >= MIN_PER_HOUR).length;

  if (!loaded || sum.overall.total === 0) {
    return (
      <div className="sentiment">
        {payload ? <ScoringNotice payload={payload} /> : null}
        <div className="empty">
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
          <h2 id="mood-title" className="sr-only">
            Overall mood
          </h2>
          <div className="hero-figure">{signed(o.net)}</div>
          <div className="hero-verdict">{verdict(o.net)}</div>
          <p className="hero-caption">
            Net mood across {o.total} scored reactions: {fmtPct(o.counts.positive + o.counts["very-positive"], o.total)} positive,{" "}
            {fmtPct(o.counts.negative + o.counts["very-negative"], o.total)} negative.
          </p>
        </div>
        <div className="hero-split">
          <MoodBar split={o} />
          <MoodLegend />
        </div>
      </section>

      <div className="sentiment-grid">
        <section className="panel" aria-labelledby="platform-title">
          <h2 id="platform-title" className="panel-title">
            Mood by platform
          </h2>
          <p className="panel-sub">Negative to the left of the line, positive to the right; neutral sits across it.</p>
          <div className="diverging-list">
            {platformRows.map((p) => (
              <div className="diverging-row" key={p.platform} data-platform={p.platform}>
                <span className="drow-label">
                  <i className="dot" />
                  {REACTION_LABEL[p.platform]} <small>{p.total}</small>
                </span>
                <DivergingBar split={p} scale={platformScale} label={REACTION_LABEL[p.platform]} />
                <span className="drow-net">{signed(p.net)}</span>
              </div>
            ))}
          </div>
          <MoodLegend />
          <MoodTable rows={platformRows.map((p) => ({ label: REACTION_LABEL[p.platform], split: p }))} />
        </section>

        <section className="panel" aria-labelledby="topic-title">
          <h2 id="topic-title" className="panel-title">
            What people talk about
          </h2>
          <p className="panel-sub">Most-discussed first. Click a topic to see its loudest reactions below.</p>
          <ul className="topic-list">
            {sum.byTopic.map((t) => (
              <li key={t.topic}>
                <button type="button" aria-pressed={topic === t.topic} onClick={() => setTopic(topic === t.topic ? null : t.topic)}>
                  <span className="topic-name">{TOPIC_LABEL[t.topic]}</span>
                  <span className="topic-count">{t.total}</span>
                  <span className="topic-bar" aria-hidden="true">
                    {MOODS.map((m) =>
                      t.counts[m] === 0 ? null : <span key={m} className="seg" data-mood={m} style={{ flexGrow: t.counts[m] }} />,
                    )}
                  </span>
                  <span className="topic-net">{signed(t.net)}</span>
                </button>
              </li>
            ))}
          </ul>
          <MoodTable rows={sum.byTopic.map((t) => ({ label: TOPIC_LABEL[t.topic], split: t }))} />
        </section>
      </div>

      <section className="panel" aria-labelledby="time-title">
        <h2 id="time-title" className="panel-title">
          Mood over the last 24 hours
        </h2>
        <p className="panel-sub">
          By when each post or comment was made. {sum.outsideWindow > 0 ? `${sum.outsideWindow} older reactions (mostly top Instagram and LinkedIn posts) are left out.` : ""}
        </p>
        {hoursWithData >= 2 ? (
          <>
            <Timeline hours={sum.hours} />
            <MoodTable
              rows={sum.hours
                .filter((b) => b.total > 0)
                .map((b) => ({ label: `${hourLabel(b.start)}`, split: b }))}
            />
          </>
        ) : (
          <div className="empty">Not enough reactions from the last 24 hours yet. Load more on the Reactions tab.</div>
        )}
      </section>

      <div className="sentiment-grid">
        <section className="panel" aria-labelledby="love-title">
          <h2 id="love-title" className="panel-title">
            Loudest love{topic ? ` · ${TOPIC_LABEL[topic]}` : ""}
          </h2>
          <p className="panel-sub">Most-liked positive and very positive reactions.</p>
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
          <p className="panel-sub">Most-liked negative and very negative reactions.</p>
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
