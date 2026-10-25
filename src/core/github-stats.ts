/** A GitHub repository as its button shows it: the latest release, stars and forks. */
export interface RepositoryStats {
  release?: string;
  stars: number;
  forks: number;
}

/** `owner/repo` from a repository's address on GitHub, or undefined for any other address. */
export function githubRepository(href: string): string | undefined {
  return /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(href)?.[1];
}

/** Each repository read once while the process runs: a build once, a dev server once a session. */
const read = new Map<string, Promise<RepositoryStats>>();

/**
 * A repository's latest release, stars and forks from GitHub's API: two
 * requests, made with `GITHUB_TOKEN` when it is set, for GitHub's higher
 * limit. A repository with no release has no release to show. GitHub has
 * three seconds to answer, so a slow answer never holds a build for long.
 */
export function repositoryStats(repository: string): Promise<RepositoryStats> {
  let stats = read.get(repository);
  if (!stats) {
    stats = readStats(repository);
    read.set(repository, stats);
    // A failed read is tried again on the next build.
    stats.catch(() => read.delete(repository));
  }
  return stats;
}

async function readStats(repository: string): Promise<RepositoryStats> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "sourcey", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const api = `https://api.github.com/repos/${repository}`;
  const get = async (url: string) => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
    if (response.status === 404 && url !== api) return undefined;
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${url}`);
    return (await response.json()) as Record<string, unknown>;
  };
  const [repo, release] = await Promise.all([get(api), get(`${api}/releases/latest`)]);
  return {
    stars: Number(repo!.stargazers_count),
    forks: Number(repo!.forks_count),
    ...(typeof release?.tag_name === "string" ? { release: release.tag_name } : {}),
  };
}
