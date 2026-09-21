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
  /**
   * Something entered the window that the pre-submit snapshot cannot explain:
   * either the list grew, or an unknown poster took a position in a list of the
   * same length. The second shape is the common one on flow.google because the
   * gallery is virtualised to a fixed number of tiles, so a finished render
   * *replaces* the oldest tile instead of appending. Without this a real clip is
   * invisible and the node dies with a false TIMEOUT (live run 882a2552).
   */
  appeared: boolean;
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
 * `candidates` is non-empty whenever a tile cannot be explained by the snapshot.
 * That is safe because a candidate is only ever *claimed* after the editor prompt
 * of the opened clip matches the submitted prompt, so an unrelated re-render can
 * cost an extra click but can never produce a false success. `rotated` is still
 * reported so a caller can tell a proven-new tile from a merely-suspicious one.
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
  // The list did not have to grow: on a virtualised gallery the new clip lands at
  // the newest position and the window shifts, so an unexplained poster is treated
  // as a possible arrival. Position 0 leads because the gallery is newest-first.
  const appeared = grew || unknownIndexes.length > 0;
  // Opening a wrong tile is harmless because the caller verifies the editor prompt,
  // so the list is ordered for speed rather than for certainty.
  // When the window grew, position 0 leads because the gallery is newest-first and
  // the remaining positions are only a guess. When it did not grow, the only
  // plausible arrival is a tile whose poster the snapshot cannot explain, so the
  // candidate list stays tight instead of opening the whole gallery on a re-sign.
  const candidates = grew
    ? Array.from(new Set([0, ...unknownIndexes, ...now.tokens.map((_, index) => index)])).slice(0, maxCandidates)
    : appeared
      ? unknownIndexes.slice(0, maxCandidates)
      : [];

  return {
    grew,
    appeared,
    unknownIndexes,
    candidates,
    rotated: !grew && rotatedIndexes.length > 0,
  };
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

/**
 * Leading phrases Flow uses for the *empty* video composer.
 *
 * Live probing on /edit/<mediaId> (2026-09-05) found the rich-text editor holds
 * a localised placeholder — "Mô tả cách chỉnh sửa video này…" — rather than the
 * clip's prompt. If that text is ever compared against a node prompt it produces
 * a guaranteed mismatch, so it is filtered out wherever editor text is read.
 * The list is injected into the page-side evaluation, hence a plain array.
 */
export const EDITOR_PLACEHOLDER_PREFIXES: string[] = [
  'mô tả cách chỉnh sửa',
  'describe how to edit',
  'describe your edit',
  'add a prompt',
  'enter a prompt',
  'nhập prompt',
];

/** Whether editor text is really Flow's empty-composer placeholder, not a prompt. */
export function isEditorPlaceholder(text: string): boolean {
  const seen = normalizePrompt(text);
  if (!seen) return true;
  return EDITOR_PLACEHOLDER_PREFIXES.some((prefix) => seen.startsWith(prefix));
}

/**
 * Attribution helper for new gallery image mediaIds.
 *
 * An image candidate is accepted when its exact requested mediaId matches a candidate
 * that is proven to carry the submitted prompt, or when no candidate mismatches.
 */
export interface ImageCandidateAttribution {
  mediaId: string;
  editorPrompt?: string;
  matchedPrompt?: boolean;
}

export function selectAttributedImageMediaId(args: {
  candidates: ImageCandidateAttribution[];
  expectedPrompt: string;
}): string | undefined {
  const expected = (args.expectedPrompt ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!expected) return undefined;
  for (const candidate of args.candidates) {
    if (!candidate.mediaId) continue;
    if (candidate.matchedPrompt) return candidate.mediaId;
    if (candidate.editorPrompt && editorPromptMatches(candidate.editorPrompt, expected)) {
      return candidate.mediaId;
    }
  }
  return undefined;
}
