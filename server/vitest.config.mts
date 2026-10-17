import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
export default defineConfig(async () => ({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, remoteBindings: false })],
  test: { include: ['server/*.test.ts'], provide: { migrations: await readD1Migrations('server/migrations') } },
}));
