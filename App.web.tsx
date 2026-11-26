import { useEffect, useState, type ReactNode } from 'react';
import { LearnScreen } from './src/screens/LearnScreen';
import { careArticles } from './src/puppy-care';
import { websiteTheme } from './src/web/brand';
import { WebsiteMetadata } from './src/web/WebsiteMetadata';
import { WebsiteAnalytics } from './src/web/WebsiteAnalytics';
import { captureWebsiteEvent } from './src/web/telemetry';
import { marketingStyles } from './src/web/marketing-styles';
import { SiteFooter, SiteHeader } from './src/web/SiteChrome';
import { androidDownloadPath, sourceUrl } from './src/web/site-chrome';
import { handoffDevice, type HandoffDevice } from './src/web/app-link';

// Metro supplies web images as URI objects; keep them in the asset pipeline.
const assetUrl = (asset: string | { uri: string }): string => typeof asset === 'string' ? asset : asset.uri;
// Serve resized WebP derivatives from scripts/build-web-images.mjs; the widest file is the fallback.
type Asset = string | { uri: string };
const webImage = (...sources: [number, Asset][]) => ({ src: assetUrl(sources[sources.length - 1][1]), srcSet: sources.map(([width, asset]) => `${assetUrl(asset)} ${width}w`).join(', ') });
const screenSizes = '360px';
const puppy = webImage([520, require('./assets/web/scruffy-terrier-520.webp')], [760, require('./assets/web/scruffy-terrier-760.webp')], [1040, require('./assets/web/scruffy-terrier-1040.webp')]);
const careImage = assetUrl(require('./assets/web/potty-512.webp'));
const timingImage = webImage([360, require('./assets/web/timeline-routine-concept-360.webp')], [720, require('./assets/web/timeline-routine-concept-720.webp')]);
const routineImage = webImage([360, require('./assets/web/schedule-360.webp')], [720, require('./assets/web/schedule-720.webp')]);
const previews = [
  { name: 'Today', image: webImage([360, require('./assets/web/today-360.webp')], [720, require('./assets/web/today-720.webp')]), description: 'Keep potty breaks, meals, and notes together. Look back when you need to know what happened and when.' },
  { name: 'History', image: webImage([360, require('./assets/web/activity-360.webp')], [720, require('./assets/web/activity-720.webp')]), description: 'Look back through recorded days. Change a time, add a note, or export your activity as CSV.' },
  { name: 'Insights', image: webImage([360, require('./assets/web/insights-summary-360.webp')], [720, require('./assets/web/insights-summary-720.webp')]), description: 'See recorded activity counts and timing patterns across days, with possible missing logs clearly marked.' },
  { name: 'Routine', image: routineImage, description: 'Build a routine around your puppy. Review suggested times, make them your own, and choose optional reminders.' },
];

function PhoneFrame({ children, reveal = false }: { children: ReactNode; reveal?: boolean }) {
  return <div className="phone-frame" data-reveal={reveal || undefined}>
    <span className="phone-button phone-action" aria-hidden="true" />
    <span className="phone-button phone-volume-up" aria-hidden="true" />
    <span className="phone-button phone-volume-down" aria-hidden="true" />
    <span className="phone-button phone-power" aria-hidden="true" />
    <div className="phone-screen">{children}</div>
  </div>;
}

function SourceLink({ className = '' }: { className?: string }) {
  return <a className={className} href={sourceUrl} onClick={() => captureWebsiteEvent('website_cta', { destination: 'source' })}>View the source&nbsp;<span aria-hidden="true">↗</span></a>;
}

export default function MarketingSite({ path = '/' }: { path?: string }) {
  const [selected, setSelected] = useState(0);
  // Static HTML offers every platform; narrow to the visitor's phone after hydration.
  const [device, setDevice] = useState<HandoffDevice | null>(null);
  const learning = path === '/puppy-care' || path.startsWith('/puppy-care/');
  const articleId = path.startsWith('/puppy-care/') ? path.slice('/puppy-care/'.length) : null;

  useEffect(() => { setDevice(handoffDevice(navigator.userAgent, navigator.maxTouchPoints)); }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#puppy-care' || hash.startsWith('#puppy-care/')) {
      const target = hash.slice(1);
      if (target === 'puppy-care' || careArticles.some((article) => target === `puppy-care/${article.id}`)) {
        window.location.replace(target === 'puppy-care' ? '/puppy-care/' : `/${target}`);
      }
    }
  }, []);

  useEffect(() => {
    if (learning || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('arrived');
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.12 });
    document.querySelectorAll('.marketing-site [data-reveal]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [learning]);

  return <div className={`marketing-site${learning ? ' care-page' : ''}`} id="top">
    <style>{marketingStyles}</style>
    <WebsiteMetadata path={path} />
    <WebsiteAnalytics path={path} />
    <a className="skip-link" href="#main">Skip to content</a>
    <SiteHeader path={path} dark={!learning} />
    {learning ? <main id="main" className="learning-content"><LearnScreen theme={websiteTheme} articleId={articleId} onArticleChange={(id) => { window.location.assign(id ? `/puppy-care/${id}` : '/puppy-care/'); }} /></main> : <main id="main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">A little help with<br />potty training.</h1>
          <p>Log potty breaks, spot your puppy’s patterns, and build a daily routine with Puptime.</p>
          <div className="hero-actions" id="get-puptime">
            <div className="download-options">
              {device !== 'ios' && <a className="primary-action" href={androidDownloadPath} onClick={() => captureWebsiteEvent('website_cta', { destination: 'android_download' })}>Download for Android <span aria-hidden="true">↓</span></a>}
              {device !== 'android' && <p className="ios-status">iPhone app coming soon</p>}
            </div>
            {device !== 'ios' && <p className="apk-note">Installs from an APK file – allow installs from your browser when asked.</p>}
            <p className="hero-note">Free, with no account needed.</p>
            <a className="text-action" href="#app" onClick={() => captureWebsiteEvent('website_cta', { destination: 'app_preview' })}>See the app&nbsp;<span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <div className="hero-art"><img className="hero-puppy" {...puppy} sizes="(max-width: 600px) 370px, (max-width: 700px) 340px, 520px" alt="Puptime’s scruffy terrier, ready for the day" width="1024" height="1024" fetchPriority="high" /></div>
      </section>

      <section className="app-chapter chapter" id="app" aria-labelledby="app-title">
        <div className="preview-copy">
          <h2 id="app-title" data-reveal>Log a break</h2>
          <div className="preview-choices" role="group" aria-label="App screens" data-reveal>
            {previews.map((preview, index) => <button type="button" key={preview.name} aria-pressed={selected === index} aria-controls="app-preview" onClick={() => setSelected(index)}>{preview.name}</button>)}
          </div>
          <p className="preview-description" aria-live="polite" aria-atomic="true">{previews[selected].description}</p>
          <p className="small-copy">From the app, with example puppy logs.</p>
        </div>
        <figure className="app-preview" id="app-preview" data-reveal>
          <PhoneFrame><img key={selected} {...previews[selected].image} sizes={screenSizes} alt={`Puptime ${previews[selected].name} screen`} width="1206" height="2622" /></PhoneFrame>
          <figcaption>{previews[selected].name} on Puptime</figcaption>
        </figure>
      </section>

      <section className="rhythm-chapter chapter" aria-labelledby="rhythm-title">
        <div className="rhythm-intro">
          <h2 id="rhythm-title" data-reveal>Find your<br />rhythm</h2>
          <p data-reveal>See when your puppy usually needs to go, then make a routine you can adjust.</p>
        </div>
        <div className="rhythm-stories">
          <article className="rhythm-story">
            <h3 data-reveal>Spot the potty patterns</h3>
            <div className="story-content">
              <PhoneFrame reveal><img {...timingImage} sizes={screenSizes} alt="Illustrative Poop & Eat timeline concept with routine windows" width="851" height="1848" loading="lazy" /></PhoneFrame>
              <p data-reveal>Compare activity across recorded days. Look for recurring potty times.<small className="story-caption">Illustrative timeline concept with routine windows.</small></p>
            </div>
          </article>
          <article className="rhythm-story">
            <h3 data-reveal>A routine that fits</h3>
            <div className="story-content reverse">
              <PhoneFrame reveal><img {...routineImage} sizes={screenSizes} alt="Editable daily routine with activity times and optional reminders" width="1206" height="2622" loading="lazy" /></PhoneFrame>
              <p data-reveal>Review suggested times from your puppy’s history, then adjust each activity. Choose reminders for the routine you want to follow.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="care-chapter chapter" aria-labelledby="care-title">
        <div className="care-art" data-reveal><img src={careImage} alt="A golden puppy outside an open garden door, ready for a potty break" width="1024" height="1024" loading="lazy" /></div>
        <div className="care-copy">
          <h2 id="care-title" data-reveal>Growing up<br />together</h2>
          <p data-reveal>Toilet training is part of puppy life. Find practical guides on trips outside, meals, sleep, and settling in, with sources you can follow.</p>
          <div className="guide-links" data-reveal>
            <a href="/puppy-care/toilet-training">Toilet training</a>
            <a href="/puppy-care/getting-started">Getting started</a>
            <a href="/puppy-care/feeding">Feeding</a>
            <a href="/puppy-care/sleep-and-first-nights">Sleep & first nights</a>
          </div>
          <a className="text-action" href="/puppy-care/" data-reveal>All puppy care guides</a>
        </div>
      </section>

      <section className="local-chapter chapter" aria-labelledby="local-title">
        <h2 id="local-title" data-reveal>Local first.<br />Yours always.</h2>
        <div className="local-columns">
          <div data-reveal>
            <h3 id="cost-title">What it costs</h3>
            <dl className="cost-list" aria-labelledby="cost-title">
              <div><dt>Free</dt><dd>Logging, notes, history, insights, routines and reminders.</dd></div>
              <div><dt>Free during beta</dt><dd>Optional cloud backup and device sync, managed in the app. Your saved cloud data stays yours when sync is paused.</dd></div>
            </dl>
          </div>
          <div data-reveal>
            <h3>Why Puptime exists</h3>
            <p>I’m Patrick Chin, and I make Puptime. I built it as a simple way to see when a puppy last went and how their days are taking shape. Its routine suggestions come from plain statistics over your own logs, worked out on your phone.</p>
            <SourceLink className="text-action" />
          </div>
        </div>
        <ul className="trust-list" aria-label="Your data" data-reveal>
          <li>No ads</li><li>Works without an account</li><li>Public source code</li><li>Export your data as CSV</li>
        </ul>
      </section>

    </main>}
    <SiteFooter path={path} analytics backToTop />
  </div>;
}
