// Small helpers shared by the overlay and the dashboard: building elements and wording dates.
export function el(tag, cls, parent, text) {
  const e = parent.ownerDocument.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  parent.appendChild(e);
  return e;
}

// Something to click that is not a form button (Obsidian styles those heavily): reachable with the
// keyboard, Enter and Space act like a click.
export function clickable(node, onClick) {
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  node.addEventListener('click', onClick);
  node.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    onClick(e);
  });
  return node;
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const fmtDay = (t) => {
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
};

export const fmtWeekday = (t) => `${WEEKDAYS[new Date(t).getDay()]}, ${fmtDay(t)}`;

export const fmtTime = (t) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 2 * 3600) return 'an hour ago';
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  if (s < 2 * 86400) return 'yesterday';
  return `${Math.round(s / 86400)} days ago`;
}

// The same for a narrow column of values
export function agoShort(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'now';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}

// The greeting over the galaxy and at the head of the dashboard
export function greeting(name) {
  return name ? `Welcome, ${name}.` : 'Welcome.';
}

// One sentence on what changed: since the last visit on this device, or this week on the first one.
export function newsLine(stats, prevVisit) {
  if (!prevVisit) return `${stats.updatedWeek} ${stats.updatedWeek === 1 ? 'note' : 'notes'} edited this week.`;
  const changed = stats.pagesList.filter((p) => p.mtime > prevVisit).length;
  if (!changed) return 'No new notes or changes since your last visit.';
  return `${changed} ${changed === 1 ? 'note was' : 'notes were'} edited since your last visit.`;
}

// When a task is due, as seen from today: the wording and how urgent it is.
export function dueText(due) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due - today.getTime()) / 86400000);
  const text = days < 0 ? `since ${fmtDay(due)}` : days === 0 ? 'today' : days === 1 ? 'tomorrow' : fmtDay(due);
  return { days, text, overdue: days < 0, soon: days >= 0 && days <= 7 };
}
