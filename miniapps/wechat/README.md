# Puptime — private WeChat prototype

An isolated native WeChat mini program for private test-account previews. It
runs locally and does not connect to Puptime accounts or upload journal data.
Keep [PR #183](https://github.com/patrickchin/puptime/pull/183) unmerged.

## Run on your WeChat account

1. Install official [WeChat DevTools](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
   and sign in with your WeChat account.
2. Import **this folder** (`miniapps/wechat`). Choose **Test account / 测试号**
   and **No cloud service / 不使用云服务**. The tracked `touristappid` is a guest
   placeholder; select a test account to generate a phone preview.
3. Compile, choose **Preview / 预览**, and scan using the same WeChat account.
   Preview codes expire; generate another when needed.
4. A friend's account needs the available tester permissions; QR previews do
   not provide unrestricted public access.

DevTools may write your AppID into `project.config.json`. Keep that change
local. `project.private.config.json` is ignored. No AppSecret, server domain,
payment setup, backend deployment or public release is used by this prototype.

## Try

- Tap Pee, Poop or Ate to log an activity; Undo lasts six seconds.
- Expand/collapse day headings. Use the pencil to edit, or the bin to delete
  after a native confirmation. Date and time use WeChat's native pickers.
- Switch between Log and Timeline with the floating button. Timeline filters
  pee separately from poop/meals; tap a mark to inspect nearby logs and edit
  one in Log. Earlier days load in batches up to 210 days.
- Open the menu for Log, Timeline, Insights and Settings.
- Insights follows the current app: ten-day pee/poop frequency, daily ranges,
  typical gaps, and a monthly summary when history spans multiple months.
  Averages use recorded days; these describe logs, not care targets.
- Settings changes the puppy name and English/简体中文 language.
- **Settings → Try a sample journal** opens 501 sample logs over 21 days.
  **Return to my journal** restores the separate personal journal. Sample edits
  stay in the sample journal. The sample is a stress fixture, not a care routine.

Storage belongs only to this mini program on this device. Clearing its storage
removes the journal. Each journal is capped at 5,000 events and has no export or
recovery, so use it for testing. Native Puptime data is never read or modified.

## UI reference and scope

Reference: `main` at `b67bcfd` (November 12, 2026), particularly `App.tsx`,
`SideNavigation`, `QuickActions`, `EventRow`, `LogViewSwitch`, `TimelineScreen`
and `InsightsScreen`. The miniapp uses the same cream/forest palette, system
font, outline icons, spacing, compact quick actions, grouped day cards and
activity colours. Custom WeChat navigation keeps its required capsule and safe
area; the drawer lists the four implemented screens. A small “Sample” label
identifies the separate sample journal without displacing the main UI.

The editor has an explicit Save action. Timeline currently shows recorded
pee/poop/meal points with 15-minute buckets, nearby-point details, and no
inferred events or routine windows. Accounts/sync, sharing, puppy management,
routines, reminders, widgets, dictation, care articles, dark mode, Alipay and
public release are outside this experiment. This is a closer UI prototype,
not full functional parity with the native app.

Icons are PNG renders of the native app's bundled MaterialCommunityIcons font;
see `assets-LICENSE.txt`. The existing accent-ladder direction (seed 1620646728)
is subordinate to matching the app's own UI.

## Checks and shared analytics

```sh
node --test miniapps/wechat/tests/journal.test.cjs
node miniapps/wechat/scripts/build-analytics.cjs --check
```

The second command uses the repository's existing TypeScript dev dependency.
`build-analytics.cjs` extracts the original pure frequency/monthly functions
from `src/analytics.ts` and their helpers in `src/domain.ts`. Regenerate with
`node miniapps/wechat/scripts/build-analytics.cjs` when those functions change.
The generated CommonJS file is committed; DevTools needs no npm installation.

Seven Node tests cover persistence failures, personal/sample isolation, invalid
data/dates, exact edit timestamps, row-scoped updates, deletion failures, recorded-day statistics,
and timeline calendar/filter/bucket behavior. Official WXML/WXSS compilers pass.

Runtime verification uses official WeChat DevTools 2.02.2609250, WeChatLib
3.18.0, and its iPhone 12/13 (Pro) profile. The local journal contains 501 sample
logs. A runtime probe after the UI changes found 162 history-row components: typing a
note sent no history patches; saving patched only the edited row and changed
one component's event property. Fresh verification of the redesigned screens
is documented in the PR. Phone verification requires the owner's preview
scan. No Android or Alipay runtime has been tested.
