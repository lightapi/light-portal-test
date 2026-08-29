GET {{promotion_api_base_url}}/portal/query
Authorization: Bearer {{access_token}}
[QueryStringParams]
cmd: {"host":"lightapi.net","service":"user","action":"getPromotionHistory","version":"0.1.0","data":{"hostId":"{{promotion_target_host_id}}","offset":0,"limit":10,"sorting":"[]","filters":"[]","globalFilter":""}}
HTTP 200
[Asserts]
jsonpath "$.promotions" exists
jsonpath "$.total" exists

GET {{promotion_api_base_url}}/portal/query
Authorization: Bearer {{access_token}}
[QueryStringParams]
cmd: {"host":"lightapi.net","service":"user","action":"exportSnapshot","version":"0.1.0","data":{"sourceHostId":"{{promotion_source_host_id}}","entityType":"platform","selection":{"mode":"allMatching","sorting":"[]","filters":"[]","globalFilter":"{{promotion_platform_match}}","active":true},"includeChildren":true,"includeSiblings":true}}
HTTP 200
[Asserts]
body contains "{{promotion_platform_match}}"

GET {{promotion_api_base_url}}/portal/query
Authorization: Bearer {{access_token}}
[QueryStringParams]
cmd: {"host":"lightapi.net","service":"user","action":"exportSnapshot","version":"0.1.0","data":{"sourceHostId":"{{promotion_source_host_id}}","entityType":"pipeline","selection":{"mode":"allMatching","sorting":"[]","filters":"[]","globalFilter":"{{promotion_pipeline_match}}","active":true},"includeChildren":true,"includeSiblings":true}}
HTTP 200
[Asserts]
body contains "{{promotion_pipeline_match}}"

GET {{promotion_api_base_url}}/portal/query
Authorization: Bearer {{access_token}}
[QueryStringParams]
cmd: {"host":"lightapi.net","service":"user","action":"exportSnapshot","version":"0.1.0","data":{"sourceHostId":"{{promotion_source_host_id}}","entityType":"product_version","selection":{"mode":"allMatching","sorting":"[]","filters":"[]","globalFilter":"{{promotion_product_id}}","active":true},"includeChildren":true,"includeSiblings":true}}
HTTP 200
[Asserts]
body contains "{{promotion_product_id}}"
body contains "{{promotion_product_version}}"
