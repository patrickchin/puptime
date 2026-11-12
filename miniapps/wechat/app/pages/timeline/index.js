const journal = require('../../utils/journal');
const { timeline } = require('../../utils/timeline');
const { copy, language } = require('../../utils/copy');
Page({
  data: { t: {}, rows: [], selected: 'pee', selection: null, hours: [0,3,6,9,12,15,18,21,24], grid: Array.from({ length: 23 }, (_, i) => i + 1), height: 500, scrollTop: 0, error: '' },
  onLoad() { this._days = 14; },
  onReady() { this.setData({ scrollTop: 360 }); },
  onShow() { this.refresh(); this._clock = setInterval(() => this.refresh(), 60000); },
  onHide() { clearInterval(this._clock); }, onUnload() { clearInterval(this._clock); },
  refresh() {
    const t = copy(), info = wx.getWindowInfo();
    try {
      this._state = journal.read();
      const now = new Date();
      const weekdays = language() === 'zh' ? ['日','一','二','三','四','五','六'] : ['SUN','MON','TUE','WED','THU','FRI','SAT'];
      this.setData({ t, height: info.windowHeight - info.statusBarHeight - 60 - 72 - 30,
        nowPosition: (now.getHours() * 60 + now.getMinutes()) / 1440 * 100,
        rows: timeline(this._state, this.data.selected === 'pee' ? ['pee'] : ['poop','meal'], this._days || 14).map(row => ({ ...row, dayLabel: row.today ? t.today : weekdays[row.weekday] })), error: '' });
    } catch (error) { this.setData({ t, error: t.readError }); }
  },
  choose(event) { this.setData({ selected: event.currentTarget.dataset.view, selection: null }); this.refresh(); },
  loadEarlier() { this._days = Math.min(210, (this._days || 14) + 14); this.setData({ scrollTop: 14 * 52 }); this.refresh(); },
  inspect(event) {
    const row = this.data.rows.find(row => row.key === event.currentTarget.dataset.key);
    if (!row || !row.events.length) return;
    const width = wx.getWindowInfo().windowWidth - 56;
    const x = event.detail.x - 56;
    const nearby = row.events.filter(item => {
      const d = new Date(item.at), center = (Math.floor((d.getHours() * 60 + d.getMinutes()) / 15) + .5) / 96 * width;
      return Math.abs(center - x) <= 22;
    });
    if (nearby.length) this.setData({ selection: { label: `${row.dayLabel} · ${row.date}`, events: nearby.map(item => ({ ...item, label: this.data.t[item.type] })) } });
  },
  close() { this.setData({ selection: null }); }, stopTap() {},
  log() { wx.redirectTo({ url: '/pages/journal/index' }); },
  edit(event) { wx.redirectTo({ url: `/pages/journal/index?event=${event.currentTarget.dataset.id}` }); },
});
