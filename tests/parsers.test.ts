import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTwitchMarkdown } from "../lib/parse/twitch.ts";
import { parseKickMarkdown } from "../lib/parse/kick.ts";
import { parseScrapeCreatorsYouTube } from "../lib/parse/youtube.ts";
import { isGoingLive, parseInstagramHashtag, parseLinkedInSearch, parseRedditSearch, parseXSearch } from "../lib/parse/social.ts";
import { handleFromUrl, parseCount, unescapeMd } from "../lib/parse/util.ts";
import { parseCharge, readMultiExecute } from "../lib/instant.ts";

// Fixtures are made-up demo data in the exact shapes the real tools return
// (see scripts/make-demo-fixtures.ts). No real posts or people.
const text = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const json = (name: string): unknown => JSON.parse(text(name));

test("parseCount handles suffixes and separators", () => {
  assert.equal(parseCount("258K"), 258000);
  assert.equal(parseCount("1.3M"), 1300000);
  assert.equal(parseCount("197.3K"), 197300);
  assert.equal(parseCount("218,356"), 218356);
  assert.equal(parseCount("1,3K"), 1300);
  assert.equal(parseCount("42"), 42);
  assert.equal(parseCount("1,204 watching"), 1204);
  assert.equal(parseCount(""), null);
  assert.equal(parseCount("LIVE"), null);
});

test("handleFromUrl accepts channel links on the right host only", () => {
  assert.equal(handleFromUrl("https://www.twitch.tv/vicecityvic", /twitch\.tv$/), "vicecityvic");
  assert.equal(handleFromUrl("https://kick.com/neonnoodle \"NeonNoodle\"", /kick\.com$/), "neonnoodle");
  assert.equal(handleFromUrl("https://www.twitch.tv/vicecityvic/videos", /twitch\.tv$/), null);
  assert.equal(handleFromUrl("https://example.com/vicecityvic", /twitch\.tv$/), null);
});

test("unescapeMd removes markdown escapes", () => {
  assert.equal(unescapeMd("CODIGOS \\| SUSCRIPTORES"), "CODIGOS | SUSCRIPTORES");
  assert.equal(unescapeMd("a\\\n\\\nb"), "a b");
});

test("twitch markdown parses into ranked streams", () => {
  const streams = parseTwitchMarkdown(text("twitch-directory.md"));
  assert.equal(streams.length, 30);
  assert.deepEqual(streams[0], {
    id: "twitch:vicecityvic",
    platform: "twitch",
    channel: "ViceCityVic",
    handle: "vicecityvic",
    title: "Photo mode tour of the beaches",
    viewers: 412000,
    url: "https://www.twitch.tv/vicecityvic",
    thumbnail: "https://static-cdn.jtvnw.net/previews-ttv/live_user_vicecityvic-640x360.jpg",
    avatar: null,
    language: "Русский",
    tags: ["DropsEnabled", "FirstTime"],
  });
  assert.ok(streams.every((s) => s.viewers !== null));
  assert.ok(streams.every((s) => s.language !== null));
  assert.ok(streams.every((s) => !s.title.includes("\\")), "titles are unescaped");
  assert.ok(streams.some((s) => s.title.includes("| CODIGOS")), "an escaped pipe comes out as a pipe");
});

test("kick markdown parses, including a slice cut off mid-card", () => {
  const md = text("kick-category.md");
  const streams = parseKickMarkdown(md);
  assert.equal(streams.length, 60, "the trailing partial card is dropped");
  const first = streams[0];
  assert.equal(first.handle, "sunsetsamir");
  assert.equal(first.channel, "SunsetSamir");
  assert.equal(first.viewers, 188000);
  assert.equal(first.language, "English");
  assert.equal(first.title, "Chill drive + radio station tier list");
  assert.ok(!streams.some((s) => s.handle === "cutoffcarla"));
  assert.ok(streams.filter((s) => s.viewers !== null).length >= 55, "cards showing only LIVE have no count");
  assert.ok(streams.some((s) => s.tags.includes("18+")), "18+ marker becomes a tag");
  assert.ok(streams.every((s) => s.language !== null), "18+ is not read as part of the language");
  // Cutting the slice shorter must only drop whole cards.
  const shorter = parseKickMarkdown(md.slice(0, 5_000));
  assert.ok(shorter.length > 0 && shorter.length < streams.length);
  assert.deepEqual(shorter, streams.slice(0, shorter.length));
});

test("youtube search keeps live results", () => {
  const streams = parseScrapeCreatorsYouTube(json("youtube-search.json"));
  assert.equal(streams.length, 19);
  assert.ok(streams.every((s) => s.platform === "youtube" && s.url.startsWith("https://www.youtube.com/")));
  assert.ok(streams.every((s) => s.viewers !== null));
});

test("youtube parser drops uploads that are not live", () => {
  const data = {
    videos: [
      { id: "aaaaaaaaaaa", title: "Old upload", viewCountText: "14,860,541 views", viewCountInt: 14860541, badges: [], channel: { title: "A" } },
      { id: "bbbbbbbbbbb", title: "Live now", viewCountText: "12,345 watching", badges: ["LIVE"], channel: { title: "B", handle: "channel/UC1" } },
    ],
    lives: [{ id: "ccccccccccc", title: "Launch stream", viewCountText: "1.2K watching", channel: { title: "C", handle: "see" } }],
  };
  const streams = parseScrapeCreatorsYouTube(JSON.stringify(data));
  assert.deepEqual(streams.map((s) => s.id), ["youtube:ccccccccccc", "youtube:bbbbbbbbbbb"]);
  assert.equal(streams[1].handle, null);
});

test("social parsers read every saved response", () => {
  const x = parseXSearch(json("social-x.json"));
  const reddit = parseRedditSearch(json("social-reddit.json"));
  const linkedin = parseLinkedInSearch(json("social-linkedin.json"));
  const instagram = parseInstagramHashtag(json("social-instagram.json"));
  assert.equal(x.length, 20);
  assert.equal(reddit.length, 25);
  assert.equal(linkedin.length, 10);
  assert.equal(instagram.length, 20);
  for (const p of [...x, ...reddit, ...linkedin, ...instagram]) {
    assert.ok(p.text.length > 0, `${p.id} has text`);
    assert.match(p.url, /^https:\/\//);
    assert.ok(p.createdAt === null || !Number.isNaN(Date.parse(p.createdAt)));
  }
  assert.ok(x.every((p) => p.handle?.startsWith("@")));
  assert.ok(reddit.every((p) => p.context?.startsWith("r/")));
  assert.ok(x.filter((p) => p.goingLive).length >= 5);
});

test("going-live detection", () => {
  assert.ok(isGoingLive("Join my GTA 6 stream tonight at 9 PM"));
  assert.ok(isGoingLive("GTA 6 live on KICK all night"));
  assert.ok(isGoingLive("we're live! twitch.tv/someone"));
  assert.ok(isGoingLive("We are streaming the whole launch, come watch us live"));
  assert.ok(isGoingLive("in an hour I'm going to be streaming gta 6"));
  assert.ok(isGoingLive("Kick: https://t.co/a Twitch: https://t.co/b"));
  assert.ok(isGoingLive("reactions all night, live only on Twitch."));
  assert.ok(!isGoingLive("GTA 6 review: is it worth it?"));
  assert.ok(!isGoingLive("Watching other people's GTA 6 livestreams from bed"));
  assert.ok(!isGoingLive("Not delivering the product we were promised"));
});

const mcpText = (body: unknown) => ({ content: [{ type: "text", text: JSON.stringify(body) }], isError: false });

test("readMultiExecute reads an inline result and its charge", () => {
  const outcome = readMultiExecute(
    mcpText({
      successful: true,
      data: { results: [{ response: { successful: true, data: { items: [1, 2] } }, tool_slug: "X", index: 0 }] },
      error: null,
      instant_charge: { amount: "0.000490", currency: "USD", charged_by: "composio" },
    }),
  );
  assert.deepEqual(outcome, { ok: true, data: { items: [1, 2] }, error: null, charge: 0.00049, offloadedPath: null });
});

test("readMultiExecute flags an offloaded result", () => {
  const outcome = readMultiExecute(
    mcpText({
      successful: true,
      data: {
        results: [{ response: { successful: true, data_preview: { data: { markdown: "..." } } }, tool_slug: "FIRECRAWL_SCRAPE" }],
        remote_file_info: { file_path: "/mnt/files/mex/duty.json" },
      },
      instant_charge: { amount: "0.000798" },
    }),
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.data, null);
  assert.equal(outcome.offloadedPath, "/mnt/files/mex/duty.json");
  assert.equal(outcome.charge, 0.000798);
});

test("readMultiExecute reports a tool failure", () => {
  const outcome = readMultiExecute(
    mcpText({ successful: false, data: { results: [{ response: { successful: false, error: "Insufficient balance" } }] } }),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error, "Insufficient balance");
});

test("parseCharge accepts the shapes Composio uses", () => {
  assert.equal(parseCharge({ amount: "0.000994", currency: "USD" }), 0.000994);
  assert.equal(parseCharge("$0.003"), 0.003);
  assert.equal(parseCharge(0.001), 0.001);
  assert.equal(parseCharge(undefined), null);
});

test("going-live detection covers past tense", () => {
  assert.ok(isGoingLive("SOMEONE WENT LIVE AND IT'S THE BEST DAY"));
  assert.ok(isGoingLive("MangroveMax is live with GTA 6"));
});

test("sortPosts: newest, oldest, most views", async () => {
  const { sortPosts } = await import("../lib/posts.ts");
  const base = { platform: "x" as const, author: "a", handle: null, avatar: null, context: null, text: "t", url: "https://x.com", goingLive: false };
  const posts = [
    { ...base, id: "a", createdAt: "2026-11-18T10:00:00Z", views: 50, likes: 1, comments: 0 },
    { ...base, id: "b", createdAt: "2026-11-18T12:00:00Z", views: null, likes: 90, comments: 9 },
    { ...base, id: "c", createdAt: "2026-11-18T11:00:00Z", views: 900, likes: 0, comments: 0 },
    { ...base, id: "d", createdAt: "2026-11-18T09:00:00Z", views: null, likes: 5, comments: 0 },
  ];
  assert.deepEqual(sortPosts(posts, "newest").map((p) => p.id), ["b", "c", "a", "d"]);
  assert.deepEqual(sortPosts(posts, "oldest").map((p) => p.id), ["d", "a", "c", "b"]);
  // Posts with views first, by views; then the rest by likes + comments.
  assert.deepEqual(sortPosts(posts, "views").map((p) => p.id), ["c", "a", "b", "d"]);
});

// ---------- Reactions and sentiment ----------

test("reaction parsers read every saved reaction response", async () => {
  const r = await import("../lib/parse/reactions.ts");
  const x = r.parseXReactions(json("reactions-x.json"));
  const reddit = r.parseRedditReactions(json("reactions-reddit.json"));
  const ig = r.parseInstagramReactions(json("reactions-instagram.json"));
  const li = r.parseLinkedInReactions(json("reactions-linkedin.json"));
  const videos = r.parseTopVideos(json("reactions-youtube-search.json"));
  const yt = r.parseYouTubeComments(json("reactions-youtube-comments.json"), videos[0], Date.parse("2026-11-18T15:00:00Z"));
  assert.equal(x.length, 20);
  assert.equal(reddit.length, 15);
  assert.equal(ig.length, 10);
  assert.equal(li.length, 10);
  assert.equal(yt.length, 20);
  for (const item of [...x, ...reddit, ...ig, ...li, ...yt]) {
    assert.ok(item.id.startsWith("react-"), item.id);
    assert.ok(item.text.length > 0);
    assert.equal(item.sentiment, null);
  }
  assert.ok(reddit.every((p) => p.context === "r/GTA6"));
  assert.ok(yt.every((c) => c.kind === "comment" && c.context?.startsWith("on “")));
  assert.ok(yt[0].url.includes("&lc="), "comment links point at the comment");
});

test("top videos keep GTA VI uploads only", async () => {
  const { parseTopVideos } = await import("../lib/parse/reactions.ts");
  const videos = parseTopVideos(json("reactions-youtube-search.json"));
  assert.ok(videos.length >= 3);
  assert.ok(videos.every((v) => /gta ?(6|vi)|grand theft auto (6|vi)/i.test(v.title)), "no GTA IV or GTA 5 videos");
  assert.ok(!videos.some((v) => /GTA 5 Online|Grand Theft Auto IV/i.test(v.title)));
});

test("relative comment times become ISO", async () => {
  const { relativeTimeToIso } = await import("../lib/parse/reactions.ts");
  const now = Date.parse("2026-11-18T15:00:00Z");
  assert.equal(relativeTimeToIso("3 hours ago", now), "2026-11-18T12:00:00.000Z");
  assert.equal(relativeTimeToIso("2 days ago (edited)", now), "2026-11-16T15:00:00.000Z");
  assert.equal(relativeTimeToIso("yesterday", now), null);
});

test("scoring builds two questions per reaction and reads the answers back", async () => {
  const { buildDecision, readDecision, moodOf } = await import("../lib/scoring.ts");
  const { parseRedditReactions } = await import("../lib/parse/reactions.ts");
  const batch = parseRedditReactions(json("reactions-reddit.json")).slice(0, 3);
  const req = buildDecision(batch);
  assert.equal(req.model, "gpt-6-luna");
  assert.equal(req.questions.length, 6);
  assert.match(req.input, /\[3\]/);
  assert.ok(!/https?:\/\//.test(req.input), "links are stripped to save tokens");
  const answers = {
    answers: [
      { name: "s1", type: "score", score: 3.6 },
      { name: "t1", type: "choice", choice: "gameplay" },
      { name: "s2", type: "score", score: 0.2 },
      { name: "t2", type: "choice", choice: "nonsense" },
      { name: "t3", type: "choice", choice: "price" },
    ],
  };
  const scores = readDecision(answers, batch);
  assert.equal(scores.size, 2, "an item with no score answer is left unscored");
  assert.deepEqual(scores.get(batch[0].id), { sentiment: 1.6, topic: "gameplay" });
  assert.equal(scores.get(batch[1].id)?.topic, "other", "unknown topics fall back to other");
  assert.equal(moodOf(1.6), "very-positive");
  assert.equal(moodOf(0.1), "neutral");
  assert.equal(moodOf(-0.5), "negative");
  assert.equal(moodOf(-1.8), "very-negative");
});

test("sentiment summary: net mood, platforms, topics, hours, loudest", async () => {
  const { summarize, split, verdict } = await import("../lib/sentiment.ts");
  const now = Date.parse("2026-11-18T15:30:00Z");
  const base = { kind: "post" as const, author: "a", handle: null, avatar: null, context: null, text: "t", url: "https://x.com", likes: 0, comments: 0, views: null };
  const mk = (id: string, platform: "x" | "reddit", mood: "positive" | "negative" | "neutral" | "very-positive", topic: "hype" | "gameplay", hoursAgo: number, likes = 0) => ({
    ...base,
    id,
    platform,
    mood,
    topic,
    likes,
    sentiment: mood === "negative" ? -1 : mood === "neutral" ? 0 : mood === "positive" ? 1 : 2,
    createdAt: new Date(now - hoursAgo * 3600_000).toISOString(),
  });
  const reactions = [
    mk("1", "x", "positive", "hype", 1, 50),
    mk("2", "x", "negative", "gameplay", 1, 900),
    mk("3", "reddit", "very-positive", "hype", 2, 10),
    mk("4", "reddit", "neutral", "hype", 30),
    { ...mk("5", "x", "neutral", "hype", 1), mood: null, sentiment: null },
  ];
  const s = summarize(reactions, now);
  assert.equal(s.overall.total, 4, "unscored reactions are not counted");
  assert.equal(s.overall.net, 25);
  assert.equal(verdict(s.overall.net), "Positive");
  assert.equal(s.byPlatform.find((p) => p.platform === "x")?.net, 0);
  assert.equal(s.byTopic[0].topic, "hype");
  assert.equal(s.outsideWindow, 1, "the 30-hour-old post is outside the 24h window");
  assert.equal(s.hours.reduce((n, h) => n + h.total, 0), 3);
  assert.deepEqual(s.loudestGripes.map((r) => r.id), ["2"]);
  assert.deepEqual(s.loudestLove.map((r) => r.id), ["1", "3"]);
  assert.equal(split([]).net, null);
});

test("snapshot scores cover every saved reaction", async () => {
  const scores = json("reaction-scores.json") as Record<string, { sentiment: number; topic: string }>;
  assert.equal(Object.keys(scores).length, 75);
  for (const s of Object.values(scores)) {
    assert.ok(s.sentiment >= -2 && s.sentiment <= 2);
    assert.ok(typeof s.topic === "string");
  }
});
