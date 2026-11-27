// Public website acceptance: no backend or provider traffic is permitted.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {extname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PUPTIME_PLAYWRIGHT_MODULE??'playwright');
const root=resolve('dist-web'),output=resolve('output/playwright/web-public'),screenshots=resolve(process.env.PUPTIME_SCREENSHOTS_DIR??join(homedir(),'Pictures/Screenshots/Codex/puptime-remove-web-login'));
mkdirSync(output,{recursive:true});mkdirSync(screenshots,{recursive:true});
const server=createServer((req,res)=>{
 const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=resolve(root,'.'+(path.endsWith('/')?path+'index.html':path));if(!extname(file))file+='.html';
 if(!file.startsWith(root+'/')||!existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
});await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({headless:true,executablePath:process.env.PUPTIME_CHROMIUM_EXECUTABLE??chromium.executablePath()});
try{
 const context=await browser.newContext(),page=await context.newPage(),api=[],external=[],requests=[],errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.addInitScript(()=>{window.storageWrites=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){window.storageWrites.push(key);return original.call(this,key,value);};});
 await context.route('**/*',route=>{const url=new URL(route.request().url());requests.push(url.href);if(url.origin!==origin){external.push(url.origin);return route.abort();}if(url.pathname.startsWith('/api/')){api.push(url.pathname);return route.abort();}return route.continue();});
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:width<600?844:900});await page.goto(origin);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('a[href="/account"],.account-chapter').count(),0);assert.equal(await page.getByRole('link',{name:/sign in/i}).count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(width!==320)await page.screenshot({path:join(screenshots,`public-home-${width}.png`)});
 }
 // Every template shares one header and footer; only pages that mount the analytics banner offer its settings button.
 const chrome=()=>({header:[...document.querySelectorAll('.site-header nav a')].map(a=>`${a.textContent}|${a.getAttribute('href')}|${a.getAttribute('aria-current')}`),footer:[...document.querySelectorAll('.site-footer .footer-columns :is(h2,a)')].map(e=>`${e.textContent}|${e.getAttribute('href')}`),analytics:document.querySelectorAll('.site-footer button').length,brand:document.querySelector('.site-header .site-brand')?.getAttribute('href')});
 let footer;
 for(const [path,current,analytics] of [['/','The app',1],['/puppy-care/','Puppy care',1],['/puppy-care/feeding','Puppy care',1],['/privacy',null,0],['/support',null,0],['/delete-account',null,0],['/care',null,0],['/404',null,0]]){
  for(const width of [1440,320]){
   await page.setViewportSize({width,height:width<600?844:900});await page.goto(origin+path);await page.locator('.site-footer').waitFor();
   const found=await page.evaluate(chrome);footer??=found.footer;
   assert.equal(found.brand,'/');assert.deepEqual(found.footer,footer,`Footer differs on ${path}`);assert.equal(found.analytics,analytics,`Analytics settings on ${path}`);
   assert.deepEqual(found.header.map(item=>item.split('|').slice(0,2).join('|')),['The app|/#app','Puppy care|/puppy-care/']);
   assert.deepEqual(found.header.filter(item=>!item.endsWith('|null')).map(item=>item.split('|')[0]),current?[current]:[],`Current header item on ${path}`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow on ${path} at ${width}px`);
   assert.ok(await page.locator('.site-header').evaluate(element=>element.getBoundingClientRect().height<100),`Header wraps on ${path} at ${width}px`);
  }
 }
 assert.deepEqual(footer,['Product|null','The app|/#app','Puppy care|/puppy-care/','Download Android APK|/download/android.apk','Help|null','Support|/support','Privacy|/privacy','Delete cloud account|/delete-account','Source|null','GitHub\u00a0↗|https://github.com/patrickchin/puptime']);
 await page.goto(origin+'/delete-account');assert.equal(await page.locator('meta[name=referrer]').getAttribute('content'),'no-referrer');assert.match(await page.locator('meta[name=robots]').getAttribute('content'),/noindex/);
 const id='shr_'+'a'.repeat(32),token='inv_'+'b'.repeat(32);
 for(const [path,target,name] of [['/account','puptime://','account-handoff'],['/care','puptime://','care-handoff'],[`/care?invite=${id}#${token}`,`puptime://care?invite=${id}#${token}`,'invitation-handoff']]){
  await page.goto(origin+path);const link=page.getByRole('link',{name:'Open Puptime',exact:true});await link.waitFor();assert.equal(await link.getAttribute('href'),target);assert.equal(await page.locator('form,input').count(),0);assert.equal(await page.evaluate(()=>window.storageWrites.length),0);assert.equal(await page.locator('meta[name=referrer]').getAttribute('content'),'no-referrer');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(screenshots,name+'.png'),fullPage:true});
 }
 await page.goto(origin+`/care?invite=${id}#${token}`);await page.getByText('Open this invitation link on your phone, where Puptime is installed.').waitFor();
 const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'});
 await phone.route('**/*',route=>{const url=new URL(route.request().url());requests.push(url.href);if(url.origin!==origin){external.push(url.origin);return route.abort();}if(url.pathname.startsWith('/api/')){api.push(url.pathname);return route.abort();}return route.continue();});
 const phonePage=await phone.newPage();phonePage.on('pageerror',error=>errors.push(error.message));await phonePage.goto(origin+`/care?invite=${id}#${token}`);
 assert.equal(await phonePage.getByText('Open this invitation link on your phone',{exact:false}).count(),0);await phonePage.getByRole('link',{name:'Open Puptime',exact:true}).click();
 await phonePage.getByText('Puptime didn’t open?').waitFor({timeout:5000});assert.equal(await phonePage.getByRole('link',{name:'Get the Android APK',exact:true}).getAttribute('href'),'/download/android.apk');await phonePage.screenshot({path:join(screenshots,'invitation-handoff-fallback.png'),fullPage:true});await phone.close();
 await page.goto(origin+'/care?invite=bad#invalid');await page.getByRole('heading',{name:'Check your invitation',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Open Puptime',exact:true}).count(),0);
 assert.deepEqual(api,[]);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.ok(requests.every(url=>!url.includes(token)));
 writeFileSync(join(output,'verification.json'),JSON.stringify({passed:true,scope:'Local static website only; no backend, authentication, browser storage writes, external provider or private-data requests.',widths:[1440,390,320]},null,2));
 console.log('PASS shared header and footer on every template, public navigation, responsive handoffs, native invitation credentials, invalid-link recovery, and zero browser authentication/storage/private-data requests.');
 await context.close();
}finally{await browser.close();await new Promise(done=>server.close(done));}
