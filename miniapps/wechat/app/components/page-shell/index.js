const { copy } = require('../../utils/copy');
Component({
  properties: { screen: String },
  data: { t: {}, top: 44, drawer: false, demo: false, destinations: [] },
  lifetimes: { attached() { this.refresh(); } },
  pageLifetimes: { show() { this.refresh(); } },
  methods: {
    refresh() {
      const t = copy(), info = wx.getWindowInfo();
      this.setData({ t, top: info.statusBarHeight, demo: wx.getStorageSync('puptime.mini.sample-mode') === true,
        destinations: ['log', 'timeline', 'insights', 'settings'].map(key => ({ key, label: t[key], icon: key === 'log' ? 'home' : key })) });
    },
    open() { this.setData({ drawer: true }); }, close() { this.setData({ drawer: false }); }, stopTap() {},
    navigate(event) {
      const key = event.currentTarget.dataset.key;
      if (!['log', 'timeline', 'insights', 'settings'].includes(key)) return;
      this.close();
      if (key !== this.data.screen) wx.redirectTo({ url: `/pages/${key === 'log' ? 'journal' : key}/index` });
    },
  },
});
