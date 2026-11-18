export type PostSort = "newest" | "oldest" | "views" | "likes";

export const POST_SORTS: { id: PostSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "views", label: "Most views" },
  { id: "likes", label: "Most liked" },
];

/** Anything with a time and engagement counts: social posts and reactions. */
interface Sortable {
  createdAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
}

const time = (p: Sortable) => (p.createdAt ? Date.parse(p.createdAt) : 0);
const engagement = (p: Sortable) => (p.likes ?? 0) + (p.comments ?? 0);

/**
 * Only X (and some Instagram posts) report views. For "Most views", posts
 * without them come after, ranked by likes plus comments; ties go to the newest.
 */
export function sortPosts<T extends Sortable>(posts: T[], sort: PostSort): T[] {
  return [...posts].sort((a, b) => {
    if (sort === "oldest") return time(a) - time(b);
    if (sort === "views") {
      if ((a.views === null) !== (b.views === null)) return a.views === null ? 1 : -1;
      if (a.views !== null && b.views !== null && a.views !== b.views) return b.views - a.views;
      if (engagement(a) !== engagement(b)) return engagement(b) - engagement(a);
    }
    if (sort === "likes") {
      if ((a.likes ?? -1) !== (b.likes ?? -1)) return (b.likes ?? -1) - (a.likes ?? -1);
      if ((a.comments ?? -1) !== (b.comments ?? -1)) return (b.comments ?? -1) - (a.comments ?? -1);
    }
    return time(b) - time(a);
  });
}
