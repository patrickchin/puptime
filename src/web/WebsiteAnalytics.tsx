import { privacyPath } from '../public-site';
import { websiteTheme } from './brand';
import { useEffect, useRef, useState } from 'react';
import { consentKey, privacySignalActive } from './telemetry-policy';
import { captureWebsiteEvent, posthogConfigured, setAnalyticsEnabled, storedConsent } from './telemetry';

// Safari doesn't focus clicked buttons, so pass the clicked trigger along for focus return.
export function openAnalyticsSettings(event?: { currentTarget: EventTarget | null }) {
  window.dispatchEvent(new CustomEvent('puptime:analytics-settings', { detail: event?.currentTarget }));
}

export function WebsiteAnalytics({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const declineButton = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  // Only move focus when a visitor opens settings themselves; the automatic first-visit banner leaves focus alone.
  useEffect(() => { if (open && focusRequest) declineButton.current?.focus(); }, [open, focusRequest]);
  useEffect(() => {
    if (open || !trigger.current) return;
    if (trigger.current.isConnected) trigger.current.focus();
    trigger.current = null;
  }, [open]);
  useEffect(() => {
    const sync = () => {
      const value = storedConsent();
      const privacySignal = privacySignalActive(navigator);
      setBlocked(privacySignal);
      setChoice(value);
      setOpen(value === null && posthogConfigured && !privacySignal);
      void setAnalyticsEnabled(value === 'yes', path);
    };
    const show = (event: Event) => {
      const active = (event as CustomEvent<EventTarget | null | undefined>).detail ?? document.activeElement;
      trigger.current = active instanceof HTMLElement && active !== document.body ? active : null;
      setOpen(true);
      setFocusRequest((count) => count + 1);
    };
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
  return <section aria-label="Website analytics preferences" style={{ position: 'fixed', bottom: 16, left: 16, right: 16, margin: '0 auto', maxWidth: 640, padding: 24, border: `1px solid ${websiteTheme.text}`, borderRadius: 0, background: websiteTheme.surface, color: websiteTheme.text, boxShadow: '0 8px 32px #17231e29', zIndex: 1000, fontFamily: "'Red Hat Text', sans-serif", fontSize: 15, lineHeight: 1.5 }}>
    <strong style={{ display: 'block', fontFamily: "'Red Hat Display', sans-serif", fontWeight: 900, fontSize: 22, letterSpacing: '-.02em', lineHeight: 1.1 }}>Help improve Puptime?</strong>
    <p style={{ margin: '10px 0 16px' }}>Optional PostHog analytics measure public website visits, source-code clicks, and browser error categories using an anonymous browser ID. No account details or session recordings. Cloudflare separately measures traffic and page speed. <a href={privacyPath} style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>Privacy policy</a></p>
    {(blocked || !posthogConfigured) && <p style={{ margin: '0 0 16px' }}>{blocked ? 'Your browser privacy signal keeps optional analytics off.' : 'Optional analytics are not configured.'}</p>}
    {choice && !blocked && <p style={{ margin: '0 0 16px' }}>Optional analytics are {choice === 'yes' ? 'on' : 'off'}.</p>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
      <button ref={declineButton} style={buttonStyle} onClick={() => choose(false)}>Decline analytics</button>
      <button style={blocked || !posthogConfigured ? { ...buttonStyle, opacity: 0.5, cursor: 'not-allowed' } : buttonStyle} disabled={blocked || !posthogConfigured} onClick={() => choose(true)}>Allow analytics</button>
    </div>
  </section>;
}

// Both choices share one style so neither is visually favoured.
const buttonStyle = { flex: '1 1 140px', minHeight: 48, padding: '12px 8px', border: 0, borderRadius: 0, color: websiteTheme.text, background: 'var(--lime)', font: 'inherit', fontWeight: 700, cursor: 'pointer', outlineOffset: 2 };
