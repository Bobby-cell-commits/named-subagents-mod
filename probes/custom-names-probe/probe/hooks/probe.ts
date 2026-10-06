// Probe for the custom-names design. Appends JSONL to <session cwd>/markers.jsonl:
//   session.start     the options as received; $.fs reads and writes under the config directory; $.store
//   tool.call.Agent   sets the next candidate name on the call and records what came back
//   agent.spawn       e.name at spawn, then the list row's name for the new id
import type { Register, EngineInterface } from 'claude-code';

// One candidate per dispatch, in order. The first refusal quoted the tool's own pattern, so
// one batch settled the rule.
const CANDIDATES = ['Ripley', 'Mary Shelley', "O'Brien", 'Zoë', '名前', 'Rocket🚀', 'a/b', 'Ripley'];

let cwd: string | undefined;
let names: string[] = [];
let n = 0;
let chain: Promise<void> = Promise.resolve();
function mark($: EngineInterface, hook: string, data: Record<string, unknown>): Promise<void> {
  const path = `${cwd ?? $.plugin.root}/markers.jsonl`;
  const line = JSON.stringify({ ts: new Date().toISOString(), hook, ...data }) + '\n';
  chain = chain.then(async () => {
    const prev = (await $.fs.exists(path)) ? await $.fs.read(path) : '';
    await $.fs.write(path, prev + line);
  }).catch(() => undefined); // audit-allow: fail-loud — probe telemetry; a lost line shows as a gap
  return chain;
}
async function attempt(f: () => Promise<unknown>): Promise<unknown> {
  try { return { ok: await f() }; } catch (err) { return { error: String(err).slice(0, 200) }; }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd;
    const r = await next(e);
    names = CANDIDATES;
    const home = await $.env.get('HOME');
    const cfg = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`;
    await mark($, 'options', { options });
    await mark($, 'fs', {
      home, cfg, root: await $.session.root(),
      readSeeded: await attempt(() => $.fs.read(`${cfg}/names-probe-seeded.json`)),
      readTilde: await attempt(() => $.fs.read('~/.claude/names-probe-seeded.json')),
      existsMissing: await attempt(() => $.fs.exists(`${cfg}/names-probe-absent.json`)),
      readMissing: await attempt(() => $.fs.read(`${cfg}/names-probe-absent.json`)),
      write: await attempt(() => $.fs.write(`${cfg}/names-probe-written.json`, '{"written":true}\n')),
      readBack: await attempt(() => $.fs.read(`${cfg}/names-probe-written.json`)),
      stat: await attempt(() => $.fs.stat(`${cfg}/names-probe-seeded.json`)),
    });
    await mark($, 'store', {
      before: await attempt(() => $.store.get('probe')),
      set: await attempt(() => $.store.set('probe', { at: new Date().toISOString() })),
      after: await attempt(() => $.store.get('probe')),
    });
    return r;
  });
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const name = names[n++];
    if (name === undefined) return next(e);
    try {
      const r = await next({ ...e, name });
      await mark($, 'tool.call.Agent', { tool_use_id: e.tool_use_id, set: name, result: JSON.stringify(r).slice(0, 300) });
      return r;
    } catch (err) {
      await mark($, 'tool.call.Agent', { tool_use_id: e.tool_use_id, set: name, threw: String(err).slice(0, 300) });
      throw err;
    }
  });
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e);
    const row = (await $.agent.list()).find(a => a.id === r.agentId);
    await mark($, 'agent.spawn', { tool_use_id: e.tool_use_id, spawnName: e.name, agentId: r.agentId, listName: row?.name });
    return r;
  });
};
