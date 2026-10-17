import { useEffect, useRef, useState } from 'react';
import { consentKey, privacySignalActive } from './telemetry-policy';
import { captureWebsiteEvent, posthogConfigured, setAnalyticsEnabled, storedConsent } from './telemetry';

export function openAnalyticsSettings() {
  window.dispatchEvent(new Event('puptime:analytics-settings'));
}

export function WebsiteAnalytics({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const declineButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) declineButton.current?.focus(); }, [open]);
  useEffect(() => {
    const sync = () => {
      const value = storedConsent();
      const privacySignal = privacySignalActive(navigator);
      setBlocked(privacySignal);
      setChoice(value);
      setOpen(value === null && posthogConfigured && !privacySignal);
      void setAnalyticsEnabled(value === 'yes', path);
    };
    const show = () => setOpen(true);
    const storageChanged = (event: StorageEvent) => { if (event.key === consentKey || event.key === null) sync(); };
    const onError = () => captureWebsiteEvent('website_error', { error_kind: 'script' });
    const onRejection = () => captureWebsiteEvent('website_error', { error_kind: 'unhandled_rejection' });
    sync();
    window.addEventListener('puptime:analytics-settings', show);
    window.addEventListener('storage', storageChanged);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('puptime:analytics-settings', show);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [path]);
  const choose = (enabled: boolean) => {
    try { localStorage.setItem(consentKey, enabled ? 'yes' : 'no'); } catch { /* Choice applies for this page if storage is unavailable. */ }
    setChoice(enabled ? 'yes' : 'no');
    void setAnalyticsEnabled(enabled, path);
    setOpen(false);
  };
  if (!open) return null;
  return <section aria-label="Website analytics preferences" style={{ position: 'fixed', bottom: 16, left: 16, right: 16, margin: '0 auto', maxWidth: 640, padding: 22, border: '1px solid #D6DED8', borderRadius: 18, background: '#FFFEFA', color: '#17231E', boxShadow: '0 4px 32px #17231e22', zIndex: 1000, fontFamily: 'system-ui', fontSize: 15, lineHeight: 1.5 }}>
    <strong>Help improve Puptime?</strong>
    <p style={{ margin: '8px 0 16px' }}>Optional PostHog analytics measure guide visits, download clicks, and error counts using an anonymous browser ID. No session recordings. Cloudflare separately measures traffic and page speed. <a href="https://github.com/patrickchin/puptime/blob/main/PRIVACY.md">Privacy policy</a></p>
    {(blocked || !posthogConfigured) && <p>{blocked ? 'Your browser privacy signal keeps optional analytics off.' : 'Optional analytics are not configured.'}</p>}
    {choice && !blocked && <p>Optional analytics are {choice === 'yes' ? 'on' : 'off'}.</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <button ref={declineButton} style={buttonStyle} onClick={() => choose(false)}>Decline analytics</button>
      <button style={buttonStyle} disabled={blocked || !posthogConfigured} onClick={() => choose(true)}>Allow analytics</button>
    </div>
  </section>;
}

const buttonStyle = { minHeight: 44, padding: '10px 16px', border: '1px solid #176B52', borderRadius: 10, color: '#0E4E3A', background: '#FFFEFA', font: 'inherit', cursor: 'pointer' };
