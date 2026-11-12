# Puptime — private WeChat prototype

This is an isolated, dependency-free native WeChat mini program. It is not an
Expo export and does not connect to Puptime accounts or upload activity data.
Nothing needs to merge or publish to try it on your own phone.

## Run on your WeChat account

1. Install the official [WeChat DevTools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
   for your Mac and sign in by scanning its login QR code with your own WeChat.
2. Import **this folder** (`miniapps/wechat`, not the repository root). The config
   points at `app/` automatically. Select **Test account / 测试号** in the AppID
   field and **No cloud service / 不使用云服务**. The tracked `touristappid` is
   only a guest placeholder; it cannot generate a phone preview.
3. Compile, then choose **Preview / 预览**. Scan the generated QR code in the
   same WeChat account. The WeChat account owns the test AppID/preview permission.
4. If inviting a friend later, add their account through the available tester
   controls; a preview QR is not unrestricted public access.

Selecting a test account may update `project.config.json` with your AppID. Keep
that local change out of the PR. `project.private.config.json` is gitignored.
No AppSecret, server domain, payments, backend deployment or public release is
needed for this local-only prototype. The test-account option still depends on
WeChat allowing your account to sign into its developer tools.

## Try

- Tap Pee, Poop or Meal to save an activity; Undo is available for six seconds.
- Tap an activity to edit its type, date, time or note using native pickers.
- Open Insights for the last seven local calendar days (including today).
- Settings changes the puppy name or English/简体中文 language.
- **Settings → Try a sample journal** opens 501 labeled sample logs over 21 days.
  **Return to my journal** restores the separate personal journal. Sample edits
  persist only in the sample journal.

Activity is saved only in this mini program's local storage. Clearing that
storage removes it. This prototype caps each journal at 5,000 events and has no
export/recovery feature, so use it for testing rather than your only copy of
important activity. Existing native Puptime data is never read or modified.

## Check

```sh
node --test miniapps/wechat/tests/journal.test.cjs
```

The checks cover persistence failures, sample/personal isolation, 501-log history,
statistics reconciliation and row-scoped editor updates. Real WeChat rendering,
permissions and QR previews require DevTools and your account.

Verified on November 12, 2026 in official WeChat DevTools 2.02.2609250,
WeChatLib 3.18.0, using its iPhone 12/13 (Pro) simulator profile: quick logging,
note editing, persistence after a full recompile, the 501-log sample journal,
and seven-day insights. A runtime probe found 162 history-row components:
typing a note sent no history patches; saving sent only `groups[0].rows[0]`
and changed exactly one component's event property. Four Node tests and the
official WXML/WXSS compilers pass. Actual phone verification remains separate
until the owner scans the preview code. No Android or Alipay runtime was tested.

## Design

Native WeChat navigation, pickers, sheets and dialogs; device system type;
Puptime's cream/forest palette and existing Scruffy/activity artwork. The app
design direction is accent-ladder (seed 1620646728), adapted to phone navigation.
The journal answers “what happened today, and can I log it in one tap?”; Insights
answers “how often did each activity happen over the last seven days?”. Activity
colours identify pee/poop/meals consistently with Puptime. Assets are resized
build derivatives of `assets/mascots/scruffy-terrier.png` and
`assets/appearance/journal-activities.png` to stay below miniapp package limits.

Deliberately omitted: accounts/sync, sharing, routines, widgets, reminders,
dictation, care articles, dark mode and Alipay. This folder adds no compatibility
layer to the existing app.
