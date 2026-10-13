import test from 'node:test';
import assert from 'node:assert/strict';
import { webSearchSources, webSearchFailure } from './web-search.ts';

test('search sources reject script links and URL credentials and preserve publication facts', () => {
  assert.deepEqual(webSearchSources(null), []);
  assert.deepEqual(webSearchSources([
    {title:'Bad',url:'javascript:alert(1)'}, {title:'Key',url:'https://key@example.com'},
    {title:'Docs',url:'https://example.com/docs',published_at:'2026-10-11'},
    {title:'Unknown date',url:'https://example.com/unknown'},
  ]), [
    {title:'Docs',url:'https://example.com/docs',published_at:'2026-10-11'},
    {title:'Unknown date',url:'https://example.com/unknown',published_at:null},
  ]);
  assert.equal(webSearchSources(Array.from({length:20},()=>({title:'x',url:'https://example.com'}))).length,10);
});

test('search failure is actionable and never becomes an empty-result claim', () => {
  assert.match(webSearchFailure('AGENT_TOOL_RATE_LIMITED'), /限|Key/);
  assert.match(webSearchFailure('AGENT_TOOL_RESPONSE_MALFORMED'), /不能据此判断没有资料/);
  assert.match(webSearchFailure('AGENT_TOOL_CREDENTIAL_REJECTED'), /Key/);
  assert.doesNotMatch(webSearchFailure('secret-value'), /secret-value/);
});
