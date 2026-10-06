// The plugin has one status line and two things to say on it: naming's alarm (a name that
// did not reach its agent, a names file that is wrong) and the pane's count of running
// agents while it is not on screen. Each half sets its own part and writes the line this
// returns, so neither wipes the other's. With both to say, the count leads and the alarm
// follows it: an alarm can stand for a whole session (a names file that stays wrong).
//
// These are module variables, so a reload forgets a standing alarm; the pane's first sync
// after it (or, with the pane switched off, the session start) then writes the line afresh. A names-file problem is alarmed again at the next
// dispatch; a "drew X but…" alarm is not.

let alarm: string | undefined;
let running: string | undefined;

const line = () => (alarm !== undefined && running !== undefined ? `${running} · ${alarm}` : alarm ?? running);

/** Naming's alarm, or undefined to clear it; returns the line to show. */
export const withAlarm = (text: string | undefined) => { alarm = text; return line(); };

/** The pane's running count, or undefined for none; returns the line to show. */
export const withRunning = (text: string | undefined) => { running = text; return line(); };
