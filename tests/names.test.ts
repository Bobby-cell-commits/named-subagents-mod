// Engine-level tests: `claude plugin test .`. The test's own hooks sit beneath the mod and
// stand in for the engine: the Agent tool, the agent list, agent.spawn and the toast.
import { test, expect } from 'claude-code/testing';
import type { AgentInfo, On } from 'claude-code';

type World = {
  list: AgentInfo[]; names: (string | undefined)[]; toasts: string[]; listName?: (n?: string) => string | undefined;
  files?: Record<string, string>; // path -> text: the names files the mod reads and /names writes
  writes?: number;
  root?: string; // the session root; '/proj' unless given
  read?: string[]; // every path the mod read
};
const USER = '/home/t/.claude/named-subagents.json';
const PROJECT = '/proj/.claude/named-subagents.json';

// Beneath the mod: the Agent tool spawns (raising agent.spawn as the engine does) and the
// new agent appears in the list under the name the spawn got, unless `listName` says otherwise.
// Call nouns (agent.list, ui.toast) answer `{ value }` beneath the plugins. The spawn is
// raised on the test's own engine `$` (`top`): a hook's `$` may only call what its module's
// scan lists.
function engine(top: any, on: On, w: World) {
  let n = 0;
  // The session's places and files: HOME and the session root fix where the two names files
  // are; a file not in `w.files` is missing (ENOENT), and each write moves the file's mtime.
  const files = (w.files ??= {});
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }) as never);
  on('session.root', () => ({ value: w.root ?? '/proj' }) as never);
  on('command.register', ($, e) => ({ value: { command: e.name } }) as never);
  on('fs.exists', ($, e) => ({ value: files[e.path] !== undefined }) as never);
  on('fs.stat', ($, e) => {
    const text = files[e.path];
    if (text === undefined) throw new Error(`stat ${e.path} failed: ENOENT`);
    return { value: { kind: 'file', size: text.length, mtimeMs: 1000 + (w.writes ?? 0), isLink: false } } as never;
  });
  on('fs.read', ($, e) => {
    (w.read ??= []).push(e.path);
    const text = files[e.path];
    if (text === undefined) throw new Error(`read ${e.path} failed: ENOENT`);
    return { value: text } as never;
  });
  on('fs.write', ($, e) => { files[e.path] = e.text; w.writes = (w.writes ?? 0) + 1; return { value: undefined } as never; });
  on('agent.list', () => ({ value: w.list }) as never);
  on('ui.toast', ($, e) => { w.toasts.push(e.text); return { value: undefined } as never; });
  on('ui.status', () => ({ value: undefined }) as never);
  on('agent.spawn', ($, e) => {
    const id = `a${++n}`;
    w.list = [...w.list, { id, description: e.description, type: e.subagentType, status: 'running', name: w.listName ? w.listName(e.name) : e.name }];
    return { model: 'haiku', agentId: id };
  });
  on('tool.call', { tool: 'Agent' }, async ($, e) => {
    w.names.push(e.name);
    const r = await top.agent.spawn({
      tool_use_id: e.tool_use_id, prompt: e.prompt, description: e.description,
      subagentType: e.subagent_type ?? 'general-purpose', name: e.name,
    } as never);
    return { result: { agentId: r.agentId ?? '' }, text: 'ok' } as never;
  });
}

const call = ($: any, description: string, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'Agent', description, prompt: 'reply ok', subagent_type: 'general-purpose', ...extra });

test('three same-type agents dispatched together get three distinct names', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [] };
  engine($, on, w);
  await Promise.all([call($, 'say ok'), call($, 'say ok'), call($, 'say ok')]);
  expect(w.names.every(n => typeof n === 'string' && n.length > 0)).toBe(true);
  expect(new Set(w.names).size).toBe(3);
  expect(w.list.map(a => a.name)).toEqual(w.names);
  expect(w.toasts).toEqual([]);
});

test('a model-supplied name is left alone', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [] };
  engine($, on, w);
  await call($, 'say ok', { name: 'my-reviewer' });
  expect(w.names).toEqual(['my-reviewer']);
});

test('a name already in the agent list is not drawn again', async ($, on) => {
  // Every code-pool name but one is live: the draw must land on the free one.
  const { POOL } = await import_pool();
  const code = POOL.categories.find(c => c.key === 'code')!.names;
  const w: World = { list: code.slice(1).map((name, i) => ({ id: `x${i}`, description: '', type: 'general-purpose', status: 'running', name })), names: [], toasts: [] };
  engine($, on, w);
  await call($, 'say ok');
  expect(w.names).toEqual([code[0]]);
});

test('the description is not rewritten', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [] };
  engine($, on, w);
  await call($, 'say ok');
  expect(w.list[0]?.description).toBe('say ok');
});

test('a list row that does not carry the drawn name raises a toast', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], listName: () => 'Somebody' };
  engine($, on, w);
  await call($, 'say ok');
  expect(w.toasts.length).toBe(1);
  expect(w.toasts[0]).toContain('agent list shows Somebody');
});

test('theme option pins the pool', { options: { theme: 'debug' } }, async ($, on) => {
  const { POOL } = await import_pool();
  const w: World = { list: [], names: [], toasts: [] };
  engine($, on, w);
  await call($, 'implement the endpoint');
  expect(POOL.categories.find(c => c.key === 'debug')!.names).toContain(w.names[0]);
});

test('enabled=false leaves every dispatch unnamed', { options: { enabled: false } }, async ($, on) => {
  const w: World = { list: [], names: [], toasts: [] };
  engine($, on, w);
  await call($, 'say ok');
  expect(w.names).toEqual([undefined]);
});


// ---- custom names ----

const names = ($: any, args: string) => $.command.run({ command: 'names', args }) as Promise<{ text?: string }>;
const VALID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

test('a names file with only=true is the whole pool', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: JSON.stringify({ only: true, names: ['Ripley', 'Deckard', 'Neo'] }) } };
  engine($, on, w);
  await Promise.all([call($, 'say ok'), call($, 'say ok'), call($, 'say ok')]);
  expect([...w.names].sort()).toEqual(['Deckard', 'Neo', 'Ripley']);
  expect(w.toasts).toEqual([]);
});

test('the project file is layered on the user file', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: {
    [USER]: JSON.stringify({ only: true, names: ['Ripley'] }),
    [PROJECT]: JSON.stringify({ names: ['Deckard'], remove: ['Ripley'] }),
  } };
  engine($, on, w);
  await call($, 'say ok');
  expect(w.names).toEqual(['Deckard']);
});

test('a names file that is not JSON raises a toast and the agent still gets a built-in name', async ($, on) => {
  const { POOL } = await import_pool();
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: '{ "names": ["Ripley" ' } };
  engine($, on, w);
  await call($, 'say ok');
  expect(w.toasts.length).toBe(1);
  expect(w.toasts[0]).toContain('not valid JSON');
  expect(POOL.categories.flatMap(c => c.names)).toContain(w.names[0]);
});

test('a name the Agent tool would refuse never reaches the call, and is reported', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: JSON.stringify({ only: true, names: ['名前', 'Mary Shelley', 'a/b'] }) } };
  engine($, on, w);
  await Promise.all([call($, 'say ok'), call($, 'say ok')]);
  expect(w.names.every(n => typeof n === 'string' && VALID.test(n))).toBe(true);
  expect([...w.names].sort()).toEqual(['MaryShelley', 'aB']);
  expect(w.toasts.length).toBe(1); // once per change of the file, not once per dispatch
  expect(w.toasts[0]).toContain('"名前" cannot be a name');
});

test('install-screen names with only_custom are the whole pool', { options: { names: 'Ripley, Mary Shelley', only_custom: true } }, async ($, on) => {
  const w: World = { list: [], names: [], toasts: [] };
  engine($, on, w);
  await Promise.all([call($, 'say ok'), call($, 'say ok')]);
  expect([...w.names].sort()).toEqual(['MaryShelley', 'Ripley']);
});

test('install-screen names join the built-in pools', { options: { names: 'Ripley' } }, async ($, on) => {
  // Every built-in code name is live, so the one free name in the pool is the added one.
  const { POOL } = await import_pool();
  const code = POOL.categories.find(c => c.key === 'code')!.names;
  const w: World = { list: code.map((name, i) => ({ id: `x${i}`, description: '', type: 'general-purpose', status: 'running', name })), names: [], toasts: [] };
  engine($, on, w);
  await call($, 'say ok');
  expect(w.names).toEqual(['Ripley']);
});

test("a set's `for` routes that agent type to it, ahead of the built-in pool", async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: JSON.stringify({ sets: { pirates: { names: ['Kidd', 'Bonny'], for: ['general-purpose'] } } }) } };
  engine($, on, w);
  await call($, 'implement the endpoint');
  expect(['Kidd', 'Bonny']).toContain(w.names[0]);
});

test('`use` draws every agent from one set, whatever its type', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: JSON.stringify({ use: 'pirates', sets: { pirates: ['Kidd'] } }) } };
  engine($, on, w);
  await call($, 'find the config', { subagent_type: 'Explore' });
  expect(w.names).toEqual(['Kidd']);
});

test('an edit to the file applies to the next dispatch', async ($, on) => {
  const { POOL } = await import_pool();
  const w: World = { list: [], names: [], toasts: [] };
  engine($, on, w);
  await call($, 'say ok');
  expect(POOL.categories.flatMap(c => c.names)).toContain(w.names[0]);
  w.files![USER] = JSON.stringify({ only: true, names: ['Ripley'] });
  w.list = [];
  await call($, 'say ok');
  expect(w.names[1]).toBe('Ripley');
});

test('/names add and /names only write the user file, and the next agent draws from it', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [] };
  engine($, on, w);
  const added = await names($, 'add Ripley "Mary Shelley"');
  expect(added.text).toContain('Added Ripley, MaryShelley.');
  await names($, 'only on');
  expect(JSON.parse(w.files![USER]!)).toEqual({ only: true, names: ['Ripley', 'MaryShelley'] });
  await Promise.all([call($, 'say ok'), call($, 'say ok')]);
  expect([...w.names].sort()).toEqual(['MaryShelley', 'Ripley']);
});

test('/names set and /names use define a set and pin it; /names lists it', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [] };
  engine($, on, w);
  await names($, 'set pirates Kidd');
  const used = await names($, 'use pirates');
  expect(used.text).toContain('Every agent now draws from pirates.');
  await call($, 'find the config', { subagent_type: 'Explore' });
  expect(w.names).toEqual(['Kidd']);
  const listed = await names($, '');
  expect(listed.text).toContain('Every agent draws from: pirates.');
  expect(listed.text).toContain('set pirates (1): Kidd');
});

test('/names leaves a file it cannot parse alone', async ($, on) => {
  const broken = '{ "names": ["Ripley" ';
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: broken } };
  engine($, on, w);
  const r = await names($, 'add Neo');
  expect(r.text).toContain('left alone');
  expect(r.text).toContain('not valid JSON');
  expect(w.files![USER]).toBe(broken);
});

test('/names reset clears the file and keeps a .bak copy', async ($, on) => {
  const before = JSON.stringify({ names: ['Ripley'] });
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: before } };
  engine($, on, w);
  await names($, 'reset');
  expect(w.files![`${USER}.bak`]).toBe(before);
  expect(JSON.parse(w.files![USER]!)).toEqual({});
});

test('/names import merges a plain list, one name per line', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: { '/tmp/crew.txt': 'Ripley\nDallas\n\nKane\n' } };
  engine($, on, w);
  const r = await names($, 'import /tmp/crew.txt');
  expect(r.text).toContain('3 names');
  expect(JSON.parse(w.files![USER]!)).toEqual({ names: ['Ripley', 'Dallas', 'Kane'] });
});

// ---- found in review ----

test('/names leaves a file alone when it is JSON but not a names file', async ($, on) => {
  const text = '["Ripley","Deckard"]';
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: text } };
  engine($, on, w);
  const r = await names($, 'add Neo');
  expect(w.files![USER]).toBe(text);
  expect(r.text).toContain('left alone');
});

test('/names leaves a file alone when it holds an entry /names would drop, and names the entry', async ($, on) => {
  const text = JSON.stringify({ sets: { 'my pirates': ['Kidd'] }, names: ['Ripley'] });
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: text } };
  engine($, on, w);
  const r = await names($, 'add Neo');
  expect(w.files![USER]).toBe(text);
  expect(r.text).toContain('"my pirates" cannot name a set');
});

test('a second /names reset does not overwrite the .bak copy', async ($, on) => {
  const before = JSON.stringify({ names: ['Ripley'] });
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: before } };
  engine($, on, w);
  await names($, 'reset');
  const again = await names($, 'reset');
  expect(again.text).toContain('Nothing to reset');
  expect(w.files![`${USER}.bak`]).toBe(before);
});

test('/names reset works on a file that is not JSON, keeping it as the .bak', async ($, on) => {
  const broken = '{ "names": ["Ripley" ';
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: broken } };
  engine($, on, w);
  await names($, 'reset');
  expect(w.files![`${USER}.bak`]).toBe(broken);
  expect(JSON.parse(w.files![USER]!)).toEqual({});
});

test('a problem is alarmed once when the session starts in the home directory', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], root: '/home/t', files: { [USER]: JSON.stringify({ colour: 'red' }) } };
  engine($, on, w);
  for (let i = 0; i < 4; i++) await call($, 'say ok');
  expect(w.toasts.length).toBe(1);
});

test('/names edits do not toast again for the project file', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: { [PROJECT]: JSON.stringify({ colour: 'red' }) } };
  engine($, on, w);
  await call($, 'say ok');
  await names($, 'add Neo');
  await names($, 'add Trinity');
  expect(w.toasts.length).toBe(1);
});

test('/names use auto says so when the Name pool option still pins a pool', { options: { theme: 'debug' } }, async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: JSON.stringify({ use: 'code' }) } };
  engine($, on, w);
  const r = await names($, 'use auto');
  expect(r.text).toContain('Name pool option');
  expect(r.text).toContain('debug');
});

test('/names import drops a `use` that names no pool, and says so', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: { '/tmp/set.json': JSON.stringify({ use: 'nope', names: ['Neo'] }) } };
  engine($, on, w);
  const r = await names($, 'import /tmp/set.json');
  expect(JSON.parse(w.files![USER]!)).toEqual({ names: ['Neo'] });
  expect(r.text).toContain('nope');
});

// ---- a names file is untrusted input ----

const ESC = '\u001b]0;owned\u0007\u001b[31m';
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

test("a project's names file cannot put control characters in a toast or in /names output", async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: { [PROJECT]: JSON.stringify({ [`${ESC}key`]: 1, names: [`${ESC}名前`, `${ESC}Evil Name`], use: `${ESC}x` }) } };
  engine($, on, w);
  await call($, 'say ok');
  expect(w.toasts.length).toBe(1);
  expect(CONTROL.test(w.toasts[0]!)).toBe(false);
  const listed = await names($, '');
  expect(listed.text).toContain('Problems:');
  expect(CONTROL.test(listed.text!)).toBe(false);
});

test('a names file over the size limit is not read; the agent gets a built-in name and one toast', async ($, on) => {
  const { POOL } = await import_pool();
  const w: World = { list: [], names: [], toasts: [], files: { [PROJECT]: JSON.stringify({ only: true, names: ['Ripley'], pad: 'x'.repeat(300 * 1024) }) } };
  engine($, on, w);
  await call($, 'say ok');
  await call($, 'say ok');
  expect(w.read ?? []).toEqual([]);
  expect(POOL.categories.flatMap(c => c.names)).toContain(w.names[0]);
  expect(w.toasts.length).toBe(1);
  expect(w.toasts[0]).toContain('too large');
});

test('/names import refuses a file over the size limit', async ($, on) => {
  const w: World = { list: [], names: [], toasts: [], files: { '/tmp/big.txt': 'Ripley\n'.repeat(60000) } };
  engine($, on, w);
  const r = await names($, 'import /tmp/big.txt');
  expect(r.text).toContain('too large');
  expect(w.files![USER]).toBe(undefined);
});

test('/names lists a long set in part, with a count', async ($, on) => {
  const many = Array.from({ length: 400 }, (_, i) => `N${i}`);
  const w: World = { list: [], names: [], toasts: [], files: { [USER]: JSON.stringify({ names: many }) } };
  engine($, on, w);
  const listed = await names($, '');
  expect(listed.text).toContain('(+350 more)');
  expect(listed.text!.length < 4000).toBe(true);
});

import { POOL as _POOL } from '../hooks/pool.ts';
async function import_pool() { return { POOL: _POOL }; }
