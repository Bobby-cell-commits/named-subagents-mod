import type { Register } from 'claude-code';
export const order: string[] = [];
export const A_FILE = '/tmp/twomods-a.txt';
// `$`-free: the caller hands in what it may do.
export async function startA(write: (path: string, text: string) => Promise<unknown>) { await write(A_FILE, 'a started'); }
export const register: Register = (on) => {
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    order.push('a-in');
    const r = await next(e.name ? e : { ...e, name: 'FromA' });
    order.push('a-out');
    return r;
  });
};
