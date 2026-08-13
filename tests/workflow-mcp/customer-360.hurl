POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/list
X-Correlation-Id: light-portal-test-customer-360-list-{{run_id}}
{
  "jsonrpc": "2.0",
  "id": "customer-360-list-{{run_id}}",
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
jsonpath "$.result.tools[*].name" contains "{{customer_360_tool}}"

POST {{mcp_base_url}}/mcp
Authorization: Bearer {{access_token}}
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: tools/call
MCP-Name: {{customer_360_tool}}
X-Correlation-Id: light-portal-test-customer-360-call-{{run_id}}
{
  "jsonrpc": "2.0",
  "id": "customer-360-call-{{run_id}}",
  "method": "tools/call",
  "params": {
    "name": "{{customer_360_tool}}",
    "arguments": {
      "customerId": "CUST-1001",
      "channel": "portal"
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
jsonpath "$.result.isError" == false
body contains "CUST-1001"
body contains "Avery Chen"
body contains "travel"
body contains "POL-AUTO-1001"
