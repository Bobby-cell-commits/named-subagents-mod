// Custom names: pure logic, no engine calls, so it is unit-tested with plain node.
//
// A names file (and the install screen's `names` list) is parsed into a Custom, and one or
// more Customs are layered onto the built-in pool: user file, then project file, then the
// install screen. `/names` edits the user file through the functions at the bottom.

import type { Category, Pool } from './draw.ts';

/** The Agent tool's own rule for `name`; a call carrying anything else is refused. */
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_LEN = 60; // leaves room for the "-2" suffix of an exhausted pool
const FALLBACK = 'default';

/**
 * Makes a typed name one the Agent tool accepts: accents dropped, apostrophes dropped,
 * words joined ("Mary Shelley" -> "MaryShelley"). Undefined when nothing usable is left.
 */
export function cleanName(raw: string): string | undefined {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw.trim())) return undefined; // no name holds a control character; not worth salvaging
  const parts = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '')
    .split(/[^A-Za-z0-9_-]+/).filter(p => p !== '');
  const joined = parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('')
    .replace(/^[_-]+/, '').slice(0, MAX_LEN);
  return NAME_RE.test(joined) ? joined : undefined;
}

export type CustomSet = { names: string[]; for: string[]; keywords: string[]; replace: boolean };
export type Custom = {
  /** Leave out everything layered before this (the built-in names included). */
  only: boolean;
  /** The pool every agent draws from; absent or "auto" picks by agent type and task. */
  use?: string;
  /** Names that join every pool except the sets the files define themselves. */
  names: string[];
  /** Names never drawn. */
  remove: string[];
  /** Old name -> new name. */
  rename: Record<string, string>;
  /** A new pool, or more names (or with `replace`, other names) for a built-in one. */
  sets: Record<string, CustomSet>;
};
export type Parsed = { custom: Custom; problems: string[]; cleaned: string[] };

export const emptyCustom = (): Custom => ({ only: false, names: [], remove: [], rename: {}, sets: {} });

const lower = (s: string) => s.toLowerCase();
function uniq(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter(n => !seen.has(lower(n)) && !!seen.add(lower(n)));
}
/**
 * A names file is untrusted input (a project's arrives with the repository), so what is read
 * from one is bounded: the file's size, how many names, sets and routes it may hold, and how
 * many problems are kept to report.
 */
export const LIMITS = { fileChars: 256 * 1024, names: 2000, sets: 100, routes: 200, problems: 20 } as const;

/**
 * Text safe to show in a terminal: control characters (escape sequences among them) and the
 * characters that reorder text become "?". Newlines stay.
 */
export const printable = (s: string) => s.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '?');

/** A bad entry as a problem quotes it: short, on one line, and printable, whatever it held. */
const quote = (v: unknown) => {
  const t = printable(typeof v === 'string' ? v : JSON.stringify(v) ?? String(v)).replace(/\s+/g, ' ').trim();
  return `"${t.length > 40 ? `${t.slice(0, 40)}…` : t}"`;
};
/** At most LIMITS.problems lines, each printable; the rest are counted. */
function bounded(lines: string[], label: string, what: string): string[] {
  const safe = lines.slice(0, LIMITS.problems).map(t => printable(t).replace(/\n/g, ' '));
  return lines.length > LIMITS.problems ? [...safe, `${label}: and ${lines.length - LIMITS.problems} more ${what}`] : safe;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A list of names from a JSON array of strings or one comma-separated string (or a list of those). */
function nameList(v: unknown, where: string, p: Parsed): string[] {
  let raw = typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v.flatMap(x => (typeof x === 'string' ? x.split(',') : [x])) : undefined;
  if (raw === undefined) { p.problems.push(`${where} must be a list of names`); return []; }
  if (raw.length > LIMITS.names) { p.problems.push(`${where}: only the first ${LIMITS.names} names are read`); raw = raw.slice(0, LIMITS.names); }
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== 'string') { p.problems.push(`${where}: ${quote(r)} is not a name`); continue; }
    if (r.trim() === '') continue;
    const c = cleanName(r);
    if (c === undefined) { p.problems.push(`${where}: ${quote(r)} cannot be a name (letters, digits, _ and - only)`); continue; }
    if (c !== r.trim()) p.cleaned.push(`${quote(r)} -> ${c}`);
    out.push(c);
  }
  return uniq(out);
}

function textList(v: unknown, where: string, p: Parsed): string[] {
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) { p.problems.push(`${where} must be a list of strings`); return []; }
  if (v.length > LIMITS.routes) p.problems.push(`${where}: only the first ${LIMITS.routes} entries are read`);
  // Shown by /names and matched against agent types and task text: one printable line each.
  return (v as string[]).slice(0, LIMITS.routes).map(s => printable(s).replace(/\s+/g, ' ').trim().slice(0, 64)).filter(s => s !== '');
}

/** A Custom from an already-parsed JSON value; what is wrong is listed, the rest is kept. */
export function readCustom(value: unknown, rawLabel: string): Parsed {
  const label = printable(rawLabel).replace(/\s+/g, ' ').slice(0, 120);
  const p = readAll(value, label);
  return { custom: p.custom, problems: bounded(p.problems, label, 'problems'), cleaned: bounded(p.cleaned, label, 'adjusted names') };
}

function readAll(value: unknown, label: string): Parsed {
  const p: Parsed = { custom: emptyCustom(), problems: [], cleaned: [] };
  if (!isRecord(value)) { p.problems.push(`${label}: expected a JSON object`); return p; }
  const c = p.custom;
  for (const [key, v] of Object.entries(value)) {
    const where = `${label}: ${key}`;
    if (key === 'only') { if (typeof v === 'boolean') c.only = v; else p.problems.push(`${where} must be true or false`); }
    else if (key === 'use') { if (typeof v === 'string' && NAME_RE.test(v.trim())) c.use = v.trim(); else p.problems.push(`${where} must be a pool's name`); }
    else if (key === 'names') c.names = nameList(v, where, p);
    else if (key === 'remove') c.remove = nameList(v, where, p);
    else if (key === 'rename') {
      if (!isRecord(v)) { p.problems.push(`${where} must map old names to new ones`); continue; }
      const pairs = Object.entries(v);
      if (pairs.length > LIMITS.names) p.problems.push(`${where}: only the first ${LIMITS.names} names are read`);
      for (const [from, to] of pairs.slice(0, LIMITS.names)) {
        const [f] = nameList([from], where, p);
        const [t] = typeof to === 'string' ? nameList([to], where, p) : [];
        if (f !== undefined && t !== undefined) c.rename[f] = t;
        else if (typeof to !== 'string') p.problems.push(`${where}: ${quote(from)} needs a new name`);
      }
    } else if (key === 'sets') {
      if (!isRecord(v)) { p.problems.push(`${where} must map a set's name to its names`); continue; }
      for (const [setKey, s] of Object.entries(v)) {
        if (Object.keys(c.sets).length >= LIMITS.sets) { p.problems.push(`${where}: only the first ${LIMITS.sets} sets are read`); break; }
        const at = `${label}: sets.${setKey.slice(0, 40)}`; // used only once the key has passed NAME_RE
        if (!NAME_RE.test(setKey)) { p.problems.push(`${label}: sets: ${quote(setKey)} cannot name a set (letters, digits, _ and - only)`); continue; }
        const set: CustomSet = { names: [], for: [], keywords: [], replace: false };
        if (Array.isArray(s) || typeof s === 'string') set.names = nameList(s, at, p); // shorthand: just the names
        else if (isRecord(s)) {
          for (const [k, sv] of Object.entries(s)) {
            if (k === 'names') set.names = nameList(sv, `${at}.names`, p);
            else if (k === 'for') set.for = textList(sv, `${at}.for`, p);
            else if (k === 'keywords') set.keywords = textList(sv, `${at}.keywords`, p).map(lower);
            else if (k === 'replace') { if (typeof sv === 'boolean') set.replace = sv; else p.problems.push(`${at}.replace must be true or false`); }
            else p.problems.push(`${at}: unknown key ${quote(k)} ignored`);
          }
        } else { p.problems.push(`${at} must be a list of names or an object`); continue; }
        c.sets[setKey] = set;
      }
    } else p.problems.push(`${label}: unknown key ${quote(key)} ignored`);
  }
  return p;
}

/** A Custom from a names file's text. Invalid JSON is one problem and an empty Custom. */
export function parseCustom(text: string, label: string): Parsed {
  if (text.length > LIMITS.fileChars) return tooLarge(label);
  let value: unknown;
  try { value = JSON.parse(text); } catch (err) {
    // The engine's message quotes the head of what it could not parse, and a project's file may be a
    // symlink to anything: only the position is kept, never the text.
    const where = /position (\d+)/.exec(String(err instanceof Error ? err.message : err))?.[1];
    return { custom: emptyCustom(), problems: [`${printable(label).slice(0, 120)}: not valid JSON${where ? ` (at character ${where})` : ''}`], cleaned: [] };
  }
  return readCustom(value, label);
}

const tooLarge = (label: string): Parsed => ({ custom: emptyCustom(), problems: [`${printable(label).slice(0, 120)}: too large (over ${LIMITS.fileChars / 1024} KB); it was not read`], cleaned: [] });

/** The file's text for a Custom: only the keys that say something. */
export function serializeCustom(c: Custom): string {
  const out: Record<string, unknown> = {};
  if (c.only) out.only = true;
  if (c.use !== undefined) out.use = c.use;
  if (c.names.length) out.names = c.names;
  if (c.remove.length) out.remove = c.remove;
  if (Object.keys(c.rename).length) out.rename = c.rename;
  const sets: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(c.sets)) {
    sets[k] = { names: s.names, ...(s.for.length ? { for: s.for } : {}), ...(s.keywords.length ? { keywords: s.keywords } : {}), ...(s.replace ? { replace: true } : {}) };
  }
  if (Object.keys(sets).length) out.sets = sets;
  return JSON.stringify(out, null, 2) + '\n';
}

export type Layer = { label: string; custom: Custom };
export type Applied = { pool: Pool; use?: string; problems: string[] };

const findCat = (cats: Category[], key: string) => cats.find(c => lower(c.key) === lower(key));

/**
 * The pool after each layer in turn. Within a layer: `only` empties what came before, sets
 * are defined (new ones go first; a set's `for` wins for those agent types), flat names join
 * every pool that is not a file-defined set, then `rename` and then `remove` apply to everything.
 * Names added to a pool that keeps other names are marked `favoured`, so they are drawn often.
 * A result with no names at all falls back to `base`, with a problem saying so.
 */
export function applyCustom(base: Pool, layers: Layer[]): Applied {
  let cats: Category[] = base.categories.map(c => ({ ...c, subagent_types: [...c.subagent_types], keywords: [...c.keywords], names: [...c.names] }));
  const own = new Set<string>(); // keys of the sets the layers created
  const problems: string[] = [];
  let use: string | undefined;
  let useFrom = '';
  for (const { label, custom: c } of layers) {
    if (c.only) { cats = []; own.clear(); }
    const fresh: Category[] = [];
    for (const [key, s] of Object.entries(c.sets)) {
      let cat = findCat(cats, key) ?? findCat(fresh, key);
      if (!cat) { cat = { key, subagent_types: [], keywords: [], names: [] }; fresh.push(cat); own.add(lower(key)); }
      if (s.for.length) cat.first = [...new Set([...s.for, ...(cat.first ?? [])])];
      if (!own.has(lower(cat.key))) cat.favoured = uniq([...(cat.favoured ?? []), ...s.names]); // added to a built-in pool
      cat.names = uniq([...(s.replace ? [] : cat.names), ...s.names]);
      cat.subagent_types = [...new Set([...s.for, ...cat.subagent_types])];
      cat.keywords = [...new Set([...s.keywords, ...cat.keywords])];
    }
    cats = [...fresh, ...cats];
    if (c.names.length) {
      let targets = cats.filter(k => !own.has(lower(k.key)));
      if (!targets.length) {
        let d = findCat(cats, FALLBACK);
        if (!d) { d = { key: FALLBACK, subagent_types: [], keywords: [], names: [] }; cats.push(d); }
        targets = [d];
      }
      for (const t of targets) { t.names = uniq([...t.names, ...c.names]); t.favoured = uniq([...(t.favoured ?? []), ...c.names]); }
    }
    const renames = Object.entries(c.rename);
    if (renames.length) {
      const to = new Map(renames.map(([f, t]) => [lower(f), t]));
      for (const k of cats) { k.names = uniq(k.names.map(n => to.get(lower(n)) ?? n)); if (k.favoured) k.favoured = uniq(k.favoured.map(n => to.get(lower(n)) ?? n)); }
    }
    if (c.remove.length) { // after rename, so a name can be hidden by what it is called now
      const gone = new Set(c.remove.map(lower));
      for (const k of cats) k.names = k.names.filter(n => !gone.has(lower(n)));
    }
    if (c.use !== undefined) { use = lower(c.use) === 'auto' ? undefined : c.use; useFrom = label; }
  }
  for (const k of cats) { // favoured: the added names still in the pool, and only where the pool holds others too
    const has = new Set(k.names.map(lower));
    const kept = (k.favoured ?? []).filter(n => has.has(lower(n)));
    if (kept.length && kept.length < k.names.length) k.favoured = kept; else delete k.favoured;
  }
  if (!cats.some(k => k.names.length)) {
    problems.push('no names are left after your changes; using the built-in names');
    return { pool: base, problems };
  }
  if (use !== undefined) {
    const hit = findCat(cats, use);
    if (hit) use = hit.key; else { problems.push(`${useFrom}: use names no pool called "${use}"; picking by agent type instead`); use = undefined; }
  }
  return { pool: { categories: cats }, use, problems };
}

// ---- /names: edits to the user's file ----

/** Splits a command's arguments on spaces and commas; quotes keep a name with spaces whole. */
export function tokenize(args: string): string[] {
  const out: string[] = [];
  for (const m of args.matchAll(/"([^"]*)"|'([^']*)'|([^\s,]+)/g)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (t !== '') out.push(t);
  }
  return out;
}

export type Edit = { custom: Custom; lines: string[]; changed: boolean };

function cleanAll(raw: string[], lines: string[]): string[] {
  const p: Parsed = { custom: emptyCustom(), problems: [], cleaned: [] };
  const names = nameList(raw, 'name', p);
  if (p.cleaned.length) lines.push(`Adjusted to fit the name rule: ${p.cleaned.join(', ')}`);
  for (const pr of p.problems) lines.push(pr.replace(/^name: /, 'Skipped: '));
  return names;
}

export const USAGE = [
  '/names                             what is set, and where the files are',
  '/names add Ripley "Mary Shelley"   more names, for every built-in pool',
  '/names remove Sisyphus             never draw this name',
  '/names rename Turing Alan          call one name something else',
  '/names set pirates Kidd Bonny      define a set (a pool of your own); same name again replaces it',
  '/names unset pirates               drop a set',
  '/names use pirates | auto          draw every agent from one pool, or go back to picking by task',
  '/names only on | off               leave out the built-in names',
  '/names import <file>               merge a names file, a JSON list, or one name per line',
  '/names reset                       clear your file (a .bak copy is kept)',
].join('\n');

/**
 * One editing verb applied to the user's Custom. `builtin` is the pool the file is layered
 * on: `use` may name its pools, and `remove` hides its names. Unknown verbs and bad
 * arguments change nothing.
 */
export function editCustom(before: Custom, verb: string, argv: string[], builtin: Pool): Edit {
  const pools = builtin.categories.map(k => k.key);
  const c: Custom = { ...before, names: [...before.names], remove: [...before.remove], rename: { ...before.rename }, sets: Object.fromEntries(Object.entries(before.sets).map(([k, s]) => [k, { ...s, names: [...s.names] }])) };
  const lines: string[] = [];
  const same = (lines2: string[]): Edit => ({ custom: before, lines: lines2, changed: false });
  if (verb === 'add') {
    const names = cleanAll(argv, lines);
    if (!names.length) return same([...lines, 'Usage: /names add Ripley "Mary Shelley"']);
    const added = names.filter(n => !c.names.some(x => lower(x) === lower(n)));
    c.names = uniq([...c.names, ...names]);
    c.remove = c.remove.filter(r => !names.some(n => lower(n) === lower(r)));
    lines.push(added.length ? `Added ${added.join(', ')}.` : 'Already there.');
    if (!c.only) lines.push('Your names get about half of the draws while one is free; /names only on leaves the built-in names out.');
  } else if (verb === 'remove') {
    const names = cleanAll(argv, lines);
    if (!names.length) return same([...lines, 'Usage: /names remove Sisyphus']);
    const isBuiltin = (n: string) => builtin.categories.some(k => k.names.some(x => lower(x) === lower(n)));
    for (const n of names) {
      const mine = c.names.some(x => lower(x) === lower(n)) || Object.values(c.sets).some(s => s.names.some(x => lower(x) === lower(n)));
      c.names = c.names.filter(x => lower(x) !== lower(n));
      for (const s of Object.values(c.sets)) s.names = s.names.filter(x => lower(x) !== lower(n));
      // A name that exists only because of a rename: undo the rename and hide what it was.
      const was = Object.keys(c.rename).filter(f => lower(c.rename[f] ?? '') === lower(n));
      for (const f of was) { delete c.rename[f]; c.remove = uniq([...c.remove, f]); }
      if (mine) lines.push(`Removed ${n} from your names.`);
      if (was.length) lines.push(`${n} was your name for ${was.join(', ')}; that will not be drawn.`);
      if (isBuiltin(n) || (!mine && !was.length)) { c.remove = uniq([...c.remove, n]); lines.push(`${n} will not be drawn.`); }
    }
  } else if (verb === 'rename') {
    const names = cleanAll(argv, lines);
    const [from, to] = names;
    if (from === undefined || to === undefined || names.length !== 2) return same([...lines, 'Usage: /names rename Turing Alan']);
    c.rename[from] = to;
    lines.push(`${from} is now ${to}.`);
  } else if (verb === 'set') {
    const [typed, ...rest] = argv;
    if (typed === undefined || !NAME_RE.test(typed)) return same(["Usage: /names set pirates Kidd Bonny   (the set's name takes letters, digits, _ and - only)"]);
    const key = Object.keys(c.sets).find(k => lower(k) === lower(typed)) ?? typed; // "Pirates" is the set "pirates"
    const names = cleanAll(rest, lines);
    if (!names.length) return same([...lines, `Usage: /names set ${key} Kidd Bonny`]);
    const old = c.sets[key];
    c.sets[key] = { names, for: old?.for ?? [], keywords: old?.keywords ?? [], replace: old?.replace ?? false };
    lines.push(`Set ${key}: ${names.join(', ')}.`, `Use it for every agent with /names use ${key}.`);
  } else if (verb === 'unset') {
    const [key] = argv;
    const hit = key === undefined ? undefined : Object.keys(c.sets).find(k => lower(k) === lower(key));
    if (hit === undefined) return same([`No set called ${key ?? '(nothing)'} in your file.`]);
    delete c.sets[hit];
    if (c.use !== undefined && lower(c.use) === lower(hit)) delete c.use;
    lines.push(`Dropped the set ${hit}.`);
  } else if (verb === 'use') {
    const [key] = argv;
    if (key === undefined) return same(['Usage: /names use pirates   or   /names use auto']);
    if (lower(key) === 'auto') { delete c.use; lines.push('Pools are picked by agent type and task again.'); }
    else {
      const hit = [...Object.keys(c.sets), ...pools].find(k => lower(k) === lower(key));
      if (hit === undefined) return same([`No pool called ${key}. Pools: ${[...Object.keys(c.sets), ...pools].join(', ')}.`]);
      c.use = hit;
      lines.push(`Every agent now draws from ${hit}.`);
    }
  } else if (verb === 'only') {
    const [flag] = argv.map(lower);
    if (flag !== 'on' && flag !== 'off') return same(['Usage: /names only on   or   /names only off']);
    c.only = flag === 'on';
    lines.push(c.only ? 'The built-in names are left out; only yours are drawn.' : 'The built-in names are back.');
  } else return same([USAGE]);
  return { custom: c, lines, changed: serializeCustom(c) !== serializeCustom(before) };
}

/** `incoming` merged into `into`: lists are joined, and so is a set of the same name. */
export function mergeCustom(into: Custom, incoming: Custom): Custom {
  const sets: Record<string, CustomSet> = Object.fromEntries(Object.entries(into.sets).map(([k, s]) => [k, { ...s }]));
  for (const [k, s] of Object.entries(incoming.sets)) {
    const key = Object.keys(sets).find(x => lower(x) === lower(k)) ?? k;
    const old = Object.hasOwn(sets, key) ? sets[key] : undefined; // "constructor" is a set only when the file has it
    sets[key] = old === undefined ? { ...s } : {
      names: uniq([...old.names, ...s.names]), for: [...new Set([...old.for, ...s.for])],
      keywords: [...new Set([...old.keywords, ...s.keywords])], replace: old.replace || s.replace,
    };
  }
  return {
    only: into.only || incoming.only,
    ...(incoming.use ?? into.use) !== undefined ? { use: incoming.use ?? into.use } : {},
    names: uniq([...into.names, ...incoming.names]),
    remove: uniq([...into.remove, ...incoming.remove]),
    rename: { ...into.rename, ...incoming.rename },
    sets,
  };
}

/** What an imported file holds: a names file, a JSON list of names, or one name per line. */
export function parseImport(text: string, label: string): Parsed {
  if (text.length > LIMITS.fileChars) return tooLarge(label);
  let value: unknown;
  try { value = JSON.parse(text); } catch { value = text.split(/\r?\n/); } // audit-allow: fail-loud — not JSON means a plain list, one name per line
  return readCustom(Array.isArray(value) ? { names: value } : value, label);
}
