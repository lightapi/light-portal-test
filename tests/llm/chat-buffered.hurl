POST {{base_url}}/v1/chat/completions
Authorization: Bearer {{access_token}}
Content-Type: application/json
X-Correlation-Id: light-portal-test-chat-buffered-{{run_id}}
{
  "model": "{{llm_model}}",
  "messages": [
    {
      "role": "user",
      "content": "Reply with exactly: gateway-ok"
    }
  ],
  "temperature": 0,
  "max_tokens": 256,
  "stream": false
}

HTTP 200
[Asserts]
jsonpath "$.choices" count > 0
jsonpath "$.choices[0].finish_reason" == "stop"
jsonpath "$.choices[0].message.role" == "assistant"
jsonpath "$.choices[0].message.content" contains "gateway-ok"
jsonpath "$.choices[0].message.tool_calls" isList
jsonpath "$.model" == "{{llm_model}}"
jsonpath "$.object" == "chat.completion"
jsonpath "$.usage.prompt_tokens" > 0
jsonpath "$.usage.completion_tokens" > 0
jsonpath "$.usage.total_tokens" > 0
