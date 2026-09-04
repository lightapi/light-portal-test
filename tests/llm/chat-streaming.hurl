POST {{base_url}}/v1/chat/completions
Authorization: Bearer {{access_token}}
Content-Type: application/json
X-Correlation-Id: light-portal-test-chat-streaming-{{run_id}}
{
  "model": "{{llm_model}}",
  "messages": [
    {
      "role": "user",
      "content": "Reply with exactly: stream-ok"
    }
  ],
  "temperature": 0,
  "max_tokens": 256,
  "stream": true
}

HTTP 200
[Asserts]
header "content-type" startsWith "text/event-stream"
body contains "\"object\":\"chat.completion.chunk\""
body contains "\"finish_reason\":\"stop\""
body contains "data: [DONE]"
