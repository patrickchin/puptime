#!/usr/bin/env python3
"""Build the review gallery from recording metadata; terminal evidence stays text."""
import argparse
import html
import json
from pathlib import Path
import re

CURRENT_JOURNEYS = [
    '330-ios-cloud-export-local',
    '331-ios-cloud-export-inline-feedback',
    '195-clean-first-open-and-timed-reminder',
    '188-drawer-and-native-timer-journeys',
    '194-terrier-full-first-open-and-recovery',
    '191-terrier-full-first-open-appearance',
    '206-notifications-native-keyboard-accessibility',
    '198-drawer-populated-history-rendering',
    '199-navigation-upgrade-preserves-owned-history',
    '222-ios-navigation-reduce-motion',
    '209-navigation-full-standalone-regression',
]

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
        '<h1>See Puptime in action</h1><p class="muted">Current iOS journeys, with test results below. Synthetic data; private sign-in steps are omitted.</p><div id="journeys">']

    def status(data):
        return 'EXPECTED RED' if data.get('expected_failure') else 'PASS' if data['exit_code'] == 0 else 'FAILED'

    def recording(path, data, featured=False):
        preload = "metadata" if featured else "none"
        poster = ' poster="first-launch-final-welcome.png"' if path.stem == '160-standalone-full-setup-and-permissions' and (root / 'first-launch-final-welcome.png').is_file() else ''
        out = [f'<article id="{e(path.stem)}"><h2>{e(data["title"])}</h2><p class="muted">{e(data["scope"])}</p>',
            f'<video id="v-{e(path.stem)}" aria-label="{e(data["title"])}" controls playsinline preload="{preload}"{poster} src="{e(data["video"])}"></video>',
            f'<small><span class="status">{status(data)}</span> · Actual iOS recording · <a href="{e(data["log"])}">Test log</a> · <a href="{e(path.name)}">Details</a></small>']
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
            f'<small><a href="{e(data["log"])}">Open log</a> · <a href="{e(path.name)}">Details</a></small><pre>{e(output)}</pre></details>'])
    parts.append('</section><section id="previous-captures"><details><summary>Previous app captures (' + str(len(previous)) + ')</summary><p class="muted">Earlier iterations and diagnostic runs; retained for traceability.</p>')
    parts.extend(recording(*item) for item in reversed(previous))
    parts.append('</details></section><footer>Browser seeking uses partial downloads. Service acceptance is limited to each check’s stated scope.</footer></main><script>' + SCRIPT + '</script></body></html>')
    (root / 'index.html').write_text('\n'.join(parts))
    print(f'Indexed {len(current)} current journeys, {len(terminal)} text checks, {len(previous)} previous app captures.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', type=Path, default=Path(__file__).parent)
    build(parser.parse_args().directory.resolve())
