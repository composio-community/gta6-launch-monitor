import type { Section, SourceId, StreamsPayload } from "@/lib/types";

export type Tab = "streamers" | "reactions" | "sentiment";
export const TABS: Tab[] = ["streamers", "reactions", "sentiment"];
const SECTION_OF: Record<Tab, Section> = { streamers: "streamers", reactions: "reactions", sentiment: "reactions" };

/**
 * Client-side store for the live feed, read with useSyncExternalStore.
 * Polling starts with the first subscriber and stops with the last, so the
 * component tree needs no effects. The server decides when an Instant call is
 * actually made (it caches per source); polling here only asks for the latest.
 */

export interface StreamState {
  payload: StreamsPayload | null;
  loading: boolean;
  /** Set when the request to our own API failed (not a per-source failure). */
  error: string | null;
  auto: boolean;
  /** Wall clock, ticked by the store so "42s ago" labels stay current. 0 before hydration. */
  now: number;
  /** Feeds with a "Load more" request in flight. */
  loadingMore: SourceId[];
  /** Set when the last "Load more" request failed outright. */
  moreError: string | null;
  tab: Tab;
  /**
   * Sections whose feeds the server should refresh. A section joins once its
   * tab is opened, so the reaction feeds cost nothing until someone looks.
   */
  sections: Section[];
}

const POLL_MS = 30_000;
const TICK_MS = 5_000;

const INITIAL: StreamState = {
  payload: null,
  loading: true,
  error: null,
  auto: true,
  now: 0,
  loadingMore: [],
  moreError: null,
  tab: "streamers",
  sections: ["streamers"],
};

let state: StreamState = INITIAL;
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let requestSeq = 0;
let inflight = false;
/** Short follow-up poll while sentiment scoring runs in the background. */
let scoringTimer: ReturnType<typeof setTimeout> | null = null;
const SCORING_POLL_MS = 6_000;

function set(patch: Partial<StreamState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

/** The server's own message when it sent one, e.g. a missing SESSION_SECRET. */
async function errorText(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // not JSON
  }
  return `${fallback} (${response.status})`;
}

/** `force` bypasses the server cache (paid); `urgent` only skips the client's in-flight guard. */
async function load(force: boolean, urgent = false) {
  if (inflight && !force && !urgent) return;
  const seq = ++requestSeq;
  inflight = true;
  set({ loading: true });
  try {
    const query = new URLSearchParams();
    if (force) query.set("force", "1");
    query.set("sections", state.sections.join(","));
    const response = await fetch(`/api/streams?${query}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await errorText(response, "Feed request failed"));
    const payload = (await response.json()) as StreamsPayload;
    // A newer request (a manual refresh or a load-more) supersedes this one.
    if (seq !== requestSeq) return;
    set({ payload, error: null, loading: false, now: Date.now() });
    followScoring(payload);
  } catch (error) {
    if (seq !== requestSeq) return;
    set({ error: error instanceof Error ? error.message : "Feed request failed", loading: false, now: Date.now() });
  } finally {
    if (seq === requestSeq) inflight = false;
  }
}

/** While reactions are being scored, check back soon instead of waiting for the next 30s poll. */
function followScoring(payload: StreamsPayload) {
  if (scoringTimer || !(payload.scoring.running || payload.scoring.pending > 0)) return;
  if (!state.sections.includes("reactions")) return;
  scoringTimer = setTimeout(() => {
    scoringTimer = null;
    if (listeners.size > 0) void load(false);
  }, SCORING_POLL_MS);
}

/**
 * Fetch the next page of the given feeds. Each paid page is one Composio
 * Instant call, so this only ever runs on a click, never on scroll.
 */
async function loadMore(ids: SourceId[]) {
  const wanted = ids.filter((id) => !state.loadingMore.includes(id));
  if (wanted.length === 0) return;
  // Any poll already in flight may predate the new page; discard its result.
  requestSeq++;
  set({ loadingMore: [...state.loadingMore, ...wanted], moreError: null });
  try {
    const response = await fetch("/api/streams/more", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: wanted, sections: state.sections }),
    });
    if (!response.ok) throw new Error(await errorText(response, "Load more failed"));
    const payload = (await response.json()) as StreamsPayload;
    requestSeq++;
    inflight = false;
    set({ payload, error: null, now: Date.now() });
    followScoring(payload);
  } catch (error) {
    set({ moreError: error instanceof Error ? error.message : "Load more failed" });
  } finally {
    set({ loadingMore: state.loadingMore.filter((id) => !wanted.includes(id)) });
  }
}

/** Keys shown on the button prompts. Ignored while typing in a field. */
function onKey(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  const target = event.target as HTMLElement | null;
  if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
  const key = event.key.toLowerCase();
  if (key === "1" || key === "2" || key === "3") streamStore.setTab(TABS[Number(key) - 1]);
  else if (key === "r") void load(true);
  else if (key === "a") set({ auto: !state.auto });
}

function start() {
  if (pollTimer) return;
  window.addEventListener("keydown", onKey);
  set({ now: Date.now() });
  if (!state.payload) void load(false);
  pollTimer = setInterval(() => {
    // A hidden tab should not spend money.
    if (state.auto && document.visibilityState === "visible") void load(false);
  }, POLL_MS);
  tickTimer = setInterval(() => set({ now: Date.now() }), TICK_MS);
}

function stop() {
  window.removeEventListener("keydown", onKey);
  if (pollTimer) clearInterval(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  if (scoringTimer) clearTimeout(scoringTimer);
  pollTimer = null;
  tickTimer = null;
  scoringTimer = null;
}

export const streamStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    start();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) stop();
    };
  },
  getSnapshot: () => state,
  getServerSnapshot: () => INITIAL,
  refresh: () => void load(true),
  loadMore: (ids: SourceId[]) => void loadMore(ids),
  setAuto: (auto: boolean) => set({ auto }),
  setTab(tab: Tab) {
    const section = SECTION_OF[tab];
    const opening = !state.sections.includes(section);
    set({ tab, sections: opening ? [...state.sections, section] : state.sections });
    // A newly opened section has nothing loaded yet: fetch now rather than at the next poll.
    if (opening) void load(false, true);
  },
};
