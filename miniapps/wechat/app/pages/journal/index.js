const journal = require('../../utils/journal');
const { copy, updateTabs } = require('../../utils/copy');

Page({
  data: { t: {}, actions: [], groups: [], editor: null, error: '', toast: '', demo: false, hasMore: false, ready: false },
  onShow() { this._limit = this._limit || 7; this.refresh(); this._clock = setInterval(() => this.refresh(), 60000); },
  onHide() { clearInterval(this._clock); clearTimeout(this._undoTimer); this._undoId = null; this.setData({ toast: '', editor: null }); },
  onUnload() { clearInterval(this._clock); clearTimeout(this._undoTimer); },
  refresh() {
    const t = copy();
    try {
      const state = journal.read(), view = journal.view(state, t, Date.now(), this._limit);
      this._state = state;
      const patch = { t, name: view.name, todayDate: view.todayDate, demo: journal.isDemo(), ready: true, error: '', hasMore: view.hasMore };
      if (JSON.stringify(this.data.actions) !== JSON.stringify(view.actions)) patch.actions = view.actions;
      Object.assign(patch, journal.groupPatch(this.data.groups, view.groups));
      this.setData(patch); updateTabs(t);
    } catch (error) { this.setData({ t, ready: false, error: t[error.message] || t.readError }); }
  },
  fail(error) { const t = this.data.t; this.setData({ error: t[error.message] || t.writeError }); },
  async quickLog(event) {
    if (this._saving || !this.data.ready) return;
    this._saving = true;
    try {
      const state = await journal.add(this._state, event.currentTarget.dataset.type);
      this._undoId = state.events[state.events.length - 1].id;
      this.refresh(); this.setData({ toast: this.data.t.saved });
      wx.vibrateShort({ type: 'light', fail() {} });
      clearTimeout(this._undoTimer);
      this._undoTimer = setTimeout(() => { this._undoId = null; this.setData({ toast: '' }); }, 6000);
    } catch (error) { this.fail(error); }
    finally { this._saving = false; }
  },
  undo() {
    if (!this._undoId || this._saving) return;
    try { journal.remove(this._state, this._undoId); this._undoId = null; clearTimeout(this._undoTimer); this.setData({ toast: '' }); this.refresh(); }
    catch (error) { this.fail(error); }
  },
  loadMore() { this._limit += 7; this.refresh(); },
  edit(event) {
    const item = this._state.events.find(row => row.id === event.detail.id);
    if (!item) return;
    this._draft = { id: item.id, type: item.type, at: item.at, date: journal.dateKey(item.at), time: journal.clock(item.at), note: item.note };
    this.setData({ editor: { ...this._draft }, editorError: '', types: journal.TYPES.map(type => this.data.t[type]), typeIndex: journal.TYPES.indexOf(item.type) });
  },
  cancelEdit() { this._draft = null; this.setData({ editor: null }); },
  stopTap() {},
  setType(event) { const index = Number(event.detail.value); this._draft.type = journal.TYPES[index]; this.setData({ typeIndex: index }); },
  setDate(event) { this._draft.date = event.detail.value; this.setData({ 'editor.date': event.detail.value }); },
  setTime(event) { this._draft.time = event.detail.value; this.setData({ 'editor.time': event.detail.value }); },
  setNote(event) { this._draft.note = event.detail.value; },
  saveEdit() {
    if (!this._draft) return;
    try {
      const draft = this._draft;
      const at = draft.date === journal.dateKey(draft.at) && draft.time === journal.clock(draft.at)
        ? draft.at : journal.parseTime(draft.date, draft.time);
      journal.change(this._state, draft.id, { type: draft.type, at, note: draft.note.trim() });
      this.cancelEdit(); this.refresh();
    } catch (error) { this.setData({ editorError: this.data.t[error.message] || this.data.t.writeError }); }
  },
  deleteEdit() {
    const t = this.data.t, id = this._draft && this._draft.id;
    if (!id) return;
    wx.showModal({ title: t.deleteTitle, content: t.deleteBody, confirmText: t.modalDelete, cancelText: t.modalCancel, confirmColor: '#B43A35', fail: () => this.fail(new Error('dialogError')), success: result => {
      if (!result.confirm) return;
      try { journal.remove(this._state, id); this.cancelEdit(); this.refresh(); }
      catch (error) { this.setData({ editorError: t.writeError }); }
    } });
  },
  settings() {
    if (this._saving) return;
    const t = this.data.t;
    wx.showActionSheet({ itemList: [t.rename, t.language, this.data.demo ? t.own : t.sample, t.about], success: result => {
      if (result.tapIndex === 0) this.rename();
      if (result.tapIndex === 1) this.chooseLanguage();
      if (result.tapIndex === 2) this.switchSample();
      if (result.tapIndex === 3) wx.showModal({ title: t.about, content: t.aboutBody, showCancel: false, confirmText: t.done });
    } });
  },
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
