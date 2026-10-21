import { websiteStyles } from './brand';

export const marketingStyles = websiteStyles + `
/* Expo’s native reset disables document scrolling; marketing pages use normal page flow. */
body:has(.marketing-site){overflow-y:auto}
#root:has(.marketing-site){height:auto;min-height:100%}
.marketing-site{
  --body:clamp(17px,1.35vw,20px);--small:14px;--lead:clamp(22px,2vw,28px);--heading:clamp(42px,5.4vw,76px);--display:clamp(48px,5.5vw,80px);
  --margin:max(24px,calc((100% - 1160px)/2));--ease:cubic-bezier(.16,1,.3,1);
  background:var(--paper);color:var(--ink);font-family:'Red Hat Text',sans-serif;font-size:var(--body);line-height:1.5;min-height:100%;
}
.marketing-site *{box-sizing:border-box}
.marketing-site :where(h1,h2,h3,p,figure){margin:0}
.marketing-site :where(h1,h2,h3){font-family:'Red Hat Display',sans-serif;font-weight:900;letter-spacing:-.03em;text-wrap:balance;line-height:.98}
.marketing-site:not(.care-page) h2{font-size:var(--heading)}
.marketing-site:not(.care-page) h3{font-size:var(--lead);letter-spacing:-.02em;line-height:1.1}
.marketing-site p{text-wrap:pretty}
.marketing-site a{color:inherit;text-decoration:none}
.marketing-site button{font:inherit;color:inherit;cursor:pointer}
.marketing-site :where(a,button){touch-action:manipulation;transition:transform 180ms var(--ease),opacity 180ms ease}
.marketing-site :where(a,button):focus-visible{outline:3px solid currentColor;outline-offset:6px}
.marketing-site :where(a,button):active{transform:translateY(2px)}
.marketing-site nav a:hover,.text-action:hover,.guide-links a:hover{text-decoration:underline;text-underline-offset:5px}
.skip-link{position:fixed;top:12px;left:12px;transform:translateY(-180%);background:var(--white);color:var(--ink);padding:12px 20px;z-index:20}
.skip-link:focus{transform:none}
.site-header{padding:24px var(--margin);display:flex;justify-content:space-between;align-items:center;background:var(--paper);color:var(--ink);gap:24px}
.site-brand{display:flex;align-items:center;gap:10px;font-size:var(--lead);font-weight:900;letter-spacing:-.04em}
.site-brand img{border-radius:10px}
.site-header nav{display:flex;align-items:center;gap:clamp(24px,3vw,48px)}
.site-header nav a{display:flex;align-items:center;min-height:44px}
.hero{position:relative;display:grid;grid-template-columns:1.1fr 1fr;gap:24px;align-items:center;min-height:640px;padding:40px var(--margin) 64px;background:var(--paper);color:var(--ink);overflow:clip}
.hero-copy{position:relative;z-index:1;padding-bottom:30px}
.hero h1{font-size:var(--display);letter-spacing:-.045em;line-height:.94;max-width:10em}
.hero-copy>p:first-of-type{font-size:var(--lead);line-height:1.4;max-width:33ch;margin-top:28px}
.primary-action{background:var(--ochre);color:var(--ink)!important;display:inline-flex;justify-content:space-between;align-items:center;gap:48px;padding:16px 24px;margin-top:32px;min-height:56px;font-weight:700;border-radius:12px}
.primary-action:hover{transform:translateY(-3px)}
.hero-note{margin-top:20px;font-size:var(--small)}
.hero-art{position:relative;align-self:stretch;display:flex;align-items:center;justify-content:center;min-width:0}
.hero-puppy{width:100%;max-width:520px;height:auto;aspect-ratio:1;object-fit:contain}
.chapter{padding:80px var(--margin);scroll-margin-top:24px}
.app-chapter{background:var(--paper);display:grid;grid-template-columns:1fr 1fr;gap:48px;min-height:0;align-items:center}
.preview-copy{max-width:620px}
.preview-choices{display:flex;flex-direction:column;align-items:stretch;margin:40px 0 28px;gap:4px}
.preview-choices button{display:flex;align-items:center;justify-content:space-between;text-align:left;background:transparent;border:0;padding:10px 16px;font-size:var(--lead);min-height:52px}
.preview-choices button[aria-pressed=true]{background:var(--mint);font-weight:900}
.preview-choices button:hover{transform:translateX(5px)}
.preview-choices button span{opacity:0}
.preview-choices button[aria-pressed=true] span{opacity:1}
.preview-description{max-width:36ch;min-height:4.5em}
.small-copy{font-size:var(--small);margin-top:24px}
.app-preview{justify-self:center;width:min(100%,360px);position:relative}
.app-preview img{display:block;width:100%;height:auto;border-radius:0}
.app-preview figcaption{font-size:var(--small);margin-top:16px;text-align:center}
.rhythm-chapter{display:grid;grid-template-columns:1fr 1fr;gap:48px;background:var(--mint);align-items:start}
.rhythm-intro{position:sticky;top:48px}
.rhythm-intro p{max-width:25ch;margin-top:32px;font-size:var(--lead);line-height:1.4}
.rhythm-stories{display:flex;flex-direction:column;gap:100px}
.rhythm-story h3{margin-bottom:28px}
.story-content{display:grid;grid-template-columns:1fr .9fr;gap:24px;align-items:center}
.story-content img{width:100%;height:auto;display:block}
.story-content.reverse img{order:2}
.story-content p{font-size:var(--body)}
.care-chapter{background:var(--paper);display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;min-height:0}
.care-art{width:100%;min-width:0}
.care-art img{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:contain;border-radius:16px}
.care-copy>p{margin:32px 0;max-width:34ch}
.guide-links{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:28px}
.guide-links a{padding:10px 0;min-height:44px;font-weight:500}
.text-action{display:inline-flex;align-items:center;min-height:44px;text-decoration:underline!important;text-underline-offset:5px;font-weight:900}
.local-chapter{background:var(--deep);color:var(--paper);min-height:0;display:flex;flex-direction:column;justify-content:center;gap:56px}
.local-columns{display:grid;grid-template-columns:1fr 1fr;gap:48px}
.local-columns p{font-size:var(--body);line-height:1.45;max-width:36ch}
.local-columns .text-action{margin-top:28px}
.account-chapter{display:flex;min-height:180px;background:var(--ochre);color:var(--ink);padding:40px var(--margin);position:relative;flex-direction:column;justify-content:space-between;overflow:clip}
.account-chapter p{max-width:30ch;padding-right:40px}
.account-word{font-family:'Red Hat Display',sans-serif;font-size:clamp(48px,6vw,80px);font-weight:900;letter-spacing:-.055em;line-height:1.1;margin-left:-.035em}
.account-arrow{position:absolute;right:var(--margin);top:24px;font-size:var(--heading);line-height:1}
.account-chapter:hover .account-arrow{transform:translate(6px,-6px)}
.account-arrow{transition:transform 240ms var(--ease)}
.site-footer{background:var(--paper);padding:40px var(--margin) 32px;border-top:1px solid var(--border);overflow:clip}
.footer-wordmark{font-family:'Red Hat Display',sans-serif;font-size:32px;letter-spacing:-.065em;font-weight:900;line-height:.9;margin-left:-.04em}
.footer-bottom{display:grid;grid-template-columns:1fr 1fr;gap:48px;margin-top:24px;align-items:start}
.footer-bottom nav{display:grid;grid-template-columns:1fr 1fr;gap:8px 28px}
.footer-bottom nav :where(a,button){min-height:44px;display:flex;align-items:center}
.footer-bottom button{border:0;background:none;padding:0;text-align:left;text-decoration:underline;text-underline-offset:4px}
.care-page .site-header{background:var(--paper);color:var(--ink)}
.learning-content{display:flex;flex-direction:column;min-height:70svh}
.learning-content :where(div,input){font-family:inherit}
.learning-content :where(h1,h2){font-family:'Red Hat Display',sans-serif;font-weight:900;letter-spacing:-.03em}
.learning-content h1:focus{outline:none}
.learning-content input:focus-visible{outline:3px solid var(--green);outline-offset:3px}
.care-art img,.learning-content [data-testid^="learn.image."]{mix-blend-mode:multiply}
@media(max-width:1000px){
  .marketing-site{--heading:clamp(48px,7vw,76px);--display:clamp(48px,6.2vw,64px)}
  .site-header{padding-top:18px;padding-bottom:18px}.hero{min-height:580px;grid-template-columns:1.15fr 1fr}
  .hero-copy>p:first-of-type{font-size:18px}.hero-puppy{width:100%}
  .chapter{padding-top:80px;padding-bottom:80px;gap:6%}.preview-choices{margin-top:28px}
  .app-preview{width:min(100%,310px)}.story-content{grid-template-columns:1fr}.story-content img{max-width:260px}
  .story-content.reverse img{order:0}.rhythm-stories{gap:72px}.guide-links{grid-template-columns:1fr;gap:0}
}
@media(min-width:601px) and (max-width:700px){
  .hero{grid-template-columns:1fr;min-height:0;padding-top:32px;padding-bottom:32px;gap:16px}
  .hero-copy{padding-bottom:0}.hero h1{font-size:52px;max-width:none}
  .hero-art{height:320px}.hero-puppy{width:340px;max-width:100%}
}
@media(max-width:600px){
  .marketing-site{--margin:20px;--lead:22px;--heading:clamp(42px,13.3vw,52px);--display:clamp(36px,10vw,56px)}
  .site-header{gap:12px;padding-top:16px;padding-bottom:16px}.site-brand{font-size:22px;gap:8px}.site-brand img{width:30px;height:30px;border-radius:8px}
  .site-header nav{gap:20px;font-size:16px}.site-header .product-nav{display:none}
  .hero{display:flex;flex-direction:column;align-items:stretch;min-height:0;padding-top:38px;padding-bottom:0}
  .hero-copy{padding-bottom:0}.hero h1{max-width:none}.hero-copy>p:first-of-type{margin-top:28px;max-width:31ch;font-size:18px;line-height:1.45}
  .primary-action{margin-top:24px;padding:13px 20px;min-height:52px}.hero-note{margin-top:16px}
  .hero-art{height:350px;align-self:center;width:100%;margin-top:-12px}.hero-puppy{width:370px;max-width:110%;margin:0}
  .chapter{padding-top:64px;padding-bottom:64px;display:flex;flex-direction:column;gap:40px;min-height:0}
  .app-chapter{gap:36px}.preview-choices{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:28px 0 24px}
  .preview-choices button{font-size:22px;padding:10px 12px}.preview-description{min-height:4.5em}.small-copy{margin-top:16px}
  .app-preview{width:280px;max-width:100%;align-self:center}.rhythm-intro{position:static}.rhythm-intro p{font-size:var(--body);margin-top:24px}
  .rhythm-stories{width:100%;gap:56px}.story-content{grid-template-columns:1fr;gap:20px;align-items:start}.story-content img{max-width:280px;justify-self:center}.story-content p{max-width:36ch}.story-content img{width:100%}
  .story-content.reverse img{order:0}.rhythm-story h3{margin-bottom:20px}.care-chapter{gap:32px}.care-art{order:2}.care-copy>p{margin:24px 0}
  .care-art img{max-width:420px}.guide-links{grid-template-columns:1fr 1fr;gap:0 12px}.local-chapter{gap:32px}.local-columns{display:flex;flex-direction:column;gap:24px}.local-columns p{font-size:var(--body)}
  .local-columns .text-action{margin-top:16px}.account-chapter{min-height:180px;padding-top:28px;padding-bottom:24px}.account-word{font-family:'Red Hat Display',sans-serif;font-size:56px}.account-arrow{font-size:52px;top:20px}
  .site-footer{padding-top:48px}.footer-bottom{display:flex;flex-direction:column;gap:28px;margin-top:36px}.footer-bottom nav{width:100%;gap:4px 20px}
}
@media(prefers-reduced-motion:no-preference){
  .hero h1{animation:title-arrive 900ms var(--ease) both}.hero-copy>p:first-of-type{animation:text-arrive 900ms 80ms var(--ease) both}
  .hero .primary-action{animation:text-arrive 900ms 160ms var(--ease) both}.hero-note{animation:text-arrive 900ms 240ms var(--ease) both}
  .hero-puppy{animation:puppy-arrive 1200ms var(--ease) both}
  [data-reveal].arrived{animation:text-arrive 850ms var(--ease) both}
  img[data-reveal].arrived,.care-art.arrived{animation:picture-arrive 1100ms var(--ease) both}
  .preview-choices.arrived,.guide-links.arrived{animation:choices-arrive 800ms var(--ease) both}
  .app-preview>img{animation:picture-arrive 600ms var(--ease) both}
}
@keyframes title-arrive{from{transform:translateY(24px)}to{transform:none}}
@keyframes text-arrive{from{transform:translateY(20px);opacity:.6}to{transform:none;opacity:1}}
@keyframes picture-arrive{from{transform:scale(.97);opacity:.7}to{transform:scale(1);opacity:1}}
@keyframes choices-arrive{from{transform:translateX(-16px);opacity:.7}to{transform:none;opacity:1}}
@keyframes puppy-arrive{from{transform:translate(16px,16px);opacity:.7}to{transform:none;opacity:1}}
@media(prefers-reduced-motion:reduce){.marketing-site *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
