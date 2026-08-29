const requiredNames = [
  'PROMOTION_SOURCE_HOST_ID',
  'PROMOTION_SOURCE_HOST_LABEL',
  'PROMOTION_TARGET_HOST_ID',
  'PROMOTION_TARGET_HOST_LABEL',
  'PROMOTION_PLATFORM_MATCH',
  'PROMOTION_PIPELINE_MATCH',
  'PROMOTION_PIPELINE_VERSION',
  'PROMOTION_PRODUCT_ID',
  'PROMOTION_PRODUCT_VERSION',
];

export function promotionConfig() {
  const missing = requiredNames.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing promotion test configuration: ${missing.join(', ')}`);
  }

  const sourceHostId = process.env.PROMOTION_SOURCE_HOST_ID.trim();
  const targetHostId = process.env.PROMOTION_TARGET_HOST_ID.trim();
  if (sourceHostId === targetHostId) {
    throw new Error('Promotion source and target hosts must be different');
  }

  return {
    sourceHostId,
    sourceHostLabel: process.env.PROMOTION_SOURCE_HOST_LABEL.trim(),
    targetHostId,
    targetHostLabel: process.env.PROMOTION_TARGET_HOST_LABEL.trim(),
    minimumMatchingRows: Number(process.env.PROMOTION_MINIMUM_MATCHING_ROWS || 11),
    projectionTimeoutMs: Number(process.env.PROMOTION_PROJECTION_TIMEOUT_MS || 120_000),
    selectionEntity: {
      type: process.env.PROMOTION_SELECTION_ENTITY_TYPE?.trim() || 'config',
      label: process.env.PROMOTION_SELECTION_ENTITY_LABEL?.trim() || 'Config',
    },
    entities: [
      {
        type: 'platform',
        label: 'Platform',
        search: process.env.PROMOTION_PLATFORM_MATCH.trim(),
        visibleTexts: [process.env.PROMOTION_PLATFORM_MATCH.trim()],
      },
      {
        type: 'pipeline',
        label: 'Pipeline',
        search: process.env.PROMOTION_PIPELINE_MATCH.trim(),
        visibleTexts: [
          process.env.PROMOTION_PIPELINE_MATCH.trim(),
          process.env.PROMOTION_PIPELINE_VERSION.trim(),
        ],
      },
      {
        type: 'product_version',
        label: 'Product Version',
        search: process.env.PROMOTION_PRODUCT_ID.trim(),
        visibleTexts: [
          process.env.PROMOTION_PRODUCT_ID.trim(),
          process.env.PROMOTION_PRODUCT_VERSION.trim(),
        ],
      },
    ],
  };
}

export function requireAuthenticationInput(authFileExists) {
  if (authFileExists) return;
  const missing = ['PROMOTION_E2E_EMAIL', 'PROMOTION_E2E_PASSWORD']
    .filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `No reusable Playwright authentication state exists and ${missing.join(', ')} is missing`,
    );
  }
}
