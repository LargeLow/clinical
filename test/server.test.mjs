import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, searchParameters } from '../server.mjs';

test('maps user searches and preserves filters on subsequent pages',()=>{
  const params = searchParameters(new URLSearchParams({condition:'diabetes',treatment:'insulin',location:'Utah',status:'RECRUITING',pageToken:'opaque-token'}));
  assert.equal(params.get('query.cond'),'diabetes');assert.equal(params.get('query.intr'),'insulin');assert.equal(params.get('query.locn'),'Utah');
  assert.equal(params.get('filter.overallStatus'),'RECRUITING');assert.equal(params.get('pageToken'),'opaque-token');assert.equal(params.has('countTotal'),false);
});
test('rejects empty searches, unknown status and oversized input',()=>{
  assert.throws(()=>searchParameters(new URLSearchParams()));
  assert.throws(()=>searchParameters(new URLSearchParams({status:'bogus'})));
  assert.throws(()=>searchParameters(new URLSearchParams({condition:'a'.repeat(251)})));
});
test('serves the interface, proxies searches and handles upstream failures',async()=>{
  const calls = [];
  const server = createServer(async(url)=>{calls.push(url);if(url.includes('unavailable')) return new Response('',{status:503});return Response.json({studies:[{protocolSection:{identificationModule:{nctId:'NCT01234567'}}}],nextPageToken:'next',totalCount:2});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:'+server.address().port;
  try {
    const home = await fetch(base);assert.equal(home.status,200);assert.match(await home.text(),/Find a study/);
    const response = await fetch(base+'/api/studies?condition=asthma');assert.equal(response.status,200);assert.equal((await response.json()).nextPageToken,'next');assert.match(calls[0],/query.cond=asthma/);
    assert.equal((await fetch(base+'/api/studies?status=invalid')).status,400);
    assert.equal((await fetch(base+'/api/studies/not-a-study')).status,400);
    assert.equal((await fetch(base+'/api/studies?condition=unavailable')).status,502);
    assert.equal((await fetch(base+'/unknown')).status,404);
    assert.equal((await fetch(base+'/health')).status,200);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
