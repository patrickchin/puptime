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
 const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);let file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!extname(file))file+='.html';
 if(!file.startsWith(root+'/')||!existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]??'application/octet-stream');res.end(readFileSync(file));
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
 const id='shr_'+'a'.repeat(32),token='inv_'+'b'.repeat(32);
 for(const [path,target,name] of [['/account','puptime://','account-handoff'],['/care','puptime://','care-handoff'],[`/care?invite=${id}#${token}`,`puptime://care?invite=${id}#${token}`,'invitation-handoff']]){
  await page.goto(origin+path);const link=page.getByRole('link',{name:'Open Puptime',exact:true});await link.waitFor();assert.equal(await link.getAttribute('href'),target);assert.equal(await page.locator('form,input').count(),0);assert.equal(await page.evaluate(()=>window.storageWrites.length),0);assert.equal(await page.locator('meta[name=referrer]').getAttribute('content'),'no-referrer');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(screenshots,name+'.png'),fullPage:true});
 }
 await page.goto(origin+'/care?invite=bad#invalid');await page.getByRole('heading',{name:'Check your invitation',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Open Puptime',exact:true}).count(),0);
 assert.deepEqual(api,[]);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.ok(requests.every(url=>!url.includes(token)));
 writeFileSync(join(output,'verification.json'),JSON.stringify({passed:true,scope:'Local static website only; no backend, authentication, browser storage writes, external provider or private-data requests.',widths:[1440,390,320]},null,2));
 console.log('PASS public navigation, responsive handoffs, native invitation credentials, invalid-link recovery, and zero browser authentication/storage/private-data requests.');
 await context.close();
}finally{await browser.close();await new Promise(done=>server.close(done));}
