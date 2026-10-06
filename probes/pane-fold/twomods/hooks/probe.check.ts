import { test, expect } from 'claude-code/testing';

test('one hooks module that registers two files: both get their hooks, the first registered is outermost', async ($, on) => {
  const writes: Record<string, string> = {};
  const names: (string | undefined)[] = [];
  on('fs.write', ($, e) => { writes[e.path] = e.text; return { value: undefined } as never; });
  on('session.start', ($, e) => ({ cwd: e.cwd }) as never);
  on('tool.call', { tool: 'Agent' }, ($, e) => { names.push(e.name); return { result: { agentId: 'x' }, text: 'ok' } as never; });
  await $.session.start({ cwd: '/w' } as never);
  await $.tool.call({ tool: 'Agent', description: 'd', prompt: 'p', subagent_type: 'general-purpose' } as never);
  expect(Object.keys(writes).sort()).toEqual(['/tmp/twomods-a.txt', '/tmp/twomods-b-saw.txt', '/tmp/twomods-b.txt']);
  expect(names).toEqual(['FromA']);
  // b's unmatched tool.call hook ran inside a's matched one, and saw the name a set
  expect(writes['/tmp/twomods-b-saw.txt']).toBe('b saw name=FromA order=a-in,b-in');
});
