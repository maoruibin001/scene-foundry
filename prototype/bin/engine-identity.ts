import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Commit of the Engine at `dir`. A source checkout answers with git; an npm release stage (bootstrap.py) records
 * the SDK manifest's engineCommit in engine-release.json and must hold exactly that package version.
 */
export function engineRevision(dir: string): { sha: string; clean: boolean; error?: string } {
  const release = join(dir, 'engine-release.json');
  if (existsSync(release)) {
    try {
      const r = JSON.parse(readFileSync(release, 'utf8'));
      const pkg = JSON.parse(readFileSync(join(dir, 'packages/engine/package.json'), 'utf8'));
      return { sha: String(r.engineCommit ?? ''), clean: pkg.name === '@forgeax/engine' && pkg.version === r.version };
    } catch (e) { return { sha: '', clean: false, error: String(e) }; }
  }
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8', timeout: 5000, maxBuffer: 4096 });
  if (head.error || head.status !== 0) return { sha: '', clean: false, error: String(head.error?.message ?? head.stderr ?? '') };
  return { sha: head.stdout.trim(), clean: spawnSync('git', ['diff', '--quiet', 'HEAD'], { cwd: dir, timeout: 5000 }).status === 0 };
}
