# GTA VI Launch Monitor

A launch-day dashboard for Grand Theft Auto VI, in three tabs:

1. **Streamers**: everyone streaming the game right now on **Twitch, Kick and YouTube**, ranked by viewers, plus a **Social radar** of posts announcing GTA VI streams on **X, Reddit, Instagram and LinkedIn**.
2. **Reactions**: what people are saying about the game itself on X, r/GTA6, YouTube comments, Instagram and LinkedIn. Every reaction is scored for mood (very negative to very positive) and tagged with a topic.
3. **Sentiment**: the overall net mood, mood by platform, the topics people talk about, mood hour by hour over the last 24 hours, and the loudest love and gripes.

All data comes through [Composio Instant](https://composio.dev/instant). Each visitor signs in with **their own Composio account**, and the tools they run are paid per call from **their own Composio wallet**. There are no API keys to manage, and one visitor's sign-in is never used for anyone else.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Click **Sign in with Composio**.

## Deploy to Vercel

1. Import the repo in Vercel. No build settings are needed.
2. Add one environment variable, **`SESSION_SECRET`**: a long random string (at least 32 characters), e.g. from `openssl rand -base64 48`. It encrypts visitors' sign-in cookies. Without it the page says so and sign-in stays off.
3. Optional: `INSTANT_BUDGET_USD`, `STREAMS_TTL_SECONDS` and `SOCIAL_TTL_SECONDS` (see `.env.example`).

The app is built for serverless hosting:

- **Sign-in is per visitor.** The OAuth tokens live in the visitor's own encrypted, httpOnly cookie (AES-256-GCM, `Secure` and `SameSite=Lax` in production), never on the server. Each deployment URL registers its own OAuth client with Composio automatically (dynamic client registration), so preview deployments work too.
- **Nothing has to survive between requests.** Feed caches and "Load more" positions are kept in memory per visitor, for as long as an instance stays warm. A cold instance simply fetches again.
- **No background work.** Sentiment scoring runs inside requests, three batches at a time, and the page polls every 6 seconds until everything is scored.
- Routes allow up to 60 seconds (`maxDuration`). The first load of the Reactions tab takes about 20 seconds.

## Where the data comes from

Every call goes through Composio Connect's `COMPOSIO_MULTI_EXECUTE_TOOL` (`https://connect.composio.dev/mcp`). Composio returns the exact charge with each result, and the page shows it.

### Streamers

| Feed | Composio tool | Charge seen on Nov 18, 2026 | Refreshed | "Load more" |
|------|---------------|-----------------------------|-----------|-------------|
| Twitch | `FIRECRAWL_SCRAPE` of the GTA VI directory | $0.0008 | every 2 min | 2 more lists: "Recently started" and "Viewers low to high" |
| Kick | `FIRECRAWL_SCRAPE` of the GTA VI category | $0.0008 | every 2 min | next ~50 streams from the saved page in Composio's sandbox, free |
| YouTube | `SCRAPECREATORS_SEARCH_YOUTUBE` ("GTA 6 live", today) | $0.001 | every 2 min | next page via cursor |
| X | `GETANYAPI_TWITTER_SEARCH` (posts announcing streams) | $0.0005 | every 5 min | next page via cursor |
| Reddit | `SCRAPECREATORS_SEARCH_REDDIT` | $0.001 | every 5 min | next page via cursor |
| Instagram | `GETANYAPI_INSTAGRAM_HASHTAG_RECENT_POSTS` (#gta6live) | $0.0019 | every 5 min | next page via cursor |
| LinkedIn | `SCRAPECREATORS_SEARCH_LINKEDIN_POSTS` | $0.001 | every 5 min | next page via cursor, up to 11 pages |

### Reactions

| Feed | Composio tool | Charge seen on Nov 18, 2026 | "Load more" |
|------|---------------|-----------------------------|-------------|
| X | `GETANYAPI_TWITTER_SEARCH`: GTA VI posts since yesterday with 25+ likes, no replies or reposts | $0.0005 | next page |
| Reddit | `SCRAPECREATORS_LIST_REDDIT_SUBREDDIT_POSTS`: r/GTA6 | $0.001 | next page |
| YouTube | `SCRAPECREATORS_SEARCH_YOUTUBE` finds today's most-watched GTA VI uploads, then `GETANYAPI_YOUTUBE_VIDEO_COMMENTS` reads the top comments of the first two | $0.001 + $0.0008 per video | comments on the next video |
| Instagram | `GETANYAPI_INSTAGRAM_HASHTAG_TOP_POSTS`: #gta6 | $0.0019 | next page |
| LinkedIn | `SCRAPECREATORS_SEARCH_LINKEDIN_POSTS`: "GTA 6" | $0.001 | next page |

Reaction feeds load only once the Reactions or Sentiment tab is opened, then refresh every 5 minutes.

**Scoring** uses `OPENAI_CREATE_DECISION` (model `gpt-6-luna`). It answers typed questions about one shared text, so a batch of 15 reactions goes in as a numbered list with two questions each: a 5-level sentiment score and a topic choice. A batch costs about $0.0007. Batches of 40 came back as "invalid decision response", so batches stay at 15, a failed batch is retried in halves, and a reaction gets at most two attempts. Scores describe public posts, so they are shared between visitors on the same instance.

**Net mood** is % positive minus % negative, from -100 to +100: Hyped at 50 and above, Positive from 20, Mixed between -20 and 20, Negative down to -50, Furious below.

### Costs

A Streamers refresh costs about $0.007 and a Reactions refresh about the same, plus under $0.0001 per reaction scored. With both tabs open that comes to roughly $0.2 an hour, charged to the visitor who has the page open.

### Instant quirks this app works around

- **Firecrawl caches pages for days**, and the tool has no max-age option, so each scrape URL carries a throwaway `_cb` parameter.
- **Big responses are offloaded.** Over about 40KB, Composio saves the result in its remote sandbox and returns only a preview. The app reads the useful part back with `COMPOSIO_REMOTE_BASH_TOOL` (no wallet charge), trimmed to fit. Kick always hits this.
- **No browser actions.** Instant's Firecrawl rejects scrolling, so Twitch shows the first ~30 cards of each list.
- X and Instagram search use GetAnyAPI because ScrapeCreators' search tools for those two are not Instant-enabled.

## Spend guard

Instant has no built-in dollar cap, so the app enforces one per visitor, in `lib/instant.ts`. Every call reserves an upper bound first and is refused once the visitor's total would pass `INSTANT_BUDGET_USD` (default $1.00). The running total is kept in the visitor's session cookie. Signing out resets it.

## Keys

`1` `2` `3` switch tabs, `R` refresh now, `A` toggle auto refresh.

## Checks

```bash
npm test            # parsers, response readers, scoring and sentiment math, against made-up fixtures
npm run typecheck
```

`node scripts/make-demo-fixtures.ts` rebuilds the test fixtures. Every name, post and number in them is invented.

## Layout

```
app/api/auth/{login,callback,logout}   Composio sign-in, per visitor
app/api/streams/route.ts               JSON feed the page polls
app/api/streams/more/route.ts          POST: load the next page of named feeds
app/page.tsx                           Sky, masthead, board
components/StreamBoard.tsx             HUD, tabs, the Streamers tab
components/ReactionsView.tsx           Reactions tab
components/SentimentView.tsx           Sentiment tab and its charts
components/shared.tsx                  Labels, avatar, Load more, feed status
components/stream-store.ts             Client store (polling, tabs, shortcuts), read with useSyncExternalStore
lib/session.ts                         Encrypted per-visitor cookies and the request context
lib/composio-mcp.ts                    OAuth provider and MCP client, per visitor
lib/instant.ts                         Multi-execute calls, charges, offloaded results, spend cap
lib/sources.ts                         All feeds, caching, paging
lib/scoring.ts                         Sentiment scoring through OPENAI_CREATE_DECISION
lib/sentiment.ts                       Net mood, per-platform, per-topic and hourly summaries
lib/posts.ts                           Post and reaction sorting
lib/parse/                             Twitch, Kick, YouTube, social and reaction parsers
lib/config.ts                          Queries, URLs, cache times
fixtures/                              Made-up responses for the tests
scripts/make-demo-fixtures.ts          Generates fixtures/
```

## Known limits

- "Going live" and sentiment are readings of short posts. Sarcasm and memes get misread sometimes, and many posts land in "Other".
- Twitch rounds viewer counts ("576K"). Kick and YouTube are close to exact.
- LinkedIn search covers Google-indexed public posts only, so it is mostly news and brands.
- GetAnyAPI's providers time out at times (HTTP 502). The feed shows "Failed" and retries on its own.
- Instagram and LinkedIn top posts can be days or months old, so they count toward overall mood but not the 24-hour line.

## Fonts

Display text uses Pricedown when it is installed on your machine, otherwise Passion One. UI text is Barlow Condensed and the script accent is Yellowtail.

Unofficial fan project, not affiliated with Rockstar Games or Take-Two.
