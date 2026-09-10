import test from 'node:test';
import assert from 'node:assert/strict';
import { messages } from './http.mjs';
test('MCP report reader handles JSON and batched SSE with notifications',()=>{
  assert.deepEqual(messages({headers:{'content-type':'application/json'},body:'{"id":1,"result":{}}'}),[{id:1,result:{}}]);
  for(const newline of ['\n','\r\n','\r']) {
    const body=[': keepalive','','data: {"id":1,"result":{}}','','data: {"id":2,"error":{"code":-32602}}','',''].join(newline);
    assert.deepEqual(messages({headers:{'content-type':'text/event-stream; charset=utf-8'},body}).map(m=>m.id),[1,2]);
  }
});
test('decode errors do not leak response bodies into reports',()=>{
  assert.throws(()=>messages({headers:{'content-type':'application/json'},body:'secret-token'}),{message:'MCP response is not valid JSON/SSE'});
  assert.throws(()=>messages({headers:{'content-type':'text/html'},body:'secret-token'}),{message:'MCP response has an unsupported content type'});
});

test('March batch arrays inside one SSE event preserve every response ID',()=>{
  const body='data: [{"jsonrpc":"2.0","id":"one","result":{}},{"jsonrpc":"2.0","id":"two","result":{}}]\n\n';
  assert.deepEqual(messages({headers:{'content-type':'text/event-stream'},body}).map(m=>m.id),['one','two']);
});
