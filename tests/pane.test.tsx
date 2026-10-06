// From agentpane 1.1.4 by Anji Xu (https://github.com/xuanji86/claude-agentpane, MIT: see LICENSE-agentpane); mounted under this mod's name, with the tests the name column and roster added.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'named-subagents-mod', surface: 'terminal', component: 'Pane', requestId: 'agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  viewport: { columns: 160, rows: 40, isFullscreen: true },
} as never

const BAND = {
  plugin: 'named-subagents-mod', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as never

type World = {
  agents: { id: string; description: string; type: string; status: string; name?: string }[]; panes: string[]; opened: number; closed: number
  widths?: (number | undefined)[]; focus?: (boolean | undefined)[]; toasts?: string[]; tools?: { tool: string; task_id?: string; consent?: string }[]
  placed?: boolean; stopAnswer?: object; messages?: object[]; stopReason?: string; rows?: (number | undefined)[]; status?: (string | undefined)[]
  surfaces?: string[]
  beforeList?: () => Promise<void> // runs while a sync waits on the engine's list
}

// All the text a drawing holds, in order.
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  const n = node as { children?: unknown[]; props?: { children?: unknown; label?: string } }
  return [n.props?.label ?? '', ...(n.children ?? []).map(textOf)].join('')
}

// The engine beneath a started session: the agent list, the panes, and one agent's conversation.
const start = async ($: { session: { start: (e: never) => Promise<unknown> } }, on: On, world: World) => {
  on('command.register', () => ({ value: { command: 'agentpane' } }))
  on('agent.list', async () => (await world.beforeList?.(), { value: world.agents }) as never)
  on('ui.panes', () => ({ value: world.panes.map(id => ({ id, title: 'Agents', isShown: true, isFocused: false, isPlaced: world.placed ?? true })) }))
  on('ui.open', ($, e) => (world.opened++, world.panes = [e.id], (world.widths ??= []).push(e.columns), (world.focus ??= []).push(e.focus), (world.rows ??= []).push(e.rows), { value: { isPlaced: true } }) as never)
  on('agent.spawn', ($, e) => ({ model: 'claude-sonnet-5-5', agentId: `sp-${(e as { description: string }).description.replace(/\W+/g, '-')}` }) as never)
  on('ui.close', () => (world.closed++, world.panes = [], { value: undefined }))
  on('session.messages', () => ({
    value: world.messages ?? [
      { role: 'user', text: 'Find every mod example.', toolUses: [] },
      { role: 'assistant', text: 'Looking now.', toolUses: [{ tool_use_id: '1', tool: 'Glob', input: { pattern: '**/*.tsx' } }] },
    ],
  }) as never)
  on('tool.call', ($, e) => (
    (world.tools ??= []).push(e as never),
    (e as { tool: string }).tool === 'TaskStop' && world.stopAnswer ? world.stopAnswer : { result: { stdout: '', stderr: '', interrupted: false } }
  ) as never)
  on('ui.toast', ($, e) => ((world.toasts ??= []).push(String((e as { text?: string }).text ?? e)), { value: undefined }) as never)
  on('ui.status', ($, e) => ((world.status ??= []).push((e as { text?: string }).text), { value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.surfaces' as never, () => ({ value: world.surfaces ?? ['terminal'] }) as never)
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: world.stopReason ?? 'tool_use', usage: { model: 'm', input_tokens: 10, output_tokens: 1_200, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0 } }
  } as never)
  // nothing else in the band beneath
  on('ui.render', { component: 'AbovePrompt' }, $ => {
    const { Box } = ($ as { ui: { resolve: (e: unknown) => { Box: (p: object) => unknown } } }).ui.resolve({ surface: 'terminal', component: 'AbovePrompt' })
    return h(Box as never, {}) as never
  })
  await $.session.start({ cwd: '/w', surface: null, isInteractive: true } as never)
}

test('a running agent opens the pane, lists what it does, and the pane folds once it is done', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  expect(world.opened).toBe(0)
  world.agents = [{ id: 'a1', description: 'find mod examples', type: 'Explore', status: 'running' }]
  await clock.advance(1_000)
  expect(world.opened).toBe(1)
  await $.tool.call({ tool: 'Bash', command: 'ls hooks', agentId: 'a1' } as never)
  const stepped = $.turn.step({ turnId: 't', index: 0, model: 'claude-fable-5-1', messageCount: 1, agentId: 'a1' } as never)
  for await (const _ of stepped as AsyncIterable<unknown>) void _ // the engine reads a response to its end
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /1 running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Bash\(ls hooks\)$/ })).toBeDefined() // in this narrow pane, on a line beneath its row
  // listed by the poll, no spawn report: the model is the one its request named, said once in the header
  expect(await ui.find({ type: 'Text', text: /^ · Fable 5\.1$/ })).toBeDefined()
  world.agents = [{ ...world.agents[0]!, status: 'completed' }]
  await clock.advance(5_000)
  expect(world.closed).toBe(0)
  await clock.advance(6_000)
  expect(world.closed).toBe(1) // folded away
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Button', text: /◂ Agents ✓ 1/ })).toBeDefined() // to look back at it
  await ui.unmount()
  await band.unmount()
})

test('in the desktop app nothing opens, toasts or shows unasked', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0, surfaces: ['desktop'] }
  await start($, on, world)
  world.agents = [{ id: 'a1', description: 'find mod examples', type: 'Explore', status: 'running' }]
  await clock.advance(2_000)
  world.agents = [{ ...world.agents[0]!, status: 'completed' }]
  await clock.advance(2_000)
  expect(world.opened).toBe(0)
  expect(world.toasts ?? []).toEqual([])
  expect((world.status ?? []).filter(Boolean)).toEqual([])
})

test('a new agent unfolds a pane folded by hand', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [{ id: 'a1', description: 'one', type: 'Explore', status: 'running' }], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'collapse' })
  await clock.advance(3_000)
  expect(world.opened).toBe(1)
  world.agents = [...world.agents, { id: 'a2', description: 'two', type: 'Plan', status: 'running' }]
  await clock.advance(1_000)
  expect(world.opened).toBe(2)
  await pane.unmount()
})

test('pressing an agent shows its conversation, and back returns to the list', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [{ id: 'a1', description: 'find mod examples', type: 'Explore', status: 'running' }], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'agent-a1' })
  expect(await ui.find({ type: 'Markdown', text: /Looking now\./ } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Glob$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /⎿ {2}Running…/ })).toBeDefined()
  expect(world.widths?.at(-1)).toBe(99) // widened to read the conversation
  expect(world.focus?.at(-1)).toBe(true) // and given the keyboard, so b/k/j work
  await ui.press({ key: 'back' })
  expect(world.widths?.at(-1)).toBeUndefined() // and back to the usual width
  expect(await ui.find({ type: 'Markdown', text: /Looking now\./ } as never)).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /1 running/ })).toBeDefined()
  await ui.unmount()
})

test('closed by hand while agents run, the pane stays shut until a new agent starts', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [{ id: 'a1', description: 'one', type: 'Explore', status: 'running' }], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  expect(world.opened).toBe(1)
  await $.command.run({ command: 'agentpane', args: '' } as never)
  expect(world.closed).toBe(1)
  await clock.advance(5_000)
  expect(world.opened).toBe(1)
  world.agents = [...world.agents, { id: 'a2', description: 'two', type: 'Plan', status: 'running' }]
  await clock.advance(1_000)
  expect(world.opened).toBe(2)
})

test('the ▸ handle hides the pane, and the tab above the prompt brings it back', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [{ id: 'a1', description: 'find mod examples', type: 'Explore', status: 'running' }], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  expect(world.opened).toBe(1)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'collapse' })
  expect(world.closed).toBe(1)
  await clock.advance(5_000)
  expect(world.opened).toBe(1) // stays hidden while the agent runs
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Button', text: /◂ Agents .* 1/ })).toBeDefined()
  await band.press({ key: 'agents-tab' })
  expect(world.opened).toBe(2)
  expect(await band.find({ type: 'Button', text: /Agents/ })).toBeUndefined()
  await pane.unmount()
  await band.unmount()
})

test('an agent that finishes says so in a toast', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [{ id: 'a1', description: 'find mod examples', type: 'Explore', status: 'running' }], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  world.agents = [{ ...world.agents[0]!, status: 'completed' }]
  await clock.advance(1_000)
  expect(world.toasts).toEqual(['✓ Explore(find mod examples) done · 1s'])
})

test('Stop asks once more, then stops the agent with TaskStop on the person\'s say-so', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [{ id: 'a1', description: 'find mod examples', type: 'Explore', status: 'running' }], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'agent-a1' })
  await ui.press({ key: 'stop' })
  expect(world.tools?.some(t => t.tool === 'TaskStop')).toBeFalsy()
  expect(await ui.find({ type: 'Button', text: /Confirm stop/ })).toBeDefined()
  await ui.press({ key: 'stop' })
  const stop = world.tools?.find(t => t.tool === 'TaskStop')
  expect(stop?.task_id).toBe('a1')
  expect(stop?.consent).toContain('Stop')
  await ui.unmount()
})

test('"done" in the header hides the finished agents and shows them again', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = {
    agents: [{ id: 'a1', description: 'still going', type: 'Explore', status: 'running' }, { id: 'a2', description: 'all done', type: 'Plan', status: 'completed' }],
    panes: [], opened: 0, closed: 0,
  }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', text: /all done/ })).toBeDefined()
  await ui.press({ key: 'toggle-done' })
  expect(await ui.find({ type: 'Button', text: /all done/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button', text: /still going/ })).toBeDefined()
  await ui.press({ key: 'toggle-done' })
  expect(await ui.find({ type: 'Button', text: /all done/ })).toBeDefined()
  await ui.unmount()
})

const running = (id: string, description = `task ${id}`, parentId?: string) => ({ id, description, type: 'Explore', status: 'running', ...(parentId && { parentId }) })

test('a pane folded by hand and reopened from the tab after the agents finished stays open', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(3_000) // the pane opens, and a sync sees it open with an agent running
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'collapse' })
  world.agents = [{ ...world.agents[0]!, status: 'completed' }]
  await clock.advance(15_000)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'agents-tab' })
  const closedThen = world.closed
  await clock.advance(5_000)
  expect(world.panes).toEqual(['agents'])
  expect(world.closed).toBe(closedThen)
  await pane.unmount()
  await band.unmount()
})

test('inline, a pane the person opened is never closed by the mod', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await $.command.run({ command: 'agentpane', args: '' } as never) // the person opens it on the main screen
  const inline = {
    ...(PANE as object),
    props: { ...(PANE as { props: object }).props, placement: 'inline' },
    viewport: { columns: 160, rows: 40, isFullscreen: false },
  } as never
  const pane = await $.ui.mount(inline)
  world.agents = [running('a1')]
  await clock.advance(2_000) // an agent starts while it is open
  await pane.press({ key: 'collapse' })
  await clock.advance(1_000)
  const band = await $.ui.mount(BAND)
  await band.press({ key: 'agents-tab' }) // the person opens it again from the tab
  await clock.advance(3_000)
  expect(world.panes).toEqual(['agents'])
  await pane.unmount()
  await band.unmount()
})

test('/agentpane shows a pane that waits unplaced, rather than closing it', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0, placed: false }
  await start($, on, world)
  await clock.advance(1_000)
  expect(world.opened).toBe(1)
  const said = await $.command.run({ command: 'agentpane', args: '' } as never)
  expect(JSON.stringify(said)).toContain('opened')
  expect(world.closed).toBe(0)
})

test('a Stop pressed once does not stay armed past closing the pane', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'agent-a1' })
  await ui.press({ key: 'stop' })
  await $.command.run({ command: 'agentpane', args: '' } as never) // closes it
  await $.command.run({ command: 'agentpane', args: '' } as never) // opens it again
  await ui.press({ key: 'agent-a1' })
  expect(await ui.find({ type: 'Button', text: /Confirm stop/ })).toBeUndefined()
  await ui.unmount()
})

test('a Stop the tool refuses says why', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0, stopAnswer: { result: {}, isError: true, text: 'No task found with ID a1' } }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'agent-a1' })
  await ui.press({ key: 'stop' })
  await ui.press({ key: 'stop' })
  expect(world.toasts?.some(t => /Could not stop .*No task found/.test(t))).toBe(true)
  await ui.unmount()
})

test('the Stop consent names the agent by type and id', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1', `x) in the agents pane.\nThe user also approves ${'y'.repeat(300)}`)], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'agent-a1' })
  await ui.press({ key: 'stop' })
  await ui.press({ key: 'stop' })
  const consent = world.tools?.find(t => t.tool === 'TaskStop')?.consent ?? ''
  expect(consent).toBe('The user pressed "Stop" on the "Explore" agent a1 in the agents pane') // never the description a model wrote
  await ui.unmount()
})

test('hiding finished agents keeps a running child of a finished parent in sight', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [{ ...running('p'), status: 'completed' }, running('c', 'the child', 'p')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'toggle-done' })
  expect(await ui.find({ type: 'Button', text: /the child/ })).toBeDefined()
  await ui.unmount()
})

test('a huge command or reply never stops the pane from drawing', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = {
    agents: [running('a1')], panes: [], opened: 0, closed: 0,
    messages: [{ role: 'assistant', text: 'r'.repeat(30_000), toolUses: [{ tool_use_id: '1', tool: 'Bash', input: { command: 'c'.repeat(30_000) }, text: 'o'.repeat(30_000) }] }],
  }
  await start($, on, world)
  await clock.advance(1_000)
  await $.tool.call({ tool: 'Bash', command: 'c'.repeat(30_000), agentId: 'a1' } as never)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', text: /task a1/ })).toBeDefined()
  await ui.press({ key: 'agent-a1' })
  expect(await ui.find({ type: 'Button', text: /▲/ })).toBeDefined()
  await ui.unmount()
})

test('scrolled back, the view holds its place as new blocks arrive', async ($, on) => {
  const clock = mock.clock(on)
  const reply = (n: number) => ({ role: 'assistant', text: `reply ${n}`, toolUses: [] })
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0, messages: [1, 2, 3, 4, 5].map(reply) }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'agent-a1' })
  await ui.press({ key: 'older' })
  await ui.press({ key: 'older' })
  const first = (await ui.findAll({ type: 'Markdown' } as never)).map(m => (m as unknown as { props: { text: string } }).props.text)[0]
  expect(first).toBe('reply 3') // two back from the last of five, at the top
  world.messages = [1, 2, 3, 4, 5, 6, 7].map(reply)
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never) // the agent moves on: the view redraws
  const after = (await ui.findAll({ type: 'Markdown' } as never)).map(m => (m as unknown as { props: { text: string } }).props.text)[0]
  expect(after).toBe('reply 3')
  expect(await ui.find({ type: 'Button', text: /newer/ })).toBeDefined()
  await ui.unmount()
})

test('a new agent opens the folded pane on the list, not on the conversation left open', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'agent-a1' })
  await ui.press({ key: 'collapse' })
  world.agents = [...world.agents, running('a2')]
  await clock.advance(1_000)
  expect(world.panes).toEqual(['agents'])
  expect(world.widths?.at(-1)).toBeUndefined() // the usual width
  expect(await ui.find({ type: 'Button', text: /task a2/ })).toBeDefined()
  await ui.unmount()
})

test('the tab counts failed agents apart from the ones that succeeded', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1'), running('a2')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'collapse' })
  world.agents = [{ ...world.agents[0]!, status: 'completed' }, { ...world.agents[1]!, status: 'failed' }]
  await clock.advance(1_000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Button', text: /✓ 1 ✗ 1/ })).toBeDefined()
  await pane.unmount()
  await band.unmount()
})

const step = async ($: { turn: { step: (e: never) => AsyncIterable<unknown> } }, agentId: string) => {
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, agentId } as never)) void _
}
const spawnOne = ($: { agent: { spawn: (e: never) => Promise<unknown> } }, description: string) =>
  $.agent.spawn({ tool_use_id: `t-${description}`, prompt: 'p', description, subagentType: 'Explore', provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5' } as never)

test('a spawned agent is listed at once with its model, before the next poll', async ($, on) => {
  mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await spawnOne($, 'look around')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', text: /Explore\(look around\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ · Sonnet 5\.5$/ })).toBeDefined()
  await ui.unmount()
})

const spawnNamed = ($: { agent: { spawn: (e: never) => Promise<unknown> } }, description: string, name: string, subagentType = 'Explore') =>
  $.agent.spawn({ tool_use_id: `t-${description}`, prompt: 'p', description, subagentType, name, provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5' } as never)

test('an agent given a name is listed under it, its description after; one without reads as before', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await spawnNamed($, 'map the hooks', 'Turing')
  await spawnNamed($, 'count the tests', 'BernersLee')
  await spawnOne($, 'look around')
  const ui = await $.ui.mount(PANE)
  // read where the surface has no clock, so each row's mark is in the drawing and starts its row
  const rows = async () => {
    const still = await $.ui.mount({ ...(PANE as object), surface: 'vscode' } as never)
    const found = textOf(await still.drawn()).match(/✻ (?!Agents).*?(map the hooks|count the tests|look around\))/g)
    await still.unmount()
    return found
  }
  // at the spawn, before any poll: a name column as wide as the widest name, then the description; no name, Type(description)
  expect(await rows()).toEqual(['✻ Turing      map the hooks', '✻ BernersLee  count the tests', '✻             Explore(look around)'])
  expect((await ui.find({ type: 'Button', text: /^Turing$/ }) as { props: { dimColor?: boolean } }).props.dimColor).toBeFalsy() // the name at full strength
  expect(await ui.find({ type: 'Button', text: /^map the hooks$/ })).toMatchObject({ props: { dimColor: true } }) // secondary beside a name
  expect((await ui.find({ type: 'Button', text: /^Explore\(look around\)$/ }) as { props: { dimColor?: boolean } }).props.dimColor).toBeFalsy()
  // the engine's list shows them under the same names: each label still equals its list name after the sync
  world.agents = [
    { id: 'sp-map-the-hooks', description: 'map the hooks', type: 'Explore', status: 'running', name: 'Turing' },
    { id: 'sp-count-the-tests', description: 'count the tests', type: 'Explore', status: 'running', name: 'BernersLee' },
    { id: 'sp-look-around', description: 'look around', type: 'Explore', status: 'running' },
  ]
  await clock.advance(2_000)
  expect(await rows()).toEqual(['✻ Turing      map the hooks', '✻ BernersLee  count the tests', '✻             Explore(look around)'])
  // the time axis labels a lane with the name alone, in a column of its own; without a name, with the task
  const lanes = textOf(await ui.drawn({ in: 'lanes' }))
  expect(lanes).toMatch(/✻ Turing {7}[·━]/)
  expect(lanes).toMatch(/✻ BernersLee {3}[·━]/)
  expect(lanes).toMatch(/✻ look around {2}[·━]/)
  expect(lanes).not.toContain('map the')
  // the name opens the agent's conversation, as its task does
  await ui.press({ key: 'name-sp-map-the-hooks' })
  expect(await ui.find({ type: 'Markdown', text: /Looking now\./ } as never)).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('above the prompt, the summary rows keep the name column', async ($, on) => {
  mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await spawnNamed($, 'map the hooks', 'Turing')
  await spawnNamed($, 'count the tests', 'BernersLee')
  const inline = { ...(PANE as object), props: { ...(PANE as { props: object }).props, placement: 'inline', bodyColumns: 120 }, viewport: { columns: 160, rows: 40, isFullscreen: false } } as never
  const ui = await $.ui.mount(inline)
  const drawn = textOf(await ui.drawn())
  expect(drawn).toContain('Turing      map the hooks')
  expect(drawn).toContain('BernersLee  count the tests')
  await ui.unmount()
})

test('a named agent is listed by name and description alone; its conversation is headed without the default type', async ($, on) => {
  mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await spawnNamed($, 'map the hooks', 'Turing', 'general-purpose')
  await spawnNamed($, 'count the tests', 'Ada')
  const ui = await $.ui.mount(PANE)
  const drawn = textOf(await ui.drawn())
  expect(drawn).toContain('Turing  map the hooks')
  expect(drawn).toContain('Ada     count the tests')
  expect(drawn).not.toMatch(/general-purpose|Explore/)
  await ui.press({ key: 'agent-sp-map-the-hooks' })
  const head = textOf(await ui.drawn())
  expect(head).toContain('⏺ Turing map the…') // the description cut to this narrow pane
  expect(head).not.toContain('general-purpose')
  await ui.unmount()
})

test('with no agent named, the list has no name column', async ($, on) => {
  mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await spawnOne($, 'look around')
  const ui = await $.ui.mount(PANE)
  expect(textOf(await ui.drawn())).toMatch(/[^ ]Explore\(look around\)/) // nothing before the task but its mark
  await ui.unmount()
})

test('a named agent\'s conversation is headed by its name, its type and description after', async ($, on) => {
  mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await spawnNamed($, 'map the hooks', 'Turing')
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'agent-sp-map-the-hooks' })
  expect(await ui.find({ type: 'Text', text: /^Turing $/ })).toMatchObject({ props: { bold: true } })
  expect(textOf(await ui.drawn())).toContain('⏺ Turing Explore(map the…)') // the description cut to this narrow pane
  await ui.unmount()
})

test('the model and effort its requests name show, the model winning over the spawn alias', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await spawnOne($, 'look around') // the spawn reports claude-sonnet-5-5
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5[1m]', effort: 'xhigh', messageCount: 1, agentId: 'sp-look-around' } as never)) void _
  // the engine's list now shows it, and the once-a-second sync rebuilds its record: model and effort must survive
  world.agents = [{ id: 'sp-look-around', description: 'look around', type: 'Explore', status: 'running' }]
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^ · Opus 5\.5 \(1M\) · xhigh$/ })).toBeDefined()
  expect(textOf(await ui.drawn())).not.toContain('Sonnet')
  await ui.unmount()
})

test('a running row\'s mark spins and its clock counts on the surface clock, the pane not redrawn', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  const mark = textOf(await ui.drawn({ in: 'mark-a1' }))
  expect(mark).toMatch(/^[·✢✳✶✻✽] $/)
  expect(textOf(await ui.drawn({ in: 'clock-a1' }))).toBe('0s')
  await (ui as unknown as { advance: (ms: number) => Promise<void> }).advance(240) // the surface clock alone: one turn of the spinner
  expect(textOf(await ui.drawn({ in: 'mark-a1' }))).not.toBe(mark)
  await (ui as unknown as { advance: (ms: number) => Promise<void> }).advance(2_760)
  expect(textOf(await ui.drawn({ in: 'clock-a1' }))).toBe('3s')
  expect(textOf(await ui.drawn())).not.toContain('Running…') // the mark says it
  await ui.unmount()
})

test('with motion off, a running row\'s mark stands still', { options: { motion: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^✻ $/ })).toMatchObject({ props: { color: 'claude' } })
  expect((await ui.findAll({ type: 'Client' } as never)).some(c => (c as unknown as { props: { key?: string } }).props.key === 'mark-a1')).toBe(false)
  await ui.unmount()
})

test('a response cut at max_tokens is flagged on the agent', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0, stopReason: 'max_tokens' }
  await start($, on, world)
  await clock.advance(1_000)
  await step($, 'a1')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^max_tokens ×1$/ })).toMatchObject({ props: { color: 'error' } })
  await ui.unmount()
})

test('model loops no agent claims are counted under the list', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  await step($, 'wf-1')
  await step($, 'wf-1')
  await step($, 'wf-2')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /2 other model loops \(workflow agents or forks\) · 3 requests/ })).toBeDefined()
  await ui.unmount()
})

test('the agent open in the main view is marked in the list', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1'), running('a2')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const viewing = { ...(PANE as object), props: { ...(PANE as { props: object }).props, view: { agentId: 'a2' } } } as never
  const ui = await $.ui.mount(viewing)
  const marks = await ui.findAll({ type: 'Text', text: /◂ main view/ })
  expect(marks.length).toBe(1)
  await ui.unmount()
})

test('above the prompt, the pane is a summary of at most eight rows', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: Array.from({ length: 7 }, (_, i) => running(`r${i}`)), panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  const inline = { ...(PANE as object), props: { ...(PANE as { props: object }).props, placement: 'inline', bodyColumns: 90 }, viewport: { columns: 160, rows: 40, isFullscreen: false } } as never
  const ui = await $.ui.mount(inline)
  await clock.advance(1_000)
  expect(world.rows?.at(-1)).toBe(8) // it asked for a summary's rows
  const root = (await ui.drawn()) as { children?: unknown[] }
  expect((root.children ?? []).filter(Boolean).length).toBeLessThanOrEqual(8)
  expect(await ui.find({ type: 'Text', text: /\+2 more running/ })).toBeDefined()
  await ui.press({ key: 'collapse' })
  expect(world.panes).toEqual([])
  await ui.unmount()
})

test('with autoOpen off, an agent does not open the pane', { options: { autoOpen: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(3_000)
  expect(world.opened).toBe(0)
})

test('with foldAfter 0 and toasts off, the pane stays open and says nothing', { options: { foldAfter: 0, toasts: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(2_000)
  world.agents = [{ ...world.agents[0]!, status: 'completed' }]
  await clock.advance(60_000)
  expect(world.closed).toBe(0)
  expect(world.toasts ?? []).toEqual([])
})

test('the list and a conversation draw on every surface and width', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1'), { ...running('a2'), status: 'completed' }], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    for (const cols of [40, 60, 86, 120]) {
      const mount = { ...(PANE as object), surface, props: { ...(PANE as { props: object }).props, bodyColumns: cols } } as never
      const ui = await $.ui.mount(mount)
      expect(await ui.find({ type: 'Text', text: /^Agents$/ })).toBeDefined()
      await ui.press({ key: 'agent-a1' })
      expect(await ui.find({ type: 'Markdown', text: /Looking now/ } as never)).toBeDefined()
      await ui.press({ key: 'back' })
      await ui.unmount()
    }
  }
})

test('two agents run on one time axis that grows on the surface clock, and the batch ends with its receipt', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1', 'map the hooks'), running('a2', 'count the tests')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /timeline/ })).toBeDefined()
  const first = textOf(await ui.drawn({ in: 'lanes' }))
  expect(first).toContain('map the hooks')
  expect(first).toContain('━')
  await (ui as unknown as { advance: (ms: number) => Promise<void> }).advance(3_000) // the surface clock alone
  expect(textOf(await ui.drawn({ in: 'lanes' }))).toMatch(/3s/)
  await clock.advance(3_000)
  world.agents = [{ ...world.agents[0]!, status: 'completed' }, running('a2', 'count the tests')]
  await clock.advance(1_000) // a1 ran 1s to 5s
  expect(await ui.find({ type: 'Text', text: /done in/ })).toBeUndefined() // not while one runs
  world.agents = world.agents.map(a => ({ ...a, status: 'completed' }))
  await clock.advance(1_000) // a2 ran 1s to 6s
  expect(await ui.find({ type: 'Text', text: /^2 done in 5s · 9s of agent time \(1\.8× in parallel\)$/ })).toBeDefined()
  await ui.unmount()
})

test('where a surface has no clock of its own, the time axis is drawn still', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1'), running('a2')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...(PANE as object), surface } as never)
    expect(await ui.find({ type: 'Client' } as never)).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^━+$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✻ $/ })).toBeDefined() // and a running row's mark too
    await ui.unmount()
  }
})

test('while the pane is not on screen, the status line counts the running agents, and clears when they are done', { options: { autoOpen: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1'), running('a2')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  expect(world.status).toEqual(['✻ 2 agents running'])
  world.agents = [{ ...world.agents[0]!, status: 'completed' }, world.agents[1]!]
  await clock.advance(1_000)
  world.agents = world.agents.map(a => ({ ...a, status: 'completed' }))
  await clock.advance(1_000)
  expect(world.status).toEqual(['✻ 2 agents running', '✻ 1 of 2 agents running', undefined])
})

test('with the pane on screen, or the status line turned off, there is no status line', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(3_000)
  expect(world.opened).toBe(1)
  expect(world.status).toEqual([undefined]) // cleared once, never set
})

test('with statusLine off, a folded pane leaves the status line alone', { options: { statusLine: false, autoOpen: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(3_000)
  expect(world.status).toEqual([undefined])
})

test('an agent listed at its spawn still unfolds a pane that folded after the last batch', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  await clock.advance(1_000)
  expect(world.opened).toBe(1)
  world.agents = [{ ...world.agents[0]!, status: 'completed' }]
  await clock.advance(12_000)
  expect(world.closed).toBe(1) // folded once the batch was done
  await $.agent.spawn({ description: 'next task', subagentType: 'Explore', prompt: 'go' } as never)
  world.agents = [...world.agents, running('sp-next-task', 'next task')] // the engine's list catches up
  await clock.advance(1_000)
  expect(world.opened).toBe(2)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Button', text: /◂ Agents/ })).toBeUndefined() // no tab while the pane is back
  await band.unmount()
})

// A sync held inside the engine's list until `release`; resolves once it is there.
const holdNextList = (world: World) => {
  let release = () => {}
  const inList = new Promise<void>(entered => {
    world.beforeList = async () => {
      world.beforeList = undefined
      entered()
      await new Promise<void>(r => (release = r))
    }
  })
  return { inList, release: () => release() }
}

test('an agent spawned while a sync reads the list still unfolds the pane', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(2_000)
  world.agents = [{ ...world.agents[0]!, status: 'completed' }]
  await clock.advance(12_000)
  expect(world.closed).toBe(1)
  const held = holdNextList(world)
  const tick = clock.advance(1_000)
  await held.inList
  await $.agent.spawn({ description: 'next task', subagentType: 'Explore', prompt: 'go' } as never)
  held.release()
  await tick
  world.agents = [...world.agents, running('sp-next-task', 'next task')]
  await clock.advance(2_000)
  expect(world.opened).toBe(2)
})

test('an agent spawned while a sync writes keeps its model', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1'), running('a0')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(2_000)
  const held = holdNextList(world)
  const tick = clock.advance(1_000)
  await held.inList
  await $.agent.spawn({ description: 'next task', subagentType: 'Explore', prompt: 'go' } as never)
  world.agents = [{ ...world.agents[0]!, status: 'completed' }, world.agents[1]!] // and something else changed this tick
  held.release()
  await tick
  world.agents = [...world.agents, running('sp-next-task', 'next task')]
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /^ · Sonnet 5\.5$/ })).toBeDefined() // the one model known, in the header
  await ui.unmount()
})

test('with autoOpen off, a new agent leaves a pane folded by hand folded, its tab in place', { options: { autoOpen: false } }, async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await $.command.run({ command: 'agentpane', args: '' } as never)
  await clock.advance(1_000)
  const pane = await $.ui.mount(PANE)
  await pane.press({ key: 'collapse' })
  await clock.advance(1_000)
  await $.agent.spawn({ description: 'next task', subagentType: 'Explore', prompt: 'go' } as never)
  world.agents = [...world.agents, running('sp-next-task', 'next task')]
  await clock.advance(2_000)
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Button', text: /◂ Agents/ })).toBeDefined()
  expect(world.opened).toBe(1)
  await pane.unmount()
  await band.unmount()
})

test('above the prompt, a running child of a finished parent has its row', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [{ ...running('p'), status: 'completed' }, running('c', 'the child', 'p')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const inline = { ...(PANE as object), props: { ...(PANE as { props: object }).props, placement: 'inline', bodyColumns: 90 }, viewport: { columns: 160, rows: 40, isFullscreen: false } } as never
  const ui = await $.ui.mount(inline)
  expect(await ui.find({ type: 'Button', text: /the child/ })).toBeDefined()
  await ui.unmount()
})

test('an opened run of hundreds of calls draws its newest ones, and the pane still draws', async ($, on) => {
  const clock = mock.clock(on)
  const line = (i: number) => `${i} `.padEnd(480, 'x')
  const uses = Array.from({ length: 300 }, (_, i) => ({ tool_use_id: `u${i}`, tool: 'Bash', input: { command: `grep -rn pattern${i} `.padEnd(280, 'c') }, text: [line(1), line(2), line(3), line(4)].join('\n') }))
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0, messages: [{ role: 'user', text: 'go', toolUses: [] }, { role: 'assistant', text: '', toolUses: uses }] }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'agent-a1' })
  await ui.press({ key: 'group-u0' })
  expect(await ui.find({ type: 'Button', text: /▲/ })).toBeDefined() // drawn, not refused
  expect(await ui.find({ type: 'Text', text: /^… \+\d+ earlier calls$/ })).toBeDefined()
  expect(JSON.stringify(await ui.drawn()).length).toBeLessThan(100_000)
  await ui.unmount()
})

test('a conversation left open on an agent no longer listed goes back to the list, and the pane folds', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(2_000)
  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'agent-a1' })
  world.agents = [{ ...world.agents[0]!, status: 'completed' }]
  await clock.advance(2_000)
  world.agents = []
  await clock.advance(60_000)
  expect(world.closed).toBe(1)
  await ui.unmount()
})

// ---- the roster ----

const WIDE = { ...(PANE as object), props: { ...(PANE as { props: object }).props, bodyColumns: 104 } } as never // 101 columns of content
const texts = async (ui: { findAll: (q: never) => Promise<unknown[]> }) =>
  (await ui.findAll({ type: 'Text' } as never)).map(t => textOf(t))

test('in a wide pane an agent is one row: its task, what it does, its tool count, its tokens and its clock', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1', 'find mod examples'), { ...running('a2', 'count the tests'), status: 'completed' }], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  await $.tool.call({ tool: 'Bash', command: 'ls /w/hooks', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/w/hooks/register.tsx', agentId: 'a1' } as never)
  await step($, 'a1')
  const ui = await $.ui.mount(WIDE)
  const all = await texts(ui)
  expect(all).toContain('Read(register.tsx)') // its latest call, beside its task
  expect(all.some(t => /^ +2 tools$/.test(t))).toBe(true)
  expect(all.filter(t => / tools?\s*$/.test(t)).every(t => t.length === 10)).toBe(true) // the column's width, whatever the count
  expect(all.some(t => /^ +41\.2k$/.test(t))).toBe(true) // 40,010 in and 1,200 out
  expect(all).toContain('done') // how the other ended, in the same column
  expect((await ui.findAll({ type: 'Box' } as never)).some(b => /^doing-/.test((b as { props: { key?: string } }).props.key ?? ''))).toBe(false) // nothing beneath a row
  expect(textOf(await ui.drawn())).not.toMatch(/⎿|more tool use/)
  await ui.unmount()
})

test('a tool call\'s paths under the session\'s directory are listed relative', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world) // the session runs in /w
  await clock.advance(1_000)
  await $.tool.call({ tool: 'Bash', command: 'find /w/src -name "*.py"', agentId: 'a1' } as never)
  const ui = await $.ui.mount(WIDE)
  expect(await texts(ui)).toContain('Bash(find src -name "*.py")')
  await ui.unmount()
})

test('an agent between turns is listed as done, counted as done, and its tab ticks it', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1'), running('a2')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  world.agents = world.agents.map(a => ({ ...a, status: 'idle' }))
  await clock.advance(2_000)
  expect(world.toasts).toEqual(['✓ 2 agents finished'])
  const ui = await $.ui.mount(WIDE)
  const drawn = textOf(await ui.drawn())
  expect(drawn).not.toContain('idle')
  expect(await ui.find({ type: 'Button', text: /^2 done$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /^✓ $/ })).filter(t => (t as { props: { color?: string } }).props.color === 'success').length).toBe(3) // two rows and the receipt
  expect(await ui.find({ type: 'Text', text: /^2 done in 1s · 2s of agent time \(2\.0× in parallel\)$/ })).toBeDefined()
  await ui.press({ key: 'collapse' })
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Button', text: /◂ Agents ✓ 2/ })).toBeDefined()
  await ui.unmount()
  await band.unmount()
})

test('agents on different models each say their own, and the header says none', async ($, on) => {
  mock.clock(on)
  const world: World = { agents: [], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await spawnOne($, 'look around') // the spawn reports claude-sonnet-5-5
  await spawnOne($, 'dig deeper')
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1, agentId: 'sp-dig-deeper' } as never)) void _
  const ui = await $.ui.mount(WIDE)
  const all = await texts(ui)
  expect(all).toContain('Sonnet 5.5')
  expect(all).toContain('Opus 5.5')
  expect(all.some(t => t.startsWith(' · '))).toBe(false)
  await ui.unmount()
})

test('a child is listed under its parent, indented, in the same columns', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('p', 'the parent'), running('c', 'the child', 'p')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount({ ...(WIDE as object), surface: 'vscode' } as never) // no surface clock: every mark is in the drawing
  const drawn = textOf(await ui.drawn())
  expect(drawn).toMatch(/✻ Explore\(the parent\) +0s {2}✻ Explore\(the child\) +0s/) // the child's mark two columns in, its clock in line
  const at = (task: string) => drawn.indexOf('0s', drawn.indexOf(task)) - drawn.indexOf(`✻ Explore(${task})`)
  expect(at('the child')).toBe(at('the parent') - 2)
  await ui.unmount()
})

test('above the prompt, finished agents keep their rows while there is room, and the rest are counted', async ($, on) => {
  const clock = mock.clock(on)
  const done = (id: string) => ({ ...running(id), status: 'completed' })
  const world: World = { agents: [running('r1'), running('r2'), done('d1'), done('d2'), done('d3'), done('d4')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const inline = { ...(PANE as object), props: { ...(PANE as { props: object }).props, placement: 'inline', bodyColumns: 160 }, viewport: { columns: 170, rows: 40, isFullscreen: false } } as never
  const ui = await $.ui.mount(inline)
  const drawn = textOf(await ui.drawn())
  for (const id of ['r1', 'r2', 'd1', 'd2', 'd3']) expect(drawn).toContain(`task ${id}`)
  expect(drawn).not.toContain('task d4')
  expect(await ui.find({ type: 'Text', text: /^ {2}\+1 more done$/ })).toBeDefined()
  const root = (await ui.drawn()) as { children?: unknown[] }
  expect((root.children ?? []).filter(Boolean).length).toBeLessThanOrEqual(8)
  await ui.press({ key: 'toggle-done' }) // "done" in its header hides them here too
  expect(textOf(await ui.drawn())).not.toContain('task d1')
  await ui.unmount()
})

// ---- review findings: each was seen failing before its fix ----

import { cols as columnsOf } from '../hooks/pane'

type Drawn = { type?: string; props?: { key?: string; width?: number }; children?: unknown[] }
// A roster row's cells, summed in columns: a Box with a width counts as that width (the clock), text by its columns.
const rowWidths = async (ui: { findAll: (q: never) => Promise<unknown[]> }) =>
  ((await ui.findAll({ type: 'Box' } as never)) as Drawn[])
    .filter(b => /^(row|doing)-/.test(b.props?.key ?? ''))
    .map(b => ({
      key: b.props!.key!, width: b.props!.width,
      cells: (b.children ?? []).filter(Boolean).reduce((n: number, c) => n + ((c as Drawn).type === 'Box' && (c as Drawn).props?.width ? (c as Drawn).props!.width! : columnsOf(textOf(c))), 0),
    }))
const at = (bodyColumns: number, placement = 'dock', view: object = {}) =>
  ({ ...(PANE as object), surface: 'vscode', props: { ...(PANE as { props: object }).props, bodyColumns, placement, view } }) as never
const named = (id: string, name: string, description = `task ${id}`, parentId?: string) => ({ ...running(id, description, parentId), name })

test('no row is wider than the pane: long names, nested agents and wide characters, docked and above the prompt', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = {
    agents: [
      named('a', 'researcher', 'find the mod examples'), named('b', 'alexander-the-great', 'write tests'),
      named('p', 'a', 'top'), named('c1', 'b', 'mid', 'p'), named('c2', 'c', 'low', 'c1'), named('c3', 'd', 'x', 'c2'),
      named('w', '名前の長いエージェント', '全角の説明文がここに入ります'), running('u', 'an agent without a name'),
    ],
    panes: [], opened: 0, closed: 0,
  }
  await start($, on, world)
  await clock.advance(1_000)
  await $.tool.call({ tool: 'Bash', command: 'echo 全角 && ls', agentId: 'c3' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'c3' } as never)
  for (const placement of ['dock', 'inline']) for (const bc of [24, 25, 27, 30, 34, 37, 40, 48, 58, 59, 62, 75, 91, 104, 130, 250]) {
    const ui = await $.ui.mount(at(bc, placement))
    const rows = await rowWidths(ui)
    expect(rows.length).toBeGreaterThan(4)
    for (const r of rows) expect(`${placement} ${bc} ${r.key} ${r.cells}`).toBe(`${placement} ${bc} ${r.key} ${r.width}`)
    await ui.unmount()
  }
})

test('the pane still draws when the batch\'s first agent has left the list and had the longest name', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [named('first', 'alexander-the-gr'), ...['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map(i => named(i, i))], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  world.agents = world.agents.map(a => (a.id === 'first' ? { ...a, status: 'completed' } : a))
  await clock.advance(2_000)
  world.agents = world.agents.map(a => ({ ...a, status: 'completed' }))
  await clock.advance(2_000) // ten finished, eight kept: the first one is in the batch but not in the list
  for (const placement of ['dock', 'inline']) {
    const ui = await $.ui.mount(at(48, placement))
    expect(await ui.find({ type: 'Text', text: /^Agents$/ })).toBeDefined()
    expect(textOf(await ui.drawn())).not.toContain('alexander')
    await ui.unmount()
  }
})

test('a tool call that describes to nothing does not stop a narrow pane from drawing', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  await $.tool.call({ tool: 'mcp__', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'mcp__', agentId: 'a1' } as never)
  const ui = await $.ui.mount(at(48))
  expect(await ui.find({ type: 'Button', text: /task a1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 tools$/ })).toBeDefined() // beneath its row, with nothing else to say
  await ui.unmount()
})

test('what an agent is doing stays in its column when it is also in the main view and a response was cut', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1', 'find the mod examples'), running('a2', 'other work')], panes: [], opened: 0, closed: 0, stopReason: 'max_tokens' }
  await start($, on, world)
  await clock.advance(1_000)
  await $.tool.call({ tool: 'Bash', command: 'ls hooks', agentId: 'a1' } as never)
  await step($, 'a1')
  for (const bc of [62, 80, 104]) {
    const ui = await $.ui.mount(at(bc, 'dock', { agentId: 'a1' }))
    const all = (await ui.findAll({ type: 'Text' } as never)).map(t => textOf(t))
    expect(all).toContain('Bash(ls hooks)') // in the row
    expect(all).toContain('◂ main view') // on a line beneath it, with the alert
    expect(await ui.find({ type: 'Text', text: /max_tokens ×1$/ })).toMatchObject({ props: { color: 'error' } })
    const rows = await rowWidths(ui)
    expect(rows.map(r => r.key)).toEqual(['row-a1', 'doing-a1', 'row-a2'])
    await ui.unmount()
  }
})

test('above the prompt in a narrow terminal, a row still says what its agent is doing', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [named('a1', 'scout', 'find the mod examples')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a1' } as never)
  const ui = await $.ui.mount(at(50, 'inline'))
  expect((await ui.findAll({ type: 'Text' } as never)).map(t => textOf(t))).toContain('Bash(ls)')
  expect((await rowWidths(ui)).map(r => r.key)).toEqual(['row-a1']) // in its row: the summary has no rows to spare
  await ui.unmount()
})

test('in a narrow pane a finished agent has a line beneath only for what cannot wait, and that line says only that', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1'), running('a2')], panes: [], opened: 0, closed: 0, stopReason: 'max_tokens' }
  await start($, on, world)
  await clock.advance(1_000)
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-fable-5-1', messageCount: 1, agentId: 'a1' } as never)) void _
  world.stopReason = 'end_turn'
  for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-4-5', messageCount: 1, agentId: 'a2' } as never)) void _
  world.agents = world.agents.map(a => ({ ...a, status: 'completed' }))
  await clock.advance(1_000)
  const ui = await $.ui.mount(at(48))
  const rows = await rowWidths(ui)
  expect(rows.map(r => r.key)).toEqual(['row-a1', 'doing-a1', 'row-a2']) // a1 was cut at the output limit; a2 has nothing to add
  const drawn = textOf(await ui.drawn())
  expect(drawn).toMatch(/⎿ max_tokens ×1 +✓/) // the alert alone, then the next row
  expect(drawn).not.toMatch(/Fable|Haiku/) // differing models are in each conversation's header, not squeezed in here
  await ui.unmount()
})

test('a tool count in the tens of thousands keeps to its column', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: [running('a1')], panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  for (let i = 0; i < 10_001; i++) await $.tool.call({ tool: 'Read', file_path: '/w/a', agentId: 'a1' } as never)
  const ui = await $.ui.mount(at(104))
  expect(await ui.find({ type: 'Text', text: /^ +10k tools$/ })).toBeDefined()
  for (const r of await rowWidths(ui)) expect(r.cells).toBe(r.width)
  await ui.unmount()
})

test('above the prompt, the finished agents not shown are counted against the header\'s own number', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = { agents: Array.from({ length: 12 }, (_, i) => ({ ...running(`d${i}`), status: 'completed' })), panes: [], opened: 0, closed: 0 }
  await start($, on, world)
  await clock.advance(1_000)
  const ui = await $.ui.mount(at(160, 'inline'))
  expect(await ui.find({ type: 'Button', text: /^12 done$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}\+7 more done$/ })).toBeDefined() // five rows shown of the twelve
  await ui.unmount()
})
