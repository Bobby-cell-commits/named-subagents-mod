// The plugin's hooks module. hooks.json takes one path, so this file is it and the two
// halves each keep their own: names.ts (every Agent dispatch gets a name) and pane.tsx (the
// agents pane, which lists each agent under that name).
//
// Registrations nest in order, first outermost, so naming's tool.call{Agent} hook runs
// around the pane's tool.call hook. Nothing depends on that order today: the pane takes an
// agent's name from agent.spawn and the agent list, not from the call. session.start and
// agent.spawn are hooked once, in pane.tsx, for both halves (see the top of names.ts).

import type { Register } from 'claude-code';
import { register as names } from './names.ts';
import { register as pane } from './pane.tsx';

export const register: Register = (on, options) => {
  names(on, options);
  pane(on, options);
};
