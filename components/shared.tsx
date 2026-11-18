"use client";

import { useState } from "react";
import { ago, usd } from "@/lib/format";
import {
  REACTION_PLATFORMS,
  SOCIAL_PLATFORMS,
  type Platform,
  type ReactionPlatform,
  type SocialPlatform,
  type SourceId,
  type ScoringStatus,
  type SourceStatus,
} from "@/lib/types";
import { streamStore } from "./stream-store";

export const PLATFORM_LABEL: Record<Platform, string> = { twitch: "Twitch", kick: "Kick", youtube: "YouTube" };
export const SOCIAL_LABEL: Record<SocialPlatform, string> = { x: "X", reddit: "Reddit", instagram: "Instagram", linkedin: "LinkedIn" };
export const REACTION_LABEL: Record<ReactionPlatform, string> = {
  x: "X",
  reddit: "Reddit",
  youtube: "YouTube",
  instagram: "Instagram",
  linkedin: "LinkedIn",
};
export const SOURCE_LABEL: Record<SourceId, string> = {
  ...PLATFORM_LABEL,
  ...SOCIAL_LABEL,
  ...(Object.fromEntries(REACTION_PLATFORMS.map((p) => [`react-${p}`, `${REACTION_LABEL[p]} reactions`])) as Record<
    `react-${ReactionPlatform}`,
    string
  >),
};
export const isSocial = (id: string): id is SocialPlatform => (SOCIAL_PLATFORMS as string[]).includes(id);

export const STATE_LABEL: Record<SourceStatus["state"], string> = {
  live: "Fresh",
  cached: "Cached",
  snapshot: "Demo",
  error: "Failed",
  budget: "Paused",
  "signed-out": "Signed out",
  idle: "Not loaded",
};

export function Feeds({ sources, now, scoring }: { sources: SourceStatus[]; now: number; scoring?: ScoringStatus }) {
  return (
    <section className="feeds" aria-label="Data feeds">
      <h2>Feeds</h2>
      <ul>
        {sources.map((s) => (
          <li key={s.source} data-platform={s.source.replace(/^react-/, "")} data-state={s.state}>
            <span className="feed-name">{SOURCE_LABEL[s.source]}</span>
            <code>{s.tool}</code>
            <span className="feed-state">{STATE_LABEL[s.state]}</span>
            <span className="feed-meta">
              {s.count} {isSocial(s.source) || s.source.startsWith("react-") ? (s.count === 1 ? "post" : "posts") : "live"}
              {s.lastChargeUsd !== null ? ` · ${usd(s.lastChargeUsd)}${s.chargeEstimated ? " est." : ""} last call` : ""}
              {s.fetchedAt ? ` · ${ago(s.fetchedAt, now)}` : ""}
            </span>
            {s.error ? (
              <span className="feed-error">
                {s.error}
                {s.state === "error" ? " Retrying automatically in about 30 seconds." : ""}
              </span>
            ) : null}
          </li>
        ))}
        {scoring ? (
          <li data-state={scoring.error ? "error" : scoring.running ? "live" : "cached"}>
            <span className="feed-name">Sentiment</span>
            <code>{scoring.tool}</code>
            <span className="feed-state">{scoring.error ? "Failed" : scoring.running ? "Scoring" : "Done"}</span>
            <span className="feed-meta">
              {scoring.scored} scored{scoring.pending ? ` · ${scoring.pending} to go` : ""}
              {scoring.lastChargeUsd !== null ? ` · ${usd(scoring.lastChargeUsd)} last batch` : ""}
            </span>
            {scoring.error ? <span className="feed-error">{scoring.error}</span> : null}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export function Avatar({ src, name, className }: { src: string | null; name: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className={`${className} blank`}>{name.replace(/^[@u/]+/, "").slice(0, 1).toUpperCase()}</span>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={className} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
  );
}

export function LoadMore({
  ids,
  statuses,
  loadingMore,
  noun,
  endNote,
}: {
  ids: SourceId[];
  statuses: Map<SourceId, SourceStatus>;
  loadingMore: SourceId[];
  noun: string;
  endNote: string;
}) {
  const ready = ids.filter((id) => statuses.get(id)?.hasMore);
  const busy = ids.some((id) => loadingMore.includes(id));
  if (!busy && ready.length === 0) return <p className="more-end">{endNote}</p>;
  const cost = ready.reduce((sum, id) => sum + (statuses.get(id)?.moreCostUsd ?? 0), 0);
  const what = ready.length === 1 ? statuses.get(ready[0])?.moreLabel : `${ready.length} feeds`;
  return (
    <button type="button" className="more" disabled={busy} onClick={() => streamStore.loadMore(ready)}>
      {busy ? (
        <>
          <i className="spinner" /> Loading more {noun}
        </>
      ) : (
        <>
          Load more {noun}
          <small>
            {what} · {cost === 0 ? "free" : `about ${usd(cost)}`}
          </small>
        </>
      )}
    </button>
  );
}

/** A row of the sidebar's filter lists. */
export function Row({
  pressed,
  onClick,
  label,
  count,
  platform,
  title,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  count?: number | string;
  platform?: string;
  title?: string;
}) {
  return (
    <li data-platform={platform}>
      <button type="button" aria-pressed={pressed} onClick={onClick} title={title}>
        <span>
          {platform ? <i className="dot" /> : null}
          {label}
        </span>
        {count === undefined ? null : <span>{count}</span>}
      </button>
    </li>
  );
}
