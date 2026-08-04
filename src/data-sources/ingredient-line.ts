// Shared by Grocery List and Recipe Vault — both speak the same "qty/unit/name"
// ingredient shape, parsed from a single frictionless text entry rather than
// separate form fields. A small tokenizer (quantity token, then unit token,
// then whatever's left is the name) rather than one mega-regex — the old
// single-regex version had two real bugs: short unit abbreviations
// partial-matching inside unrelated words ("4 Large eggs" -> unit "l", name
// "arge eggs", since the "l" alternative had no word-boundary anchor), and no
// support at all for mixed numbers ("1 1/2 cups") or Unicode fraction glyphs
// ("1½ cups") — both split the quantity apart from its unit incorrectly.
// qty is a real number (not a display string) so it can be scaled — see
// formatQty() for turning it back into a clean cooking-friendly display.

// Recipe sites frequently format ingredients with an embedded shopping link,
// e.g. "1 cup [milk](https://amzn.to/...)" — pasted verbatim into Obsidian
// this is fine as markdown, but left un-stripped it breaks both display
// (raw "[milk](https://...)" shown as text) and search/filter (matching
// against the URL text, not just "milk"). Only well-formed [text](url) pairs
// are touched; a stray/unclosed "[" from a bad paste is left as plain text.
const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

function extractFirstLinkUrl(s: string): string | null {
  MD_LINK_RE.lastIndex = 0;
  const m = MD_LINK_RE.exec(s);
  return m ? m[2].trim() : null;
}

function stripMarkdownLinks(s: string): string {
  return s.replace(MD_LINK_RE, '$1');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Quantity token ──────────────────────────────────────────────────────────

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};
const UNICODE_FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join('');

interface QtyToken { value: number; length: number; }

// Tried longest/most-specific pattern first — a plain "\d+" check first
// would grab just the "1" out of "1 1/2" and leave "1/2" dangling as part of
// the name, which was the original mixed-number bug.
function parseLeadingQuantity(s: string): QtyToken | null {
  let m = /^(\d+)\s+(\d+)\/(\d+)\b/.exec(s);           // "1 1/2"
  if (m) {
    const den = parseInt(m[3], 10);
    if (den !== 0) return { value: parseInt(m[1], 10) + parseInt(m[2], 10) / den, length: m[0].length };
  }

  m = /^(\d+)\/(\d+)\b/.exec(s);                        // "1/2"
  if (m) {
    const den = parseInt(m[2], 10);
    if (den !== 0) return { value: parseInt(m[1], 10) / den, length: m[0].length };
  }

  m = new RegExp(`^(\\d+)([${UNICODE_FRACTION_CHARS}])`).exec(s);   // "1½"
  if (m) return { value: parseInt(m[1], 10) + UNICODE_FRACTIONS[m[2]], length: m[0].length };

  m = new RegExp(`^([${UNICODE_FRACTION_CHARS}])`).exec(s);          // "½"
  if (m) return { value: UNICODE_FRACTIONS[m[1]], length: m[0].length };

  m = /^(\d+(?:\.\d+)?)\b/.exec(s);                     // "2", "1.5"
  if (m) return { value: parseFloat(m[1]), length: m[0].length };

  // Ranges ("2-3") are intentionally not parsed as a quantity — scaling a
  // range isn't well-defined. Left as plain name text, same as anything else
  // unrecognized.
  return null;
}

// ── Unit token ──────────────────────────────────────────────────────────────

interface UnitDef { canonical: string; aliases: string[]; }

const UNIT_TABLE: UnitDef[] = [
  { canonical: 'tsp',   aliases: ['teaspoons', 'teaspoon', 'tsp'] },
  { canonical: 'tbsp',  aliases: ['tablespoons', 'tablespoon', 'tbsp', 'tbs'] },
  { canonical: 'fl oz', aliases: ['fluid ounces', 'fluid ounce', 'fl oz', 'floz'] },
  { canonical: 'cup',   aliases: ['cups', 'cup'] },
  { canonical: 'pt',    aliases: ['pints', 'pint', 'pt'] },
  { canonical: 'qt',    aliases: ['quarts', 'quart', 'qt'] },
  { canonical: 'gal',   aliases: ['gallons', 'gallon', 'gal'] },
  { canonical: 'ml',    aliases: ['milliliters', 'milliliter', 'millilitres', 'millilitre', 'ml'] },
  { canonical: 'l',     aliases: ['liters', 'liter', 'litres', 'litre', 'l'] },
  { canonical: 'oz',    aliases: ['ounces', 'ounce', 'oz'] },
  { canonical: 'lb',    aliases: ['pounds', 'pound', 'lbs', 'lb'] },
  { canonical: 'g',     aliases: ['grams', 'gram', 'g'] },
  { canonical: 'kg',    aliases: ['kilograms', 'kilogram', 'kg'] },
  { canonical: 'clove', aliases: ['cloves', 'clove'] },
  { canonical: 'can',   aliases: ['cans', 'can'] },
  { canonical: 'pkg',   aliases: ['packages', 'package', 'pkgs', 'pkg'] },
  { canonical: 'pinch', aliases: ['pinches', 'pinch'] },
  { canonical: 'dash',  aliases: ['dashes', 'dash'] },
  { canonical: 'stick', aliases: ['sticks', 'stick'] },
  { canonical: 'slice', aliases: ['slices', 'slice'] },
  { canonical: 'piece', aliases: ['pieces', 'piece'] },
  { canonical: 'bunch', aliases: ['bunches', 'bunch'] },
  { canonical: 'head',  aliases: ['heads', 'head'] },
];

const ALIAS_TO_CANONICAL = new Map<string, string>();
const ALL_ALIASES: string[] = [];
for (const unit of UNIT_TABLE) {
  for (const alias of unit.aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase(), unit.canonical);
    ALL_ALIASES.push(alias);
  }
}
// Longest-first is defensive belt-and-suspenders — the trailing \b below is
// what actually prevents "l" from matching inside "Large" (the position
// right after a single "l" in "Large" sits between two word characters, so
// \b fails there and the regex engine backtracks to try the next alias,
// eventually failing the whole match rather than accepting a bad partial one).
ALL_ALIASES.sort((a, b) => b.length - a.length);
const UNIT_RE = new RegExp(`^(${ALL_ALIASES.map(escapeRegex).join('|')})\\b`, 'i');

function matchLeadingUnit(s: string): { canonical: string; length: number } | null {
  const m = UNIT_RE.exec(s);
  if (!m) return null;
  const canonical = ALIAS_TO_CANONICAL.get(m[1].toLowerCase());
  return canonical ? { canonical, length: m[0].length } : null;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface ParsedIngredientLine {
  qty:  number | null;   // real number, for scaling math — use formatQty() to display
  unit: string | null;   // canonical unit key (e.g. "tbsp", "cup", "g"), or null
  name: string;
  url:  string | null;   // first embedded link's target, if any — Recipe Vault renders `name` as a clickable link when present; Grocery List ignores it
}

export function parseIngredientLine(raw: string): ParsedIngredientLine {
  const url = extractFirstLinkUrl(raw);
  let rest = stripMarkdownLinks(raw).trim();

  let qty: number | null = null;
  const qtyToken = parseLeadingQuantity(rest);
  if (qtyToken) {
    qty = qtyToken.value;
    rest = rest.slice(qtyToken.length).trim();
  }

  let unit: string | null = null;
  const unitToken = matchLeadingUnit(rest);
  if (unitToken) {
    unit = unitToken.canonical;
    rest = rest.slice(unitToken.length).trim();
  }

  return { qty, unit, name: rest, url };
}

// Nearest-clean-fraction formatter — cooking measurement tools don't support
// arbitrary decimals anyway, so scaling results (or a directly-typed "0.5")
// always snap to the closest of these denominators rather than printing a
// raw decimal like "0.43".
const NICE_DENOMINATORS = [2, 3, 4, 6, 8];

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function formatQty(value: number): string {
  if (value <= 0) return '0';

  const rounded = Math.round(value * 1000) / 1000; // kill float noise before splitting
  const whole = Math.floor(rounded);
  const frac = rounded - whole;

  if (frac < 0.02) return String(whole);
  if (frac > 0.98) return String(whole + 1);

  let bestNum = 0, bestDen = 1, bestErr = Infinity;
  for (const den of NICE_DENOMINATORS) {
    const num = Math.round(frac * den);
    if (num === 0 || num === den) continue;
    const err = Math.abs(frac - num / den);
    if (err < bestErr) { bestErr = err; bestNum = num; bestDen = den; }
  }
  if (bestNum === 0) return String(Math.round(rounded));

  const g = gcd(bestNum, bestDen);
  const num = bestNum / g, den = bestDen / g;
  return whole > 0 ? `${whole} ${num}/${den}` : `${num}/${den}`;
}

export function formatIngredientLine(p: ParsedIngredientLine): string {
  const qtyStr = p.qty !== null ? formatQty(p.qty) : null;
  return [qtyStr, p.unit, p.name].filter((s): s is string => !!s && s.length > 0).join(' ');
}
