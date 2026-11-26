const journal = require('../../utils/journal');
const { activityFrequencyStats, monthlyActivityStats, formatDuration } = require('../../utils/analytics');
const { copy, language } = require('../../utils/copy');
Page({
  data: { t: {}, stats: [], months: [], allMonths: false, hasMonths: false, error: '' },
  onShow() { this.refresh(); this._clock = setInterval(() => this.refresh(), 60000); },
  onHide() { clearInterval(this._clock); }, onUnload() { clearInterval(this._clock); },
  toggleMonths() { this.setData({ allMonths: !this.data.allMonths }); this.refresh(); },
  refresh() {
    const t = copy(), zh = language() === 'zh';
    try {
      const state = journal.read(), now = new Date();
      const frequency = activityFrequencyStats(state.events, ['pee', 'poop'], 10, now);
      const duration = minutes => minutes === undefined ? '—' : formatDuration(minutes * 60000);
      const stats = frequency.stats.map(stat => ({
        ...stat, label: t[stat.type], daily: stat.total ? `${stat.averagePerRecordedDay.toFixed(1)}${t.dailySuffix}` : '—',
        detail: !stat.total ? t.noLogs : stat.minimumPerRecordedDay === stat.maximumPerRecordedDay
          ? `${stat.minimumPerRecordedDay} ${t.eachDay}` : `${stat.minimumPerRecordedDay}–${stat.maximumPerRecordedDay} ${t.recordedDay}`,
        gap: duration(stat.medianIntervalMinutes),
        gapDetail: !stat.intervalSamples ? t.needAnother : stat.intervalSamples >= 4
          ? `${t.middleHalf} ${duration(stat.lowerIntervalMinutes)}–${duration(stat.upperIntervalMinutes)}` : `${stat.intervalSamples} ${t.gapsObserved}`,
      }));
      const all = monthlyActivityStats(state.events), max = Math.max(1, ...all.map(month => month.averagePerRecordedDay));
      const months = (this.data.allMonths ? all : all.slice(0, 6)).map(month => ({
        key: month.key, label: month.key === journal.dateKey(now).slice(0, 7) ? t.thisMonth : zh ? `${month.date.getFullYear()}年${month.date.getMonth() + 1}月` : month.date.toLocaleDateString('en', { month: 'long', year: 'numeric' }),
        current: month.key === journal.dateKey(now).slice(0, 7), daily: month.averagePerRecordedDay.toFixed(1), total: month.total, days: month.recordedDays,
        width: month.total ? Math.max(4, month.averagePerRecordedDay / max * 100) : 0,
      }));
      this.setData({ t, stats, caption: zh ? `10 天中有 ${frequency.recordedDays} 天有记录 · 非目标` : `${frequency.recordedDays}/10 days with logs · not a target`,
        months, hasMonths: all.length > 1, hasMoreMonths: all.length > 6, error: '' });
    } catch (error) { this.setData({ t, error: t.readError }); }
  },
});
