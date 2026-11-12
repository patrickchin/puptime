const journal = require('../../utils/journal');
const { copy, language } = require('../../utils/copy');
Page({
  data: { t: {}, name: '', demo: false, languageName: '', error: '' },
  onShow() { this.refresh(); },
  refresh() {
    const t = copy();
    try { if (this.selectComponent) this.selectComponent('#shell')?.refresh(); this._state = journal.read(); this.setData({ t, name: this._state.name || t.puppy, demo: journal.isDemo(), languageName: language() === 'zh' ? '简体中文' : 'English', error: '' }); }
    catch (error) { this.setData({ t, error: t.readError }); }
  },
  fail(error) { this.setData({ error: this.data.t[error.message] || this.data.t.writeError }); },
  about() { const t = this.data.t; wx.showModal({ title: t.about, content: t.aboutBody, showCancel: false, confirmText: t.done }); },
  rename() {
    const t = this.data.t;
    wx.showModal({ title: t.rename, editable: true, content: this._state ? this._state.name : '', placeholderText: t.nameHint, confirmText: t.save, cancelText: t.modalCancel, fail: () => this.fail(new Error('dialogError')), success: result => {
      if (!result.confirm) return;
      const name = (result.content || '').trim();
      if (!name || name.length > 40) { this.setData({ error: t.minName }); return; }
      try { journal.write({ ...journal.read(), name }); this.refresh(); } catch (error) { this.fail(error); }
    } });
  },
  chooseLanguage() {
    wx.showActionSheet({ itemList: ['English', '简体中文'], success: result => {
      try { wx.setStorageSync('puptime.mini.language', result.tapIndex === 1 ? 'zh' : 'en'); this.refresh(); }
      catch (error) { this.fail(error); }
    } });
  },
  switchSample() {
    if (this.data.demo) { try { journal.closeDemo(); this.refresh(); } catch (error) { this.fail(error); } return; }
    const t = this.data.t;
    wx.showModal({ title: t.sampleTitle, content: t.sampleBody, confirmText: t.openSample, cancelText: t.modalCancel, fail: () => this.fail(new Error('dialogError')), success: async result => {
      if (!result.confirm || this._saving) return;
      this._saving = true;
      try { await journal.openDemo(); this._limit = 7; this.refresh(); }
      catch (error) { this.fail(error); }
      finally { this._saving = false; }
    } });
  },
});
