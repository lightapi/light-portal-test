POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/list
X-Correlation-Id: light-portal-test-workflow-list-{{run_id}}
{
  "jsonrpc": "2.0",
  "id": "workflow-list-{{run_id}}",
  "method": "tools/list",
  "params": {
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "light-portal-test",
        "version": "1"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
HTTP 200
[Asserts]
jsonpath "$.result.tools[*].name" contains "{{workflow_smoke_tool}}"

POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: {{workflow_smoke_tool}}
X-Correlation-Id: light-portal-test-workflow-call-{{run_id}}
{
  "jsonrpc": "2.0",
  "id": "workflow-call-{{run_id}}",
  "method": "tools/call",
  "params": {
    "name": "{{workflow_smoke_tool}}",
    "arguments": {},
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "light-portal-test",
        "version": "1"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
HTTP 200
[Asserts]
jsonpath "$.result.isError" == false
body contains "\"message\":\"message\""
body contains "executedBy"
body contains "light-workflow"

POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: {{workflow_smoke_tool}}
X-Correlation-Id: light-portal-test-workflow-invalid-{{run_id}}
{
  "jsonrpc": "2.0",
  "id": "workflow-invalid-{{run_id}}",
  "method": "tools/call",
  "params": {
    "name": "{{workflow_smoke_tool}}",
    "arguments": {
      "unexpected": true
    },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": {
        "name": "light-portal-test",
        "version": "1"
      },
      "io.modelcontextprotocol/clientCapabilities": {}
    }
  }
}
HTTP 200
[Asserts]
jsonpath "$.result.isError" == true
body contains "additionalProperties"
