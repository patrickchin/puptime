import { useEffect, useState, type ReactNode } from 'react';
import { LearnScreen } from './src/screens/LearnScreen';
import { careArticles } from './src/puppy-care';
import { websiteTheme } from './src/web/brand';
import { WebsiteMetadata } from './src/web/WebsiteMetadata';
import { WebsiteAnalytics } from './src/web/WebsiteAnalytics';
import { captureWebsiteEvent } from './src/web/telemetry';
import { SiteFooter, SiteHeader } from './src/web/SiteChrome';
import { downloadPath, sourceUrl } from './src/web/site-chrome';

// Metro supplies web images as URI objects; keep them in the asset pipeline.
const assetUrl = (asset: string | { uri: string }): string => typeof asset === 'string' ? asset : asset.uri;
// Serve resized WebP derivatives from scripts/build-web-images.mjs; the widest file is the fallback.
type Asset = string | { uri: string };
const webImage = (...sources: [number, Asset][]) => ({ src: assetUrl(sources[sources.length - 1][1]), srcSet: sources.map(([width, asset]) => `${assetUrl(asset)} ${width}w`).join(', ') });
const screenSizes = '360px';
const puppy = webImage([520, require('./assets/web/scruffy-terrier-520.webp')], [760, require('./assets/web/scruffy-terrier-760.webp')], [1040, require('./assets/web/scruffy-terrier-1040.webp')]);
const careImage = assetUrl(require('./assets/web/potty-512.webp'));
const timingImage = webImage([360, require('./assets/web/timeline-poop-eat-360.webp')], [720, require('./assets/web/timeline-poop-eat-720.webp')]);
const routineImage = webImage([360, require('./assets/web/schedule-poop-eat-360.webp')], [720, require('./assets/web/schedule-poop-eat-720.webp')]);
const previews = [
  { name: 'Today', image: webImage([360, require('./assets/web/today-360.webp')], [720, require('./assets/web/today-720.webp')]), description: 'Log a pee, poop or meal in one tap.' },
  { name: 'History', image: webImage([360, require('./assets/web/activity-360.webp')], [720, require('./assets/web/activity-720.webp')]), description: 'Edit times, add notes, export CSV.' },
  { name: 'Insights', image: webImage([360, require('./assets/web/insights-summary-360.webp')], [720, require('./assets/web/insights-summary-720.webp')]), description: 'See counts and timing across days.' },
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
  const learning = path === '/puppy-care' || path.startsWith('/puppy-care/');
  const articleId = path.startsWith('/puppy-care/') ? path.slice('/puppy-care/'.length) : null;

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
    <WebsiteMetadata path={path} />
    <WebsiteAnalytics path={path} />
    <a className="skip-link" href="#main">Skip to content</a>
    <SiteHeader path={path} dark={!learning} />
    {learning ? <main id="main" className="learning-content"><LearnScreen theme={websiteTheme} articleId={articleId} onArticleChange={(id) => { window.location.assign(id ? `/puppy-care/${id}` : '/puppy-care/'); }} /></main> : <main id="main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">A little help with<br />potty training.</h1>
          <p>Log potty breaks, spot patterns, build a routine.</p>
          <div className="hero-actions">
            <a className="primary-action" href={downloadPath} onClick={() => captureWebsiteEvent('website_cta', { destination: 'get_puptime' })}>Get Puptime <span aria-hidden="true">→</span></a>
            <p className="hero-note">Free · No account needed</p>
          </div>
        </div>
        <div className="hero-art"><img className="hero-puppy" {...puppy} sizes="(max-width: 600px) 370px, (max-width: 700px) 340px, 520px" alt="Puptime’s scruffy terrier, ready for the day" width="1024" height="1024" fetchPriority="high" /></div>
      </section>

      <section className="app-chapter chapter" id="app" aria-labelledby="app-title">
        <div className="preview-copy">
          <h2 id="app-title" data-reveal>Take a look inside</h2>
          <div className="preview-choices" role="group" aria-label="App screens" data-reveal>
            {previews.map((preview, index) => <button type="button" key={preview.name} aria-pressed={selected === index} aria-controls="app-preview" onClick={() => setSelected(index)}>{preview.name}</button>)}
          </div>
          <p className="preview-description" aria-live="polite" aria-atomic="true">{previews[selected].description}</p>
        </div>
        <figure className="app-preview" id="app-preview" data-reveal>
          <PhoneFrame>{previews.map((preview, index) => <img key={preview.name} className="preview-shot" data-active={selected === index} aria-hidden={selected !== index || undefined} {...preview.image} sizes={screenSizes} alt={selected === index ? `Puptime ${preview.name} screen with example logs` : ''} width="1206" height="2622" />)}</PhoneFrame>
        </figure>
      </section>

      <section className="rhythm-chapter chapter" aria-labelledby="rhythm-title">
        <h2 id="rhythm-title" data-reveal>Find your rhythm</h2>
        <div className="rhythm-stories">
          <article className="rhythm-story">
            <h3 data-reveal>Spot the potty patterns</h3>
            <div className="story-content">
              <PhoneFrame reveal><img {...timingImage} sizes={screenSizes} alt="Puptime Poop & Eat timeline of recorded days where poops often follow breakfast and dinner" width="1206" height="2622" loading="lazy" /></PhoneFrame>
              <p data-reveal>Meals and poops, day by day.</p>
            </div>
          </article>
          <article className="rhythm-story">
            <h3 data-reveal>A routine that fits</h3>
            <div className="story-content">
              <PhoneFrame reveal><img {...routineImage} sizes={screenSizes} alt="Editable daily routine with meal and poop times and optional reminders" width="1206" height="2622" loading="lazy" /></PhoneFrame>
              <p data-reveal>Suggested from your logs. Adjust any time.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="care-chapter chapter" aria-labelledby="care-title">
        <div className="care-art" data-reveal><img src={careImage} alt="A golden puppy outside an open garden door, ready for a potty break" width="1024" height="1024" loading="lazy" /></div>
        <div className="care-copy">
          <h2 id="care-title" data-reveal>Growing up<br />together</h2>
          <p data-reveal>Short, sourced guides for the first months.</p>
          <div className="guide-links" data-reveal>
            <a href="/puppy-care/toilet-training">Toilet training</a>
            <a href="/puppy-care/getting-started">Getting started</a>
            <a href="/puppy-care/feeding">Feeding</a>
            <a href="/puppy-care/sleep-and-first-nights">Sleep & first nights</a>
          </div>
          <a className="text-action" href="/puppy-care/" data-reveal>All puppy care guides</a>
        </div>
      </section>

      <section className="local-chapter chapter" aria-labelledby="price-title">
        <h2 id="price-title" data-reveal>Free to use.</h2>
        <p className="price-line" data-reveal>Logging, history, insights and routines are free. Cloud backup is free during the beta.</p>
        <ul className="trust-list" data-reveal>
          <li>No ads</li><li>Export as CSV</li>
        </ul>
        <p className="maker-line" data-reveal>Made by Patrick Chin · <SourceLink /></p>
      </section>

    </main>}
    <SiteFooter path={path} analytics backToTop />
  </div>;
}
