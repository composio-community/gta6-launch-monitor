// Writes the demo fixtures in fixtures/: made-up channels, posts and comments in
// the exact shapes the real tools return, so tests and demo mode run without
// anyone's real data. Every name, post, link and number here is invented.
// Usage: node scripts/make-demo-fixtures.ts
import { writeFileSync } from "node:fs";

const OUT = new URL("../fixtures/", import.meta.url);
const write = (name: string, data: unknown) =>
  writeFileSync(new URL(name, OUT), typeof data === "string" ? data : `${JSON.stringify(data, null, 1)}\n`);

// Seeded PRNG so the fixtures are the same on every run.
let seed = 20261119;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
const idOf = (n: number, len: number) => String(n).padStart(len, "0").slice(-len);

/** Demo time anchor: launch eve, Nov 18 2026, 15:00 UTC. */
const NOW = Date.parse("2026-11-18T15:00:00Z");
const minsAgo = (m: number) => Math.round((NOW - m * 60_000) / 1000);

const NAMES = [
  "ViceCityVic", "LeonidaLaura", "PalmTreePete", "NeonNoodle", "OceanDriveOlly", "KeysKaren", "GatorGrace",
  "SunsetSamir", "MiamiMango", "PinkFlamingoTV", "GrassriversGus", "PortGellhornPaul", "HamletHana", "StiltsSteve",
  "AmbrosiaAmy", "MountKalagaMo", "LuciaFanClub", "JasonMains", "BoatShoesBen", "WaveRiderWes", "CasinoCassie",
  "HurricaneHal", "SwampSally", "CoralCam", "PelicanPat", "TikiTobi", "BayfrontBea", "SprinterSid", "NitroNat",
  "RooftopRio", "DriftDaria", "LowriderLeo", "HeistHelga", "GetawayGabe", "RadioRaul", "VinylVera", "ArcadeArlo",
  "PixelPia", "TurboTess", "MangroveMax", "CrocCarl", "FloridaFern", "BeachBallBo", "ScooterSkye", "PierPilar",
  "ShrimpShackSol", "MarlinMara", "KeyLimeKai", "SandbarSven", "TropicTara", "BonfireBruno", "DuneDex", "CanalCleo",
  "HarborHugo", "LagoonLuz", "SaltwaterSam", "BreezeBria", "ReefRay", "CoveCora", "IsletIggy", "BlvdBlake",
];
const LANGS = ["English", "Español", "Português", "Deutsch", "Français", "Русский", "Italiano", "Türkçe", "Polski"];
const KICK_LANGS = ["English", "Spanish", "Portuguese", "Turkish", "Arabic", "Polish", "German", "Russian"];
const STREAM_TITLES = [
  "GTA 6 DAY ONE: first time in Vice City", "Blind playthrough, no spoilers please", "GTA VI launch marathon [24h]",
  "Finding every secret in Leonida", "Story mode start to finish", "Photo mode tour of the beaches",
  "Stealing every car in the city", "Speedrun practice, any%", "Chill drive + radio station tier list",
  "First heist with chat", "Jason & Lucia, chapter one", "Exploring the Keys at sunset",
];
const TAGS = ["DropsEnabled", "BlindPlaythrough", "Chill", "Speedrun", "NoSpoilers", "FirstTime", "Marathon", "Cozy"];

const slug = (name: string) => name.toLowerCase();
const viewersText = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")}K` : String(n));

// ---------- Twitch directory (Firecrawl markdown, includeTags ["article"]) ----------
{
  const cards: string[] = [];
  let viewers = 412_000;
  for (let i = 0; i < 30; i++) {
    const name = NAMES[i];
    const handle = slug(name);
    const title = i === 2 ? "PRIMER DIRECTO GTA 6 \\| CODIGOS PARA SEGUIDORES" : pick(STREAM_TITLES);
    const tags = [pick(TAGS), pick(LANGS), pick(TAGS)].filter((t, j, a) => a.indexOf(t) === j);
    cards.push(
      [
        `[**${title}** \\\\\n\\\\\n${name}\\\\\n\\\\\nVerified](https://www.twitch.tv/${handle})`,
        ...tags,
        `[![${title} - ${handle}](https://static-cdn.jtvnw.net/ttv-static/404_preview-640x360.jpg)\\\\\n\\\\\nLIVE\\\\\n\\\\\n${viewersText(viewers)} viewers](https://www.twitch.tv/${handle})`,
      ].join("\n\n"),
    );
    viewers = Math.max(1200, Math.round(viewers * (0.62 + rand() * 0.3)));
  }
  write("twitch-directory.md", `${cards.join("\n\n")}\n`);
}

// ---------- Kick category (Firecrawl markdown, cut off mid-card like a bounded slice) ----------
{
  const cards: string[] = [];
  let viewers = 188_400;
  for (let i = 0; i < 60; i++) {
    const name = NAMES[(i + 7) % NAMES.length] + (i >= NAMES.length - 7 ? "2" : "");
    const handle = slug(name);
    const title = pick(STREAM_TITLES);
    const adult = i % 9 === 4 ? "18+" : "";
    const count = i % 17 === 11 ? "LIVE" : viewersText(viewers);
    cards.push(
      [
        `[\\\\\n\\\\\n${count}](https://kick.com/${handle})`,
        `[${name}](https://kick.com/${handle} "${name}")`,
        `[**${title}**](https://kick.com/${handle} "${title}")`,
        `[Grand Theft Auto VI (GTA)](https://kick.com/category/grand-theft-auto-vi) ${pick(KICK_LANGS)}${adult}`,
      ].join("\n\n"),
    );
    viewers = Math.max(900, Math.round(viewers * (0.78 + rand() * 0.18)));
  }
  // A trailing partial card: the slice ends mid-card, as the sandbox reader does.
  write("kick-category.md", `${cards.join("\n\n")}\n\n[\\\\\n\\\\\n812](https://kick.com/cutoffcarla)\n\n[CutoffCarla](https://kick.com/cutoffcarla "Cut`);
}

// ---------- YouTube live search (ScrapeCreators) ----------
{
  const lives = Array.from({ length: 19 }, (_, i) => {
    const id = `demoLive${idOf(i, 3)}`;
    const watching = Math.round(14_000 / (i + 1) + rand() * 400);
    return {
      type: "live",
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: `🔴 ${pick(STREAM_TITLES)}`,
      thumbnail: null,
      channel: { id: `UCdemo${idOf(i, 4)}`, title: NAMES[(i + 20) % NAMES.length], handle: slug(NAMES[(i + 20) % NAMES.length]), thumbnail: null },
      viewCountText: `${watching.toLocaleString("en-US")} watching`,
      viewCountInt: watching,
      badges: ["LIVE"],
    };
  });
  write("youtube-search.json", { success: true, has_more: true, next_cursor: "demo-cursor-youtube-2", lives, videos: [], shorts: [], channels: [], playlists: [], shelves: [] });
}

// ---------- Text pools ----------
const ANNOUNCE = [
  "Going live with GTA 6 in 10 minutes, come hang out!",
  "LIVE NOW on Kick: first hour of GTA VI, no spoilers in chat please",
  "Join my GTA 6 stream tonight at 9 PM, blind playthrough",
  "We're live! Exploring Vice City until the sun comes up",
  "Streaming GTA 6 all day on Twitch, drops are on",
  "I'm live playing GTA VI right now, first heist incoming",
  "Day one GTA 6 marathon starts in an hour on YouTube",
  "Live on Twitch: photo mode tour of Leonida",
];
const CHATTER = [
  "Which streamer are you watching for the GTA 6 launch?",
  "Is it a good idea to stream GTA VI on launch night or will everything lag?",
  "Best capture settings for streaming GTA 6 on console?",
  "Watch party for GTA VI tonight at the community center",
  "GTA 6 launch timeline: when does it unlock in each region?",
];
type Seed = { text: string; mood: "very-positive" | "positive" | "neutral" | "negative" | "very-negative"; topic: string };
const REACTIONS: Seed[] = [
  { text: "Vice City has never looked this good. The sunsets alone are worth it.", mood: "very-positive", topic: "visuals" },
  { text: "Twelve years of waiting and it actually delivered. Masterpiece.", mood: "very-positive", topic: "hype" },
  { text: "The driving feels heavy in a good way, every car handles differently", mood: "positive", topic: "gameplay" },
  { text: "Lucia is the best protagonist Rockstar has written", mood: "very-positive", topic: "story" },
  { text: "Can't stop laughing at the in-game radio ads", mood: "positive", topic: "other" },
  { text: "First mission done. Pacing is slow but the city is unreal.", mood: "positive", topic: "gameplay" },
  { text: "The crowd detail on the beach is wild, every NPC is doing something", mood: "positive", topic: "visuals" },
  { text: "Launch night with friends, best gaming night in years", mood: "very-positive", topic: "hype" },
  { text: "Story hooked me in the first ten minutes", mood: "positive", topic: "story" },
  { text: "Download is 160 GB, see you all next week", mood: "neutral", topic: "performance" },
  { text: "Patch notes for day one are out, mostly stability fixes", mood: "neutral", topic: "performance" },
  { text: "Is the PC version still coming next year?", mood: "neutral", topic: "price" },
  { text: "Which edition did everyone get?", mood: "neutral", topic: "price" },
  { text: "Here's a map comparison between Vice City then and now", mood: "neutral", topic: "visuals" },
  { text: "Clip of the first police chase from my stream", mood: "neutral", topic: "streams" },
  { text: "Frame rate drops hard in the city center on base console", mood: "negative", topic: "performance" },
  { text: "Servers are melting, can't even get past the title screen", mood: "very-negative", topic: "performance" },
  { text: "Seventy dollars and the online mode isn't even out yet", mood: "negative", topic: "price" },
  { text: "The tutorial is way too long, let me play", mood: "negative", topic: "gameplay" },
  { text: "Crashed twice in an hour. Not great.", mood: "negative", topic: "performance" },
];

const authorOf = (i: number) => NAMES[(i * 7 + 3) % NAMES.length];

// ---------- X search (GetAnyAPI) ----------
function xSearch(texts: string[], startMins: number, likesBase: number) {
  return {
    cost_usd: null,
    hint: null,
    items: texts.length,
    jq_error: null,
    output: {
      found: true,
      data: {
        nextCursor: "demo-cursor-x-2",
        items: texts.map((text, i) => {
          const name = authorOf(i);
          const id = `9000000000000${idOf(i + startMins, 6)}`;
          return {
            id,
            text,
            url: `https://x.com/i/web/status/${id}`,
            authorName: name,
            authorUsername: slug(name),
            authorImage: null,
            authorFollowers: Math.round(rand() * 50_000),
            authorVerified: false,
            createdUtc: minsAgo(startMins + i * 7),
            likeCount: Math.round(likesBase * rand()),
            replyCount: Math.round(rand() * 30),
            retweetCount: Math.round(rand() * 20),
            viewCount: Math.round(likesBase * 40 * rand()) + 10,
            isReply: false,
            lang: "en",
          };
        }),
      },
    },
    provider: "AnyAPI",
  };
}

// ---------- Reddit (ScrapeCreators search and subreddit listing share this shape) ----------
function reddit(rows: { title: string; body: string | null }[], subreddit: (i: number) => string, startMins: number) {
  return {
    success: true,
    has_more: true,
    next_cursor: "demo-cursor-reddit-2",
    items: rows.map((r, i) => {
      const id = `demo${idOf(i, 3)}`;
      const sub = subreddit(i);
      return {
        id,
        name: `t3_${id}`,
        author: slug(authorOf(i + 11)),
        title: r.title,
        selftext: r.body,
        subreddit: sub,
        url: `https://www.reddit.com/r/${sub}/comments/${id}/demo_post/`,
        permalink: null,
        created_utc: minsAgo(startMins + i * 23),
        score: Math.round(rand() * 900),
        ups: 0,
        num_comments: Math.round(rand() * 120),
      };
    }),
  };
}

// ---------- LinkedIn (ScrapeCreators) ----------
function linkedin(texts: string[], startMins: number) {
  return {
    success: true,
    has_more: true,
    next_cursor: "demo-cursor-linkedin-2",
    query: "GTA 6",
    items: texts.map((description, i) => ({
      url: `https://www.linkedin.com/posts/demo-post-${idOf(i, 4)}`,
      description,
      date_published: new Date((minsAgo(startMins + i * 300)) * 1000).toISOString(),
      like_count: Math.round(rand() * 200),
      comment_count: Math.round(rand() * 20),
      comments: [],
      image: null,
      images: [],
      media: null,
      author: { name: `${authorOf(i + 5)} Studio`, url: "https://www.linkedin.com/company/demo", image: null, followers: Math.round(rand() * 9000) },
    })),
  };
}

// ---------- Instagram (GetAnyAPI hashtag feeds) ----------
function instagram(captions: string[], startMins: number, withLikes: boolean) {
  return {
    cost_usd: null,
    hint: null,
    items: captions.length,
    jq_error: null,
    output: {
      found: true,
      data: {
        nextCursor: "demo-cursor-instagram-2",
        posts: captions.map((caption, i) => {
          const name = authorOf(i + 17);
          return {
            id: `31000000${idOf(i, 6)}`,
            shortcode: `Demo${idOf(i, 5)}`,
            url: `https://www.instagram.com/p/Demo${idOf(i, 5)}/`,
            username: slug(name),
            displayName: name,
            avatarUrl: null,
            caption: `${caption} #gta6 #gta6live`,
            createdUtc: minsAgo(startMins + i * 11),
            countsHidden: !withLikes,
            likes: withLikes ? Math.round(rand() * 60_000) : undefined,
            comments: Math.round(rand() * 300),
            hashtags: ["gta6", "gta6live"],
            productType: "clips",
          };
        }),
      },
    },
    provider: "AnyAPI",
  };
}

// ---------- Social radar: posts announcing streams ----------
{
  const xTexts = Array.from({ length: 20 }, (_, i) => (i % 3 === 2 ? pick(CHATTER) : pick(ANNOUNCE)));
  write("social-x.json", xSearch(xTexts, 2, 80));
  write(
    "social-reddit.json",
    reddit(
      Array.from({ length: 25 }, (_, i) => ({ title: i % 4 === 0 ? pick(ANNOUNCE) : pick(CHATTER), body: i % 2 ? "Curious what everyone thinks." : null })),
      (i) => (i % 3 ? "GTA6" : "Twitch"),
      45,
    ),
  );
  write("social-linkedin.json", linkedin(Array.from({ length: 10 }, (_, i) => (i % 4 === 0 ? "Our team is going live all day to play GTA 6 together. Join the stream!" : pick(CHATTER))), 60));
  write("social-instagram.json", instagram(Array.from({ length: 20 }, (_, i) => (i % 5 === 0 ? pick(ANNOUNCE) : pick(CHATTER))), 5, false));
}

// ---------- Reactions ----------
const scores: Record<string, { sentiment: number; topic: string }> = {};
const SENTIMENT = { "very-positive": 1.7, positive: 0.9, neutral: 0, negative: -0.8, "very-negative": -1.6 } as const;
function score(id: string, s: Seed) {
  scores[id] = { sentiment: Math.round((SENTIMENT[s.mood] + (rand() - 0.5) * 0.3) * 100) / 100, topic: s.topic };
}
const reactionSet = (n: number) => Array.from({ length: n }, () => pick(REACTIONS));

{
  const xs = reactionSet(20);
  const x = xSearch(xs.map((s) => s.text), 1, 4000);
  x.output.data.items.forEach((item, i) => score(`react-x:${item.id}`, xs[i]));
  write("reactions-x.json", x);

  const rs = reactionSet(15);
  const r = reddit(rs.map((s) => ({ title: s.text, body: null })), () => "GTA6", 15);
  r.items.forEach((item, i) => score(`react-reddit:${item.id}`, rs[i]));
  write("reactions-reddit.json", { cached: null, cached_at: null, ...r });

  const is = reactionSet(10);
  const ig = instagram(is.map((s) => s.text), 60 * 24 * 3, true);
  ig.output.data.posts.forEach((p, i) => score(`react-instagram:${p.id}`, is[i]));
  write("reactions-instagram.json", ig);

  const ls = reactionSet(10);
  const li = linkedin(ls.map((s) => s.text), 90);
  li.items.forEach((p, i) => score(`react-linkedin:${p.url.replace(/^https?:\/\/[^/]+/, "")}`, ls[i]));
  write("reactions-linkedin.json", li);

  // Search results include uploads about other GTA games, which the parser must skip.
  const titles = [
    "GTA 6 Review: is it worth the wait?",
    "GTA 5 Online: one last ride",
    "Everything you need to know before GTA 6 day one",
    "Grand Theft Auto IV, revisited",
    "GTA VI first 30 minutes (no commentary)",
    "Ranking every GTA 6 radio station",
  ];
  write("reactions-youtube-search.json", {
    success: true,
    has_more: false,
    next_cursor: null,
    videos: titles.map((title, i) => ({
      type: "video",
      id: `demoVideo${idOf(i, 2)}`,
      url: `https://www.youtube.com/watch?v=demoVideo${idOf(i, 2)}`,
      title,
      thumbnail: null,
      viewCountInt: 1_500_000 - i * 180_000,
      viewCountText: `${(1_500_000 - i * 180_000).toLocaleString("en-US")} views`,
      badges: [],
    })),
    lives: [],
    shorts: [],
    channels: [],
    playlists: [],
    shelves: [],
  });

  const cs = reactionSet(20);
  const hoursAgo = [1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6, 8, 10, 12, 14, 18, 20, 22];
  write("reactions-youtube-comments.json", {
    cost_usd: null,
    hint: null,
    items: cs.length,
    jq_error: null,
    output: {
      found: true,
      data: {
        nextCursor: "demo-cursor-comments-2",
        comments: cs.map((s, i) => {
          const id = `DemoComment${idOf(i, 3)}`;
          score(`react-youtube:${id}`, s);
          return {
            id,
            author: `@${slug(authorOf(i + 29))}`,
            authorAvatarUrl: null,
            text: s.text,
            likes: Math.round(12_000 / (i + 1)),
            replies: Math.round(rand() * 150),
            publishedTime: `${hoursAgo[i]} hour${hoursAgo[i] === 1 ? "" : "s"} ago`,
          };
        }),
      },
    },
    provider: "AnyAPI",
  });
}

write("reaction-scores.json", scores);
console.log(`wrote demo fixtures; ${Object.keys(scores).length} demo scores`);
