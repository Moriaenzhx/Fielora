import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentToolCallView } from '@fielora/contracts';
import { researchOperation, researchSummary, researchUrl } from './web-research.ts';
const source = {title:'Official help',url:'https://example.com/docs',snippet:'Returned source content <script>not executable</script>'};
const call = (overrides: Partial<AgentToolCallView> = {}): AgentToolCallView => ({id:'search',run_id:'run',name:'web.search',effect:'NETWORK',status:'COMPLETED',policy_decision:'ALLOW',arguments:{query:'official docs'},receipt:{success:true,result_count:1,sources:[source],retrieved_at:123},error_code:null,created_at:1,updated_at:2,...overrides});

test('research displays actual returned excerpts and preserves literal untrusted markup', () => {
  const operation = researchOperation(call(), [], false)!;
  assert.equal(operation.state, 'success');
  assert.equal(operation.sources[0]?.excerpt, source.snippet);
  assert.equal(operation.sources[0]?.excerptKind, 'search');
  assert.equal(operation.sources[0]?.readState, 'unread');
  assert.match(operation.sources[0]!.readLabel, /未读取正文/);
  assert.deepEqual(researchSummary([]), []);
  assert.equal(researchOperation(call({name:'work_plan'}),[],true),null);
});
test('running and empty results are distinct from failed and interrupted searches', () => {
  assert.equal(researchOperation(call({status:'RUNNING',receipt:null}),[],true)?.state,'running');
  assert.equal(researchOperation(call({status:'RUNNING',receipt:null}),[],false)?.state,'interrupted');
  assert.match(researchOperation(call({status:'PROPOSED',receipt:null}),[],true)!.heading,/等待执行/);
  assert.equal(researchOperation(call({status:'FAILED',error_code:'AGENT_TOOL_REQUEST_TIMEOUT'}),[],false)?.sources.length,0);
  assert.match(researchOperation(call({status:'FAILED',error_code:'AGENT_TOOL_REQUEST_TIMEOUT'}),[],false)!.detail,/超时/);
  assert.equal(researchOperation(call({receipt:{success:true,result_count:0,sources:[]}}),[],false)?.detail,'未找到结果');
  assert.equal(researchOperation(call({receipt:{success:false,sources:[source]}}),[],false)?.state,'failed');
});
test('source read state requires same Run and exact URL with returned body, never a planned read', () => {
  const fetch = call({id:'fetch',name:'web.fetch',arguments:{url:source.url},receipt:{success:true,final_url:source.url,text_returned_chars:123}});
  const label = (reads: AgentToolCallView[]) => researchOperation(call(),reads,false)!.sources[0]!.readLabel;
  assert.match(label([fetch]),/已返回正文/);
  assert.match(label([{...fetch,run_id:'foreign'}]),/未读取/);
  assert.match(label([{...fetch,status:'RUNNING'}]),/未读取/);
  assert.match(label([{...fetch,status:'FAILED'}]),/读取失败/);
  assert.match(label([{...fetch,arguments:{url:'https://example.com/other'},receipt:{success:true,final_url:'https://example.com/other',text_returned_chars:123}}]),/未读取/);
  assert.match(label([{...fetch,receipt:{success:true,final_url:source.url,text_returned_chars:0}}]),/未返回可用正文/);
});
test('legacy sources remain visible after serialization with no fabricated excerpt; unsafe links rejected', () => {
  const old = call({receipt:{success:true,result_count:1,sources:[{title:source.title,url:source.url}]}});
  assert.equal(researchOperation(JSON.parse(JSON.stringify(old)),[],false)!.sources[0]!.excerpt,'');
  assert.equal(researchUrl('javascript:alert(1)'),null);
  assert.equal(researchUrl('https://secret@example.com/'),null);
  assert.equal(researchUrl('file:///tmp/a'),null);
  assert.equal(researchUrl(source.url+'#section'),source.url);
  assert.equal(researchOperation(call({receipt:{success:true,sources:[{title:'bad',url:'javascript:alert(1)'}]}}),[],false)!.sources.length,0);
});
test('fetch previews, redirects and deduplicated summary retain their actual coverage', () => {
  const fetch = call({id:'fetch',name:'web.fetch',arguments:{url:'https://example.com/old'},receipt:{success:true,requested_url:'https://example.com/old',final_url:source.url,title:'Docs body',text_returned_chars:1000,excerpt:'Body excerpt',excerpt_truncated:true,truncated:true}});
  const operation = researchOperation(fetch,[fetch],false)!;
  assert.equal(operation.sources[0]?.excerpt,'Body excerpt');
  assert.equal(operation.sources[0]?.excerptKind,'body');
  assert.equal(operation.sources[0]?.readState,'returned');
  assert.equal(operation.sources[0]?.truncated,true);
  assert.match(operation.sources[0]!.readLabel,/部分正文/);
  const summary = researchSummary([call(),fetch]);
  assert.equal(summary.length,1);
  assert.equal(summary[0]?.url,source.url);
  assert.equal(researchOperation(call({receipt:{success:true,sources:[source],retrieved_at:Infinity}}),[],false)?.retrievedAt,null);
});

test('source state distinguishes failed, unknown and empty receipts without inventing a body read', () => {
  const fetch = call({id:'fetch',name:'web.fetch',arguments:{url:source.url},receipt:{success:true,final_url:source.url,text_returned_chars:123}});
  const state = (read: AgentToolCallView) => researchOperation(call(),[read],false)!.sources[0]!.readState;
  assert.equal(state({...fetch,status:'UNKNOWN'}),'unknown');
  assert.equal(state({...fetch,status:'CANCELLED'}),'unknown');
  assert.equal(state({...fetch,receipt:{success:true,outcome_unknown:true,text_returned_chars:123}}),'unknown');
  assert.equal(state({...fetch,receipt:{success:false}}),'failed');
  assert.equal(state({...fetch,receipt:{success:true,text_returned_chars:0}}),'empty');
  for (const count of [undefined, Infinity, -1, 0.5]) {
    assert.equal(state({...fetch,receipt:{success:true,text_returned_chars:count}}),'unknown');
  }
  assert.equal(state({...fetch,run_id:'another-run',status:'UNKNOWN'}),'unread');
  const unknown = researchOperation({...fetch,receipt:{success:true,outcome_unknown:true,final_url:source.url,text_returned_chars:123}},[],false)!;
  assert.equal(unknown.state,'interrupted');
  assert.deepEqual(unknown.sources,[]);
  assert.equal(researchOperation(call({receipt:{success:true,outcome_unknown:true,sources:[source]}}),[],false)?.sources.length,0);
});

test('successful fetch with empty or legacy body counts does not claim a body was returned', () => {
  for (const count of [0, undefined]) {
    const fetch = call({name:'web.fetch',receipt:{success:true,final_url:source.url,text_returned_chars:count,excerpt:'Existing literal excerpt'}});
    const operation = researchOperation(fetch,[fetch],false)!;
    assert.equal(operation.heading,'网页请求完成');
    assert.equal(operation.sources[0]?.readState,count === 0 ? 'empty' : 'unknown');
    assert.equal(operation.sources[0]?.excerpt,'Existing literal excerpt');
  }
});

test('summary preserves excerpt provenance and actual earlier body receipt across retries', () => {
  const fetch = call({id:'fetch',name:'web.fetch',arguments:{url:source.url},receipt:{success:true,final_url:source.url,text_returned_chars:123,excerpt:'Actual body',excerpt_truncated:true}});
  const empty = {...fetch,id:'empty',receipt:{success:true,final_url:source.url,text_returned_chars:0}};
  const searchFirst = researchSummary([call(),fetch,empty]);
  assert.equal(searchFirst.length,1);
  assert.equal(searchFirst[0]?.readState,'returned');
  assert.equal(searchFirst[0]?.excerpt,source.snippet);
  assert.equal(searchFirst[0]?.excerptKind,'search');
  assert.equal(searchFirst[0]?.truncated,false);
  const legacy = call({receipt:{success:true,sources:[{title:source.title,url:source.url}]}});
  const filled = researchSummary([legacy,fetch]);
  assert.equal(filled[0]?.excerptKind,'body');
  assert.equal(filled[0]?.excerpt,'Actual body');
  assert.equal(filled[0]?.truncated,true);
  const separateRuns = researchSummary([fetch,{...call(),run_id:'other'}]);
  assert.equal(separateRuns.length,2);
  assert.deepEqual(separateRuns.map(item=>item.readState),['returned','unread']);
});
