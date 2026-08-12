/**
 * Scrub + gate terminal control sequences so they never become Composer text.
 *
 * WSL / Windows Terminal often split CSI (`\x1b[A`) across reads. ESC may be
 * handled alone while `[A` / `[B` land as printable characters. Some paths also
 * show ESC as caret notation `^[`.
 */

/** Force-disable all common mouse / focus tracking modes. */
export const DISABLE_MOUSE_TRACKING =
  '\x1b[?1006l\x1b[?1004l\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1001l';

const CSI_ANY = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
const SS3_ARROW = /\x1bO[ABCD]/g;
const ESC_PAIR = /\x1b[\s\S]/g;

/** `^[[A`, `^[[1;5B`, optional spaces: `^[ [B`. */
const CARET_CSI = /\^\[\s*\[+\s*[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
const CARET_ESC = /\^\[+/g;

const LEGACY_MOUSE = /\x1b\[M[\s\S]{3}/g;
const SGR_MOUSE_REMNANT = /\[<\d+;\d+;\d+[Mm]/g;

/** Remnant arrows; allow spaces; avoid `arr[A]`. */
const ARROW_REMNANT = /\[{1,2}\s*(?:\d+(?:;\d+)*)?[ABCD](?!\])/g;

const COMPLETE_CSI =
  /^\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]$|^\x1bO[ABCD]$/;
const VERTICAL_ARROW =
  /^\x1b\[(?:\d+(?:;\d+)*)?[AB]$|^\x1bO[AB]$/;
const HORIZONTAL_ARROW =
  /^\x1b\[(?:\d+(?:;\d+)*)?[CD]$|^\x1bO[CD]$/;
const PARTIAL_CSI = /^\x1b(?:\[[\x30-\x3f]*[\x20-\x2f]*|O)?$/;
const PARTIAL_CARET = /^\^\[?\s*\[{0,2}\s*[\x30-\x3f]*[\x20-\x2f]*$/;
const COMPLETE_CARET = /^\^\[\s*\[+\s*[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]$/;

export function scrubComposerBuffer(text: string): string {
  if (!text) return text;
  let out = text
    .replace(LEGACY_MOUSE, '')
    .replace(CSI_ANY, '')
    .replace(SS3_ARROW, '')
    .replace(ESC_PAIR, '')
    .replace(/\x1b/g, '')
    .replace(CARET_CSI, '')
    .replace(CARET_ESC, '')
    .replace(SGR_MOUSE_REMNANT, '')
    .replace(ARROW_REMNANT, '');
  out = out.replace(CARET_CSI, '').replace(ARROW_REMNANT, '');
  // Pure bracket/caret/arrow spam → wipe.
  if (out && !/[^\[\]\^ABCD\s\d;]/.test(out) && /[ABCD]/.test(out)) return '';
  return out;
}

/** @deprecated */
export function scrubTerminalInput(data: string): string {
  return scrubComposerBuffer(data);
}

export type IncomingFilter =
  | { action: 'pass'; data: string }
  | { action: 'consume' }
  | { action: 'replace'; data: string }
  | { action: 'scroll'; dir: 'up' | 'down' }
  | { action: 'escape' };

export function isVerticalArrowCsi(data: string): boolean {
  return VERTICAL_ARROW.test(data);
}

function classifyCompleteSequence(seq: string): IncomingFilter {
  if (VERTICAL_ARROW.test(seq)) {
    return { action: 'scroll', dir: seq.includes('A') ? 'up' : 'down' };
  }
  if (HORIZONTAL_ARROW.test(seq)) {
    return { action: 'pass', data: seq };
  }
  if (/^\x1b\[[0-9;]*[~HFP]$/.test(seq)) {
    return { action: 'pass', data: seq };
  }
  return { action: 'consume' };
}

/**
 * Stateless chunk filter (unit tests + fallback).
 * Live TUI should use `createInputGate()` so split CSI is assembled.
 */
export function filterIncomingChunk(data: string): IncomingFilter {
  if (!data) return { action: 'pass', data };

  if (data === '\x1b') return { action: 'escape' };

  if (COMPLETE_CSI.test(data)) return classifyCompleteSequence(data);

  if (COMPLETE_CARET.test(data)) {
    return /[AB]$/.test(data)
      ? { action: 'scroll', dir: /A$/.test(data) ? 'up' : 'down' }
      : { action: 'consume' };
  }

  if (
    data === '^['
    || /^\[{1,2}\s*[ABCD]$/.test(data)
  ) {
    if (/[AB]/.test(data)) {
      return { action: 'scroll', dir: data.includes('A') ? 'up' : 'down' };
    }
    return { action: 'consume' };
  }

  if (
    /^\x1b\[<\d+;\d+;\d+[Mm]$/.test(data)
    || /^\x1b\[[IO]$/.test(data)
    || (data.length === 6 && data.startsWith('\x1b[M'))
  ) {
    return { action: 'consume' };
  }

  if (!data.includes('\x1b') && !data.includes('^[') && !/\[</.test(data) && !ARROW_REMNANT.test(data)) {
    ARROW_REMNANT.lastIndex = 0;
    // Allow normal text; still reject lone `^`? keep — users type exponents.
    return { action: 'pass', data };
  }
  ARROW_REMNANT.lastIndex = 0;

  const cleaned = scrubComposerBuffer(data);
  if (!cleaned) return { action: 'consume' };
  if (cleaned !== data) return { action: 'replace', data: cleaned };
  return { action: 'pass', data };
}

export type InputGate = {
  feed: (data: string) => IncomingFilter;
  /** Call on a short interval; returns true once when a lone ESC timed out as Escape. */
  pollEscape: () => boolean;
  reset: () => void;
};

/**
 * Stateful gate: assembles split CSI / caret CSI so Editor never sees orphan `[B`.
 */
export function createInputGate(options?: { escTimeoutMs?: number }): InputGate {
  const escTimeoutMs = options?.escTimeoutMs ?? 35;
  let buf = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let escapePending = false;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const reset = () => {
    clearTimer();
    buf = '';
  };

  const feed = (data: string): IncomingFilter => {
    if (!data) return { action: 'pass', data };

    // --- continue ESC assembly ---
    if (buf.startsWith('\x1b')) {
      clearTimer();
      buf += data;
      if (COMPLETE_CSI.test(buf)) {
        const seq = buf;
        reset();
        return classifyCompleteSequence(seq);
      }
      if (PARTIAL_CSI.test(buf) && buf.length <= 32) {
        return { action: 'consume' };
      }
      // Invalid — drop ESC prefix, retry with this chunk alone.
      reset();
      return feed(data);
    }

    // --- continue caret assembly (`^[` …) ---
    if (buf.startsWith('^')) {
      buf += data;
      if (COMPLETE_CARET.test(buf)) {
        const seq = buf;
        reset();
        return /[AB]$/.test(seq)
          ? { action: 'scroll', dir: /A$/.test(seq) ? 'up' : 'down' }
          : { action: 'consume' };
      }
      if (PARTIAL_CARET.test(buf) && buf.length <= 24) {
        return { action: 'consume' };
      }
      reset();
      return { action: 'consume' };
    }

    // --- start ESC ---
    if (data === '\x1b') {
      buf = '\x1b';
      clearTimer();
      timer = setTimeout(() => {
        if (buf === '\x1b') {
          buf = '';
          escapePending = true;
        }
        timer = null;
      }, escTimeoutMs);
      return { action: 'consume' };
    }
    if (data.startsWith('\x1b')) {
      buf = data;
      if (COMPLETE_CSI.test(buf)) {
        const seq = buf;
        reset();
        return classifyCompleteSequence(seq);
      }
      if (PARTIAL_CSI.test(buf)) return { action: 'consume' };
      reset();
      return { action: 'consume' };
    }

    // --- start caret ---
    if (data === '^' || data.startsWith('^[')) {
      buf = data;
      if (COMPLETE_CARET.test(buf)) {
        const seq = buf;
        reset();
        return /[AB]$/.test(seq)
          ? { action: 'scroll', dir: /A$/.test(seq) ? 'up' : 'down' }
          : { action: 'consume' };
      }
      return { action: 'consume' };
    }

    // Orphan remnant when ESC was already eaten by something else.
    if (/^\[{1,2}\s*(?:\d+(?:;\d+)*)?[ABCD]$/.test(data)) {
      return /[AB]/.test(data)
        ? { action: 'scroll', dir: data.includes('A') ? 'up' : 'down' }
        : { action: 'consume' };
    }

    return filterIncomingChunk(data);
  };

  return {
    feed,
    pollEscape: () => {
      if (!escapePending) return false;
      escapePending = false;
      return true;
    },
    reset,
  };
}

export function isTerminalJunkInput(data: string): boolean {
  if (!data) return false;
  const filtered = filterIncomingChunk(data);
  return filtered.action === 'consume'
    || filtered.action === 'scroll'
    || filtered.action === 'escape'
    || scrubComposerBuffer(data).length === 0;
}
