import { existsSync, readFileSync, statSync } from 'fs';
import { execFile } from 'child_process';
import { dirname, isAbsolute, join, resolve } from 'path';
import { promisify } from 'util';

export interface GitSnapshot {
  ahead: number;
  branch: string;
  branchIcon: string;
  behind: number;
  gitDir: string;
  hasUpstream: boolean;
  remote: string;
  service: string;
  serviceIcon: string;
  staged: boolean;
  text: string;
  unstaged: boolean;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
  conflictCount: number;
}

const GITHUB = '';
const GITLAB = '';
const BITBUCKET = '';
const AZURE = '󰠅';
const GIT = '';
const BRANCH = '';

const REFRESH_INTERVAL_MS = 1000;
const execFileAsync = promisify(execFile);

export class GitSnapshotProvider {
  private readonly snapshots = new Map<string, GitSnapshot | undefined>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private cwd: string | null = null;
  private refreshing = false;

  constructor(private readonly onChange: () => void) {}

  start(cwd: string): void {
    this.cwd = cwd;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.cwd = null;
    this.refreshing = false;
    this.snapshots.clear();
  }

  current(cwd: string): GitSnapshot | undefined {
    return this.snapshots.get(cwd);
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return;

    const cwd = this.cwd;
    if (!cwd) return;

    this.refreshing = true;
    try {
      const previous = snapshotKey(this.snapshots.get(cwd));
      const next = await readGitSnapshot(cwd);

      if (this.cwd !== cwd) return;

      this.snapshots.set(cwd, next);

      if (previous !== snapshotKey(next)) this.onChange();
    } finally {
      this.refreshing = false;
    }
  }
}

async function readGitSnapshot(cwd: string): Promise<GitSnapshot | undefined> {
  const gitDir = findGitDir(cwd);
  if (!gitDir) return undefined;

  const branch = readBranch(gitDir);
  if (!branch) return undefined;

  const remote = readOriginUrl(gitDir);
  const { service, serviceIcon } = remoteService(remote);
  const branchIcon = BRANCH;
  const text = `${serviceIcon}${branchIcon}${branch}`;
  const status = await readGitStatus(cwd);

  return { branch, branchIcon, gitDir, remote, service, serviceIcon, text, ...status };
}

function snapshotKey(snapshot: GitSnapshot | undefined): string {
  if (!snapshot) return '';
  return [
    snapshot.text,
    snapshot.staged,
    snapshot.unstaged,
    snapshot.ahead,
    snapshot.behind,
    snapshot.hasUpstream,
    snapshot.stagedCount,
    snapshot.modifiedCount,
    snapshot.untrackedCount,
    snapshot.conflictCount,
  ].join('|');
}

type GitStatusCounts = Pick<
  GitSnapshot,
  | 'staged'
  | 'unstaged'
  | 'ahead'
  | 'behind'
  | 'hasUpstream'
  | 'stagedCount'
  | 'modifiedCount'
  | 'untrackedCount'
  | 'conflictCount'
>;

async function readGitStatus(cwd: string): Promise<GitStatusCounts> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'status', '--porcelain=v2', '--branch'], {
      encoding: 'utf8',
      timeout: 500,
    });
    return parseGitStatus(stdout);
  } catch {
    return {
      staged: false,
      unstaged: false,
      ahead: 0,
      behind: 0,
      hasUpstream: false,
      stagedCount: 0,
      modifiedCount: 0,
      untrackedCount: 0,
      conflictCount: 0,
    };
  }
}

function parseGitStatus(output: string): GitStatusCounts {
  let ahead = 0;
  let behind = 0;
  let hasUpstream = false;
  let stagedCount = 0;
  let modifiedCount = 0;
  let untrackedCount = 0;
  let conflictCount = 0;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('# branch.upstream ')) {
      hasUpstream = true;
      continue;
    }

    const branch = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);
    if (branch) {
      hasUpstream = true;
      ahead = Number.parseInt(branch[1] ?? '0', 10);
      behind = Number.parseInt(branch[2] ?? '0', 10);
      continue;
    }

    if (line.startsWith('? ')) {
      untrackedCount += 1;
      continue;
    }

    if (line.startsWith('u ')) {
      conflictCount += 1;
      continue;
    }

    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const indexStatus = line[2];
      const worktreeStatus = line[3];
      if (indexStatus && indexStatus !== '.') stagedCount += 1;
      if (worktreeStatus && worktreeStatus !== '.') modifiedCount += 1;
    }
  }

  const staged = stagedCount > 0 || conflictCount > 0;
  const unstaged = modifiedCount > 0 || untrackedCount > 0 || conflictCount > 0;

  return {
    staged,
    unstaged,
    ahead,
    behind,
    hasUpstream,
    stagedCount,
    modifiedCount,
    untrackedCount,
    conflictCount,
  };
}

function findGitDir(startDir: string): string | undefined {
  let dir = resolve(startDir);

  while (true) {
    const candidate = join(dir, '.git');
    const gitDir = resolveGitDir(candidate);
    if (gitDir) return gitDir;

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function resolveGitDir(path: string): string | undefined {
  if (!existsSync(path)) return undefined;

  const stat = statSync(path);
  if (stat.isDirectory()) return path;
  if (!stat.isFile()) return undefined;

  const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(path, 'utf8'));
  if (!match?.[1]) return undefined;

  const gitDir = match[1].trim();
  return isAbsolute(gitDir) ? gitDir : resolve(dirname(path), gitDir);
}

function readBranch(gitDir: string): string | undefined {
  const head = readOptional(join(gitDir, 'HEAD'))?.trim();
  if (!head) return undefined;

  const refPrefix = 'ref: refs/heads/';
  if (head.startsWith(refPrefix)) return truncate(head.slice(refPrefix.length));

  return truncate(head.slice(0, 7));
}

function readOriginUrl(gitDir: string): string {
  const config = readOptional(join(gitDir, 'config'));
  if (!config) return '';

  let inOrigin = false;
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inOrigin = line === '[remote "origin"]';
      continue;
    }
    if (!inOrigin) continue;

    const match = /^url\s*=\s*(.+)$/.exec(line);
    if (match?.[1]) return match[1].trim();
  }

  return '';
}

function remoteService(remote: string): Pick<GitSnapshot, 'service' | 'serviceIcon'> {
  if (remote.includes('github')) return { service: 'github', serviceIcon: GITHUB };
  if (remote.includes('gitlab')) return { service: 'gitlab', serviceIcon: GITLAB };
  if (remote.includes('bitbucket')) return { service: 'bitbucket', serviceIcon: BITBUCKET };
  if (remote.includes('azure') || remote.includes('visualstudio')) {
    return { service: 'azure', serviceIcon: AZURE };
  }
  return { service: remote ? 'git' : '', serviceIcon: GIT };
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function truncate(value: string): string {
  return value.length > 25 ? `${value.slice(0, 25)}…` : value;
}
