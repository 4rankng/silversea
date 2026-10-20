import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// User report 2026-10-20: an installed (Home Screen) PWA still showed the
// login © footer — web chrome that has no place in a native-feeling launch.
// The hiding is CSS, driven by the hybrid `pwa-standalone` class from
// lib/pwa-standalone.ts with the display-mode media query as belt-and-braces
// (iOS WebKit evaluates that query false even when launched standalone).

const cwd = process.cwd();

function read(relativePath: string): string {
  return readFileSync(resolve(cwd, relativePath), 'utf8');
}

const utilitiesCss = read('src/styles/utilities.css');
const loginTsx = read('src/pages/LoginPage.tsx');
const loginCss = read('src/pages/LoginPage.css');

describe('installed-PWA chrome suppression contract', () => {
  it('ships the hybrid class rule AND the belt-and-braces display-mode media query', () => {
    expect(utilitiesCss).toMatch(/\.pwa-standalone \.hide-in-pwa\s*\{\s*display:\s*none !important;/);
    expect(utilitiesCss).toMatch(/@media all and \(display-mode: standalone\)\s*\{\s*\.hide-in-pwa\s*\{\s*display:\s*none !important;/);
  });

  it('marks the login © footer and the marketing hero copy as web-only chrome', () => {
    expect(loginTsx).toContain('className="login-footer hide-in-pwa"');
    expect(loginTsx).toContain('className="login-visual__content hide-in-pwa"');
  });

  it('keeps home-indicator clearance once the footer stops carrying the safe-area padding', () => {
    expect(loginCss).toMatch(
      /\.pwa-standalone \.login-auth-panel\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom/,
    );
  });

  it('does not hide the chrome on the open web — browser visitors keep the branding', () => {
    // Every `.hide-in-pwa { … }` rule must be scoped to an installed context:
    // the html class descendant form, or inside the display-mode media query.
    // A bare top-level rule would hide the footer for everyone.
    const ruleRe = /[^{}\n]*\.hide-in-pwa[^{}\n]*\{/g;
    const rules: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = ruleRe.exec(utilitiesCss)) !== null) rules.push(match[0]);

    const mediaStart = utilitiesCss.indexOf('@media all and (display-mode: standalone)');
    const mediaEnd = mediaStart === -1 ? -1 : utilitiesCss.indexOf('\n}', mediaStart);

    for (const rule of rules) {
      const start = utilitiesCss.indexOf(rule);
      const scoped = rule.includes('.pwa-standalone .hide-in-pwa')
        || (mediaStart !== -1 && mediaEnd !== -1 && start > mediaStart && start < mediaEnd);
      expect(scoped, `unscoped hide rule: ${rule.trim()}`).toBe(true);
    }
    // One descendant rule + one belt-and-braces media rule.
    expect(rules.length).toBe(2);
  });
});
