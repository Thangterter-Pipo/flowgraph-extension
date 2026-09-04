// Pure helpers behind the "did my I2V render finish yet?" decision in
// handleGenerate. The DOM reading itself has to happen inside the page via CDP,
// but the *reasoning* over the snapshots is plain data and is the part that has
// repeatedly produced false TIMEOUTs, so it lives here where it can be unit
// tested against the shapes observed on the real flow.google gallery.
//
// Observed facts (live probing, 2026-09-05):
//  * A generated video is a <flow-video-tile> that only appears once the render
//    finishes; its poster <img> is lazy, so a tile can briefly have no src.
//  * The gallery is newest-first: index 0 is the most recent media.
//  * Poster URLs are signed and get rotated, so a token can change on an *old*
//    tile without any new generation having happened.

export interface VideoTileSnapshot {
  /** One poster token per `flow-video-tile` in DOM order; '' when not loaded. */
  tokens: string[];
}

export interface VideoTileVerdict {
  /** The tile list grew past the pre-submit snapshot, so a new clip exists. */
  grew: boolean;
  /** Tile indexes whose poster token the pre-submit snapshot cannot explain. */
  unknownIndexes: number[];
  /**
   * Indexes worth opening, best guess first. Only meaningful when `grew`:
   * newest-first position 0 leads, then any other unexplained tile. Each candidate
   * still has to be confirmed against the submitted prompt in the editor.
   */
  candidates: number[];
  /**
   * Posters changed on tiles the snapshot already knew about. Because Flow rotates
   * signed poster URLs this is normally cosmetic, so it must never fail a node.
   */
  rotated: boolean;
}

/**
 * Compare the pre-submit and current per-tile poster tokens.
 *
 * Deliberately conservative: `candidates` is non-empty only when the tile count
 * actually grew. A same-length list with changed tokens is reported as `rotated`
 * so the caller keeps waiting instead of claiming an older clip.
 */
export function decideVideoTileArrival(
  before: VideoTileSnapshot,
  now: VideoTileSnapshot,
  maxCandidates = 4,
): VideoTileVerdict {
  const known = new Set(before.tokens.filter(Boolean));
  const unknownIndexes: number[] = [];
  const rotatedIndexes: number[] = [];

  now.tokens.forEach((token, index) => {
    if (!token) return;
    if (known.has(token)) return;
    unknownIndexes.push(index);
    // The old tile at this position had a poster we recognised, so this is a
    // rotation of an existing clip rather than a new one.
    if (index < before.tokens.length && before.tokens[index]) rotatedIndexes.push(index);
  });

  const grew = now.tokens.length > before.tokens.length;
  // When the list grew there is definitely a new tile, but its position is only a
  // strong guess: newest-first (index 0), backed by any tile whose poster token the
  // snapshot cannot explain, backed by the remaining tiles in order. Opening a
  // wrong tile is harmless because the caller verifies the editor prompt, so the
  // list is ordered for speed rather than for certainty.
  const candidates = grew
    ? Array.from(new Set([0, ...unknownIndexes, ...now.tokens.map((_, index) => index)])).slice(0, maxCandidates)
    : [];

  return { grew, unknownIndexes, candidates, rotated: !grew && rotatedIndexes.length > 0 };
}

/**
 * Whether an editor page's prompt proves the clip belongs to this node.
 *
 * Flow's composer can decorate the text (model chips, whitespace), so a prefix
 * comparison is used instead of exact equality. An empty expected prompt cannot
 * be verified this way and returns false rather than matching everything.
 */
export function editorPromptMatches(editorPrompt: string, expectedPrompt: string): boolean {
  const expected = normalizePrompt(expectedPrompt);
  if (!expected) return false;
  const seen = normalizePrompt(editorPrompt);
  if (!seen) return false;
  return seen.includes(expected.slice(0, Math.min(40, expected.length)));
}

function normalizePrompt(value: string): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}
