"use client";

import { useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { ago, compactCount, usd } from "@/lib/format";
import { POST_SORTS, sortPosts, type PostSort } from "@/lib/posts";
import {
  PLATFORMS,
  SOCIAL_PLATFORMS,
  type LiveStream,
  type Platform,
  type SocialPlatform,
  type SocialPost,
  type SourceId,
  type SourceStatus,
  type StreamsPayload,
} from "@/lib/types";
import { ReactionsView } from "./ReactionsView";
import { SentimentView } from "./SentimentView";
import { AutoUpdate, Avatar, Feeds, isSocial, LoadMore, PLATFORM_LABEL, SOCIAL_LABEL } from "./shared";
import { streamStore, type Tab } from "./stream-store";

/** What the board shows: everything, one stream platform, or one social platform. */
type View = "all" | SourceId;

type Sort = "most" | "fewest" | "az";
const SORTS: { id: Sort; label: string; hint: string }[] = [
  { id: "most", label: "Most viewers", hint: "Biggest rooms first" },
  { id: "fewest", label: "Fewest viewers", hint: "Small streamers first" },
  { id: "az", label: "Channel A to Z", hint: "" },
];

/** Total viewers needed for each wanted star. */
const HEAT_STEPS = [10_000, 100_000, 500_000, 1_000_000, 2_000_000];

function Stars({ lit }: { lit: number }) {
  return (
    <div
      className="stars"
      role="img"
      aria-label={`Heat level ${lit} of 5`}
      title="One star each at 10K, 100K, 500K, 1M and 2M reported viewers across found streams"
    >
      {HEAT_STEPS.map((step, i) => (
        <svg key={step} viewBox="0 0 24 24" className={i < lit ? "star on" : "star"} aria-hidden="true">
          <path d="M12 1.6l3.1 6.7 7.3.9-5.4 5 1.4 7.2L12 17.8l-6.4 3.6L7 14.2l-5.4-5 7.3-.9z" />
        </svg>
      ))}
    </div>
  );
}

function Hud({ payload, totalViewers, children }: { payload: StreamsPayload | null; totalViewers: number; children?: ReactNode }) {
  const lit = HEAT_STEPS.filter((step) => totalViewers >= step).length;
  // The budget is spending on the signed-in account; without a sign-in there is nothing to show.
  const budget = payload?.signedIn ? payload.budget : null;
  const left = budget ? Math.max(0, budget.capUsd - budget.spentUsd) : null;
  return (
    <aside className="hud" aria-label="Status">
      <Stars lit={lit} />
      {budget && left !== null ? (
        <>
          <div className="hud-cash" title="Composio Instant spend left before the app stops calling tools for you">
            {usd(left)}
          </div>
          <div className="hud-label">Instant budget left</div>
        </>
      ) : null}
      {budget && budget.spentUsd > 0 ? (
        <div className="hud-spent">
          -{usd(budget.spentUsd)}
          <span>
            {budget.estimated ? " est. " : " "}
            over {budget.calls} {budget.calls === 1 ? "call" : "calls"}
          </span>
        </div>
      ) : null}
      {payload?.signedIn ? (
        <form className="hud-account" action="/api/auth/logout" method="post">
          <span>{payload.account?.name || payload.account?.email || "Signed in to Composio"}</span>
          <button type="submit">Sign out</button>
        </form>
      ) : null}
      {children}
    </aside>
  );
}

function Thumb({ stream }: { stream: LiveStream }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : stream.thumbnail;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="thumb-img" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    );
  }
  // No preview frame (the source page lazy-loads them): show the channel avatar instead.
  return (
    <div className="thumb-fallback">
      {stream.avatar ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="backdrop" src={stream.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="face" src={stream.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />
        </>
      ) : (
        <span>{stream.channel.slice(0, 1).toUpperCase()}</span>
      )}
    </div>
  );
}

function Card({ stream, rank }: { stream: LiveStream; rank: number | null }) {
  return (
    <a className="card" data-platform={stream.platform} href={stream.url} target="_blank" rel="noreferrer">
      <div className="thumb">
        <Thumb stream={stream} />
        <div className="thumb-top">
          <span className="live">Live</span>
          <span className="chip platform">{PLATFORM_LABEL[stream.platform]}</span>
        </div>
        {rank !== null ? <span className="rank">{rank}</span> : null}
        <span className="viewers">
          {stream.viewers === null ? "Live" : compactCount(stream.viewers)}
          {stream.viewers === null ? null : <small>watching</small>}
        </span>
      </div>
      <span className="sr-only">(opens in a new tab)</span>
      <div className="card-body">
        {stream.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="avatar" src={stream.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="avatar blank">{stream.channel.slice(0, 1).toUpperCase()}</span>
        )}
        <div className="card-text">
          <div className="channel">{stream.channel}</div>
          <div className="title" title={stream.title}>
            {stream.title}
          </div>
          <div className="tags">
            {stream.language ? <span className="tag lang">{stream.language}</span> : null}
            {stream.tags.slice(0, 2).map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </a>
  );
}

function PostCard({ post, now }: { post: SocialPost; now: number }) {
  // Zero counts are noise on a feed of posts minutes old; show only what has moved.
  const stats = [
    post.likes ? `${compactCount(post.likes)} ${post.platform === "reddit" ? "points" : "likes"}` : null,
    post.comments ? `${compactCount(post.comments)} ${post.platform === "x" ? "replies" : "comments"}` : null,
    post.views ? `${compactCount(post.views)} views` : null,
  ].filter(Boolean);
  return (
    <a className="post" data-platform={post.platform} href={post.url} target="_blank" rel="noreferrer">
      <div className="post-head">
        <Avatar src={post.avatar} name={post.author} className="post-avatar" />
        <div className="post-who">
          <span className="post-author">{post.author}</span>
          <span className="post-meta">{[post.handle, post.context, ago(post.createdAt, now)].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="chip platform">{SOCIAL_LABEL[post.platform]}</span>
      </div>
      <p className="post-text">
        {post.goingLive ? <span className="going-live">Stream announcement</span> : null}
        {post.text}
      </p>
      {stats.length > 0 ? <div className="post-stats">{stats.join(" · ")}</div> : null}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function SocialRadar({
  posts,
  total,
  now,
  view,
  onView,
  footer,
  viewsHint,
}: {
  /** Posts already narrowed by the sidebar platform and the search box. */
  posts: SocialPost[];
  /** Per-platform counts before the platform filter, for the chips. */
  total: Record<SocialPlatform, number>;
  now: number;
  view: View;
  onView: (view: View) => void;
  /** Shown under the posts: the load-more button. */
  footer: ReactNode;
  /** Set when sorting by views and some posts have none to sort by. */
  viewsHint: boolean;
}) {
  const [liveOnly, setLiveOnly] = useState(false);
  const liveCount = posts.filter((p) => p.goingLive).length;
  const visible = liveOnly ? posts.filter((p) => p.goingLive) : posts;
  const all = SOCIAL_PLATFORMS.reduce((sum, p) => sum + total[p], 0);

  return (
    <section className="radar" id="radar" aria-labelledby="radar-title">
      <div className="radar-head">
        <h2 id="radar-title">Social radar</h2>
        <p>
          Posts about GTA VI streams on X, Reddit, Instagram and LinkedIn. "Stream announcement" is a guess from the wording and
          links, not proof someone is live.
        </p>
      </div>
      <div className="chips" role="group" aria-label="Filter posts">
        <button type="button" aria-pressed={!isSocial(view)} onClick={() => onView("all")}>
          All socials <span>{all}</span>
        </button>
        {SOCIAL_PLATFORMS.map((p) => (
          <button key={p} type="button" data-platform={p} aria-pressed={view === p} onClick={() => onView(p)}>
            <i className="dot" />
            {SOCIAL_LABEL[p]} <span>{total[p]}</span>
          </button>
        ))}
        <button type="button" className="toggle" aria-pressed={liveOnly} onClick={() => setLiveOnly(!liveOnly)}>
          Announcements only <span>{liveCount}</span>
        </button>
      </div>
      {viewsHint ? (
        <p className="radar-hint">Only X and some Instagram posts report views. Posts without them follow, ranked by likes and comments.</p>
      ) : null}
      {visible.length === 0 ? (
        <div className="empty">{all === 0 ? "No posts came back from the social feeds yet. See Feeds below." : "No posts match these filters."}</div>
      ) : (
        <div className="posts">
          {visible.map((post) => (
            <PostCard key={post.id} post={post} now={now} />
          ))}
        </div>
      )}
      {footer}
    </section>
  );
}

function SignIn({ error }: { error: string | null }) {
  return (
    <section className="setup">
      <p className="script">One more job</p>
      <h2>Sign in to Composio</h2>
      <p className="setup-lede">
        Stream data comes from Composio Instant tools, paid per call from your own Composio wallet. No API keys, no
        provider accounts. New Composio accounts start with $2 in the wallet.
      </p>
      {error ? (
        <p className="setup-error">
          <b>Sign-in failed.</b> {error}
        </p>
      ) : null}
      <div className="setup-actions">
        <a className="prompt big" href="/api/auth/login">
          <kbd aria-hidden="true">↵</kbd> Sign in with Composio
        </a>
      </div>
      <p className="setup-note">
        Streamers costs about $0.007 per refresh. Reactions and Sentiment load only once you open them, about $0.007
        per refresh plus under $0.0001 per reaction scored. The app stops spending for you at $1.00 unless the site
        owner sets <code>INSTANT_BUDGET_USD</code>.
      </p>
    </section>
  );
}

const TAB_LIST: { id: Tab; label: string }[] = [
  { id: "streamers", label: "Streamers" },
  { id: "reactions", label: "Reactions" },
  { id: "sentiment", label: "Sentiment" },
];

/** Arrow keys move between tabs, as in any tablist. */
function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
  event.preventDefault();
  const current = TAB_LIST.findIndex((t) => t.id === streamStore.getSnapshot().tab);
  const next =
    event.key === "Home" ? 0 : event.key === "End" ? TAB_LIST.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + TAB_LIST.length) % TAB_LIST.length;
  streamStore.setTab(TAB_LIST[next].id);
  document.getElementById(`tab-${TAB_LIST[next].id}`)?.focus();
}

/** How many streams the combined view shows before "Show all". */
const COLLAPSED_STREAMS = 24;

export function StreamBoard() {
  const { payload, loading, error, auto, now, loadingMore, moreError, tab, autoMore, nextAutoAt } = useSyncExternalStore(
    streamStore.subscribe,
    streamStore.getSnapshot,
    streamStore.getServerSnapshot,
  );
  const [view, setView] = useState<View>("all");
  const [language, setLanguage] = useState("all");
  const [sort, setSort] = useState<Sort>("most");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [postSort, setPostSort] = useState<PostSort>("newest");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const streams = payload?.streams ?? [];
  const posts = payload?.posts ?? [];
  const totalViewers = streams.reduce((sum, s) => sum + (s.viewers ?? 0), 0);
  const counts: Record<Platform | SocialPlatform, number> = { twitch: 0, kick: 0, youtube: 0, x: 0, reddit: 0, instagram: 0, linkedin: 0 };
  const languages = new Map<string, number>();
  for (const s of streams) {
    counts[s.platform] += 1;
    if (s.language) languages.set(s.language, (languages.get(s.language) ?? 0) + 1);
  }
  for (const p of posts) counts[p.platform] += 1;
  const languageOptions = [...languages.entries()].sort((a, b) => b[1] - a[1]);
  // A refresh can drop the selected language; fall back to "all" instead of an empty grid.
  const activeLanguage = language !== "all" && languages.has(language) ? language : "all";

  const showStreams = !isSocial(view);
  const showPosts = view === "all" || isSocial(view);

  const needle = query.trim().toLowerCase();
  const matchingStreams = streams
    .filter((s) => view === "all" || s.platform === view)
    .filter((s) => activeLanguage === "all" || s.language === activeLanguage)
    .filter((s) => !needle || s.channel.toLowerCase().includes(needle) || s.title.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === "az") return a.channel.localeCompare(b.channel);
      // Streams without a viewer count sort last either way.
      if (a.viewers === null || b.viewers === null) return (a.viewers === null ? 1 : 0) - (b.viewers === null ? 1 : 0);
      return sort === "most" ? b.viewers - a.viewers : a.viewers - b.viewers;
    });
  // In the combined view, keep the grid short so the social radar is in reach.
  const collapse = view === "all" && !expanded && matchingStreams.length > COLLAPSED_STREAMS;
  const visibleStreams = collapse ? matchingStreams.slice(0, COLLAPSED_STREAMS) : matchingStreams;

  const searchedPosts = needle
    ? posts.filter((p) => p.author.toLowerCase().includes(needle) || p.text.toLowerCase().includes(needle))
    : posts;
  const postTotals: Record<SocialPlatform, number> = { x: 0, reddit: 0, instagram: 0, linkedin: 0 };
  for (const p of searchedPosts) postTotals[p.platform] += 1;
  const visiblePosts = sortPosts(isSocial(view) ? searchedPosts.filter((p) => p.platform === view) : searchedPosts, postSort);
  const viewsHint = postSort === "views" && visiblePosts.some((p) => p.views === null);
  const statuses = new Map((payload?.sources ?? []).map((st) => [st.source, st]));
  const goingLive = posts.filter((p) => p.goingLive).length;
  // One creator streaming on two platforms is one creator: match on the handle (or name) with punctuation stripped.
  const creators = new Set(streams.map((s) => (s.handle ?? s.channel).toLowerCase().replace(/[^a-z0-9]/g, ""))).size;
  const uncounted = streams.filter((s) => s.viewers === null).length;

  const top = streams.find((s) => s.viewers !== null) ?? null;
  const needsSetup = payload !== null && !payload.signedIn;
  const filtered = view !== "all" || activeLanguage !== "all" || needle !== "";

  const row = (id: View, label: string, count: number) => (
    <li key={id} data-platform={id === "all" ? undefined : id}>
      <button type="button" aria-pressed={view === id} onClick={() => setView(id)}>
        <span>
          {id === "all" ? null : <i className="dot" />}
          {label}
        </span>
        <span>{count}</span>
      </button>
    </li>
  );

  return (
    <div className="board">
      <Hud payload={payload} totalViewers={totalViewers}>
      <div className="prompts">
        {loading ? (
          <span className="loading" role="status">
            <i className="spinner" aria-hidden="true" />
            Pulling live feeds
          </span>
        ) : payload && !needsSetup ? (
          <span className="updated">Updated {ago(payload.generatedAt, now)}</span>
        ) : null}
        {!needsSetup ? (
          <>
            <button type="button" className="prompt" aria-pressed={auto} onClick={() => streamStore.setAuto(!auto)}>
              <kbd aria-hidden="true">A</kbd> Auto refresh {auto ? "on" : "off"}
            </button>
            <button type="button" className="prompt" onClick={streamStore.refresh} disabled={loading}>
              <kbd aria-hidden="true">R</kbd> Refresh now
            </button>
          </>
        ) : null}
      </div>
      </Hud>

      <div className="tabs" role="tablist" aria-label="Sections" onKeyDown={onTabKey}>
        {TAB_LIST.map((t, i) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            className={tab === t.id ? "tab active" : "tab"}
            aria-selected={tab === t.id}
            aria-controls="tab-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => streamStore.setTab(t.id)}
          >
            <kbd aria-hidden="true">{i + 1}</kbd> {t.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="notice bad">
          <span>
            <b>Feed unreachable.</b> {error}
          </span>
          <button type="button" className="prompt" onClick={streamStore.refresh}>
            <kbd>R</kbd> Retry
          </button>
        </div>
      ) : null}

      {moreError ? (
        <div className="notice bad">
          <span>
            <b>Load more failed.</b> {moreError}
          </span>
        </div>
      ) : null}

      <div id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {needsSetup ? (
        <SignIn error={payload?.authError ?? null} />
      ) : tab === "reactions" ? (
        <ReactionsView
          payload={payload}
          now={now}
          statuses={statuses}
          loadingMore={loadingMore}
          autoMore={autoMore}
          nextAutoAt={nextAutoAt}
        />
      ) : tab === "sentiment" ? (
        <SentimentView payload={payload} now={now} statuses={statuses} />
      ) : (
        <div className="layout">
          <aside className={filtersOpen ? "menu open" : "menu"} aria-label="Filters">
            <button type="button" className="menu-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
              <span>Filters & sort</span>
              <span>{view === "all" ? "Everything" : PLATFORM_LABEL[view as Platform] ?? SOCIAL_LABEL[view as SocialPlatform]}</span>
            </button>
            <ul className="rows">{row("all", "Everything", streams.length + posts.length)}</ul>

            <h2>Live streams</h2>
            <ul className="rows">{PLATFORMS.map((p) => row(p, PLATFORM_LABEL[p], counts[p]))}</ul>

            <h2>Socials</h2>
            <ul className="rows">{SOCIAL_PLATFORMS.map((p) => row(p, SOCIAL_LABEL[p], counts[p]))}</ul>

            {showStreams ? (
              <>
                <h2>Sort streams</h2>
                <ul className="rows">
                  {SORTS.map((option) => (
                    <li key={option.id}>
                      <button type="button" aria-pressed={sort === option.id} title={option.hint} onClick={() => setSort(option.id)}>
                        <span>{option.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>

                <h2>
                  <label htmlFor="language">Language</label>
                </h2>
                <select id="language" value={activeLanguage} onChange={(e) => setLanguage(e.target.value)}>
                  <option value="all">Any language</option>
                  {languageOptions.map(([name, count]) => (
                    <option key={name} value={name}>
                      {name} ({count})
                    </option>
                  ))}
                </select>
              </>
            ) : null}

            {showPosts ? (
              <>
                <h2>Sort posts</h2>
                <ul className="rows">
                  {POST_SORTS.map((option) => (
                    <li key={option.id}>
                      <button type="button" aria-pressed={postSort === option.id} onClick={() => setPostSort(option.id)}>
                        <span>{option.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <h2>
              <label htmlFor="search">Search</label>
            </h2>
            <input
              id="search"
              type="search"
              placeholder="Channel, title or post"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </aside>

          <main className="results">
            <div className="stats">
              <div className="stat" title="Distinct creators among the streams found. Someone live on Twitch and Kick counts once.">
                <span className="stat-value">{payload ? creators : "--"}</span>
                <span className="stat-label">Creators live{payload ? ` · ${streams.length} streams` : ""}</span>
              </div>
              <div
                className="stat"
                title="The sum of each found stream's reported count. Twitch rounds (576K), and a viewer watching two streams counts twice."
              >
                <span className="stat-value">{payload ? compactCount(totalViewers) : "--"}</span>
                <span className="stat-label">Reported viewers{uncounted ? ` · ${uncounted} without a count` : ""}</span>
              </div>
              <a
                className="stat link"
                href="#radar"
                onClick={() => {
                  if (!showPosts) setView("all");
                }}
              >
                <span className="stat-value">{payload ? posts.length : "--"}</span>
                <span className="stat-label">Social posts{payload ? ` · ${goingLive} announce streams` : ""}</span>
              </a>
              <div className="stat wide">
                <span className="stat-value">{top ? top.channel : "--"}</span>
                <span className="stat-label">
                  Largest room found{top?.viewers ? ` · ${compactCount(top.viewers)} on ${PLATFORM_LABEL[top.platform]}` : ""}
                </span>
              </div>
            </div>

            {payload === null ? (
              <div className="empty">
                {error ? null : <i className="spinner" aria-hidden="true" />}
                {error ? "No data yet." : "Pulling live feeds. The first load takes up to 30 seconds."}
              </div>
            ) : null}

            {payload && showStreams ? (
              visibleStreams.length === 0 ? (
                <div className="empty">
                  {filtered ? "No streams match these filters." : "No live streams came back from any feed. See Feeds below."}
                </div>
              ) : (
                <>
                  <div className="grid">
                    {visibleStreams.map((stream, i) => (
                      <Card key={stream.id} stream={stream} rank={sort === "most" && !filtered ? i + 1 : null} />
                    ))}
                  </div>
                  {collapse ? (
                    <button type="button" className="more" onClick={() => setExpanded(true)}>
                      Show all {matchingStreams.length} streams <small>already loaded · free</small>
                    </button>
                  ) : (
                    <LoadMore
                      ids={view === "all" ? PLATFORMS : [view as Platform]}
                      statuses={statuses}
                      loadingMore={loadingMore}
                      noun={view === "all" ? "streams" : `${PLATFORM_LABEL[view as Platform]} streams`}
                      endNote={
                        view === "twitch"
                          ? "That's all Twitch shows through Instant: the top streams, the recently started list and the smallest streams. Instant's scraper can't scroll."
                          : "That's everything these feeds return for now."
                      }
                    />
                  )}
                </>
              )
            ) : null}

            {payload && showPosts ? (
              <SocialRadar
                posts={visiblePosts}
                total={postTotals}
                now={now}
                view={view}
                onView={setView}
                viewsHint={viewsHint}
                footer={
                  <>
                    <LoadMore
                      ids={isSocial(view) ? [view] : SOCIAL_PLATFORMS}
                      statuses={statuses}
                      loadingMore={loadingMore}
                      noun={isSocial(view) ? `${SOCIAL_LABEL[view]} posts` : "posts"}
                      endNote="That's every post these feeds return for this search."
                    />
                    <AutoUpdate ids={SOCIAL_PLATFORMS} statuses={statuses} on={autoMore} nextAt={nextAutoAt} now={now} noun="social" />
                  </>
                }
              />
            ) : null}
            {payload ? <Feeds sources={payload.sources.filter((st) => !st.source.startsWith("react-"))} now={now} /> : null}
          </main>
        </div>
      )}
      </div>

    </div>
  );
}
