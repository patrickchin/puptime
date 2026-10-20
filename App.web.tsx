import { useEffect, useState } from 'react';
import { LearnScreen } from './src/screens/LearnScreen';
import { careArticles } from './src/puppy-care';
import { lightTheme } from './src/theme';
import { WebsiteMetadata } from './src/web/WebsiteMetadata';
import { openAnalyticsSettings, WebsiteAnalytics } from './src/web/WebsiteAnalytics';
import { captureWebsiteEvent } from './src/web/telemetry';
import { marketingStyles } from './src/web/marketing-styles';

const sourceUrl = 'https://github.com/patrickchin/puptime';
const privacyUrl = `${sourceUrl}/blob/main/PRIVACY.md`;
// Metro supplies web images as URI objects; keep them in the asset pipeline.
const assetUrl = (asset: string | { uri: string }): string => typeof asset === 'string' ? asset : asset.uri;
const icon = assetUrl(require('./assets/puptime-icon.png'));
const puppy = assetUrl(require('./assets/mascots/scruffy-terrier.png'));
const careImage = assetUrl(require('./assets/puppy-care/home.jpg'));
const timingImage = assetUrl(require('./assets/screenshots/insights-timeline.png'));
const routineImage = assetUrl(require('./assets/screenshots/schedule.png'));
const previews = [
  { name: 'Today', image: assetUrl(require('./assets/screenshots/today.png')), description: 'Keep potty breaks, meals, and notes together. Look back when you need to know what happened and when.' },
  { name: 'History', image: assetUrl(require('./assets/screenshots/activity.png')), description: 'Look back through recorded days. Change a time, add a note, or export your activity as CSV.' },
  { name: 'Insights', image: assetUrl(require('./assets/screenshots/insights-summary.png')), description: 'See recorded activity counts and timing patterns across days, with possible missing logs clearly marked.' },
  { name: 'Routine', image: routineImage, description: 'Build a routine around your puppy. Review suggested times, make them your own, and choose optional reminders.' },
];

function SourceLink({ className = '', children = 'View the source' }: { className?: string; children?: string }) {
  return <a className={className} href={sourceUrl} onClick={() => captureWebsiteEvent('website_cta', { destination: 'source' })}>{children}</a>;
}

function Header({ learning = false }: { learning?: boolean }) {
  return <header className="site-header">
    <a className="site-brand" href="/" aria-label="Puptime home"><img src={icon} width="38" height="38" alt="" />Puptime</a>
    <nav aria-label="Website">
      <a className="product-nav" href={learning ? '/#app' : '#app'}>The app</a>
      <a href="/puppy-care/">Puppy care</a>
      <a href="/account">Account</a>
    </nav>
  </header>;
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
    <style>{marketingStyles}</style>
    <WebsiteMetadata path={path} />
    <WebsiteAnalytics path={path} />
    <a className="skip-link" href="#main">Skip to content</a>
    <Header learning={learning} />
    {learning ? <main id="main" className="learning-content"><LearnScreen theme={lightTheme} articleId={articleId} onArticleChange={(id) => { window.location.assign(id ? `/puppy-care/${id}` : '/puppy-care/'); }} /></main> : <main id="main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">Puppy days,<br />remembered.</h1>
          <p>Puptime is a puppy log for potty breaks, meals, walks, and everything you want to remember.</p>
          <a className="primary-action" href="#app">See the app <span aria-hidden="true">↘</span></a>
          <p className="hero-note">Free local logging. No account needed.</p>
        </div>
        <div className="hero-art"><img className="hero-puppy" src={puppy} alt="Puptime’s scruffy terrier, ready for the day" width="1024" height="1024" fetchPriority="high" /></div>
      </section>

      <section className="app-chapter chapter" id="app" aria-labelledby="app-title">
        <div className="preview-copy">
          <h2 id="app-title" data-reveal>A day,<br />all together</h2>
          <div className="preview-choices" role="group" aria-label="App screens" data-reveal>
            {previews.map((preview, index) => <button type="button" key={preview.name} aria-pressed={selected === index} aria-controls="app-preview" onClick={() => setSelected(index)}>{preview.name}<span aria-hidden="true">↗</span></button>)}
          </div>
          <p className="preview-description" aria-live="polite" aria-atomic="true">{previews[selected].description}</p>
          <p className="small-copy">Screens from the offline release.</p>
        </div>
        <figure className="app-preview" id="app-preview" data-reveal>
          <img key={selected} src={previews[selected].image} alt={`Puptime ${previews[selected].name} screen`} width="430" height="932" />
          <figcaption>{previews[selected].name} on Puptime</figcaption>
        </figure>
      </section>

      <section className="rhythm-chapter chapter" aria-labelledby="rhythm-title">
        <div className="rhythm-intro">
          <h2 id="rhythm-title" data-reveal>Find your<br />rhythm</h2>
          <p data-reveal>Yesterday’s little moments can help you make sense of today.</p>
        </div>
        <div className="rhythm-stories">
          <article className="rhythm-story">
            <h3 data-reveal>Patterns over time</h3>
            <div className="story-content">
              <img src={timingImage} alt="Puptime timeline comparing activity times across ten days" width="430" height="932" loading="lazy" data-reveal />
              <p data-reveal>Compare activity across 10, 20, or 30 days. See when things tend to happen, with estimates kept separate from recorded logs.</p>
            </div>
          </article>
          <article className="rhythm-story">
            <h3 data-reveal>A routine that fits</h3>
            <div className="story-content reverse">
              <img src={routineImage} alt="Editable daily routine with activity times and optional reminders" width="430" height="932" loading="lazy" data-reveal />
              <p data-reveal>Set your own times or review suggestions from your history. Adjust each activity and choose which reminders you want.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="care-chapter chapter" aria-labelledby="care-title">
        <div className="care-art" data-reveal><img src={careImage} alt="A golden puppy arriving home beside a bag and green blanket" width="1024" height="1024" loading="lazy" /></div>
        <div className="care-copy">
          <h2 id="care-title" data-reveal>Growing up<br />together</h2>
          <p data-reveal>The first nights, the food bowl, the trip outside. Find practical puppy-care guides with sources you can follow.</p>
          <div className="guide-links" data-reveal>
            <a href="/puppy-care/getting-started">Getting started</a>
            <a href="/puppy-care/toilet-training">Toilet training</a>
            <a href="/puppy-care/feeding">Feeding</a>
            <a href="/puppy-care/sleep-and-first-nights">Sleep & first nights</a>
          </div>
          <a className="text-action" href="/puppy-care/" data-reveal>All puppy care guides</a>
        </div>
      </section>

      <section className="local-chapter chapter" aria-labelledby="local-title">
        <h2 id="local-title" data-reveal>Local first.<br />Yours always.</h2>
        <div className="local-columns">
          <p data-reveal>Log for free, without an account. Keep notes, edit your history, and export your activity as CSV. The everyday record belongs to you.</p>
          <div data-reveal><p>Cloud backup and device sync are optional. Use your account to manage sign-in methods and saved cloud data. Your saved cloud data stays yours when sync is paused.</p><SourceLink className="text-action" /></div>
        </div>
      </section>

      <a className="account-chapter" href="/account">
        <p>Manage your sign-in methods and saved cloud data.</p>
        <span className="account-word">Account</span>
        <span className="account-arrow" aria-hidden="true">↗</span>
      </a>
    </main>}
    <footer className="site-footer">
      <p className="footer-wordmark" aria-hidden="true">Puptime</p>
      <div className="footer-bottom">
        <p>A little record of growing up.</p>
        <nav aria-label="Footer"><SourceLink>GitHub</SourceLink><a href="/puppy-care/">Puppy care</a><a href="/account">Account</a><a href={privacyUrl}>Privacy</a><button type="button" onClick={openAnalyticsSettings}>Analytics settings</button><a href="#top">Back to top</a></nav>
      </div>
    </footer>
  </div>;
}
