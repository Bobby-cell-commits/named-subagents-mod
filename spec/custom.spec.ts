// Plain unit tests for the custom-names logic. Run: node --test spec/*.spec.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryFor, drawName, pickName, type Pool } from '../hooks/draw.ts';
import { POOL } from '../hooks/pool.ts';
import {
  NAME_RE, applyCustom, cleanName, editCustom, emptyCustom, mergeCustom, parseCustom, parseImport,
  serializeCustom, tokenize, type Custom,
} from '../hooks/custom.ts';

const base: Pool = {
  categories: [
    { key: 'explore', subagent_types: ['Explore'], keywords: ['search', 'find'], names: ['Magellan', 'Cook'] },
    { key: 'code', subagent_types: ['general-purpose', 'worker'], keywords: ['implement'], names: ['Hopper', 'Turing'] },
    { key: 'default', subagent_types: ['default'], keywords: [], names: ['Vega'] },
  ],
};
const custom = (c: Partial<Custom>): Custom => ({ ...emptyCustom(), ...c });
const layer = (c: Partial<Custom>, label = 'file') => ({ label, custom: custom(c) });
const namesOf = (pool: Pool, key: string) => pool.categories.find(c => c.key === key)?.names;

// ---- the name rule ----

test('every built-in name already fits the Agent tool rule', () => {
  const bad = POOL.categories.flatMap(c => c.names).filter(n => !NAME_RE.test(n));
  assert.deepEqual(bad, []);
});

test('cleanName joins words, drops accents and apostrophes', () => {
  assert.equal(cleanName('Mary Shelley'), 'MaryShelley');
  assert.equal(cleanName("O'Brien"), 'OBrien');
  assert.equal(cleanName('Zoë'), 'Zoe');
  assert.equal(cleanName('  padded  '), 'padded');
  assert.equal(cleanName('a/b'), 'aB');
  assert.equal(cleanName('lower-case_1'), 'lower-case_1');
  assert.equal(cleanName('-dash'), 'dash');
});

test('cleanName gives nothing for a name with no usable character', () => {
  assert.equal(cleanName('名前'), undefined);
  assert.equal(cleanName('🚀'), undefined);
  assert.equal(cleanName('   '), undefined);
});

test('cleanName caps the length so a numbered suffix still fits', () => {
  const c = cleanName('B'.repeat(200))!;
  assert.equal(c.length, 60);
  assert.ok(NAME_RE.test(`${c}-99`));
});

// ---- reading a file ----

test('parseCustom reads every key and cleans the names', () => {
  const p = parseCustom(JSON.stringify({
    only: true, use: 'pirates', names: ['Ripley', 'Mary Shelley'], remove: ['Turing'], rename: { Hopper: 'Grace' },
    sets: { pirates: { names: ['Kidd'], for: ['Explore'], keywords: ['Search'], replace: true }, crew: ['Dallas', 'Kane'] },
  }), 'file');
  assert.deepEqual(p.problems, []);
  assert.deepEqual(p.cleaned, ['"Mary Shelley" -> MaryShelley']);
  assert.deepEqual(p.custom, {
    only: true, use: 'pirates', names: ['Ripley', 'MaryShelley'], remove: ['Turing'], rename: { Hopper: 'Grace' },
    sets: {
      pirates: { names: ['Kidd'], for: ['Explore'], keywords: ['search'], replace: true },
      crew: { names: ['Dallas', 'Kane'], for: [], keywords: [], replace: false },
    },
  });
});

test('parseCustom reports invalid JSON as one problem and changes nothing', () => {
  const p = parseCustom('{ "names": [', 'your names file');
  assert.equal(p.problems.length, 1);
  assert.match(p.problems[0]!, /^your names file: not valid JSON/);
  assert.deepEqual(p.custom, emptyCustom());
});

test('parseCustom keeps what is right and lists what is wrong', () => {
  const p = parseCustom(JSON.stringify({ names: ['Ripley', '名前', 7], only: 'yes', colour: 'red', sets: { 'bad key': ['X'], ok: { names: ['Y'], extra: 1 } } }), 'file');
  assert.deepEqual(p.custom.names, ['Ripley']);
  assert.deepEqual(Object.keys(p.custom.sets), ['ok']);
  assert.equal(p.custom.only, false);
  assert.equal(p.problems.length, 6);
  assert.ok(p.problems.some(x => x.includes('"名前" cannot be a name')));
  assert.ok(p.problems.some(x => x.includes('unknown key "colour"')));
});

test('a names list may be one comma-separated string, or a list holding such strings', () => {
  assert.deepEqual(parseCustom(JSON.stringify({ names: 'Ripley, Deckard,Neo' }), 'f').custom.names, ['Ripley', 'Deckard', 'Neo']);
  assert.deepEqual(parseCustom(JSON.stringify({ names: ['Ripley, Mary Shelley', 'Neo'] }), 'f').custom.names, ['Ripley', 'MaryShelley', 'Neo']);
});

test('serializeCustom round-trips and leaves out what is empty', () => {
  assert.equal(serializeCustom(emptyCustom()), '{}\n');
  const c = custom({ only: true, names: ['Ripley'], sets: { pirates: { names: ['Kidd'], for: ['Explore'], keywords: [], replace: false } } });
  assert.deepEqual(parseCustom(serializeCustom(c), 'f').custom, c);
});

// ---- layering onto the pool ----

test('no layers leaves the pool as it is', () => {
  assert.deepEqual(applyCustom(base, []).pool, base);
});

test('flat names join every built-in pool', () => {
  const { pool } = applyCustom(base, [layer({ names: ['Ripley'] })]);
  for (const key of ['explore', 'code', 'default']) assert.ok(namesOf(pool, key)!.includes('Ripley'), key);
  assert.equal(base.categories[0]!.names.includes('Ripley'), false); // the built-in pool is not mutated
});

test('a new set goes first, is exact, and its `for` wins over keywords for a generic role', () => {
  const { pool } = applyCustom(base, [layer({ names: ['Ripley'], sets: { pirates: { names: ['Kidd'], for: ['general-purpose'], keywords: [], replace: false } } })]);
  assert.equal(pool.categories[0]!.key, 'pirates');
  assert.deepEqual(namesOf(pool, 'pirates'), ['Kidd']); // flat names stay out of the user's own sets
  assert.equal(categoryFor(pool, 'general-purpose', 'implement the endpoint'), 'pirates');
  assert.equal(categoryFor(pool, 'Explore', 'find it'), 'explore');
});

test('a set with a built-in name adds to that pool, or replaces its names', () => {
  const added = applyCustom(base, [layer({ sets: { code: { names: ['Neo'], for: [], keywords: [], replace: false } } })]).pool;
  assert.deepEqual(namesOf(added, 'code'), ['Hopper', 'Turing', 'Neo']);
  const replaced = applyCustom(base, [layer({ sets: { code: { names: ['Neo'], for: [], keywords: [], replace: true } } })]).pool;
  assert.deepEqual(namesOf(replaced, 'code'), ['Neo']);
  assert.equal(categoryFor(replaced, 'general-purpose', 'find it'), 'explore'); // still a built-in pool: keywords first
});

test('only leaves out the built-in names; flat names become the default pool', () => {
  const { pool } = applyCustom(base, [layer({ only: true, names: ['Ripley', 'Neo'] })]);
  assert.deepEqual(pool.categories, [{ key: 'default', subagent_types: [], keywords: [], names: ['Ripley', 'Neo'] }]);
  assert.ok(['Ripley', 'Neo'].includes(pickName(pool, { subagentType: 'Explore', description: 'find it', taken: [], rand: () => 0 }).name));
});

test('only with nothing of your own falls back to the built-in names and says so', () => {
  const a = applyCustom(base, [layer({ only: true })]);
  assert.deepEqual(a.pool, base);
  assert.match(a.problems[0]!, /no names are left/);
});

test('remove and rename apply to every pool, case-insensitively', () => {
  const { pool } = applyCustom(base, [layer({ remove: ['turing'], rename: { hopper: 'Grace' } })]);
  assert.deepEqual(namesOf(pool, 'code'), ['Grace']);
});

test('later layers build on earlier ones: project after user, install screen last', () => {
  const { pool } = applyCustom(base, [
    layer({ only: true }, 'install screen'),
    layer({ names: ['Ripley'], sets: { pirates: { names: ['Kidd'], for: [], keywords: [], replace: false } } }, 'user'),
    layer({ remove: ['Ripley'], names: ['Deckard'] }, 'project'),
    layer({ names: ['Neo'] }, 'install screen'),
  ]);
  assert.deepEqual(namesOf(pool, 'default'), ['Deckard', 'Neo']);
  assert.deepEqual(namesOf(pool, 'pirates'), ['Kidd']);
});

test('use resolves to a pool that exists, or is reported and dropped', () => {
  const sets = { pirates: { names: ['Kidd'], for: [], keywords: [], replace: false } };
  assert.equal(applyCustom(base, [layer({ use: 'Pirates', sets })]).use, 'pirates');
  assert.equal(applyCustom(base, [layer({ use: 'code' })]).use, 'code');
  const missing = applyCustom(base, [layer({ use: 'ninjas' }, 'your names file')]);
  assert.equal(missing.use, undefined);
  assert.match(missing.problems[0]!, /your names file: use names no pool called "ninjas"/);
  assert.equal(applyCustom(base, [layer({ use: 'pirates', sets }), layer({ use: 'auto' })]).use, undefined);
});

test('everything applyCustom can produce fits the name rule', () => {
  const p = parseCustom(JSON.stringify({ names: ['Mary Shelley', "O'Brien", 'x@y.z', '<b>bold</b>', 'B'.repeat(200)], rename: { Hopper: 'Grace Hopper' }, sets: { s: ['line1\nline2', '#hash tag!'] } }), 'f');
  const { pool } = applyCustom(base, [{ label: 'f', custom: p.custom }]);
  assert.deepEqual(pool.categories.flatMap(c => c.names).filter(n => !NAME_RE.test(n)), []);
});

// ---- /names ----

test('tokenize splits on spaces and commas and keeps quoted names whole', () => {
  assert.deepEqual(tokenize('add Ripley, "Mary Shelley"  \'Jean Luc\' Neo'), ['add', 'Ripley', 'Mary Shelley', 'Jean Luc', 'Neo']);
  assert.deepEqual(tokenize(''), []);
});

test('add puts names in the file, cleans them, and un-hides a hidden one', () => {
  const e = editCustom(custom({ remove: ['Ripley'] }), 'add', ['Ripley', 'Mary Shelley', '名前'], base);
  assert.deepEqual(e.custom.names, ['Ripley', 'MaryShelley']);
  assert.deepEqual(e.custom.remove, []);
  assert.ok(e.changed);
  assert.ok(e.lines.some(l => l.includes('"Mary Shelley" -> MaryShelley')));
  assert.ok(e.lines.some(l => l.startsWith('Skipped: "名前"')));
});

test('remove drops your own name, or hides a built-in one', () => {
  const c = custom({ names: ['Ripley'], sets: { pirates: { names: ['Kidd', 'Bonny'], for: [], keywords: [], replace: false } } });
  const e = editCustom(c, 'remove', ['ripley', 'Kidd', 'Turing'], base);
  assert.deepEqual(e.custom.names, []);
  assert.deepEqual(e.custom.sets.pirates!.names, ['Bonny']);
  assert.deepEqual(e.custom.remove, ['Turing']);
});

test('set defines or replaces a set and keeps its routing; unset drops it and its pin', () => {
  const c = custom({ use: 'pirates', sets: { pirates: { names: ['Kidd'], for: ['Explore'], keywords: ['search'], replace: false } } });
  const set = editCustom(c, 'set', ['pirates', 'Bonny', 'Teach'], base);
  assert.deepEqual(set.custom.sets.pirates, { names: ['Bonny', 'Teach'], for: ['Explore'], keywords: ['search'], replace: false });
  const unset = editCustom(c, 'unset', ['Pirates'], base);
  assert.deepEqual(unset.custom.sets, {});
  assert.equal(unset.custom.use, undefined);
});

test('use takes your sets and the built-in pools, and refuses anything else', () => {
  const c = custom({ sets: { pirates: { names: ['Kidd'], for: [], keywords: [], replace: false } } });
  assert.equal(editCustom(c, 'use', ['pirates'], base).custom.use, 'pirates');
  assert.equal(editCustom(c, 'use', ['CODE'], base).custom.use, 'code');
  const no = editCustom(c, 'use', ['ninjas'], base);
  assert.equal(no.changed, false);
  assert.match(no.lines[0]!, /No pool called ninjas/);
  assert.equal(editCustom(custom({ use: 'code' }), 'use', ['auto'], base).custom.use, undefined);
});

test('a verb that is unknown or badly used changes nothing and shows how', () => {
  const c = custom({ names: ['Ripley'] });
  for (const [verb, argv] of [['frobnicate', []], ['add', []], ['rename', ['OnlyOne']], ['only', ['maybe']], ['set', ['pirates']]] as const) {
    const e = editCustom(c, verb, [...argv], base);
    assert.equal(e.changed, false, verb);
    assert.equal(e.custom, c, verb);
    assert.ok(e.lines.join('\n').includes('/names'), verb);
  }
});

test('import takes a names file, a JSON list, or one name per line; merge joins them', () => {
  assert.deepEqual(parseImport('Ripley\nDallas\r\n\nKane\n', 'f').custom.names, ['Ripley', 'Dallas', 'Kane']);
  assert.deepEqual(parseImport('["Ripley", "Mary Shelley"]', 'f').custom.names, ['Ripley', 'MaryShelley']);
  const file = parseImport(JSON.stringify({ names: ['Neo'], sets: { pirates: ['Kidd'] } }), 'f').custom;
  const merged = mergeCustom(custom({ names: ['Ripley'], sets: { crew: { names: ['Kane'], for: [], keywords: [], replace: false } } }), file);
  assert.deepEqual(merged.names, ['Ripley', 'Neo']);
  assert.deepEqual(Object.keys(merged.sets), ['crew', 'pirates']);
});

// ---- found in review ----

test('rename applies before remove, so removing the new name works', () => {
  const { pool } = applyCustom(base, [layer({ rename: { Turing: 'Alan' }, remove: ['Alan'] })]);
  assert.deepEqual(namesOf(pool, 'code'), ['Hopper']);
});

test("`for` on a set named like a built-in pool wins for that type, without making the pool's own types win", () => {
  const { pool } = applyCustom(base, [layer({ sets: { code: { names: ['Neo'], for: ['Explore'], keywords: [], replace: true } } })]);
  assert.equal(categoryFor(pool, 'Explore', 'find it'), 'code');
  assert.equal(categoryFor(pool, 'general-purpose', 'find it'), 'explore'); // generic role: keywords still first
});

test('/names set finds an existing set whatever the case', () => {
  const c = custom({ sets: { pirates: { names: ['Kidd'], for: ['Explore'], keywords: [], replace: false } } });
  const e = editCustom(c, 'set', ['Pirates', 'Roberts'], base);
  assert.deepEqual(e.custom.sets, { pirates: { names: ['Roberts'], for: ['Explore'], keywords: [], replace: false } });
});

test('/names remove of a renamed name hides the original', () => {
  const e = editCustom(custom({ rename: { Turing: 'Alan' } }), 'remove', ['Alan'], base);
  assert.deepEqual(e.custom.rename, {});
  assert.deepEqual(e.custom.remove, ['Turing']);
  assert.equal(applyCustom(base, [{ label: 'f', custom: e.custom }]).pool.categories.flatMap(k => k.names).some(n => n === 'Alan' || n === 'Turing'), false);
});

test('/names remove of a name that is yours and built in also hides the built-in one', () => {
  const added = editCustom(emptyCustom(), 'add', ['Magellan'], base).custom;
  const e = editCustom(added, 'remove', ['Magellan'], base);
  assert.deepEqual(e.custom.names, []);
  assert.deepEqual(e.custom.remove, ['Magellan']);
});

test('merge joins a set of the same name instead of replacing it', () => {
  const mine = custom({ sets: { pirates: { names: ['Kidd', 'Bonny'], for: ['Explore'], keywords: ['search'], replace: false } } });
  const merged = mergeCustom(mine, parseImport(JSON.stringify({ sets: { Pirates: ['Roberts', 'kidd'] } }), 'f').custom);
  assert.deepEqual(merged.sets, { pirates: { names: ['Kidd', 'Bonny', 'Roberts'], for: ['Explore'], keywords: ['search'], replace: false } });
});

test('an exhausted pool with no default pool numbers a real name, not "Agent"', () => {
  const pool: Pool = { categories: [{ key: 'pirates', subagent_types: [], keywords: [], names: ['Kidd'] }] };
  assert.equal(drawName(pool, 'default', ['Kidd'], () => 0), 'Kidd-2');
});

test('a problem quotes at most a short piece of a bad entry', () => {
  const p = parseCustom(JSON.stringify({ names: ['名'.repeat(200000)] }), 'f');
  assert.equal(p.problems.length, 1);
  assert.ok(p.problems[0]!.length < 200, String(p.problems[0]!.length));
});
