const TYPES = ['pee', 'poop', 'meal'];
const KEY = 'puptime.mini.journal';
const DEMO_KEY = 'puptime.mini.demo';
const MODE_KEY = 'puptime.mini.sample-mode';
const MAX_EVENTS = 5000;
const pad = value => String(value).padStart(2, '0');
function dateKey(at) { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function clock(at) { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function isDemo() { return wx.getStorageSync(MODE_KEY) === true; }
function key() { return isDemo() ? DEMO_KEY : KEY; }
function valid(state) {
  if (!state || typeof state !== 'object' || typeof state.name !== 'string' || state.name.length > 40
      || !Array.isArray(state.events) || state.events.length > MAX_EVENTS) return false;
  const ids = new Set();
  return state.events.every(event => {
    if (!event || typeof event.id !== 'string' || !/^evt_[a-f0-9]{32}$/.test(event.id) || ids.has(event.id)
        || !TYPES.includes(event.type) || !Number.isSafeInteger(event.at) || event.at < 0 || event.at > 8640000000000000
        || typeof event.note !== 'string' || event.note.length > 500) return false;
    ids.add(event.id); return true;
  });
}
function read() {
  const state = wx.getStorageSync(key());
  if (state === '') return { name: '', events: [] };
  if (!valid(state)) throw new Error('readError');
  return state;
}
function write(state) {
  if (!valid(state)) throw new Error('writeError');
  // One persisted object: failed writes never advance the page's current state.
  wx.setStorageSync(key(), state);
  return state;
}
function ids(count = 1) {
  return new Promise((resolve, reject) => {
    if (typeof wx.getRandomValues !== 'function') return reject(new Error('randomError'));
    wx.getRandomValues({ length: count * 16, success(result) {
      const bytes = new Uint8Array(result.randomValues);
      if (bytes.length !== count * 16) return reject(new Error('randomError'));
      resolve(Array.from({ length: count }, (_, i) => 'evt_' + Array.from(bytes.slice(i * 16, i * 16 + 16), b => b.toString(16).padStart(2, '0')).join('')));
    }, fail() { reject(new Error('randomError')); } });
  });
}
async function add(state, type, now = Date.now()) {
  if (!TYPES.includes(type)) throw new Error('writeError');
  if (state.events.length >= MAX_EVENTS) throw new Error('full');
  const [id] = await ids();
  return write({ ...state, events: [...state.events, { id, type, at: now, note: '' }] });
}
function change(state, id, fields) {
  if (!state.events.some(event => event.id === id)) throw new Error('writeError');
  return write({ ...state, events: state.events.map(event => event.id === id ? { ...event, ...fields, id } : event) });
}
function remove(state, id) { return write({ ...state, events: state.events.filter(event => event.id !== id) }); }
function parseTime(date, time, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error('invalidDate');
  const at = new Date(`${date}T${time}:00`).getTime();
  if (!Number.isFinite(at) || dateKey(at) !== date || clock(at) !== time || at > now) throw new Error('invalidDate');
  return at;
}
function view(state, t, now = Date.now(), limit = 7) {
  const today = dateKey(now), yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const sorted = [...state.events].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  const groups = [];
  const labels = { pee: t.peed, poop: t.pooped, meal: t.ate };
  for (const event of sorted) {
    const key = dateKey(event.at);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: key === today ? t.today : key === dateKey(yesterday) ? t.yesterday : key, rows: [] };
      groups.push(group);
    }
    group.rows.push({ ...event, label: labels[event.type], time: clock(event.at) });
  }
  return {
    name: state.name || t.puppy, todayDate: today,
    actions: TYPES.map(type => {
      const last = sorted.find(event => event.type === type);
      const minutes = last ? Math.max(0, Math.floor((now - last.at) / 60000)) : 0;
      return { type, label: t[type], count: state.events.filter(e => e.type === type && dateKey(e.at) === today).length,
        last: last ? minutes < 1 ? t.now : minutes < 60 ? `${minutes}${t.minute}` : minutes < 1440 ? `${Math.floor(minutes / 60)}${t.hour}` : dateKey(last.at) : t.noLogs };
    }),
    groups: groups.slice(0, limit), hasMore: groups.length > limit,
  };
}
function groupPatch(before, after) {
  if (before.length !== after.length || before.some((group, i) => group.key !== after[i].key)) return { groups: after };
  const patch = {};
  after.forEach((group, i) => {
    const old = before[i];
    if (old.label !== group.label) patch[`groups[${i}].label`] = group.label;
    if (old.rows.length !== group.rows.length || old.rows.some((row, j) => row.id !== group.rows[j].id)) patch[`groups[${i}].rows`] = group.rows;
    else group.rows.forEach((row, j) => { if (JSON.stringify(row) !== JSON.stringify(old.rows[j])) patch[`groups[${i}].rows[${j}]`] = row; });
  });
  return patch;
}
function statistics(state, now = Date.now()) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (6 - i));
    return { key: dateKey(d), label: `${d.getMonth() + 1}/${d.getDate()}`, pee: 0, poop: 0, meal: 0, total: 0 };
  });
  const byDate = new Map(days.map(day => [day.key, day]));
  state.events.forEach(event => { const day = byDate.get(dateKey(event.at)); if (day) { day[event.type]++; day.total++; } });
  const peak = Math.max(1, ...days.map(day => day.total));
  return { total: days.reduce((sum, day) => sum + day.total, 0), activeDays: days.filter(day => day.total).length,
    totals: TYPES.map(type => ({ type, count: days.reduce((sum, day) => sum + day[type], 0), average: (days.reduce((sum, day) => sum + day[type], 0) / 7).toFixed(1) })),
    days: days.map(day => ({ ...day, peeHeight: day.pee / peak * 120, poopHeight: day.poop / peak * 120, mealHeight: day.meal / peak * 120 })),
  };
}
async function openDemo(now = Date.now()) {
  const existing = wx.getStorageSync(DEMO_KEY);
  if (existing !== '' && !valid(existing)) throw new Error('readError');
  if (existing === '') {
    const sampleIds = await ids(501);
    const start = new Date(now); start.setDate(start.getDate() - 20); start.setHours(0, 0, 0, 0);
    const end = now - 60000;
    const events = sampleIds.map((id, i) => ({ id, type: TYPES[i % 3], at: Math.round(start.getTime() + (end - start.getTime()) * i / 500), note: '' }));
    wx.setStorageSync(DEMO_KEY, { name: 'Scruffy', events });
  }
  wx.setStorageSync(MODE_KEY, true);
}
function closeDemo() { wx.setStorageSync(MODE_KEY, false); }
module.exports = { TYPES, read, write, add, change, remove, ids, view, statistics, dateKey, clock, parseTime, groupPatch, isDemo, openDemo, closeDemo, valid };
