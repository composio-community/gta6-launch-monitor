/** Parse "258K", "1.3M", "218,356", "4 842" into a number. Returns null when there is no number. */
export function parseCount(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw) : null;
  if (!raw) return null;
  const m = raw.replace(/[  ]/g, " ").match(/(\d[\d.,\s]*)\s*([KkMmBb])?/);
  if (!m) return null;
  const suffix = m[2]?.toUpperCase();
  let digits = m[1].trim().replace(/\s/g, "");
  if (suffix) {
    // "1,3K" (decimal comma) and "1.3K" both mean 1300.
    digits = digits.replace(",", ".");
    const n = Number.parseFloat(digits);
    if (!Number.isFinite(n)) return null;
    const mult = suffix === "K" ? 1e3 : suffix === "M" ? 1e6 : 1e9;
    return Math.round(n * mult);
  }
  // No suffix: separators are thousands separators ("218,356", "218.356").
  const n = Number.parseInt(digits.replace(/[.,]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** First path segment of a channel link on `host`, e.g. "https://kick.com/neonnoodle" -> "neonnoodle". */
export function handleFromUrl(url: string | undefined, host: RegExp): string | null {
  if (!url) return null;
  const m = url.match(/^https?:\/\/([^/]+)\/([A-Za-z0-9_][A-Za-z0-9_-]*)\/?(?:[?#"\s].*)?$/);
  if (!m || !host.test(m[1])) return null;
  return m[2];
}

/** Undo markdown backslash escapes ("\|", "\*", "\_") and collapse whitespace. */
export function unescapeMd(raw: string | null | undefined): string {
  return (raw ?? "")
    .replace(/\\\n/g, " ")
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Depth-first search for the first array stored under `key`. */
export function findArray(value: unknown, key: string, depth = 0): unknown[] | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findArray(item, key, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (Array.isArray(record[key])) return record[key] as unknown[];
  for (const child of Object.values(record)) {
    const hit = findArray(child, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Depth-first search for the first string value stored under `key`. */
export function findString(value: unknown, key: string, depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findString(item, key, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === "string" && direct.length > 0) return direct;
  for (const child of Object.values(record)) {
    const hit = findString(child, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Tool results sometimes arrive as a JSON string; unwrap it when so. */
export function unwrapJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function cleanText(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/** Languages as Twitch and Kick label them, lower-cased. */
export const LANGUAGE_NAMES = new Set(
  [
    "English", "Español", "Spanish", "Português", "Portuguese", "Français", "French", "Deutsch", "German",
    "Italiano", "Italian", "Русский", "Russian", "Українська", "Ukrainian", "Polski", "Polish", "Türkçe", "Turkish",
    "العربية", "Arabic", "日本語", "Japanese", "한국어", "Korean", "中文", "Chinese", "Nederlands", "Dutch",
    "Svenska", "Swedish", "Suomi", "Finnish", "Norsk", "Norwegian", "Dansk", "Danish", "Čeština", "Czech",
    "Magyar", "Hungarian", "Română", "Romanian", "Ελληνικά", "Greek", "ภาษาไทย", "Thai", "Tiếng Việt",
    "Vietnamese", "Bahasa Indonesia", "Indonesian", "हिन्दी", "Hindi", "Tagalog", "Filipino", "Български",
    "Bulgarian", "Català", "Catalan", "Slovenčina", "Slovak", "עברית", "Hebrew",
  ].map((s) => s.toLowerCase()),
);
