// From agentpane 1.1.4 by Anji Xu (https://github.com/xuanji86/claude-agentpane, MIT: see LICENSE-agentpane); with the tests the name column and roster added.
import { describe, expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

import { addUsage, arrange, batchReceipt, lastCalls, finishNotice, clean, cols, describeTool, fmtTokens, givenName, latestBatch, look, statusOf, groupSummary, mergeAgents, nameColumn, nameOf, parseConfig, pickBlocks, prettyEffort, prettyModel, preview, relative, rosterColumns, runsOn, setRoot, sharedModel, spawned, stepLoop, toolParts, transcriptBlocks, visibleAgents, wrap } from '../hooks/pane'
import type { Block } from '../hooks/pane'
import { fmtDuration, laneRows } from '../hooks/time'

const info = (id: string, status = 'running', parentId?: string) => ({ id, description: `task ${id}`, type: 'Explore', status, ...(parentId && { parentId }) })
const say = (role: 'user' | 'assistant', text: string, toolUses: SessionMessage['toolUses'] = []): SessionMessage => ({ role, text, toolUses })

describe('agents', () => {
  test('first seen and end times carry over from what the pane knew', async () => {
    const one = mergeAgents([], [info('a'), info('b', 'completed')], 1_000)
    expect(one.map(a => [a.id, a.firstSeen, a.seenRunning, a.endedAt])).toEqual([['a', 1_000, true, undefined], ['b', 1_000, false, undefined]])
    const two = mergeAgents(one, [info('a', 'completed'), info('b', 'completed')], 5_000)
    expect(two[0]).toMatchObject({ firstSeen: 1_000, endedAt: 5_000, status: 'completed' })
    expect(mergeAgents(two, [info('a', 'completed')], 9_000)[0]?.endedAt).toBe(5_000)
    expect(mergeAgents(two, [info('a')], 600_000)[0]).toMatchObject({ firstSeen: 600_000, status: 'running' }) // resumed: a new run
    expect(mergeAgents(two, [info('a')], 600_000)[0]?.endedAt).toBeUndefined()
  })
  test('the list keeps every running agent and the eight that finished last, by when they ended', async () => {
    let all = mergeAgents([], [info('long'), ...Array.from({ length: 9 }, (_, i) => info(`s${i}`))], 0)
    all = mergeAgents(all, [info('long'), ...Array.from({ length: 9 }, (_, i) => info(`s${i}`, 'completed'))], 1_000)
    all = mergeAgents(all, [info('long', 'completed'), ...Array.from({ length: 9 }, (_, i) => info(`s${i}`, 'completed'))], 2_000)
    const shown = visibleAgents(all).map(a => a.id)
    expect(shown.length).toBe(8)
    expect(shown).toContain('long') // the last to end, though the first to start
  })
  test('agents group under their parents; hiding finished ones lifts their running children out', async () => {
    const all = mergeAgents([], [info('done', 'completed'), info('p'), info('c', 'completed', 'p'), info('g', 'running', 'c'), info('orphan', 'running', 'gone'), info('q', 'completed'), info('r', 'running', 'q')], 0)
    const both = arrange(visibleAgents(all))
    expect(both.running.map(t => [t.agent.id, t.kids.map(k => `${k.agent.id}:${k.depth}`)])).toEqual([['p', ['c:1', 'g:2']], ['orphan', []]])
    expect(both.finished.map(t => [t.agent.id, t.kids.map(k => k.agent.id)])).toEqual([['done', []], ['q', ['r']]])
    const live = arrange(visibleAgents(all), true)
    expect(live.running.map(t => t.agent.id)).toEqual(['p', 'g', 'orphan', 'r'])
    expect(live.finished).toEqual([])
  })
  test('tool calls read in a few words', async () => {
    expect(describeTool('Bash', { command: 'npm test\n  --watch' })).toBe('Bash(npm test --watch)')
    expect(describeTool('Read', { file_path: '/a/b/register.tsx' })).toBe('Read(register.tsx)')
    expect(describeTool('Grep', { pattern: 'TODO' })).toBe('Grep(TODO)')
    expect(describeTool('mcp__github__list_issues', {})).toBe('github:list_issues')
    expect(describeTool('TodoWrite', { todos: [] })).toBe('TodoWrite')
  })
  test('a path under the session\'s directory is drawn relative, and others are left alone', async () => {
    expect(relative('find /w/src -name "*.py"', '/w')).toBe('find src -name "*.py"')
    expect(relative('cd /w && ls /w/', '/w')).toBe('cd . && ls .')
    expect(relative('ls "/w/a b" /web/x /w-old /w.bak /x/w/y', '/w')).toBe('ls "a b" /web/x /w-old /w.bak /x/w/y')
    expect(relative('ls /w/src', '')).toBe('ls /w/src') // no directory known: as written
    // only a path that starts a word and is the directory itself or inside it; anything else is as written
    for (const [cwd, text] of [
      ['/home/u/项目', 'cd /home/u/项目备份/src'], ['/w', 'café/w/x'], ['/home/u/proj', 'cd "/home/u/proj (copy)/src"'],
      ['/home/u/proj', 'ls /home/u/proj@2/a /home/u/proj+x/b /home/u/proj~ /home/u/proj,v'], ['/w', 'cat /w//etc/passwd'],
      ['/w', 'scp host:/w/x.txt .'], ['/w', 'docker run -v /w:/w img'], ['/w', 'ls ${SYSROOT}/w/lib "$D"/w/x'],
      ['/w', 'curl https://e.com/w/x file:///w/x'],
    ] as const) expect(relative(text, cwd)).toBe(text)
    expect(relative('cd "/home/u/proj" && cat \'/home/u/proj/a b\' --root=/home/u/proj/src', '/home/u/proj')).toBe('cd "." && cat \'a b\' --root=src')
    expect(relative('rm -rf /w/ /w; (cd /w)', '/w')).toBe('rm -rf . .; (cd .)')
    expect(relative('cat /a+b (1)/x', '/a+b (1)')).toBe('cat x') // the directory is matched as text, not as a pattern
    setRoot('/w/')
    try {
      expect(describeTool('Bash', { command: 'pytest /w/tests -k cache' })).toBe('Bash(pytest tests -k cache)')
      expect(describeTool('Grep', { pattern: 'TODO /w/src' })).toBe('Grep(TODO src)')
      expect(describeTool('WebFetch', { url: 'https://example.com/w/page' })).toBe('WebFetch(https://example.com/w/page)')
    } finally {
      setRoot('')
    }
    expect(describeTool('Bash', { command: 'pytest /w/tests' })).toBe('Bash(pytest /w/tests)')
  })
  test('an agent between turns reads as done, and waking it starts a new run', async () => {
    const before = mergeAgents([], [info('a')], 0)
    const idle = mergeAgents(before, [info('a', 'idle')], 5_000)
    expect(idle[0]).toMatchObject({ status: 'completed', endedAt: 5_000 })
    expect(finishNotice(before, idle, 5_000)).toBe('✓ Explore(task a) done · 5s')
    expect(mergeAgents(idle, [info('a')], 9_000)[0]).toMatchObject({ status: 'running', firstSeen: 9_000 })
    expect(mergeAgents([], [info('w', 'waiting')], 0)[0]!.status).toBe('waiting') // held, not done: as the engine says it
  })
  test('a teammate between turns is waiting for its next message, not done', async () => {
    const mate = (status: string) => ({ ...info('m', status), teammateId: 'm@team', name: 'Ada' })
    const before = mergeAgents([], [mate('running')], 0)
    const waits = mergeAgents(before, [mate('idle')], 5_000)
    expect(waits[0]!.status).toBe('idle')
    expect(look('idle')).toEqual({ word: 'Waiting', mark: '·', dim: true }) // no tick, no green
    expect(finishNotice(before, waits, 5_000)).toBe('· Ada waiting · 5s · task m')
    expect(mergeAgents(waits, [mate('running')], 9_000)[0]).toMatchObject({ status: 'running', firstSeen: 9_000 })
  })
  test('a roster row drops its columns from the right as the pane narrows, and always fills the width', async () => {
    const sum = (w: number, name: number, task: number, beneath = true) => {
      const c = rosterColumns(w, name, task, beneath)
      return 2 + c.name + c.task + c.doing + c.tools + c.tokens + 7
    }
    expect(rosterColumns(100, 13, 30)).toEqual({ name: 13, task: 32, doing: 28, tools: 10, tokens: 8 }) // the task and a gap, the rest to the doing
    expect(rosterColumns(100, 13, 10)).toMatchObject({ task: 12, doing: 48 }) // short tasks leave the room to the doing
    expect(rosterColumns(100, 13, 200)).toMatchObject({ task: 36, doing: 24 }) // a long one takes three fifths at most
    expect(rosterColumns(80, 13, 37)).toMatchObject({ tools: 10, tokens: 0 })
    expect(rosterColumns(60, 13, 37)).toMatchObject({ tools: 0, tokens: 0 })
    expect(rosterColumns(60, 13, 37).doing).toBeGreaterThan(0)
    expect(rosterColumns(45, 13, 37)).toEqual({ name: 13, task: 23, doing: 0, tools: 0, tokens: 0 }) // what it does goes beneath
    // the name column gives way before the task has fewer than 8 columns: a pane never has a row wider than itself
    expect(rosterColumns(22, 13, 37)).toMatchObject({ name: 5, task: 8 })
    expect(rosterColumns(30, 18, 37)).toMatchObject({ name: 13, task: 8 })
    for (const name of [0, 6, 13, 18]) for (const w of [22, 23, 24, 27, 31, 34, 45, 55, 56, 60, 72, 80, 88, 100, 140, 250]) {
      expect(sum(w, name, 37)).toBe(w)
      expect(sum(w, name, 37, false)).toBe(w)
      expect(rosterColumns(w, name, 37).task).toBeGreaterThanOrEqual(8)
    }
    // where a row has no line beneath it (the summary above the prompt), the doing keeps a column in a narrow pane too
    expect(rosterColumns(50, 7, 20, false).doing).toBeGreaterThanOrEqual(8)
    expect(rosterColumns(50, 7, 20).doing).toBe(0)
  })
  test('a model every agent shares is said once; when they differ, none is', async () => {
    expect(sharedModel([{ model: 'claude-haiku-4-5' }, { model: 'claude-haiku-4-5' }, {}])).toBe('Haiku 4.5') // one not known yet does not count
    expect(sharedModel([{ model: 'claude-haiku-4-5' }, { model: 'claude-opus-5-5' }])).toBe('')
    expect(sharedModel([{ model: 'claude-opus-5-5', effort: 'high' }, { model: 'claude-opus-5-5' }])).toBe('') // the effort is part of it
    expect(sharedModel([{}])).toBe('')
  })
  test('token use sums over an agent\'s responses; context is the latest request', async () => {
    const one = addUsage(undefined, { input_tokens: 100, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 2_000, output_tokens: 300 })
    const two = addUsage(one, { input_tokens: 20, cache_read_input_tokens: 52_000, cache_creation_input_tokens: 500, output_tokens: 80 })
    expect(two).toEqual({ input: 104_620, cached: 102_000, output: 380, context: 52_600, requests: 2 })
    expect([fmtTokens(950), fmtTokens(12_345), fmtTokens(99_960), fmtTokens(312_400), fmtTokens(999_800), fmtTokens(1_240_000)]).toEqual(['950', '12.3k', '100k', '312k', '1M', '1.2M'])
  })
  test('finishing agents make one toast: by name when alone, counted when several', async () => {
    const before = mergeAgents([], [info('a'), info('b'), info('c', 'completed')], 0)
    expect(finishNotice(before, mergeAgents(before, [info('a'), info('b'), info('c', 'completed')], 5_000), 5_000)).toBeNull()
    const one = mergeAgents(before, [info('a', 'failed'), info('b'), info('c', 'completed')], 5_000)
    expect(finishNotice(before, one, 5_000)).toBe('✗ Explore(task a) failed · 5s')
    const two = mergeAgents(before, [info('a', 'completed'), info('b', 'failed'), info('c', 'completed')], 5_000)
    expect(finishNotice(before, two, 5_000)).toBe('✓ 2 agents finished · ✗ 1 failed')
  })
  test('the list sync keeps the name an agent was given, and gives none to an agent without one', async () => {
    const one = mergeAgents([], [{ ...info('a'), name: 'Turing' }, info('b')], 1_000)
    expect(one.map(a => a.name)).toEqual(['Turing', undefined])
    expect('name' in one[1]!).toBe(false)
    const two = mergeAgents(one, [{ ...info('a', 'completed'), name: 'Turing' }, info('b')], 5_000)
    expect(two.map(a => a.name)).toEqual(['Turing', undefined])
  })
  test('a given name leads an agent\'s label; without one it reads Type(description)', async () => {
    const a = { ...mergeAgents([], [info('a')], 0)[0]! }
    expect(nameOf(a)).toBe('Explore(task a)')
    expect(nameOf({ ...a, name: 'Turing' })).toBe('Turing task a') // beside a name the type is left out, whatever it is
    expect(nameOf({ ...a, type: 'general-purpose', name: 'Turing' })).toBe('Turing task a')
    expect(nameOf({ ...a, type: 'general-purpose' })).toBe('general-purpose(task a)')
    expect(givenName(a)).toBe('')
    expect(givenName({ name: ' Ada\u202e \n Lovelace ' })).toBe('Ada Lovelace') // cleaned as the rest of an agent's text is
    expect(givenName({ name: 'a-very-long-name-a-model-wrote' })).toBe('a-very-long-nam…')
    const before = mergeAgents([], [{ ...info('a'), name: 'Turing' }], 0)
    expect(finishNotice(before, mergeAgents(before, [{ ...info('a', 'completed'), name: 'Turing' }], 5_000), 5_000)).toBe('✓ Turing done · 5s · task a') // the name, how it ended, then its task
  })
  test('the name column is as wide as the widest name shown, and absent when no agent has one', async () => {
    const [a, b, c] = mergeAgents([], [{ ...info('a'), name: 'Turing' }, { ...info('b'), name: 'BernersLee' }, info('c')], 0)
    const col = nameColumn([a!, b!, c!])
    expect([col(a!), col(b!), col(c!)]).toEqual(['Turing      ', 'BernersLee  ', '            '])
    expect(nameColumn([c!])(c!)).toBe('')
  })
  test('a name column asked about an agent it was not built from does not throw', async () => {
    const col = nameColumn([{ id: 'a', name: 'al' } as never])
    expect(col({ name: 'alexander-the-gr' } as never)).toBe('alexander-the-gr  ') // wider than the column: its name and the gap
  })
  test('emoji that take two columns are counted as two, and a skin tone as none', async () => {
    expect(['✅', '❌', '✨', '⭐', '⚡', '⌛', '⬛', '➕'].map(c => cols(c))).toEqual([2, 2, 2, 2, 2, 2, 2, 2])
    expect(cols('👍🏽')).toBe(2)
    expect(cols('✓ ✗ ⊘ ✻ ⏺ ⎿ ━ · é')).toBe(17) // the pane's own marks stay one each
  })
  test('durations read as Claude Code writes them', async () => {
    expect([fmtDuration(5_000), fmtDuration(80_000), fmtDuration(725_000), fmtDuration(3_725_000)]).toEqual(['5s', '1m 20s', '12m 5s', '1h 2m'])
  })
  test('model ids read as their names', async () => {
    expect([prettyModel('claude-sonnet-5-5'), prettyModel('claude-haiku-4-5-20251001'), prettyModel('claude-opus-5-5[1m]'), prettyModel('sonnet'), prettyModel(undefined)]).toEqual(['Sonnet 5.5', 'Haiku 4.5', 'Opus 5.5 (1M)', 'sonnet', ''])
    expect([prettyEffort('high'), prettyEffort(2048), prettyEffort(undefined)]).toEqual(['high', 'effort 2048', ''])
    expect([runsOn({ model: 'claude-fable-5-1', effort: 'xhigh' }), runsOn({ model: 'claude-fable-5-1' }), runsOn({ effort: 'low' }), runsOn({})]).toEqual(['Fable 5.1 · xhigh', 'Fable 5.1', 'low', ''])
  })
  test('settings fall back to their defaults and stay in range', async () => {
    expect(parseConfig(undefined)).toEqual({ pane: true, autoOpen: true, foldAfterMs: 10_000, motion: true, toasts: true, keepFinished: 8, statusLine: true })
    expect(parseConfig({ pane: false }).pane).toBe(false)
    expect(parseConfig({ autoOpen: false, foldAfter: 0, keepFinished: 99, motion: 'no', statusLine: false })).toEqual({ pane: true, autoOpen: false, foldAfterMs: 0, motion: true, toasts: true, keepFinished: 30, statusLine: false })
  })
  test('the latest batch begins after a quiet minute, and a running agent holds it open', async () => {
    const ran = (id: string, firstSeen: number, endedAt?: number, status = 'completed') =>
      ({ id, description: id, type: 'Explore', status, firstSeen, seenRunning: true, ...(endedAt !== undefined && { endedAt }) })
    const ids = (list: { id: string }[]) => list.map(a => a.id)
    expect(ids(latestBatch([ran('old', 0, 10_000), ran('a', 100_000, 130_000), ran('b', 120_000, 200_000), ran('c', 250_000, 260_000)]))).toEqual(['a', 'b', 'c'])
    expect(ids(latestBatch([ran('long', 0, undefined, 'running'), ran('late', 500_000, 510_000)]))).toEqual(['long', 'late'])
    expect(ids(latestBatch([{ ...ran('seen-done', 0, 1_000), seenRunning: false }, ran('a', 2_000, 3_000)]))).toEqual(['a'])
  })
  test('a finished batch says how long it took, how much ran side by side and what it used', async () => {
    const ran = (id: string, firstSeen: number, endedAt: number, status = 'completed') => ({ id, description: id, type: 'Explore', status, firstSeen, seenRunning: true, endedAt })
    const batch = [ran('a', 0, 20_000), ran('b', 0, 30_000), ran('c', 10_000, 30_000)]
    const act = { a: { text: 'Read(x)', tools: 3 }, b: { text: 'Bash(ls)', tools: 2 } }
    const tok = { a: { input: 1_000, cached: 0, output: 500, context: 1_500, requests: 1 } }
    expect(batchReceipt(batch, act, tok)).toEqual({ failed: false, text: '3 done in 30s · 1m 10s of agent time (2.3× in parallel) · 5 tool uses · 1.5k tokens' })
    expect(batchReceipt([ran('a', 0, 20_000), ran('b', 0, 30_000, 'failed')], {}, {})).toEqual({ failed: true, text: '1 done · 1 failed in 30s · 50s of agent time (1.7× in parallel)' })
    expect(batchReceipt([ran('a', 0, 10_000), ran('b', 10_000, 20_000)], {}, {})?.text).toBe('2 done in 20s · 20s of agent time') // one after the other
    expect(batchReceipt([ran('parent', 0, 100_000), { ...ran('child', 5_000, 95_000), parentId: 'parent' }, ran('other', 0, 100_000)], {}, {})?.text)
      .toBe('3 done in 1m 40s · 3m 20s of agent time (2.0× in parallel)') // the child runs inside its parent's time
    expect(batchReceipt([ran('a', 0, 10_000), ran('b', 0, 10_000, 'paused')], {}, {})?.text).toBe('1 done · 1 paused in 10s · 20s of agent time (2.0× in parallel)')
    expect(batchReceipt([ran('a', 0, 10_000)], {}, {})).toBeNull()
    expect(batchReceipt([ran('a', 0, 10_000), { ...ran('b', 0, 0), status: 'running' }], {}, {})).toBeNull()
  })
  test('the status line counts the batch while it runs, and clears when it is done', async () => {
    const a = (id: string, status: string) => ({ id, description: id, type: 'Explore', status, firstSeen: 0, seenRunning: true })
    expect(statusOf([a('r', 'running')])).toBe('✻ 1 agent running')
    expect(statusOf([a('r', 'running'), a('s', 'running'), a('d', 'completed'), a('f', 'failed')])).toBe('✻ 2 of 4 agents running · ✗ 1 failed')
    expect(statusOf([a('d', 'completed')])).toBeUndefined()
  })
  test('lanes share one axis, to now while one runs and to the last end once all have ended', async () => {
    const lane = (from: number, to: number | null) => ({ name: 'x', mark: '✓', color: '', dim: false, from, to })
    expect(laneRows([lane(0, 10_000), lane(5_000, null)], 20_000, 20)).toEqual([
      { before: 0, bar: 10, after: 10, ms: 10_000 },
      { before: 5, bar: 15, after: 0, ms: 15_000 },
    ])
    expect(laneRows([lane(0, 10_000), lane(5_000, 20_000)], 90_000, 20).map(g => g.after)).toEqual([10, 0]) // not stretched to now
    expect(laneRows([lane(0, 20_000), lane(20_000, 20_000)], 20_000, 20)[1]).toEqual({ before: 19, bar: 1, after: 0, ms: 0 }) // never empty
    expect(laneRows([], 0, 20)).toEqual([])
  })
  test('a spawn is listed at once, keeps its model past the next poll, and waits a moment for the list', async () => {
    const a = { id: 'n', description: 'new', type: 'Explore', status: 'running', firstSeen: 0, seenRunning: true, model: 'claude-sonnet-5-5' }
    const listed = spawned([], a)
    expect(mergeAgents(listed, [], 5_000).map(x => x.id)).toEqual(['n']) // the engine's list has not caught up
    expect(mergeAgents(listed, [], 20_000)).toEqual([]) // nor ever did
    expect(mergeAgents(listed, [info('n')], 2_000)[0]?.model).toBe('claude-sonnet-5-5')
  })
  test('loops no agent claims are counted by request', async () => {
    expect(stepLoop(stepLoop({}, 'w', 1), 'w', 5)).toEqual({ w: { firstSeen: 1, lastSeen: 5, requests: 2 } })
  })
  test('responses cut at the output limit are counted', async () => {
    const u = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    expect(addUsage(addUsage(undefined, u, 'max_tokens'), u, 'end_turn').truncated).toBe(1)
    expect(addUsage(undefined, u, 'end_turn')).not.toHaveProperty('truncated')
  })
})

describe('transcript', () => {
  test('wrapping breaks at spaces and counts wide characters as two', async () => {
    expect(wrap('the quick brown fox jumps', 10)).toEqual(['the quick', 'brown fox', 'jumps'])
    expect(wrap('x'.repeat(20), 8)).toEqual(['xxxxxxxx', 'xxxxxxxx', 'xxxx'])
    expect(wrap('中文字符测试', 8).every(r => cols(r) <= 8)).toBe(true)
  })
  test('injected reminders, controls and bidi marks are left out', async () => {
    expect(clean('a<system-reminder>secret</system-reminder>b\u001b[31m‮')).toBe('ab[31m')
  })
  test('a conversation reads as its brief, replies, and each run of tool calls as one group', async () => {
    const msgs = [
      say('user', 'Find every mod example.'),
      say('assistant', 'Looking.', [
        { tool_use_id: '1', tool: 'Glob', input: { pattern: '**/*.tsx' }, text: 'a.tsx\nb.tsx' },
        { tool_use_id: '2', tool: 'Read', input: { file_path: '/x/a.tsx' }, text: 'nope', isError: true },
      ]),
      say('user', ''),
      say('assistant', '', [{ tool_use_id: '3', tool: 'Bash', input: { command: 'ls' } }]),
      say('assistant', 'Found **two**.'),
    ]
    const blocks = transcriptBlocks(msgs)
    expect(blocks.map(b => b.kind)).toEqual(['prompt', 'reply', 'tools', 'reply'])
    const group = blocks[2]
    expect(group?.kind === 'tools' && group.key).toBe('1')
    expect(group?.kind === 'tools' && group.calls.map(c => [c.name, c.arg, c.state, c.result])).toEqual([
      ['Glob', '**/*.tsx', 'ok', ['a.tsx', 'b.tsx']],
      ['Read', 'a.tsx', 'error', ['nope']],
      ['Bash', 'ls', 'running', []],
    ])
    expect(group?.kind === 'tools' && groupSummary(group.calls)).toBe('Searched for 1 pattern, read 1 file, ran 1 command')
    expect(groupSummary([...(group?.kind === 'tools' ? group.calls.slice(1) : []), ...(group?.kind === 'tools' ? group.calls.slice(2) : []), { id: 'x', name: 'github:list', arg: '', state: 'ok', result: [], more: 0 }])).toBe('Read 1 file, ran 2 commands, called github:list')
  })
  test('a call an ended agent never answered reads as interrupted, not running', async () => {
    const msgs = [say('assistant', '', [{ tool_use_id: '1', tool: 'Bash', input: { command: 'sleep 99' } }])]
    expect(transcriptBlocks(msgs).map(b => b.kind === 'tools' && b.calls[0]?.state)).toEqual(['running'])
    expect(transcriptBlocks(msgs, true).map(b => b.kind === 'tools' && b.calls[0]?.state)).toEqual(['stopped'])
  })
  test('arguments and result lines are cut to length, so no drawn text nears the engine\'s limit', async () => {
    expect(toolParts('Bash', { command: 'x'.repeat(20_000) }).arg.length).toBeLessThanOrEqual(300)
    expect(preview('y'.repeat(20_000)).result[0]!.length).toBeLessThanOrEqual(500)
  })
  test('the blocks drawn stay within the count and the text budget, newest when live, from the top when scrolled', async () => {
    const reply = (n: number): Block => ({ kind: 'reply', text: `${n} ${'z'.repeat(5_000)}` })
    const blocks = Array.from({ length: 30 }, (_, i) => reply(i))
    const live = pickBlocks(blocks, null)
    expect(live.at(-1)).toBe(blocks[29])
    expect(live.length).toBeLessThan(15) // 30 × 5k is over the 60k budget
    const back = pickBlocks(blocks, 3)
    expect(back[0]).toBe(blocks[3])
    expect(pickBlocks([{ kind: 'reply', text: 'q'.repeat(200_000) }], null).length).toBe(1) // one always shows
  })
  test('a result previews its first three non-empty lines', async () => {
    expect(preview('a\n\nb\nc\nd\ne')).toEqual({ result: ['a', 'b', 'c'], more: 2 })
    expect(preview('')).toEqual({ result: [], more: 0 })
  })
})

describe('review fixes', () => {
  test('a result\'s preview reads its head and counts the rest', async () => {
    const big = `first\nsecond\nthird\nfourth\n${'x'.repeat(10_000)}\n${'more\n'.repeat(1_000)}`
    const p = preview(big)
    expect(p.result).toEqual(['first', 'second', 'third'])
    expect(p.more).toBeGreaterThanOrEqual(1_000)
    expect(preview('a\n\nb\nc\nd')).toEqual({ result: ['a', 'b', 'c'], more: 1 })
  })
  test('an opened run keeps its newest calls within budget, always at least one', async () => {
    const call = (i: number, size: number) => ({ id: `c${i}`, name: 'Bash', arg: 'x'.repeat(size), state: 'ok' as const, result: [], more: 0 })
    const many = Array.from({ length: 100 }, (_, i) => call(i, 10))
    expect(lastCalls(many).shown.length).toBe(40)
    expect(lastCalls(many).hidden).toBe(60)
    expect(lastCalls(many).shown.at(-1)?.id).toBe('c99')
    const huge = [call(0, 50_000), call(1, 50_000)]
    expect(lastCalls(huge)).toMatchObject({ hidden: 1, shown: [{ id: 'c1' }] })
    expect(lastCalls([call(0, 10)])).toMatchObject({ hidden: 0 })
  })
})
