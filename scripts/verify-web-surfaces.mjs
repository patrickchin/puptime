// Static two-host acceptance. All requests are fulfilled locally; no live domain is contacted.
// Build both surfaces with EXPO_PUBLIC_SITE_URL=https://puptime.example.test first.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {resolve,extname,join} from 'node:path';
import {homedir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PUPTIME_PLAYWRIGHT_MODULE??'playwright');
const site='https://puptime.example.test',app='https://app.puptime.example.test';
const screenshots=resolve(process.env.PUPTIME_SCREENSHOTS_DIR??join(homedir(),'Pictures/Screenshots/Codex/puptime-web-login'));mkdirSync(screenshots,{recursive:true});
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json','.txt':'text/plain'};
const browser=await chromium.launch({headless:true,executablePath:process.env.PUPTIME_CHROMIUM_EXECUTABLE??chromium.executablePath()});
try{
 const context=await browser.newContext(),page=await context.newPage(),requests=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript(()=>localStorage.setItem('puptime.website.analytics','no'));
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url());requests.push(url.href);
  assert.ok([site,app].includes(url.origin),'No external requests are permitted.');
  if(url.pathname.startsWith('/api/')){
   assert.equal(url.origin,app,'Public redirects must not mount authentication.');
   if(url.pathname==='/api/config')await route.fulfill({json:{protocolVersion:1,providers:{apple:true,google:true,email:true}}});
   else if(url.pathname.includes('/get-session'))await route.fulfill({json:null});
   else await route.fulfill({status:401,json:{error:'unauthorized'}});
   return;
  }
  const root=resolve(url.origin===site?'dist-web':'dist-web-app');
  let file=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));if(!extname(file))file+='.html';
  if(!file.startsWith(root+'/')||!existsSync(file)){await route.fulfill({status:404,body:'Page not found'});return;}
  await route.fulfill({body:readFileSync(file),contentType:types[extname(file)]??'application/octet-stream'});
 });
 await page.goto(site+'/');const signIn=page.locator('.site-header').getByRole('link',{name:'Sign in',exact:true});assert.equal(await signIn.getAttribute('href'),app+'/account');await signIn.click();await page.getByLabel('Email address',{exact:true}).waitFor();assert.equal(new URL(page.url()).origin,app);
 await page.goto(app+'/');await page.getByRole('heading',{name:'Sign in to Puptime',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Back to Puptime',exact:true}).getAttribute('href'),site+'/');
 for(const width of [1440,768,390]){await page.setViewportSize({width,height:width<500?844:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(screenshots,`app-sign-in-${width}.png`),fullPage:true});}
 await page.goto(site+'/account?error=cancelled');await page.getByRole('alert').filter({hasText:'Sign-in wasn’t completed'}).waitFor();assert.equal(new URL(page.url()).origin,app);assert.ok(requests.includes(app+'/account?error=cancelled'));
 const invite='shr_'+'a'.repeat(32),token='inv_'+'b'.repeat(32);await page.goto(site+`/care?invite=${invite}#${token}`);await page.waitForURL(url=>url.origin===app&&url.pathname==='/care'&&!url.hash);assert.equal(new URL(page.url()).searchParams.get('invite'),invite);assert.equal(await page.evaluate(id=>sessionStorage.getItem('puptime.care.invite.'+id),invite),token);assert.ok(requests.every(url=>!url.includes(token)));
 assert.equal((await page.goto(app+'/puppy-care/feeding')).status(),404);assert.equal((await page.goto(app+'/sitemap.xml')).status(),404);
 assert.deepEqual(errors,[]);await context.close();
 console.log('PASS public navigation, legacy account redirect, invitation query/fragment preservation, host-only invitation storage, app homepage, public back link, responsive app screenshots, and absent marketing pages/sitemap. No live domains or auth credentials used.');
}finally{await browser.close();}
