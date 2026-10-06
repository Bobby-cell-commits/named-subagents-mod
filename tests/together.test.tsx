// Naming and the pane in one plugin: `claude plugin test .`. The test's hooks sit beneath the
// mod and stand in for the engine: the Agent tool, agent.spawn, the agent list, the panes,
// the names files (none), the toast and the status line.
import { test, expect, mock } from 'claude-code/testing';
import type { AgentInfo, On } from 'claude-code';

const PANE = {
  plugin: 'named-subagents-mod', surface: 'vscode', component: 'Pane', requestId: 'agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  viewport: { columns: 160, rows: 40, isFullscreen: true },
} as never;

type World = {
  list: AgentInfo[]; names: (string | undefined)[]; toasts: string[]; status: (string | undefined)[]; commands: string[];
  listName?: (n?: string) => string | undefined; // the name the engine's list shows for a spawn
  duringSpawn?: () => Promise<void>; // runs once the agent is listed, before the spawn answers
  files?: Record<string, string>; // path -> text: the names files there are (none unless given)
  refuse?: string; // a command the engine will not register
  agentBreaks?: boolean; // the Agent tool throws, after the mod's hooks have run
};
const USER = '/home/t/.claude/named-subagents.json';
const world = (): World => ({ list: [], names: [], toasts: [], status: [], commands: [] });

// All the text a drawing holds, in order.
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  const n = node as { children?: unknown[]; props?: { label?: string } };
  return [n.props?.label ?? '', ...(n.children ?? []).map(textOf)].join('');
};

// Beneath the mod. The Agent tool spawns (raising agent.spawn on the test's own `$`, as the
// engine does) and the new agent is in the list under the name the spawn got.
async function start(top: any, on: On, w: World) {
  let n = 0;
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/t' : undefined }) as never);
  on('session.root', () => ({ value: '/proj' }) as never);
  on('fs.exists', ($, e) => ({ value: w.files?.[e.path] !== undefined }) as never);
  on('fs.stat', ($, e) => ({ value: { kind: 'file', size: w.files?.[e.path]?.length ?? 0, mtimeMs: 1000, isLink: false } }) as never);
  on('fs.read', ($, e) => ({ value: w.files?.[e.path] ?? '' }) as never);
  on('command.register', ($, e) => {
    if (e.name === w.refuse) throw new Error(`cannot register ${e.name}`);
    w.commands.push(e.name);
    return { value: { command: e.name } } as never;
  });
  on('agent.list', () => ({ value: w.list }) as never);
  on('ui.panes', () => ({ value: [] }) as never);
  on('ui.open', () => ({ value: { isPlaced: false } }) as never);
  on('ui.toast', ($, e) => { w.toasts.push(e.text); return { value: undefined } as never; });
  on('ui.status', ($, e) => { w.status.push(e.text); return { value: undefined } as never; });
  on('session.surfaces' as never, () => ({ value: ['terminal'] }) as never);
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never);
  on('agent.spawn', async ($, e) => {
    const id = `a${++n}`;
    w.list = [...w.list, { id, description: e.description, type: e.subagentType, status: 'running', name: w.listName ? w.listName(e.name) : e.name }];
    await w.duringSpawn?.();
    return { model: 'haiku', agentId: id };
  });
  on('tool.call', { tool: 'Agent' }, async ($, e) => {
    w.names.push(e.name);
    if (w.agentBreaks) throw new Error('the Agent tool broke');
    const r = await top.agent.spawn({
      tool_use_id: e.tool_use_id, prompt: e.prompt, description: e.description,
      subagentType: e.subagent_type ?? 'general-purpose', name: e.name,
    } as never);
    return { result: { agentId: r.agentId ?? '' }, text: 'ok' } as never;
  });
  await top.session.start({ cwd: '/proj', surface: null, isInteractive: true } as never);
}

// The label of the Button with this key: a roster row's name.
const labelOf = async (ui: { find: (q: { key: string }) => Promise<unknown> }, key: string) =>
  ((await ui.find({ key })) as { props: { label: string } } | undefined)?.props.label.trim();

const dispatch = ($: any, description: string) =>
  $.tool.call({ tool: 'Agent', description, prompt: 'reply ok', subagent_type: 'general-purpose' });

test('an agent the mod names is listed in the pane under that name', async ($, on) => {
  const clock = mock.clock(on);
  const w = world();
  await start($, on, w);
  await dispatch($, 'map the hooks');
  await dispatch($, 'count the tests');
  const [first, second] = w.names as [string, string];
  expect(first).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/); // the mod drew it: the model gave none
  expect(second).not.toBe(first);
  for (const settle of [0, 2_000]) { // at the spawn, and again once the list sync has run
    await clock.advance(settle);
    const ui = await $.ui.mount(PANE);
    expect(await labelOf(ui, 'name-a1')).toBe(first);
    expect(await labelOf(ui, 'name-a2')).toBe(second);
    const drawn = textOf(await ui.drawn());
    expect(drawn).toContain('map the hooks');
    expect(drawn).not.toContain('general-purpose('); // beside a name a row is the task alone
    await ui.unmount();
  }
  expect(w.list.map(a => a.name)).toEqual([first, second]); // the engine's list, the tree's source, agrees
  expect(w.toasts).toEqual([]);
});

test('both commands are registered when the session starts', async ($, on) => {
  mock.clock(on);
  const w = world();
  await start($, on, w);
  expect([...w.commands].sort()).toEqual(['agentpane', 'names']);
});

test('with naming off the pane still lists agents, by type, and /names is not offered', { options: { enabled: false } }, async ($, on) => {
  mock.clock(on);
  const w = world();
  await start($, on, w);
  await dispatch($, 'map the hooks');
  expect(w.names).toEqual([undefined]);
  expect(w.commands).toEqual(['agentpane']);
  const ui = await $.ui.mount(PANE);
  expect(textOf(await ui.drawn())).toContain('general-purpose(map the hooks)');
  await ui.unmount();
});

// The plugin has one status line. The pane counts running agents on it while it is not on
// screen; naming raises an alarm on it and clears the alarm at the next clean spawn.
test('a clean spawn does not wipe the running count from the status line', { options: { autoOpen: false } }, async ($, on) => {
  const clock = mock.clock(on);
  const w = world();
  await start($, on, w);
  w.duringSpawn = () => clock.advance(1_000); // the pane's sync counts the new agent before naming has checked its name
  await dispatch($, 'map the hooks');
  await clock.advance(3_000);
  expect(w.toasts).toEqual([]);
  expect(w.status.at(-1)).toBe('✻ 1 agent running');
});

test('a naming alarm stays on the status line beside the count, and leaves it to the count at the next clean spawn', { options: { autoOpen: false } }, async ($, on) => {
  const clock = mock.clock(on);
  const w = world();
  await start($, on, w);
  w.listName = () => 'Somebody-else';
  await dispatch($, 'map the hooks');
  await clock.advance(3_000);
  expect(w.status.at(-1)).toMatch(/^✻ 1 agent running · named-subagents: drew \S+ but the agent list shows Somebody-else$/);
  w.listName = undefined;
  await dispatch($, 'count the tests');
  await clock.advance(3_000);
  expect(w.status.at(-1)).toBe('✻ 2 agents running');
});

// A names file that is wrong is alarmed until it is fixed, however many clean spawns follow.
test('a names file with a problem does not hide the running count', { options: { autoOpen: false } }, async ($, on) => {
  const clock = mock.clock(on);
  const w = world();
  w.files = { [USER]: '{ not json' };
  await start($, on, w);
  await dispatch($, 'map the hooks');
  await dispatch($, 'count the tests');
  await clock.advance(3_000);
  expect(w.status.at(-1)).toMatch(/^✻ 2 agents running · named-subagents: .*not valid JSON/);
});

test('when /agentpane cannot be registered the mod says so, and the pane still counts agents', { options: { autoOpen: false } }, async ($, on) => {
  const clock = mock.clock(on);
  const w = world();
  w.refuse = 'agentpane';
  await start($, on, w);
  expect(w.commands).toEqual(['names']);
  expect(w.toasts.join('\n')).toMatch(/could not register \/agentpane/);
  w.toasts.length = 0;
  w.status.length = 0;
  await dispatch($, 'map the hooks');
  await clock.advance(3_000);
  expect(w.status.at(-1)).toBe('✻ 1 agent running');
});

// Naming's hook stands around everything beneath it: the pane's tool.call hook, other plugins, the Agent
// tool itself. A failure down there, after the name was set, is not naming's.
test('a failure beneath naming, once the call has its name, is not reported as naming failing', async ($, on) => {
  mock.clock(on);
  const w = world();
  w.agentBreaks = true;
  await start($, on, w);
  await Promise.resolve(dispatch($, 'map the hooks')).catch(() => undefined);
  expect(w.names[0]).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
  expect(w.toasts.filter(t => /naming failed/.test(t))).toEqual([]);
});
