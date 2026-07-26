// Lao ↔ Karaoke translator. Logic mirrors original site (chanthachonepimmasone.github.io/Laokaraoke).
import { fullMap } from "./dictionary";

// Community words approved by an admin are merged on top of the built-in map.
let activeMap: Record<string, string> = { ...fullMap };
let sortedKeys = Object.keys(activeMap).sort((a, b) => b.length - a.length);

/** Merge admin-approved community words into the active dictionary. */
export function setCommunityWords(entries: Array<{ lao: string; karaoke: string }>): void {
  activeMap = { ...fullMap };
  for (const e of entries) {
    const lao = e.lao?.trim();
    const karaoke = e.karaoke?.trim().toLowerCase();
    if (!lao || !karaoke || fullMap[lao]) continue;
    activeMap[lao] = karaoke;
    if (!activeMap[karaoke]) activeMap[karaoke] = lao;
  }
  sortedKeys = Object.keys(activeMap).sort((a, b) => b.length - a.length);
}

/** True when the word already exists in the built-in dictionary. */
export function hasWord(lao: string): boolean {
  return Boolean(fullMap[lao.trim()]);
}


const seg =
  typeof Intl !== "undefined" && (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function getGraphemes(str: string): string[] {
  if (seg) return [...seg.segment(str)].map((s) => s.segment);
  const COMB = /[\u0EB0-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECB\u0ECD]/;
  const PRE = /[\u0EC0-\u0EC4]/;
  const out: string[] = [];
  let i = 0;
  while (i < str.length) {
    let g = str[i];
    if (PRE.test(str[i]) && i + 1 < str.length) {
      g += str[i + 1];
      i += 2;
    } else {
      i++;
    }
    while (i < str.length && COMB.test(str[i])) g += str[i++];
    out.push(g);
  }
  return out;
}

export function translateKaraokeToLao(text: string): string {
  const lower = text.toLowerCase();
  const len = lower.length;
  let result = "";
  let i = 0;
  while (i < len) {
    if (/\s/.test(lower[i])) {
      i++;
      continue;
    }
    let matched = false;
    for (const key of sortedKeys) {
      if (lower.substr(i, key.length) === key) {
        result += fullMap[key];
        i += key.length;
        matched = true;
        break;
      }
    }
    if (!matched) result += lower[i++];
  }
  return result;
}

export function translateLaoToKaraoke(text: string): string {
  const len = text.length;
  let result = "";
  let i = 0;
  while (i < len) {
    if (/\s/.test(text[i])) {
      result += text[i++];
      continue;
    }
    let matched = false;
    for (const key of sortedKeys) {
      if (text.substr(i, key.length) === key) {
        if (result && !/\s/.test(result[result.length - 1])) result += " ";
        result += fullMap[key];
        i += key.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const cluster = getGraphemes(text.slice(i, Math.min(i + 8, len)))[0] || text[i];
      if (result && !/\s/.test(result[result.length - 1])) result += " ";
      result += cluster;
      i += cluster.length;
    }
  }
  return result.trim();
}

export type Direction = "lao-to-karaoke" | "karaoke-to-lao";

export function translate(text: string, dir: Direction): string {
  if (!text.trim()) return "";
  return dir === "lao-to-karaoke" ? translateLaoToKaraoke(text) : translateKaraokeToLao(text);
}
