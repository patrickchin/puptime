import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig(async()=>({
 plugins:[cloudflareTest(({inject})=>({
  wrangler:{configPath:'./wrangler.jsonc'},remoteBindings:false,
  miniflare:{bindings:{ENVIRONMENT:'local',SENTRY_DSN:`${inject('sentryTestOrigin').replace('http://','http://public@')}/42`}},
 }))],
 test:{include:['server/observability.integration.ts'],globalSetup:['./scripts/sentry-test-ingestion.mjs'],provide:{migrations:await readD1Migrations('server/migrations')}},
}));
