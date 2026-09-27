import {defineConfig} from '@playwright/test';
import publicationConfig from './playwright.workflow-mcp-publication.config.js';

export default defineConfig({
  ...publicationConfig,
  testDir: './tests/workflow-tool-binding',
  globalSetup: undefined,
  use: {...publicationConfig.use, storageState: process.env.WORKFLOW_TOOL_BINDING_AUTHOR_STATE || undefined},
});
