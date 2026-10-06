import type { Register } from 'claude-code';
import { register as a } from './a.ts';
import { register as b } from './b.tsx';
export const register: Register = (on, options) => { a(on, options); b(on, options); };
