const { dateKey, clock } = require('./journal');
function timeline(state, selected, count, now = Date.now()) {
  const today = dateKey(now);
  const end = new Date(now); end.setDate(end.getDate() + 2);
  return Array.from({ length: count + 2 }, (_, i) => {
    const date = new Date(end); date.setDate(date.getDate() - (count + 1 - i));
    const key = dateKey(date), events = state.events.filter(event => dateKey(event.at) === key && selected.includes(event.type));
    const buckets = new Map();
    events.forEach(event => {
      const d = new Date(event.at), bucket = Math.floor((d.getHours() * 60 + d.getMinutes()) / 15);
      const mark = buckets.get(bucket) || { key: String(bucket), left: (bucket + .5) / 96 * 100, types: [], ids: [] };
      if (!mark.types.includes(event.type)) mark.types.push(event.type);
      mark.ids.push(event.id); buckets.set(bucket, mark);
    });
    return { key, today: key === today, date: `${date.getMonth() + 1}/${date.getDate()}`, weekday: date.getDay(), marks: [...buckets.values()],
      events: events.map(event => ({ ...event, time: clock(event.at) })).sort((a, b) => a.at - b.at) };
  });
}
module.exports = { timeline };
