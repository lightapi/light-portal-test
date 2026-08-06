GET {{base_url}}/v1/models
Authorization: Bearer {{access_token}}
X-Correlation-Id: light-portal-test-models-{{run_id}}

HTTP 200
[Asserts]
jsonpath "$.object" == "list"
jsonpath "$.data" count > 0
jsonpath "$.data[*].id" contains "{{llm_model}}"
jsonpath "$.data[0].object" == "model"
jsonpath "$.data[0].owned_by" == "light-gateway"
