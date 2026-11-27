import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { websiteTheme } from './brand.ts';

test('website CSS color tokens match websiteTheme', () => {
  const css = readFileSync(new URL('./website.css', import.meta.url), 'utf8');
  const block = css.match(/\.marketing-site,\s*\.static-page\s*\{([^}]*)\}/)?.[1];
  assert.ok(block, 'website.css must define the shared tokens once');
  const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim().toLowerCase()]));
  const expected = {
    paper: websiteTheme.background, white: websiteTheme.surface, ink: websiteTheme.text, muted: websiteTheme.textMuted, border: websiteTheme.border,
    green: websiteTheme.primary, deep: websiteTheme.primaryPressed, mint: websiteTheme.primarySoft, danger: websiteTheme.danger,
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(tokens[name], value.toLowerCase(), `--${name}`);
  for (const name of Object.keys(expected)) assert.equal(css.match(new RegExp(`--${name}:`, 'g'))?.length, 1, `--${name} is defined once`);
});
