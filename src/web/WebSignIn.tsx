import { useEffect, useId, useRef, useState } from 'react';
import type { Provider } from './account-client';

type Props = {
 headingLevel?: 1 | 2;
 providers: { apple: boolean; google: boolean; email: boolean } | null;
 email: string;
 onEmail: (value: string) => void;
 sent: string | null;
 code: string;
 onCode: (value: string) => void;
 busy: string | null;
 disabled: boolean;
 error: string;
 codeInvalid?: boolean;
 reauth?: boolean;
 onRetryConfig?: () => void;
 onSubmit: () => void;
 onSocial: (provider: Provider) => void;
 onResend: () => Promise<boolean>;
 onBack: () => void;
};

export function ProviderIcon({ provider }: { provider: Provider }) {
 return provider === 'apple' ? <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M17.05 12.54c.03 3.16 2.77 4.21 2.8 4.22-.02.07-.44 1.5-1.45 2.98-.87 1.28-1.78 2.55-3.21 2.58-1.4.03-1.85-.83-3.45-.83-1.59 0-2.09.8-3.42.86-1.38.05-2.43-1.39-3.31-2.66C3.21 17.08 1.84 12.3 3.69 9.08a5.14 5.14 0 0 1 4.35-2.64c1.36-.03 2.64.92 3.46.92.81 0 2.34-1.14 3.94-.97.67.03 2.56.27 3.78 2.06-.1.06-2.25 1.31-2.22 4.09h.05ZM14.42 4.66c.73-.89 1.23-2.12 1.09-3.35-1.05.04-2.33.7-3.08 1.58-.67.77-1.26 2.01-1.1 3.19 1.17.09 2.36-.6 3.09-1.42Z"/></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.01v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.35Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.51c-.9.6-2.04.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.91a6 6 0 0 1 0-3.82V7.5H3.06a10 10 0 0 0 0 9l3.34-2.59Z"/><path fill="#EA4335" d="M12 5.97c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.5l3.34 2.59A5.99 5.99 0 0 1 12 5.97Z"/></svg>;
}

// Both entry points share the form; their existing session and account guards own authentication.
export function WebSignIn(props: Props) {
 const { providers, email, onEmail, sent, code, onCode, busy, disabled, error, reauth } = props;
 const id = useId(), input = useRef<HTMLInputElement>(null);
 const [resendAt, setResendAt] = useState(0), [seconds, setSeconds] = useState(0);
 const Heading = props.headingLevel === 1 ? 'h1' : 'h2';
 const social = (['apple', 'google'] as const).filter(provider => providers?.[provider]);
 useEffect(() => { if (sent) setResendAt(Date.now() + 30000); }, [sent]);
 useEffect(() => {
  if (!sent || !resendAt) { setSeconds(0); return; }
  const tick = () => setSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
  tick(); const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
 }, [sent, resendAt]);
 useEffect(() => { if (sent && !disabled) { input.current?.focus(); if (props.codeInvalid) input.current?.select(); } }, [sent, disabled, error, props.codeInvalid]);
 return <div className="web-sign-in" aria-busy={!!busy}>
  <style>{webSignInStyles}</style>
  <div className="sign-in-heading">
   <Heading>{sent ? 'Enter your code' : reauth ? 'Confirm it’s you' : 'Sign in to Puptime'}</Heading>
   <p id={`${id}-description`}>{sent ? <>We sent a 6-digit code to <strong>{sent}</strong>.</> : reauth ? 'Verify your account before deleting cloud data.' : 'Use the same sign-in method you use in the app.'}</p>
  </div>
  {error ? <p className="sign-in-error" id={`${id}-error`} role="alert">{error}</p> : null}
  {!sent && social.length ? <div className="sign-in-providers">{social.map(provider => <button className="sign-in-provider" key={provider} type="button" disabled={disabled} onClick={() => props.onSocial(provider)}><ProviderIcon provider={provider}/><span>{busy === provider ? `Opening ${provider === 'apple' ? 'Apple' : 'Google'}…` : `${reauth ? 'Verify' : 'Continue'} with ${provider === 'apple' ? 'Apple' : 'Google'}`}</span></button>)}</div> : null}
  {!sent && social.length && providers?.email ? <div className="sign-in-divider"><span>or use email</span></div> : null}
  {providers?.email ? <form onSubmit={event => { event.preventDefault(); props.onSubmit(); }}>
   {sent ? <><input ref={input} className="sign-in-code" aria-label="Email code" aria-describedby={`${id}-description ${id}-hint${error ? ` ${id}-error` : ''}`} aria-invalid={props.codeInvalid ? true : undefined} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={event => onCode(event.target.value.replace(/\D/g, '').slice(0, 6))} onPaste={event => { event.preventDefault(); onCode(event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)); }} disabled={disabled}/><p className="sign-in-hint" id={`${id}-hint`}>Expires in 5 minutes.</p></> : !reauth ? <><label htmlFor={`${id}-email`}>Email address</label><input id={`${id}-email`} name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={320} required value={email} onChange={event => onEmail(event.target.value)} disabled={disabled}/></> : null}
   <button className="sign-in-submit" type="submit" disabled={disabled || (!!sent && code.length !== 6)}>{busy === 'email' ? 'Sending code…' : busy === 'verify' ? 'Signing in…' : sent ? 'Continue' : 'Email me a code'}<span aria-hidden="true">→</span></button>
   {sent ? <div className="sign-in-code-actions"><button type="button" className="sign-in-text" disabled={disabled} onClick={props.onBack}>{reauth ? 'Back' : 'Change email'}</button><button type="button" className="sign-in-text" disabled={disabled || seconds > 0} onClick={() => { void props.onResend().then(success => { if (success) setResendAt(Date.now() + 30000); }); }}>{seconds > 0 ? `Resend in ${seconds}s` : 'Resend code'}</button></div> : !reauth ? <p className="sign-in-hint">We’ll email you a code. No password to remember.</p> : null}
  </form> : null}
  {providers && !providers.email && !social.length ? <><p className="sign-in-hint">Sign-in is unavailable right now. Please try again later.</p>{props.onRetryConfig?<button className="sign-in-text" type="button" disabled={disabled} onClick={props.onRetryConfig}>Try again</button>:null}</> : null}
  {!sent && !reauth && (providers?.email || social.length > 0) ? <p className="sign-in-new">New here? Your first sign-in creates your account.</p> : null}
 </div>;
}

export const webSignInStyles = `
.web-sign-in{font-family:'Red Hat Text',sans-serif;color:var(--ink);display:grid;gap:20px;min-width:0}
.web-sign-in *{box-sizing:border-box}.web-sign-in .sign-in-heading :is(h1,h2){font-family:'Red Hat Display',sans-serif;font-size:32px;font-weight:900;letter-spacing:-1px;line-height:1.15;margin:0 0 12px}
.web-sign-in .sign-in-heading p{font-size:15px;line-height:1.6;color:var(--muted);margin:0;overflow-wrap:anywhere}.sign-in-heading strong{font-weight:600;color:var(--ink)}
.web-sign-in form,.sign-in-providers{display:grid;gap:12px}.web-sign-in label{display:block;font-size:14px;font-weight:600;margin:0}
.web-sign-in input{font:inherit;font-size:16px;color:var(--ink);background:var(--white);border:1px solid #8b978c;border-radius:8px;min-height:54px;width:100%;padding:14px 16px;margin:0}
.web-sign-in button{font:inherit;font-size:15px;font-weight:600;min-height:52px;cursor:pointer;touch-action:manipulation;transition:background 150ms ease,border-color 150ms ease}
.web-sign-in button.sign-in-provider{display:flex;align-items:center;justify-content:center;gap:12px;border:1px solid var(--border);border-radius:999px;color:var(--ink);background:var(--white);padding:12px 20px}
.web-sign-in button.sign-in-provider:hover{background:var(--mint);border-color:#8b978c}.web-sign-in button.sign-in-submit{display:flex;justify-content:space-between;align-items:center;gap:16px;border:1px solid var(--green);border-radius:999px;background:var(--green);color:var(--white);padding:12px 22px}.web-sign-in button.sign-in-submit:hover{background:var(--deep)}
.web-sign-in :is(button,input):focus-visible{outline:3px solid var(--green);outline-offset:4px}.web-sign-in button:disabled{opacity:.6;cursor:default}.web-sign-in input:disabled{opacity:.7}.web-sign-in input[aria-invalid=true]{border-color:#a32d26}
.sign-in-divider{display:flex;align-items:center;gap:16px;font-size:13px;color:var(--muted)}.sign-in-divider::before,.sign-in-divider::after{content:'';height:1px;flex:1;background:var(--border)}.sign-in-divider span{white-space:nowrap}
.web-sign-in p.sign-in-hint,.web-sign-in p.sign-in-new{font-size:13px;line-height:1.6;color:var(--muted);margin:0}.web-sign-in p.sign-in-new{margin-top:4px;text-align:center}
.web-sign-in input.sign-in-code{font-size:28px;letter-spacing:.4em;font-variant-numeric:tabular-nums;text-align:center;padding-left:calc(16px + .4em)}
.sign-in-code-actions{display:flex;justify-content:space-between;gap:16px}.web-sign-in button.sign-in-text{border:0;background:none;border-radius:0;padding:0;color:var(--green);font-size:14px;text-decoration:underline;text-underline-offset:4px;min-height:44px}
.web-sign-in p.sign-in-error{font-size:14px;line-height:1.6;color:#a32d26;background:#faebe6;border-radius:8px;padding:12px 16px;margin:0;overflow-wrap:anywhere}
@media(max-width:680px){.web-sign-in .sign-in-heading :is(h1,h2){font-size:28px}}
@media(prefers-reduced-motion:reduce){.web-sign-in button{transition:none}}
`;
