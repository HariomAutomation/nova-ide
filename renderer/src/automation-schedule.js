// Automation scheduling — pure, side-effect-free helpers.
//
// Nova automations are a saved prompt plus a *trigger*. Cursor's automations are
// cloud-hosted and fire on webhooks/schedules; Nova runs locally, so it supports
// the triggers that make sense on a user's machine: manual, on startup, every N
// minutes, and daily at a time. This module decides *whether a trigger is due*;
// the store owns the timer and the actual run.

export const TRIGGER_TYPES = ['manual', 'startup', 'interval', 'daily'];

export function normalizeTrigger(t) {
  const type = t && TRIGGER_TYPES.includes(t.type) ? t.type : 'manual';
  const out = { type };
  if (type === 'interval') out.minutes = Math.max(1, Math.min(Number(t && t.minutes) || 60, 10080));
  if (type === 'daily') {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String((t && t.time) || '').trim());
    out.time = m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : '09:00';
  }
  return out;
}

/** Epoch ms for today's HH:MM in local time. */
function todayAt(time, now) {
  const [hh, mm] = String(time || '09:00')
    .split(':')
    .map((n) => Number(n) || 0);
  const d = new Date(now);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

/**
 * Is this automation due to run at `now`?
 * Manual triggers are never "due" (the user runs them); they only run on demand.
 */
export function isAutomationDue(a, now) {
  if (!a || a.enabled === false) return false;
  const t = normalizeTrigger(a.trigger);
  const last = Number(a.lastRunAt) || 0;
  switch (t.type) {
    case 'manual':
      return false;
    case 'startup':
      return last === 0; // once per install/session baseline
    case 'interval':
      return now - last >= t.minutes * 60000;
    case 'daily': {
      const at = todayAt(t.time, now);
      return now >= at && last < at;
    }
    default:
      return false;
  }
}

/** Every automation that is due right now, oldest-created first. */
export function dueAutomations(list, now) {
  if (!Array.isArray(list)) return [];
  return list.filter((a) => isAutomationDue(a, now)).sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
}

/** A short human label for a trigger, for the UI. */
export function describeTrigger(t) {
  const tr = normalizeTrigger(t);
  switch (tr.type) {
    case 'startup':
      return 'On app start';
    case 'interval':
      return `Every ${tr.minutes} min`;
    case 'daily':
      return `Daily at ${tr.time}`;
    default:
      return 'Manual';
  }
}
