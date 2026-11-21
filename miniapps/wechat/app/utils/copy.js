const en = {
  timeline: 'Timeline', openMenu: 'Open navigation', close: 'Close', sampleShort: 'Sample', log: 'Log', insights: 'Insights', puppy: 'My puppy', settings: 'Settings', today: 'Today', yesterday: 'Yesterday',
  pee: 'Pee', poop: 'Poop', meal: 'Ate', peed: 'Peed', pooped: 'Pooped', ate: 'Ate a meal', source: 'Mini program',
  frequency: 'Frequency', dailySuffix: '/day', eachDay: 'on each recorded day', recordedDay: 'per recorded day', needAnother: 'Need another log', middleHalf: 'Middle half:', gapsObserved: 'gaps observed', logs: 'logs', typicalGap: 'TYPICAL GAP', byMonth: 'By month', thisMonth: 'This month', allMonths: 'Show all months', recentMonths: 'Show recent months', poopAndMeal: 'Poop & Ate', earlierTimeline: 'Load earlier days', localJournal: 'Local journal', previewTitle: 'WeChat prototype', quick: 'Quick log', history: 'Activity', earlier: 'Load earlier days', empty: 'A fresh start',
  emptyBody: 'Your puppy’s day starts with the first log.', noLogs: 'No logs yet',
  saved: 'Saved', undo: 'Undo', last: 'Last', now: 'Just now', minute: 'm ago', hour: 'h ago',
  local: 'Saved on this device · No cloud sync', demo: 'Sample journal · Your own logs are kept separately',
  rename: 'Puppy name', language: 'Language / 语言', sample: 'Try a sample journal', own: 'Return to my journal',
  about: 'About this prototype', aboutBody: 'A private, local-only WeChat prototype. Logs stay in this mini program’s storage. Clearing its storage removes them. It does not connect to your Puptime account.',
  nameHint: 'Your puppy’s name', save: 'Save', cancel: 'Cancel', edit: 'Edit activity', type: 'Activity', date: 'Date', time: 'Time',
  note: 'Note (optional)', noteHint: 'Anything you want to remember', remove: 'Delete activity', deleteTitle: 'Delete this activity?',
  deleteBody: 'This removes it from this local journal.', invalidDate: 'Choose a valid date and time that is not in the future.',
  writeError: 'Couldn’t save. Your previous logs are kept. Try again.', readError: 'Couldn’t read this journal. Its saved data has been kept.',
  randomError: 'Couldn’t create a log ID. Update WeChat or try again.', full: 'This prototype holds up to 5,000 logs.',
  sevenDays: 'Last 7 days', statsBody: 'Recorded activity, day by day', total: 'Total logs', perDay: 'per day',
  activityByDay: 'Activity by day', days: 'days with logs', statsEmpty: 'Your first log will appear here.',
  sampleTitle: 'Open a sample journal?', sampleBody: 'Creates 501 example logs across 21 days. Your own journal stays separate.',
  openSample: 'Open', modalCancel: 'Back', modalDelete: 'Yes', done: 'OK', minName: 'Enter your puppy’s name.',
  dialogError: 'Couldn’t open this dialog. Try again.',
};
const zh = {
  timeline: '时间线', openMenu: '打开导航', close: '关闭', sampleShort: '示例', log: '记录', insights: '统计', puppy: '我的小狗', settings: '设置', today: '今天', yesterday: '昨天',
  pee: '尿尿', poop: '便便', meal: '吃饭', peed: '尿尿了', pooped: '便便了', ate: '吃饭了', source: '小程序',
  frequency: '频率', dailySuffix: '/天', eachDay: '次 / 每个记录日', recordedDay: '次 / 记录日', needAnother: '还需要一条记录', middleHalf: '中间一半：', gapsObserved: '个间隔', logs: '条记录', typicalGap: '典型间隔', byMonth: '按月查看', thisMonth: '本月', allMonths: '显示所有月份', recentMonths: '显示最近月份', poopAndMeal: '便便和吃饭', earlierTimeline: '加载更早记录', localJournal: '本地记录', previewTitle: '微信测试版', quick: '快速记录', history: '活动记录', earlier: '加载更早记录', empty: '新的一天，从这里开始',
  emptyBody: '记下小狗今天的第一件事。', noLogs: '暂无记录',
  saved: '已保存', undo: '撤销', last: '上次', now: '刚刚', minute: '分钟前', hour: '小时前',
  local: '仅保存在本机 · 未开启云同步', demo: '示例记录 · 你的个人记录单独保存',
  rename: '小狗的名字', language: 'Language / 语言', sample: '体验示例记录', own: '返回我的记录',
  about: '关于此测试版', aboutBody: '这是微信小程序的本地测试版。记录仅保存在此小程序中，清除小程序存储将删除记录，不会连接你的 Puptime 账号。',
  nameHint: '小狗的名字', save: '保存', cancel: '取消', edit: '编辑记录', type: '活动', date: '日期', time: '时间',
  note: '备注（选填）', noteHint: '记下你想记住的事', remove: '删除记录', deleteTitle: '删除这条记录？',
  deleteBody: '这会从本地记录中移除此条活动。', invalidDate: '请选择有效且不晚于现在的日期和时间。',
  writeError: '无法保存，之前的记录已保留，请重试。', readError: '无法读取记录，原有数据已保留。',
  randomError: '无法生成记录编号，请更新微信或重试。', full: '此测试版最多保存 5,000 条记录。',
  sevenDays: '最近7天', statsBody: '每天记录的活动', total: '总记录数', perDay: '次/天',
  activityByDay: '每日活动', days: '天有记录', statsEmpty: '记录第一件事后，就能在这里看到统计。',
  sampleTitle: '打开示例记录？', sampleBody: '创建21天共501条示例记录。你的个人记录会单独保留。',
  openSample: '打开示例', modalCancel: '取消', modalDelete: '删除', done: '确定', minName: '请输入小狗的名字。',
  dialogError: '无法打开对话框，请重试。',
};
function language() {
  const stored = wx.getStorageSync('puptime.mini.language');
  if (stored === 'en' || stored === 'zh') return stored;
  return /^zh/i.test(wx.getAppBaseInfo().language) ? 'zh' : 'en';
}
function copy() { return language() === 'zh' ? zh : en; }
module.exports = { copy, language };
