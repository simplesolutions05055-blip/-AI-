// Sends each run's summary (and the pictures that are new or changed) to the staging qa helper,
// so the result can be read without opening GitHub.
import type { Reporter, TestCase, TestResult, FullResult, Suite, FullConfig } from '@playwright/test/reporter';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { qa } from './helpers';

const walk = (d: string): string[] => { try { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; }); } catch { return []; } };

export default class QaReporter implements Reporter {
  private t0 = Date.now();
  private passed = 0; private failed = 0; private flaky = 0; private skipped = 0;
  private failures: { test: string; error: string }[] = [];
  private suite?: Suite;
  onBegin(_c: FullConfig, suite: Suite) { this.suite = suite; }
  onTestEnd(_t: TestCase, _r: TestResult) { /* counted once at the end, after retries */ }
  async onEnd(_r: FullResult) {
    for (const test of this.suite?.allTests() ?? []) {
      const o = test.outcome();
      const last = test.results[test.results.length - 1];
      if (!last) continue;
      if (o === 'expected') this.passed++; else if (o === 'flaky') this.flaky++; else if (o === 'skipped') this.skipped++;
      else { this.failed++; this.failures.push({ test: test.titlePath().slice(1).join(' > '), error: (last.errors.map((e) => e.message || '').join(' | ') || '').replace(/\u001b\[[0-9;]*m/g, '').slice(0, 600) }); }
    }
    if (!this.passed && !this.failed && !this.flaky && !this.skipped) return; // a listing, not a run
    const sha = (process.env.GITHUB_SHA || 'local').slice(0, 12);
    const shots: { name: string; url: string; kind: string }[] = [];
    // new reference pictures (first run) and the actual/diff pictures of a changed screen
    const fresh = walk(join(process.cwd(), 'specs', '__screens__')).filter((f) => statSync(f).mtimeMs >= this.t0);
    const diffs = walk(join(process.cwd(), 'results', 'artifacts')).filter((f) => /-(actual|diff)\.png$/.test(f));
    for (const [f, kind] of [...fresh.map((f) => [f, 'new'] as const), ...diffs.map((f) => [f, /-diff\.png$/.test(f) ? 'diff' : 'actual'] as const)].slice(0, 180)) {
      const name = f.split('/').slice(-2).join('__').replace(/[^\w.-]/g, '_');
      try { const r = await qa('shot', { path: `runs/${sha}/${name}`, b64: readFileSync(f).toString('base64') }); shots.push({ name, url: r.url, kind }); } catch (e) { console.error('shot upload', name, (e as Error).message); }
    }
    const url = process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';
    try { await qa('report', { run: { sha, passed: this.passed, failed: this.failed, flaky: this.flaky, skipped: this.skipped, ms: Date.now() - this.t0, failures: this.failures, shots, url } }); }
    catch (e) { console.error('report upload', (e as Error).message); }
  }
}
