/**
 * Shared "已played" set, persisted in localStorage and keyed by audio_url.
 * Both VoicePlayerInline (manual play) and AutoplayManager (auto-advance) read
 * and write the SAME set, so "what has the user already heard" is one source of
 * truth — the auto-advance can skip clips a manual click already played, and
 * vice-versa.
 */
const PLAYED_KEY = "mc-voice-played";
const CAP = 500;

export function getPlayedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

export function isPlayed(url: string): boolean {
  return getPlayedSet().has(url);
}

export function markPlayed(url: string): void {
  const s = getPlayedSet();
  if (s.has(url)) return;
  s.add(url);
  const arr = [...s];
  if (arr.length > CAP) arr.splice(0, arr.length - CAP);
  localStorage.setItem(PLAYED_KEY, JSON.stringify(arr));
}
