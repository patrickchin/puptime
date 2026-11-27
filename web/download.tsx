import { useEffect, useState } from 'react';
import { appStoreUrl } from '../src/public-site';
import { handoffDevice } from '../src/web/app-link';
import { SiteFooter, SiteHeader } from '../src/web/SiteChrome';
import { androidDownloadPath, androidReleasesUrl } from '../src/web/site-chrome';
import { captureWebsiteEvent } from '../src/web/telemetry';
import { WebsiteAnalytics } from '../src/web/WebsiteAnalytics';
import { WebsiteMetadata } from '../src/web/WebsiteMetadata';

const path = '/download';

export default function Download() {
  // Static HTML lists iPhone first; Android phones move their own option up after hydration.
  const [androidFirst, setAndroidFirst] = useState(false);
  useEffect(() => { setAndroidFirst(handoffDevice(navigator.userAgent, navigator.maxTouchPoints) === 'android'); }, []);
  const iphone = <section key="iphone" className="download-platform" aria-labelledby="iphone-title">
    <h2 id="iphone-title">iPhone</h2>
    {appStoreUrl
      ? <a className="app-store-badge" href={appStoreUrl}><small>Download on the</small> App Store</a>
      : <p>Coming soon to the App Store.</p>}
  </section>;
  const android = <section key="android" className="download-platform" aria-labelledby="android-title">
    <h2 id="android-title">Android</h2>
    <p>Google Play is coming soon. Until then, you can install the Android app directly.</p>
    <a className="secondary-action" href={androidDownloadPath} onClick={() => captureWebsiteEvent('website_cta', { destination: 'android_download' })}>Download the APK <span aria-hidden="true">↓</span></a>
    <ol className="install-steps">
      <li>Download the APK</li>
      <li>Open the file</li>
      <li>Allow installs from your browser when asked</li>
    </ol>
    <a className="release-link" href={androidReleasesUrl}>Release notes and files on GitHub&nbsp;<span aria-hidden="true">↗</span></a>
  </section>;
  return <div className="marketing-site care-page site-page download-page" id="top">
    <WebsiteMetadata path={path} />
    <WebsiteAnalytics path={path} />
    <a className="skip-link" href="#main">Skip to content</a>
    <SiteHeader path={path} />
    <main id="main" className="download-content">
      <h1>Get Puptime</h1>
      <div className="download-platforms">{androidFirst ? [android, iphone] : [iphone, android]}</div>
    </main>
    <SiteFooter path={path} analytics />
  </div>;
}
