const journal = require('../../utils/journal');
const { copy, updateTabs } = require('../../utils/copy');
Page({
  data: { t: {}, totals: [], days: [], total: 0, activeDays: 0, demo: false, error: '' },
  onShow() { this.refresh(); this._clock = setInterval(() => this.refresh(), 60000); },
  onHide() { clearInterval(this._clock); },
  onUnload() { clearInterval(this._clock); },
  refresh() {
    const t = copy();
    try {
      const state = journal.read();
      this.setData({ ...journal.statistics(state), t, name: state.name || t.puppy, demo: journal.isDemo(), error: '' });
      updateTabs(t);
    } catch (error) { this.setData({ t, error: t.readError }); }
  },
});
