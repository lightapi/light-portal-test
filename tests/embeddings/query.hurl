POST {{base_url}}/v1/embeddings
Authorization: Bearer {{embedding_query_access_token}}
Content-Type: application/json
X-Correlation-Id: light-portal-test-embedding-query-{{run_id}}
X-Light-Expected-Embedding-Space-Id: {{embedding_space_id}}
X-Light-Expected-Embedding-Space-Revision: {{embedding_space_revision}}
{
  "model": "{{embedding_query_alias}}",
  "input": "light-gateway embedding query validation"
}
HTTP 200
[Asserts]
header "content-type" startsWith "application/json"
header "x-light-embedding-space-id" == "{{embedding_space_id}}"
header "x-light-embedding-space-revision" == "{{embedding_space_revision}}"
jsonpath "$.object" == "list"
jsonpath "$.model" == "{{embedding_query_alias}}"
jsonpath "$.data" count == 1
jsonpath "$.data[0].object" == "embedding"
jsonpath "$.data[0].index" == 0
jsonpath "$.data[0].embedding" count == {{embedding_dimension}}
