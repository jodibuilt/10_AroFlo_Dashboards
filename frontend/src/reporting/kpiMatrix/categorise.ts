// Derive a single failure_category per row from the Description field.
// These are conditions present on the job, NOT confirmed causes of delay.

import {
  CATEGORY_RULES,
  DEFAULT_CATEGORY,
  KNOWN_FIELD_LABELS,
  NO_ACCESS_NOTES_LITERAL,
  SPECIAL_ACCESS_LABEL,
  SUPPLIER_BLANK_PREFIXES,
  SUPPLIER_LABEL,
} from './config';

const RULES = new Map(CATEGORY_RULES);

export function prepareText(raw: string | null | undefined): string {
  if (!raw) return '';
  // 1. strip HTML tags: split on '<', keep everything after '>' in each fragment
  const parts: string[] = [];
  for (const frag of String(raw).split('<')) {
    const gt = frag.indexOf('>');
    parts.push(gt === -1 ? frag : frag.slice(gt + 1));
  }
  let text = parts.join(' ');
  // 2. lowercase   3. collapse whitespace
  text = text.toLowerCase().replace(/\s+/g, ' ').trim();
  // 4. remove the literal 'no access notes' — NOT optional
  text = text.split(NO_ACCESS_NOTES_LITERAL).join(' ').replace(/\s+/g, ' ').trim();
  return text;
}

function fieldValue(text: string, label: string): string | null {
  const idx = text.indexOf(label);
  if (idx === -1) return null;
  const rest = text.slice(idx + label.length);
  let cut = rest.length;
  for (const other of KNOWN_FIELD_LABELS) {
    if (other === label) continue;
    const pos = rest.indexOf(other);
    if (pos !== -1) cut = Math.min(cut, pos);
  }
  return rest.slice(0, cut).trim();
}

function hasSupplierGap(text: string): boolean {
  const val = fieldValue(text, SUPPLIER_LABEL);
  if (val === null) return false;
  if (val === '') return true;
  return SUPPLIER_BLANK_PREFIXES.some((p) => val.startsWith(p));
}

function hasSpecialAccess(text: string): boolean {
  return Boolean(fieldValue(text, SPECIAL_ACCESS_LABEL));
}

function keywordHit(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

export function categoriseOne(raw: string | null | undefined): string {
  const text = prepareText(raw);
  if (!text) return DEFAULT_CATEGORY;

  if (keywordHit(text, RULES.get('flooding')!)) return 'flooding';
  if (hasSupplierGap(text)) return 'no supplier assigned';
  if (keywordHit(text, RULES.get('specialist trade required')!)) return 'specialist trade required';
  if (keywordHit(text, RULES.get('materials required')!)) return 'materials required';
  if (keywordHit(text, RULES.get('access coordination required')!) || hasSpecialAccess(text)) {
    return 'access coordination required';
  }
  if (keywordHit(text, RULES.get('multi-item scope')!)) return 'multi-item scope';
  if (keywordHit(text, RULES.get('repeat visit')!)) return 'repeat visit';
  return DEFAULT_CATEGORY;
}
