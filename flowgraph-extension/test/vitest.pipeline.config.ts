import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/check_flow_pipeline.test.ts'], environment: 'node', testTimeout: 15000 } });
