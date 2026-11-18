"use client";

import { useState } from "react";
import { ago, compactCount } from "@/lib/format";
import { POST_SORTS, sortPosts, type PostSort } from "@/lib/posts";
import { MOOD_LABEL, split, TOPIC_LABEL, verdict } from "@/lib/sentiment";
import {
  REACTION_PLATFORMS,
  reactionSourceId,
  TOPICS,
  type Reaction,
  type ReactionPlatform,
  type SourceId,
  type SourceStatus,
  type StreamsPayload,
  type Topic,
} from "@/lib/types";
import { AutoUpdate, Avatar, Feeds, LoadMore, REACTION_LABEL, Row } from "./shared";

type MoodFilter = "all" | "positive" | "neutral" | "negative" | "off-topic";
const MOOD_FILTERS: { id: MoodFilter; label: string }[] = [
  { id: "all", label: "Any mood" },
  { id: "positive", label: "Positive" },
  { id: "neutral", label: "Neutral" },
  { id: "negative", label: "Negative" },
  { id: "off-topic", label: "Not about GTA VI" },
];

/** Off-topic reactions get no mood group: they are left out of every mood figure. */
const moodGroup = (r: Reaction): MoodFilter | null =>
  r.mood === null
    ? null
    : r.topic === "off-topic"
      ? "off-topic"
      : r.mood.endsWith("positive")
        ? "positive"
        : r.mood.endsWith("negative")
          ? "negative"
          : "neutral";

export function signed(n: number | null): string {
  if (n === null) return "--";
  return n > 0 ? `+${n}` : String(n);
}

export function ReactionCard({ reaction: r, now }: { reaction: Reaction; now: number }) {
  const stats = [
    r.likes ? `${compactCount(r.likes)} ${r.platform === "reddit" ? "points" : "likes"}` : null,
    r.comments ? `${compactCount(r.comments)} ${r.kind === "comment" || r.platform === "x" ? "replies" : "comments"}` : null,
    r.views ? `${compactCount(r.views)} views` : null,
  ].filter(Boolean);
  return (
    <a className="post reaction" data-platform={r.platform} href={r.url} target="_blank" rel="noreferrer">
      <div className="post-head">
        <Avatar src={r.avatar} name={r.author} className="post-avatar" />
        <div className="post-who">
          <span className="post-author">{r.author}</span>
          <span className="post-meta">{[r.handle, r.context, ago(r.createdAt, now)].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="chip platform">{REACTION_LABEL[r.platform]}</span>
      </div>
      <p className="post-text">{r.text}</p>
      <div className="reaction-foot">
        {r.topic === "off-topic" ? (
          <span className="mood off-topic" title="Not about GTA VI: left out of every mood figure">
            Not about GTA VI
          </span>
        ) : r.mood ? (
          <span className="mood" data-mood={r.mood}>
            {MOOD_LABEL[r.mood]}
          </span>
        ) : (
          <span className="mood pending">Scoring</span>
        )}
        {r.topic && r.topic !== "off-topic" ? <span className="tag">{TOPIC_LABEL[r.topic]}</span> : null}
        {stats.length > 0 ? <span className="post-stats">{stats.join(" · ")}</span> : null}
      </div>
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export function ScoringNotice({ payload }: { payload: StreamsPayload }) {
  const { scoring } = payload;
  if (scoring.pending > 0 || scoring.running) {
    return (
      <div className="notice scoring" role="status">
        <span>
          <i className="spinner" /> <b>Scoring sentiment.</b> {scoring.pending} of {scoring.scored + scoring.pending} reactions
          left, 15 at a time through <code>{scoring.tool}</code>.
        </span>
      </div>
    );
  }
  if (scoring.error) {
    return (
      <div className="notice bad">
        <span>
          <b>Scoring stopped.</b> {scoring.error}
        </span>
      </div>
    );
  }
  return null;
}

export function ReactionsView({
  payload,
  now,
  statuses,
  loadingMore,
  autoMore,
  nextAutoAt,
}: {
  payload: StreamsPayload | null;
  now: number;
  statuses: Map<SourceId, SourceStatus>;
  loadingMore: SourceId[];
  autoMore: boolean;
  nextAutoAt: number | null;
}) {
  const [platform, setPlatform] = useState<ReactionPlatform | "all">("all");
  const [mood, setMood] = useState<MoodFilter>("all");
  const [topic, setTopic] = useState<Topic | "all">("all");
  const [sort, setSort] = useState<PostSort>("newest");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const reactions = payload?.reactions ?? [];
  const loaded = payload ? payload.sections.includes("reactions") : false;
  const needle = query.trim().toLowerCase();
  const searched = needle
    ? reactions.filter((r) => r.author.toLowerCase().includes(needle) || r.text.toLowerCase().includes(needle))
    : reactions;

  const platformCounts = Object.fromEntries(REACTION_PLATFORMS.map((p) => [p, 0])) as Record<ReactionPlatform, number>;
  for (const r of searched) platformCounts[r.platform] += 1;
  const inPlatform = searched.filter((r) => platform === "all" || r.platform === platform);
  const moodCounts: Record<MoodFilter, number> = { all: inPlatform.length, positive: 0, neutral: 0, negative: 0, "off-topic": 0 };
  for (const r of inPlatform) {
    const g = moodGroup(r);
    if (g) moodCounts[g] += 1;
  }
  const visible = sortPosts(
    inPlatform.filter((r) => (mood === "all" || moodGroup(r) === mood) && (topic === "all" || r.topic === topic)),
    sort,
  );
  const mix = split(inPlatform);
  const filtered = platform !== "all" || mood !== "all" || topic !== "all" || needle !== "";

  return (
    <div className="layout">
      <aside className={filtersOpen ? "menu open" : "menu"} aria-label="Reaction filters">
        <button type="button" className="menu-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          <span>Filters & sort</span>
          <span>{platform === "all" ? "All platforms" : REACTION_LABEL[platform]}</span>
        </button>
        <ul className="rows">
          <Row pressed={platform === "all"} onClick={() => setPlatform("all")} label="All platforms" count={searched.length} />
        </ul>
        <h2>Platform</h2>
        <ul className="rows">
          {REACTION_PLATFORMS.map((p) => (
            <Row key={p} platform={p} pressed={platform === p} onClick={() => setPlatform(p)} label={REACTION_LABEL[p]} count={platformCounts[p]} />
          ))}
        </ul>

        <h2>Mood</h2>
        <ul className="rows">
          {MOOD_FILTERS.map((m) => (
            <li key={m.id} data-mood-group={m.id}>
              <button type="button" aria-pressed={mood === m.id} onClick={() => setMood(m.id)}>
                <span>
                  {m.id === "all" || m.id === "off-topic" ? null : <i className="mood-dot" />}
                  {m.label}
                </span>
                <span>{moodCounts[m.id]}</span>
              </button>
            </li>
          ))}
        </ul>

        <h2>
          <label htmlFor="topic">Topic</label>
        </h2>
        <select id="topic" value={topic} onChange={(e) => setTopic(e.target.value as Topic | "all")}>
          <option value="all">Any topic</option>
          {TOPICS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>

        <h2>Sort</h2>
        <ul className="rows">
          {POST_SORTS.map((o) => (
            <Row key={o.id} pressed={sort === o.id} onClick={() => setSort(o.id)} label={o.label} />
          ))}
        </ul>

        <h2>
          <label htmlFor="reaction-search">Search</label>
        </h2>
        <input
          id="reaction-search"
          type="search"
          placeholder="Words or author"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </aside>

      <main className="results">
        <div className="stats">
          <div className="stat">
            <span className="stat-value">{loaded ? inPlatform.length : "--"}</span>
            <span className="stat-label">Reactions{platform === "all" ? "" : ` on ${REACTION_LABEL[platform]}`}</span>
          </div>
          <div className="stat">
            <span className="stat-value">{signed(mix.net)}</span>
            <span className="stat-label">Net mood · {verdict(mix.net)}</span>
          </div>
          <div className="stat">
            <span className="stat-value">{mix.total ? `${Math.round(((mix.counts.positive + mix.counts["very-positive"]) / mix.total) * 100)}%` : "--"}</span>
            <span className="stat-label">Positive</span>
          </div>
          <div className="stat wide">
            <span className="stat-value">{mix.total ? `${Math.round(((mix.counts.negative + mix.counts["very-negative"]) / mix.total) * 100)}%` : "--"}</span>
            <span className="stat-label">Negative · of {mix.total} counted</span>
          </div>
        </div>

        {payload ? <ScoringNotice payload={payload} /> : null}

        {!loaded || (reactions.length === 0 && !payload?.sources.some((s) => s.source.startsWith("react-") && s.state !== "idle")) ? (
          <div className="empty">
            <i className="spinner" aria-hidden="true" />
            Pulling reactions from X, Reddit, YouTube, Instagram and LinkedIn. About 20 seconds the first time.
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">{filtered ? "No reactions match these filters." : "No reactions came back. See Feeds below."}</div>
        ) : (
          <div className="posts">
            {visible.map((r) => (
              <ReactionCard key={r.id} reaction={r} now={now} />
            ))}
          </div>
        )}

        {loaded ? (
          <LoadMore
            ids={platform === "all" ? REACTION_PLATFORMS.map(reactionSourceId) : [reactionSourceId(platform)]}
            statuses={statuses}
            loadingMore={loadingMore}
            noun={platform === "all" ? "reactions" : `${REACTION_LABEL[platform]} reactions`}
            endNote="That's every reaction these feeds return for now."
          />
        ) : null}
        {loaded ? (
          <AutoUpdate
            ids={REACTION_PLATFORMS.map(reactionSourceId)}
            statuses={statuses}
            on={autoMore}
            nextAt={nextAutoAt}
            now={now}
            noun="reaction"
          />
        ) : null}

        {payload ? (
          <Feeds
            sources={payload.sources.filter((st) => st.source.startsWith("react-"))}
            now={now}
            scoring={payload.scoring}
          />
        ) : null}
      </main>
    </div>
  );
}
