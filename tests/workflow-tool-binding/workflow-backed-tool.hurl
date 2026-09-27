# Step 18 check 5: completed synchronous Tool call.
POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: {{workflow_tool_name}}
{"jsonrpc":"2.0","id":"complete-{{run_id}}","method":"tools/call","params":{"name":"{{workflow_tool_name}}","arguments":{"scenario":"complete","idempotencyKey":"complete-{{run_id}}"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"light-portal-test","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
HTTP 200
[Asserts]
jsonpath "$.result.isError" == false
jsonpath "$.result.structuredContent" exists

# Step 18 check 6: first failing call returns the stored task failure.
POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: {{workflow_tool_name}}
{"jsonrpc":"2.0","id":"fail-{{run_id}}","method":"tools/call","params":{"name":"{{workflow_tool_name}}","arguments":{"scenario":"fail","idempotencyKey":"fail-{{run_id}}"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"light-portal-test","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
HTTP 200
[Asserts]
jsonpath "$.result.isError" == true
body contains "WORKFLOW_TASK_FAILED"

# Step 18 check 7: a slow call times out and retry attaches to its instance.
POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: {{workflow_tool_name}}
{"jsonrpc":"2.0","id":"slow-{{run_id}}","method":"tools/call","params":{"name":"{{workflow_tool_name}}","arguments":{"scenario":"slow","idempotencyKey":"slow-{{run_id}}"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"light-portal-test","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
HTTP 200
[Captures]
slow_instance: jsonpath "$.result.structuredContent.workflowInstanceId"
[Asserts]
jsonpath "$.result.isError" == true
body contains "WORKFLOW_TIMEOUT"

POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: {{workflow_tool_name}}
{"jsonrpc":"2.0","id":"slow-retry-{{run_id}}","method":"tools/call","params":{"name":"{{workflow_tool_name}}","arguments":{"scenario":"slow","idempotencyKey":"slow-{{run_id}}"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"light-portal-test","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
HTTP 200
[Asserts]
body contains "{{slow_instance}}"

# Step 18 check 8: resultReplayMs 0 creates a new instance after completion.
POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: {{workflow_tool_name}}
{"jsonrpc":"2.0","id":"fresh-a-{{run_id}}","method":"tools/call","params":{"name":"{{workflow_tool_name}}","arguments":{"scenario":"complete","key":"fresh-{{run_id}}","idempotencyKey":"fresh-{{run_id}}"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"light-portal-test","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
HTTP 200
[Captures]
first_instance: jsonpath "$.result.structuredContent.workflowInstanceId"
[Asserts]
jsonpath "$.result.isError" == false

POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: {{workflow_tool_name}}
{"jsonrpc":"2.0","id":"fresh-b-{{run_id}}","method":"tools/call","params":{"name":"{{workflow_tool_name}}","arguments":{"scenario":"complete","key":"fresh-{{run_id}}","idempotencyKey":"fresh-{{run_id}}"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"light-portal-test","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
HTTP 200
[Asserts]
jsonpath "$.result.isError" == false
jsonpath "$.result.structuredContent.workflowInstanceId" != "{{first_instance}}"

# Step 18 check 16: the lane runner admits two same-user slow calls first.
POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: {{capacity_tool_name}}
{"jsonrpc":"2.0","id":"capacity-{{run_id}}","method":"tools/call","params":{"name":"{{capacity_tool_name}}","arguments":{"scenario":"slow","key":"capacity-{{run_id}}"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"light-portal-test","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
HTTP 200
[Asserts]
jsonpath "$.result.isError" == true
body contains "WORKFLOW_CAPACITY_EXHAUSTED"
body contains "retryAfterMs"

# Step 18 check 18: Gateway refuses a direct workflow_invoke call.
POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: workflow_invoke
{"jsonrpc":"2.0","id":"direct-invoke-{{run_id}}","method":"tools/call","params":{"name":"workflow_invoke","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"light-portal-test","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
HTTP 200
[Asserts]
body contains "tool is not available"
