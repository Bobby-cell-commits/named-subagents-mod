import type { Register } from 'claude-code';
import { order, startA } from './a.ts';
export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await startA((path, text) => $.fs.write(path, text));
    await $.fs.write('/tmp/twomods-b.txt', 'b started');
    return next(e);
  });
  on('tool.call', async ($, e, next) => {
    order.push('b-in');
    if (e.tool === 'Agent') await $.fs.write('/tmp/twomods-b-saw.txt', `b saw name=${(e as { name?: string }).name ?? 'none'} order=${order.join(',')}`);
    const r = await next(e);
    order.push('b-out');
    return r;
  });
};
