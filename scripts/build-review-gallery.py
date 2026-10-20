#!/usr/bin/env python3
"""Build the review gallery from recording metadata; terminal evidence stays text."""
import argparse
from datetime import datetime, timezone
import html
import json
from pathlib import Path
import re

CATALOG = Path(__file__).resolve().parents[1] / 'docs' / 'review-gallery-catalog.json'

STYLE = '''
.journey{border-bottom:1px solid var(--line);padding:12px 0}.journey>summary{font-size:20px;font-weight:650;min-height:48px}.journey article{border-bottom:0;padding:12px 0 20px}.review-list{padding-left:24px}.review-list li{padding:3px 0}.companion{padding:12px 0}#archive>summary{font-size:22px;font-weight:650}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:4px}

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
document.addEventListener('click', event => {
  if (event.target.closest('a[href^="#"]')) requestAnimationFrame(revealHash);
});
addEventListener('hashchange', revealHash); revealHash();
'''


def build(root, catalog=None):
    catalog = json.loads(CATALOG.read_text()) if catalog is None else catalog
    notes = catalog.get("review_notes", {})
    pending = catalog.get("pending_journeys", [])
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
    journeys = [journey for journey in catalog['journeys'] if journey['primary'] in native]
    historical = [journey for journey in catalog.get('historical_journeys', []) if journey['primary'] in native]
    selected = {journey[key] for journey in journeys + historical for key in ('primary', 'companion') if key in journey and journey[key] in native}
    previous = [item for stem, item in native.items() if stem not in selected]
    history_nav = '<a href="#historical-journeys">Historical review</a>' if historical else ''
    archive_nav = '<a href="#archive">Archive</a>' if previous or historical else ''
    parts = ['<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Puptime review</title>',
        f'<style>{STYLE}</style></head><body><aside><strong>Puptime review</strong><nav aria-label="Review sections"><a href="#journeys">Current journeys</a>{history_nav}{archive_nav}<a href="#test-results">Technical checks</a></nav></aside><main>',
        '<h1>Puptime review</h1><div id="journeys">']
    if journeys:
        parts.append('<p class="muted">Selected development journeys. Capture dates, build scopes and original results apply.</p><ol class="review-list">')
        parts.extend(f'<li><a href="#journey-{e(journey["primary"])}">{e(journey["title"])}</a></li>' for journey in journeys)
        parts.append('</ol>')
        if pending:
            parts.append(f'<details id="pending-journeys"><summary>{e(catalog.get("pending_label", "Pending journeys"))} ({len(pending)})</summary><ul>' + ''.join(f'<li>{e(title)}</li>' for title in pending) + '</ul></details>')
    else:
        parts.append('<h2>Current footage pending</h2><p class="muted">Qualified recordings will appear here when available.</p><p><a href="#archive">Browse evidence</a></p>')

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
        captured = datetime.fromtimestamp(data['started_at'], timezone.utc).strftime('%Y-%m-%d UTC') if data.get('started_at') else 'date in original details'
        provenance = f'Recorded {captured}' + (' · Recorded rerun' if data.get('recorded_rerun') else '')
        out = [f'<article id="{e(path.stem)}"><h2>{e(data["title"])}</h2><p class="muted">{e(data["scope"])}</p>',
            f'<video id="v-{e(path.stem)}" aria-label="{e(data["title"])}" controls playsinline preload="{preload}" src="{e(data["video"])}"></video>',
            f'<small><span class="status">{status(data)}</span> · {e(data.get("capture_kind", "Actual iOS recording"))} · {e(provenance)} · <a href="{e(data["log"])}">Test log</a> · <a href="{e(path.name)}">Details</a></small>']
        out.append(screenshots(data))
        if path.stem in notes:
            out.append(f'<p class="muted">{e(notes[path.stem])}</p>')
        chapters = [chapter for chapter in data.get('chapters', []) if chapter['title'].startswith('> Flow ')]
        if chapters:
            out.append('<details><summary>Jump to a step</summary><div class="chapters">')
            for chapter in chapters:
                seconds = float(chapter['seconds'])
                label = chapter['title'].removeprefix('> Flow ')
                out.append(f'<button data-video="v-{e(path.stem)}" data-seek="{seconds}">{int(seconds)//60}:{int(seconds)%60:02d} · {e(label)}</button>')
            out.append('</div></details>')
        return '\n'.join(out + ['</article>'])

    def render_journeys(entries, historical=False):
        for number, journey in enumerate(entries, 1):
            stem = journey['primary']
            featured = number == 1 and not historical
            opened = ' open' if featured else ''
            label = 'Historical · ' if historical else ''
            parts.append(f'<details class="journey" id="journey-{e(stem)}"{opened}><summary>{label}{number:02d} · {e(journey["title"])}</summary><p class="muted">{e(journey["description"])}</p>')
            parts.append(recording(*native[stem], featured=featured))
            companion = journey.get('companion')
            if companion in native:
                parts.append('<details class="companion"><summary>Companion: ' + e(native[companion][1]['title']) + '</summary>')
                parts.append(recording(*native[companion]))
                parts.append('</details>')
            parts.append('</details>')

    render_journeys(journeys)
    archived_count = len(native) - sum(1 + int(journey.get('companion') in native) for journey in journeys)
    archive_title = f'Archive · {archived_count} recordings · {len(terminal)} technical checks' if archived_count else f'Technical evidence · {len(terminal)} checks'
    archive_links = []
    if historical:
        archive_links.append('<a href="#historical-journeys">Historical review</a>')
    if previous:
        archive_links.append('<a href="#previous-captures">Browse app recordings</a>')
    archive_links.append('<a href="#test-results">Search technical checks</a>')
    parts.append('</div><section><details id="archive"><summary>' + archive_title + '</summary><p class="muted">Original scopes and results apply. Generated summaries identify their source and remaining checks.</p><p>' + ' · '.join(archive_links) + '</p>')
    if historical:
        parts.append('<section><details id="historical-journeys"><summary>Historical review (' + str(len(historical)) + ' earlier journeys)</summary><p class="muted">The former selection does not demonstrate the current cloud-development contract.</p>')
        render_journeys(historical, historical=True)
        parts.append('</details></section>')
    if previous:
        parts.append('<section><details id="previous-captures"><summary>More app recordings (' + str(len(previous)) + ')</summary>')
        parts.extend(recording(*item) for item in reversed(previous))
        parts.append('</details></section>')
    parts.append('<section><details id="test-results"><summary>Technical checks (' + str(len(terminal)) + ')</summary><label for="search-results">Search checks and full output</label><input id="search-results" type="search" placeholder="Search results…"><p id="result-count" class="muted" aria-live="polite">' + str(len(terminal)) + ' checks</p>')
    available_text = {path.stem for path, _ in terminal}
    links = [f'<a href="#{e(stem)}">{e(label)}</a>' for stem, label in catalog.get('evidence_links', []) if stem in available_text]
    if links:
        parts.append('<details><summary>Related service and preservation evidence</summary><p>' + ' · '.join(links) + '</p></details>')
    for path, data in reversed(terminal):
        log_path = root / data['log']
        output = log_path.read_text(errors='replace') if log_path.is_file() else 'Original log is unavailable.'
        kind = ' · Generated summary' if data.get('generated_summary') else ''
        parts.extend([f'<details class="result" id="{e(path.stem)}"><summary><span class="status">{status(data)}</span>{e(data["title"])}{kind}</summary><p class="muted">{e(data["scope"])}</p>',
            f'<small><a href="{e(data["log"])}">Open log</a> · <a href="{e(path.name)}">Details</a></small>'])
        if path.stem in notes:
            parts.append(f'<p class="muted">{e(notes[path.stem])}</p>')
        parts.extend([screenshots(data), f'<pre>{e(output)}</pre></details>'])
    parts.append('</details></section></details></section><footer>Browser seeking uses partial downloads. Each check and capture remains limited to its stated scope. This curation adds no new product qualification.</footer></main><script>' + SCRIPT + '</script></body></html>')
    (root / 'index.html').write_text('\n'.join(parts))
    print(f'Indexed {len(journeys)} current journeys, {len(historical)} historical journeys, {len(terminal)} text checks, {len(previous)} archived app captures.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', type=Path, default=Path(__file__).parent)
    build(parser.parse_args().directory.resolve())
