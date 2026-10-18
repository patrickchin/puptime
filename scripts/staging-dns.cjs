// Optional qualification-only resolver when the host's DNS returns NXDOMAIN.
// node --require ./scripts/staging-dns.cjs scripts/verify-cloud-clients.mjs staging
// Normal HTTPS/WSS hostname and certificate verification remain enabled.
const dns=require('node:dns'),{syncBuiltinESMExports}=require('node:module');
const lookup=dns.lookup,host='puptime-api-staging.p-ch.workers.dev';
let pending;
dns.lookup=function(name,options,callback){
 if(name!==host)return lookup.apply(this,arguments);
 if(typeof options==='function'){callback=options;options={};}
 if(typeof options==='number')options={family:options};
 options??={};
 pending??=fetch('https://1.1.1.1/dns-query?name='+host+'&type=A',{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(15000)})
  .then(async response=>{if(!response.ok)throw new Error('Staging DNS-over-HTTPS lookup failed.');const value=await response.json();const addresses=(value.Answer??[]).filter(row=>row.type===1&&row.name===host).map(row=>({address:row.data,family:4}));if(value.Status!==0||!addresses.length)throw new Error('Staging DNS-over-HTTPS returned no IPv4 address.');return addresses;});
 pending.then(addresses=>{
  if(options.family===6){const error=new Error('IPv6 is not part of this qualification resolver.');error.code='ENOTFOUND';callback(error);}
  else if(options.all)callback(null,addresses);
  else callback(null,addresses[0].address,4);
 },callback);
};
syncBuiltinESMExports();
