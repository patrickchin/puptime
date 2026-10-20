#!/usr/bin/env python3
"""Build the review gallery from recording metadata; terminal evidence stays text."""
import argparse
import html
import json
from pathlib import Path
import re

CURRENT_JOURNEYS = [
    '260-live-account-setup',
    '263-live-puppy-restore-log-and-reopen',
    '267-live-incoming-sync-without-refresh',
    '298-google-session-ready-cold-restart',
    '320-apple-session-ready-cold-restart',
    '275-google-native-start',
    '276-google-native-cancel',
    '279-existing-account-provider-controls',
    '306-web-account-review',
    '309-web-account-deletion-unconfirmed',
    '310-web-account-deletion-confirmed',
    '313-web-inflight-deletion',
    '314-web-deletion-recovery',
    '315-web-export-owner-guard',
    '327-apple-account-deletion',
    '195-clean-first-open-and-timed-reminder',
    '188-drawer-and-native-timer-journeys',
    '194-terrier-full-first-open-and-recovery',
    '191-terrier-full-first-open-appearance',
    '206-notifications-native-keyboard-accessibility',
    '198-drawer-populated-history-rendering',
    '199-navigation-upgrade-preserves-owned-history',
    '222-ios-navigation-reduce-motion',
    '240-ios-history-local-standalone-small',
    '280-owned-cloud-history-paging',
    '283-owned-history-remote-stale',
    '284-owned-history-saved-restore-verified',
    '285-history-small-maximum-text',
    '285-confirmation-scroll-context-green',
    '285-confirmation-owned-render-proof',
    '288-owned-update-history-verified',
    '288-backup-restored-owned-history-verified',
    '288-history-accessibility-label-green-verified',
    '289-history-default-standalone-local',
    '289-history-default-standalone-regression-final',
    '330-ios-cloud-export-local',
    '331-ios-cloud-export-inline-feedback',
    '334-ios-cloud-export-live',
    '340-ios-delete-confirmation',
    '344-ios-delete-standalone-https',
    '345-ios-delete-lost-reply',
    '346-ios-delete-layout-matrix',
    '347-ios-modal-diagnostic',
]

REVIEW_NOTES = {
    '248-cloud-enabled-signed-in-ios': 'Previous local-backend qualification. This recording proves the local SDK journey; the featured live recordings above use the deployed Pages API.',
    '259-live-account-setup': 'Diagnostic failure: the initial welcome tap did not open the profile step. No email request occurred; local data remained unchanged. The successful retry is recording260.',
    '262-live-puppy-restore-log-and-reopen': 'Diagnostic failure: Maestro rejected the unsupported settleTimeoutMs property before any actions. Before/after SQLite snapshots were identical: verified sign-in, zero events, owner and outbox. Recording263 passed after removing that test property.',
    '274-google-first-open-configured': 'Diagnostic failure: the UI assertions passed, then an unsupported absolute screenshot path failed. Recording 275 resumed with a relative screenshot path and no data reset.',
    '275-google-native-start': 'Earlier signed iOS first-open Google handoff and system confirmation. This clip has no credential entry. The later completed real-provider session is qualified separately in 298.',
    '276-google-native-cancel': 'Cancelling the system Google handoff returns to the same account step with a useful retry message. Proof 277 compares every SQLite table; this does not claim completed Google sign-in.',
    '281-owned-cloud-history-stale': 'Diagnostic failure: the independent local HTTP peer hit a stale Node socket after the UI preparation. No remote mutation was sent. Recording 283 passed after the qualifier stopped reusing that socket.',
    '282-owned-history-stale-confirmation': 'Diagnostic failure: the qualifier used a detail-note ID in the confirmation. Interrupted before the remote mutation; the corrected confirmation ID passed in 283.',
    '284-owned-history-offline-reconnect': 'Diagnostic failure after the saved restore had been acknowledged once: the qualifier counted historical changes as current logs. The distinct-current-record count and exact saved-operation readback pass in284-owned-history-saved-restore-verified; the restore was not replayed.',
    '284-owned-history-offline-readback': 'Diagnostic failure: independent server/local data checks passed, then the unconfirmed menu tap missed. The completed read-only retry uses bounded drawer/Settings waits; no second restore was submitted.',
    '284-owned-history-saved-restore-verified': 'Read-only completion of the actual offline restoration in 284-owned-history-offline-reconnect. The unique saved operation was accepted once; all 1,001 current cloud logs match local data. No restoration replay or reseeding.',
    '285-history-small-preserved-appearance': 'Diagnostic run: complete standard English/light and Spanish/dark cases passed with all tables unchanged. The next Chinese-language driver failed to start before UI actions; original preferences were restored. Chinese passes in the next capture, and all maximum-text cases are recorded separately.',
    '285-history-small-remaining-appearance': 'Diagnostic run: the complete standard Chinese case passed. Maximum-text English then remained on the correct version card after a tap; all data and preferences were preserved. Settling the scroll before the bounded tap passed in the subsequent maximum-text capture.',
    '285-history-small-maximum-text': 'Three maximum-text journeys on the signed default standalone, using the real language picker and retained system theme. Standard English/light and Spanish/dark passed in the first 285 capture; standard Chinese passed in the second. Earlier test-driver/tap failures remain diagnostic records.',
    '288-owned-completed-installation-history': 'Diagnostic run: the signed update and full walkthrough replay passed with all 14 tables and server count unchanged. The final Recent changes row tap missed. The settled read-only selection passed in the recorded rerun; no fixture reset or restoration.',
    '288-owned-update-history-verified': 'The exact preserved 1,002-log account survives the signed update, walkthrough replay and read-only Recent changes/local-version navigation. The selected version is identical to current data, so this fixture verifies Back rather than a restore confirmation; Cancel is covered by the other history journeys.',
    '279-existing-account-provider-controls': 'Both Connect cards appear on the retained live account with three logs and Up to date. No provider credential, Connect, enrollment or logout action was taken. Text proofs 291/292 compare all 14 tables before launch and after viewing.',
    '290-retained-account-before-launch': 'Diagnostic failure: the qualifier assumed installation would keep the same data-container path. iOS relocated the container. Proof 291 resolves the selected device’s current container and compares every table and full row to the preserved pre-install backup; proof 292 repeats that comparison after viewing the provider controls.',
    '296-google-session-cold-restart': 'Earlier restart capture checks control presence; its last frame still shows loading. The stronger 298 recording waits for both cloud choices to be enabled after cold restart. Both preserve the signed-in account without activating cloud.',
    '298-google-session-ready-cold-restart': 'Actual completed Google OAuth used the installed SDK and deployed service; private provider interaction is omitted. This post-auth recording cold-restarts the standalone and waits for both cloud choices to be enabled. Proofs 294/295/299 verify the genuine deployed identity/session and preserved local data. No trial, puppy enrollment, upload or provider linking was performed.',
    '320-apple-session-ready-cold-restart': 'Actual completed Sign in with Apple used the approved Hide My Email choice and installed SDK. Private provider interaction is omitted. Both cloud choices are enabled after standalone cold restart; proofs 321/322 preserve local data, and 323 verifies separate real Apple/Google identities and sessions. No trial, enrollment, upload or account linking occurred.',
    '289-history-default-standalone-local': 'The actual CI entry script passes on a fresh task-owned simulator using integrated signed bundle c0c9 after merged provider changes. Populated draft/save, paging, Cancel, stale-edit rejection, actual SQLite rollback/retry, one restore despite repeated taps and deleted estimated-log recovery all pass with unrelated records preserved. No account, backend, or retained fixture is used.',
    '289-history-default-standalone-regression': 'Diagnostic full run: 11 of 13 flows passed. Navigation and simple-log both stopped in the shared profile Not now helper before their feature assertions; the profile remained visible after the unsettled tap. This failed run is retained. Settled/enabled helper qualification and a fresh complete suite are separate recordings.',
    '289-history-default-standalone-regression-verified': 'Diagnostic second run: 12 of 13 flows passed, including the corrected profile helper. A separate walkthrough Next tap stayed on practice step 0. The capture and strict step-1 failure remain retained; the from-step-guarded transition and final complete suite are separate qualifications.',
    '289-history-default-standalone-regression-final': 'All 13 configured flows pass on the integrated signed c0c9 build: full first-open setup and practice/replay, preferences, logging, routines, Notifications, timed reminders, populated views, CSV cancellation, guide audio and themes. Thirteen chapters use actual command timestamps. The later f0a8 build changes only the shared spoken history-row label and has separate targeted accessibility qualification.',
    '288-backup-restored-owned-history': 'Diagnostic failure: the new fixture passed schema and 1,002-log preflight, then the Recent changes tap remained on Settings. All 14 tables and original raw backup hashes were unchanged. The same fixture passed the bounded settled retry without copying or seeding again.',
    '288-backup-restored-owned-history-verified': 'The signed c0c9 build passes read-only Recent changes, local version selection and Back on a NEW synthetic fixture copied from the preserved 1,002-log backup. Every table, owner, outbox, mirror and cursor is unchanged; the three unopened original backup hashes remain exact. This is neither the deleted original device’s in-place upgrade nor restored authentication/cloud-sync proof.',
    '288-history-accessibility-label-red': 'Expected RED on c0c9: the actual native row label contains only date/source/change details and omits the event name and note. The row exists; the precise combined-label assertion fails. Every table and original backup hash remains unchanged.',
    '288-history-accessibility-label-green': 'Diagnostic preflight failure before app launch: CoreSimulator returned a stale bundle-container path immediately after the signed update. The actual installed bundle had the expected f0a8 hash. The next bounded read-only lookup/qualification is recorded separately; no data reset or repair occurred.',
    '288-history-accessibility-label-green-verified': 'The signed f0a8 correction reuses the visible event/custom label and note in the spoken row label. Actual native hierarchy assertions pass for both Recent changes and local-version rows, followed by detail and Back. The SAME backup-restored 1,002-log fixture preserves all 14 tables, owner/outbox and original raw hashes. The earlier c0c9 full13 result remains scoped to that build; no layout, storage or navigation behavior changed.',
    '285-confirmation-scroll-context-red': 'Expected RED on the previous signed build: the maximum-text confirmation retained the detail scroll offset and hid its explanation. The translated explanation-visible assertion failed before any restoration; the database and original preferences were preserved.',
    '285-confirmation-scroll-context-green': 'The final signed build resets only the local history pane when opening confirmation. The explanation-visible regression, full maximum-text journeys and all-table read-only checks run in English, Spanish and Chinese.',
}

STYLE = '''
:root{color-scheme:light;--ink:#18372f;--muted:#536b62;--line:#dce5db;--paper:#fbfcf8;--accent:#28654c}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,sans-serif}a{color:var(--accent);text-underline-offset:3px}aside{position:fixed;inset:0 auto 0 0;width:220px;padding:36px 24px;border-right:1px solid var(--line);background:#eef3e9}aside strong{font-size:20px}nav{display:grid;gap:16px;margin-top:36px}main{max-width:1000px;margin-left:220px;padding:36px 48px 80px}h1{font-size:34px;letter-spacing:-1px;margin:0 0 10px}h2{font-size:22px;letter-spacing:-.4px;margin:0 0 6px}p{margin:0 0 20px}.muted,small{color:var(--muted)}article{padding:28px 0 36px;border-bottom:1px solid var(--line);scroll-margin-top:20px}video{display:block;max-width:100%;width:auto;max-height:640px;background:#18372f;border-radius:16px;margin:16px 0}small{display:block;margin:12px 0}.status{font-size:12px;letter-spacing:.7px;font-weight:700}.chapters{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.chapters button,button{font:inherit;color:var(--accent);background:#eaf1e7;border:1px solid var(--line);border-radius:8px;padding:7px 10px;cursor:pointer}.chapters button{font-size:13px}.chapters summary{color:var(--muted)}summary{cursor:pointer;padding:10px 0}section{margin-top:48px}input[type=search]{font:inherit;width:100%;padding:12px;border:1px solid #a3b7a9;border-radius:10px;margin:12px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:#edf2eb;padding:18px;border-radius:10px;max-height:65vh;overflow:auto}.result{border-bottom:1px solid var(--line)}.result small{margin:0 0 12px}.result summary{font-weight:600}.result .status{margin-right:10px}footer{margin-top:40px;font-size:13px;color:var(--muted)}[hidden]{display:none!important}@media(max-width:760px){aside{position:static;width:auto;padding:20px 22px;border-bottom:1px solid var(--line);border-right:0}nav{display:flex;gap:18px;margin-top:12px;flex-wrap:wrap}main{margin:0;padding:28px 22px}h1{font-size:29px}video{max-height:70vh}}
'''
SCRIPT = '''
for (const button of document.querySelectorAll('[data-seek]')) {
  button.addEventListener('click', () => {
    const video = document.getElementById(button.dataset.video);
    const seek = () => { video.currentTime = Math.min(Number(button.dataset.seek), video.duration); video.play().catch(() => {}); };
    if (video.readyState) seek();
    else { video.addEventListener('loadedmetadata', seek, {once:true}); video.load(); }
  });
}
const search = document.getElementById('search-results');
search.addEventListener('input', () => {
  const query = search.value.trim().toLowerCase();
  let count = 0;
  for (const result of document.querySelectorAll('.result')) {
    const matches = !query || result.textContent.toLowerCase().includes(query);
    result.hidden = !matches;
    result.open = Boolean(query && matches);
    count += Number(matches);
  }
  document.getElementById('result-count').textContent = count + (count === 1 ? ' check' : ' checks');
});
function revealHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = document.getElementById(id);
  if (!target) return;
  target.hidden = false;
  for (let parent = target; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
  requestAnimationFrame(() => target.scrollIntoView());
}
addEventListener('hashchange', revealHash); revealHash();
'''


def build(root):
    e = html.escape
    items = []
    for path in root.glob('*.json'):
        if not re.match(r'^\d+-', path.name):
            continue
        data = json.loads(path.read_text())
        if {'title', 'scope', 'exit_code', 'log'} <= data.keys():
            items.append((path, data))
    items.sort(key=lambda item: (int(item[0].name.split('-')[0]), item[0].name))
    terminal = [(p, d) for p, d in items if d.get('rendered_actual_output') or not d.get('video') or not (root / d['video']).is_file()]
    native = {p.stem: (p, d) for p, d in items if d.get('video') and not d.get('rendered_actual_output') and (root / d['video']).is_file()}
    current = [native[stem] for stem in CURRENT_JOURNEYS if stem in native]
    previous = [item for stem, item in native.items() if stem not in CURRENT_JOURNEYS]
    parts = ['<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Puptime review</title>',
        f'<style>{STYLE}</style></head><body><aside><strong>Puptime review</strong><nav aria-label="Review sections"><a href="#journeys">App journeys</a><a href="#test-results">Test results</a><a href="#previous-captures">Previous captures</a></nav></aside><main>',
        '<h1>See Puptime in action</h1><p class="muted">Start with live iOS account setup, puppy restore and incoming sync. The web account recordings use isolated local fixtures. Private code entry is omitted; each recording states its scope.</p><div id="journeys">']

    live_proof = [
        ('265-live-native-independent-database-proof', 'Genuine email session: native and live database agree'),
        ('258-pages-live-database-sync', 'Live service matrix: 1000 events, reconnect, restore and conflicts'),
        ('273-google-staging-configuration', 'Deployed Google configuration and callback guards'),
        ('277-google-cancel-sql-preservation', 'Google cancellation preserves every local table'),
        ('278-apple-google-staging-configuration', 'Both deployed provider starts and callback guards'),
        ('291-retained-account-before-launch', 'Signed update preserves the live account before launch'),
        ('292-retained-account-after-provider-view', 'Viewing Connect cards preserves all live account data'),
        ('293-apple-keychain-signing-verification', 'Private Apple signing key and client-secret validation'),
        ('294-google-real-sign-in-local-preservation', 'Real Google sign-in preserves local data'),
        ('295-google-live-identity-readback', 'Deployed Google identity and session readback'),
        ('299-google-ready-restart-data-preservation', 'Ready Google restart preserves every local table'),
        ('321-apple-real-sign-in-local-preservation', 'Real Apple sign-in preserves local data'),
        ('322-apple-ready-restart-data-preservation', 'Ready Apple restart preserves every local table'),
        ('323-apple-google-live-identity-isolation', 'Deployed Apple and Google identities remain separate'),
        ('318-web-local-browser-matrix', 'Web: sixteen-case local browser matrix'),
        ('316-web-stale-deletion-marker-guard', 'Web final fix: stale-tab deletion guard'),
        ('319-web-mature-cookie-reauthentication', 'Web final fix: mature-cookie renewal'),
        ('317-web-source-media-preservation', 'Frozen web source and review screenshots'),
        ('324-staging-rollout-review', 'Web backend staging rollout and anonymous route guards'),
        ('325-cloud-export-stream-contract', 'Native export stream contract: focused tests only'),
        ('326-apple-deletion-local-review', 'Apple-linked local deletion and owner-isolation proof'),
        ('328-cloud-account-deletion-regression', 'Account-deletion code regression checks'),
        ('329-cloud-export-code-and-scale-checks', 'Cloud export code and100,000-revision local runtime proof'),
        ('287-history-restacked-code-checks', 'Restacked history code checks'),
        ('287-history-confirm-scroll-code-checks', 'Final scroll correction code checks'),
        ('287-history-pr103-integrated-code-checks', 'History integrated with merged provider changes'),
        ('288-owned-update-sql-preservation', 'Completed account matches its original pre-boot database'),
        ('288-history-accessibility-observed', 'Actual native history labels and all-table preservation'),
        ('289-local-history-service-restacked', 'Local history HTTP and SQL acceptance'),
    ]
    available_text = {path.stem for path, _ in terminal}
    links = [f'<a href="#{e(stem)}">{e(label)}</a>' for stem, label in live_proof if stem in available_text]
    if links:
        parts.append('<p class="muted">Read the evidence: ' + ' · '.join(links) + '. The service matrix uses synthetic fixture sessions; genuine email sign-in is checked separately.</p>')

    def status(data):
        return 'EXPECTED RED' if data.get('expected_failure') else 'PASS' if data['exit_code'] == 0 else 'FAILED'

    def screenshots(data):
        shots = [shot for shot in data.get('screenshots', []) if (root / shot['file']).is_file()]
        if not shots:
            return ''
        return '<details><summary>Review screenshots</summary>' + ''.join(
            f'<figure><a href="{e(shot["file"])}"><img src="{e(shot["file"])}" alt="{e(shot["title"])}" loading="lazy" style="max-width:100%;max-height:560px"></a><figcaption>{e(shot["title"])}</figcaption></figure>'
            for shot in shots) + '</details>'

    def recording(path, data, featured=False):
        preload = "metadata" if featured else "none"
        poster = ' poster="first-launch-final-welcome.png"' if path.stem == '160-standalone-full-setup-and-permissions' and (root / 'first-launch-final-welcome.png').is_file() else ''
        out = [f'<article id="{e(path.stem)}"><h2>{e(data["title"])}</h2><p class="muted">{e(data["scope"])}</p>',
            f'<video id="v-{e(path.stem)}" aria-label="{e(data["title"])}" controls playsinline preload="{preload}"{poster} src="{e(data["video"])}"></video>',
            f'<small><span class="status">{status(data)}</span> · {e(data.get("capture_kind", "Actual iOS recording"))} · <a href="{e(data["log"])}">Test log</a> · <a href="{e(path.name)}">Details</a></small>']
        out.append(screenshots(data))
        if path.stem in REVIEW_NOTES:
            out.append(f'<p class="muted">{e(REVIEW_NOTES[path.stem])}</p>')
        if path.stem == '195-clean-first-open-and-timed-reminder':
            out.append('<p class="muted">This earlier reminder journey uses a cloud-disabled build. The featured live setup and restore recordings use the deployed Pages API.</p>')
        chapters = [chapter for chapter in data.get('chapters', []) if chapter['title'].startswith('> Flow ')]
        if chapters:
            out.append('<details><summary>Jump to a step</summary><div class="chapters">')
            for chapter in chapters:
                seconds = float(chapter['seconds'])
                label = chapter['title'].removeprefix('> Flow ')
                out.append(f'<button data-video="v-{e(path.stem)}" data-seek="{seconds}">{int(seconds)//60}:{int(seconds)%60:02d} · {e(label)}</button>')
            out.append('</div></details>')
        return '\n'.join(out + ['</article>'])

    parts.extend(recording(*item, featured=True) for item in current)
    parts.append('</div><section id="test-results"><h2>Test results</h2><label for="search-results">Search checks and full output</label><input id="search-results" type="search" placeholder="Search results…"><p id="result-count" class="muted" aria-live="polite">' + str(len(terminal)) + ' checks</p>')
    for path, data in reversed(terminal):
        log_path = root / data['log']
        output = log_path.read_text(errors='replace') if log_path.is_file() else 'Original log is unavailable.'
        parts.extend([f'<details class="result" id="{e(path.stem)}"><summary><span class="status">{status(data)}</span>{e(data["title"])}</summary><p class="muted">{e(data["scope"])}</p>',
            f'<small><a href="{e(data["log"])}">Open log</a> · <a href="{e(path.name)}">Details</a></small>'])
        if path.stem in REVIEW_NOTES:
            parts.append(f'<p class="muted">{e(REVIEW_NOTES[path.stem])}</p>')
        parts.append(screenshots(data))
        parts.append(f'<pre>{e(output)}</pre></details>')
    parts.append('</section><section id="previous-captures"><details><summary>Previous app captures (' + str(len(previous)) + ')</summary><p class="muted">Earlier iterations and diagnostic runs; retained for traceability.</p>')
    parts.extend(recording(*item) for item in reversed(previous))
    parts.append('</details></section><footer>Browser seeking uses partial downloads. Service acceptance is limited to each check’s stated scope.</footer></main><script>' + SCRIPT + '</script></body></html>')
    (root / 'index.html').write_text('\n'.join(parts))
    print(f'Indexed {len(current)} current journeys, {len(terminal)} text checks, {len(previous)} previous app captures.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', type=Path, default=Path(__file__).parent)
    build(parser.parse_args().directory.resolve())
