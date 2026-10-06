// named-subagents mod: every Agent dispatch without a model-supplied `name` gets one from
// the themed pool, so the task tree labels it. The name is display-only: the engine does
// not put it in the subagent's context, so there is no ledger, queue or file lock.
//
// tool.call{Agent}  draws a name not held by a listed agent or an in-flight draw, and
//                   sets it on the call; the description is left as is.
// agent.spawn       checks the name reached the spawn and that $.agent.list() shows it
//                   on the new id; anything else raises a toast.
// command.run       /names shows and edits the user's names file.
//
// The pool is the built-in one with the user's changes layered on: the names file in the
// config directory, then the project's, then the install screen's `names` list. Both files
// are checked on every dispatch (exists, then stat), so an edit applies to the next agent.

import type { Register, EngineInterface, PluginOptions } from 'claude-code';
import { pickName, type Pool } from './draw.ts';
import { POOL } from './pool.ts';
import {
  NAME_RE, USAGE, applyCustom, editCustom, emptyCustom, mergeCustom, parseCustom, parseImport, readCustom,
  serializeCustom, tokenize, type Custom, type Layer, type Parsed,
} from './custom.ts';

const TAG = 'named-subagents';
const FILE = 'named-subagents.json';

// Drawn but not yet settled. JS runs the draw and the reserve with no await between them,
// so parallel dispatches in one message cannot draw the same name.
const reserved = new Set<string>();
// tool_use_id -> the name this module set, read back by agent.spawn to verify.
const drawn = new Map<string, string>();

function rand(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] ?? 0) / 2 ** 32;
}

function alarm($: EngineInterface, text: string): void {
  // Toast plus status line: the toast fades, the status line stays until the next clean spawn.
  const line = `${TAG}: ${text.length > 240 ? `${text.slice(0, 240)}…` : text}`;
  void Promise.resolve($.ui.toast(line, { timeoutMs: 10000 })).catch(() => undefined); // audit-allow: fail-loud — the alarm itself has nowhere louder to report
  void Promise.resolve($.ui.status(line)).catch(() => undefined); // audit-allow: fail-loud — same
}

type Paths = { user?: string; project?: string };
type FileState = { path?: string; sig: string; parsed?: Parsed; error?: string };
type Loaded = { pool: Pool; use?: string; problems: string[]; user: FileState; project: FileState };
const NO_FILE: FileState = { sig: 'none' }; // one object, so "nothing changed" holds for a path that does not exist

let paths: Paths | undefined;
let loaded: Loaded | undefined;
let loading: Promise<Loaded> | undefined;
let loadFailed = false; // the load itself broke: alarmed once, not on every dispatch

async function findPaths($: EngineInterface): Promise<Paths> {
  if (paths) return paths;
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'));
  const cfg = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined);
  const root = await $.session.root();
  paths = { user: cfg ? `${cfg}/${FILE}` : undefined, project: root ? `${root}/.claude/${FILE}` : undefined };
  if (paths.user === paths.project) paths.project = undefined; // a session started in the home directory
  return paths;
}

/** The file's signature (`none` when absent) and, when it changed, its parsed content. */
async function readFile($: EngineInterface, path: string | undefined, label: string, prev?: FileState): Promise<FileState> {
  if (path === undefined) return NO_FILE;
  let sig = 'none';
  try {
    if (await $.fs.exists(path)) {
      const st = await $.fs.stat(path);
      sig = `${st.mtimeMs}:${st.size}`;
    }
    if (prev && prev.sig === sig) return prev;
    return sig === 'none' ? { path, sig } : { path, sig, parsed: parseCustom(await $.fs.read(path), label) };
  } catch {
    // There, but not readable. Signed by what was seen, so the alarm is raised once, not per dispatch.
    return prev?.sig === `unreadable:${sig}` ? prev : { path, sig: `unreadable:${sig}`, error: `${label}: cannot read ${path}` };
  }
}

/** The install screen's `names` and `only_custom`, as the layers around the files. */
function optionLayers(options: PluginOptions): { first: Layer[]; last: Layer[]; problems: string[] } {
  const p = readCustom({ names: options.names ?? [] }, 'install-screen names');
  const first = options.only_custom === true ? [{ label: 'install screen', custom: { ...emptyCustom(), only: true } }] : [];
  return { first, last: p.custom.names.length ? [{ label: 'install screen', custom: p.custom }] : [], problems: p.problems };
}

/**
 * The pool to draw from now. Re-reads a names file only when it changed; a problem in one
 * (bad JSON, a name the Agent tool would refuse) is alarmed once per change and the rest of
 * the file still applies. Never throws: with nothing readable, the built-in pool.
 * `quiet` is for /names, whose own output lists the problems.
 */
function load($: EngineInterface, options: PluginOptions, quiet = false): Promise<Loaded> {
  // Dispatches in one message share one read (and one alarm).
  return (loading ??= read($, options, quiet).finally(() => { loading = undefined; }));
}

async function read($: EngineInterface, options: PluginOptions, quiet: boolean): Promise<Loaded> {
  try {
    const at = await findPaths($);
    const user = await readFile($, at.user, 'your names file', loaded?.user);
    const project = await readFile($, at.project, "the project's names file", loaded?.project);
    if (loaded && loaded.user === user && loaded.project === project) return loaded;
    const opt = optionLayers(options);
    const layers: Layer[] = [
      ...opt.first,
      ...(user.parsed ? [{ label: 'your names file', custom: user.parsed.custom }] : []),
      ...(project.parsed ? [{ label: "the project's names file", custom: project.parsed.custom }] : []),
      ...opt.last,
    ];
    const applied = applyCustom(POOL, layers);
    const problems = [
      ...[user, project].flatMap(f => [...(f.error ? [f.error] : []), ...(f.parsed?.problems ?? [])]),
      ...opt.problems, ...applied.problems,
    ];
    if (problems.length && !quiet) alarm($, `${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more: /names)` : ''}`);
    loaded = { pool: applied.pool, use: applied.use, problems, user, project };
    loadFailed = false;
    return loaded;
  } catch (err) {
    if (!loadFailed) alarm($, `could not load your names (${String(err).slice(0, 80)}); using the built-in names`);
    loadFailed = true;
    return { pool: POOL, problems: [String(err).slice(0, 200)], user: NO_FILE, project: NO_FILE };
  }
}

const count = (pool: Pool) => new Set(pool.categories.flatMap(c => c.names.map(n => n.toLowerCase()))).size;

function describe(l: Loaded, at: Paths, options: PluginOptions, theme: string): string {
  const file = (f: FileState, path?: string) => (path === undefined ? 'no location' : `${path} (${f.sig === 'none' ? 'not there yet' : f.error ? 'unreadable' : 'found'})`);
  const mine = (c?: Custom) => (c ? [
    ...(c.only ? ['    only: the names before this file are left out'] : []),
    ...(c.names.length ? [`    names: ${c.names.join(', ')}`] : []),
    ...(c.remove.length ? [`    never drawn: ${c.remove.join(', ')}`] : []),
    ...Object.entries(c.rename).map(([f, t]) => `    renamed: ${f} -> ${t}`),
    ...Object.entries(c.sets).map(([k, s]) => `    set ${k} (${s.names.length}): ${s.names.join(', ')}${s.for.length ? `; for ${s.for.join(', ')}` : ''}${s.keywords.length ? `; keywords ${s.keywords.join(', ')}` : ''}${s.replace ? '; replaces the built-in names' : ''}`),
    ...(c.use !== undefined ? [`    use: ${c.use}`] : []),
  ] : []);
  const opt = optionLayers(options);
  const pin = l.use ?? (theme !== 'auto' ? theme : undefined);
  return [
    `${count(l.pool)} names in ${l.pool.categories.length} pools (${count(POOL)} built in).`,
    `Every agent draws from: ${pin ?? 'the pool that fits its type and task'}.`,
    `Your file:    ${file(l.user, at.user)}`, ...mine(l.user.parsed?.custom),
    `Project file: ${file(l.project, at.project)}`, ...mine(l.project.parsed?.custom),
    ...(opt.first.length || opt.last.length ? [`Install screen: ${opt.first.length ? 'only my names; ' : ''}${opt.last[0]?.custom.names.join(', ') ?? ''}`] : []),
    `Pools: ${l.pool.categories.map(c => `${c.key} ${c.names.length}`).join(' · ')}`,
    ...(l.problems.length ? ['Problems:', ...l.problems.map(p => `    ${p}`)] : []),
    ...[l.user.parsed, l.project.parsed].flatMap(p => (p?.cleaned.length ? [`Adjusted to fit the name rule: ${p.cleaned.join(', ')}`] : [])),
    '', USAGE,
  ].join('\n');
}

/** `/names …`: every verb but the bare listing rewrites the user's file. */
async function names($: EngineInterface, args: string, options: PluginOptions, theme: string): Promise<string> {
  const [verb = 'list', ...argv] = tokenize(args);
  const at = await findPaths($);
  const now = await load($, options, true);
  if (verb === 'list') return describe(now, at, options, theme);
  if (verb === 'help') return USAGE;
  if (at.user === undefined) return 'No HOME or CLAUDE_CONFIG_DIR is set, so there is nowhere to keep your names.';
  const before = now.user.parsed?.custom ?? emptyCustom();
  let next: Custom;
  let lines: string[];
  if (verb === 'reset') { // the one verb that works on a file /names cannot read
    if (now.user.sig === 'none') return `Nothing to reset; ${at.user} does not exist.`;
    const text = await $.fs.read(at.user);
    if (text.trim() === serializeCustom(emptyCustom()).trim()) return `Nothing to reset; ${at.user} is already empty.`;
    await $.fs.write(`${at.user}.bak`, text);
    next = emptyCustom();
    lines = [`Cleared your names. The previous file is at ${at.user}.bak.`];
  } else if (now.user.error || now.user.parsed?.problems.length) {
    // Rewriting the file would drop whatever could not be read from it, so it is left alone.
    return [
      `${at.user} was left alone, because /names cannot read all of it and would drop the rest:`,
      ...(now.user.error ? [`    ${now.user.error}`] : []), ...(now.user.parsed?.problems ?? []).map(p => `    ${p}`),
      'Fix it by hand, or run /names reset to start clean (a .bak copy is kept).',
    ].join('\n');
  } else if (verb === 'import') {
    const [src] = argv;
    if (src === undefined) return 'Usage: /names import <file>';
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'));
    const path = src.startsWith('~/') && home ? `${home}/${src.slice(2)}` : src;
    let text: string;
    try { text = await $.fs.read(path); } catch { return `Cannot read ${path}.`; }
    const p = parseImport(text, src);
    const pools = [...Object.keys(before.sets), ...Object.keys(p.custom.sets), ...POOL.categories.map(c => c.key)];
    const badUse = p.custom.use !== undefined && !pools.some(k => k.toLowerCase() === p.custom.use?.toLowerCase()) ? p.custom.use : undefined;
    if (badUse !== undefined) delete p.custom.use;
    next = mergeCustom(before, p.custom);
    const sets = Object.keys(p.custom.sets);
    lines = [
      `Imported ${src}: ${p.custom.names.length} names${sets.length ? `, sets ${sets.join(', ')}` : ''}.`,
      ...(p.cleaned.length ? [`Adjusted to fit the name rule: ${p.cleaned.join(', ')}`] : []),
      ...(badUse !== undefined ? [`Left out its "use": there is no pool called ${badUse}.`] : []),
      ...p.problems,
    ];
    if (serializeCustom(next) === serializeCustom(before)) return [...lines, 'Nothing new; your file is unchanged.'].join('\n');
  } else {
    const edit = editCustom(before, verb, argv, POOL);
    if (!edit.changed) return edit.lines.join('\n');
    next = edit.custom;
    lines = edit.lines;
    if (verb === 'use' && next.use === undefined && theme !== 'auto') lines.push(`The Name pool option still pins ${theme}; set it to auto in /config to pick by agent type and task.`);
  }
  await $.fs.write(at.user, serializeCustom(next));
  loaded = undefined; // the next dispatch (and the line below) reads the file as written
  const after = await load($, options, true);
  return [...lines, `${count(after.pool)} names in ${after.pool.categories.length} pools now. Saved to ${at.user}.`, ...after.problems].join('\n');
}

export const register: Register = (on, options) => {
  if (options.enabled === false) return;
  const theme = typeof options.theme === 'string' ? options.theme : 'auto';

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'names', description: 'Show or change the names your subagents get', argumentHint: '[add|remove|rename|set|unset|use|only|import|reset]' });
    return next(e);
  }).catch(($, e, next) => {
    alarm($, 'could not register /names');
    return next(e); // replays the settled start if next already ran
  });

  on('command.run', { command: 'names' }, async ($, e) => {
    try {
      return { text: await names($, e.args, options, theme) };
    } catch (err) {
      return { text: `/names failed (${String(err).slice(0, 200)}). Your file was not changed unless a line above says so.` };
    }
  });

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.name !== undefined && e.name !== '') return next(e); // the model named it: leave it
    const { pool, use } = await load($, options);
    const live = (await $.agent.list()).map(a => a.name).filter((n): n is string => !!n);
    const { name } = pickName(pool, {
      subagentType: e.subagent_type, description: e.description, theme: use ?? theme,
      taken: [...live, ...reserved], rand,
    });
    if (!NAME_RE.test(name)) { // the Agent tool refuses the whole call for such a name
      alarm($, `drew "${name.slice(0, 40)}", which is not a valid agent name; this agent runs unnamed`);
      return next(e);
    }
    reserved.add(name);
    drawn.set(e.tool_use_id, name);
    try {
      return await next({ ...e, name });
    } finally {
      reserved.delete(name);
      drawn.delete(e.tool_use_id);
    }
  }).catch(($, e, next) => {
    alarm($, 'naming failed; this agent runs unnamed');
    return next(e); // replays the settled call if next already ran; never blocks the dispatch
  });

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e);
    const want = drawn.get(e.tool_use_id);
    if (want === undefined || r.agentId === undefined) return r; // not ours, or not started
    try {
      if (e.name !== want) {
        alarm($, `drew ${want} but the spawn got ${e.name ?? 'no name'}`);
      } else {
        const row = (await $.agent.list()).find(a => a.id === r.agentId);
        if (row?.name !== want) alarm($, `drew ${want} but the agent list shows ${row?.name ?? (row ? 'no name' : 'no row')}`);
        else if (!loaded?.problems.length) void Promise.resolve($.ui.status(undefined)).catch(() => undefined); // audit-allow: fail-loud — clearing a stale alarm line
      }
    } catch {
      alarm($, `could not verify ${want}`);
    }
    return r;
  }).catch(($, e, next) => next(e)); // replays the spawn if it already ran; never refuses one
};
