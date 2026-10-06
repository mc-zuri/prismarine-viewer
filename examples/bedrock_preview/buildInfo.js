// What a build of the pages was made of: the viewer and each fork it takes, with the repository, branch and commit of
// each (and whether its checkout had changes not committed). build-site.js writes it into the site as build.json, the
// server works it out as it serves /build.json, and index.html shows it.
//
//   buildInfo() -> { built, run, packages: [{ name, of, repo, branch, commit, dirty, from }] }
//     of       the package a checkout is nested in (a data fork's data: its own repository, in its folder)
//     repo     'owner/name' on GitHub (null where it is somewhere else: url then says where)
//     from     'git': the package is a checkout of its own (the viewer, a data fork cloned or linked);
//              'local copy': copied from a checkout by link-local.mjs, which notes that checkout's facts (.link-local.json);
//              'lockfile': installed from GitHub by npm, at the commit its lockfile names;
//              'package.json': only what package.json asks for (a branch, no commit)
//     run      the GitHub Actions run that built the site, if one did
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '../..')
// the packages, by their folder in node_modules (a data fork's data is a checkout of its own inside it)
const PACKAGES = [
  { name: 'prismarine-viewer', dir: '.' },
  { name: 'minecraft-data', dir: 'node_modules/minecraft-data' },
  { name: 'minecraft-data', of: 'minecraft-data', dir: 'node_modules/minecraft-data/minecraft-data' },
  { name: 'minecraft-assets', dir: 'node_modules/minecraft-assets' },
  { name: 'minecraft-assets', of: 'minecraft-assets', dir: 'node_modules/minecraft-assets/minecraft-assets' },
  { name: 'prismarine-registry', dir: 'node_modules/prismarine-registry' },
  { name: 'prismarine-chunk', dir: 'node_modules/prismarine-chunk' },
  { name: 'prismarine-block', dir: 'node_modules/prismarine-block' },
  { name: 'bedrock-protocol', dir: 'node_modules/bedrock-protocol' },
  { name: 'prismarine-physics', dir: 'node_modules/prismarine-physics-bedrock', package: 'prismarine-physics-bedrock' }
]
const MARKER = '.link-local.json'

const git = (dir, ...args) => {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

// 'git@github.com:owner/name.git', 'https://github.com/owner/name', 'git+ssh://git@github.com/owner/name.git#sha',
// 'github:owner/name#branch' -> 'owner/name'; null for anything not on GitHub
function githubRepo (url) {
  const match = /^github:([^/#]+\/[^/#]+)/.exec(url ?? '') ?? /github\.com[/:]([^/]+\/[^/#]+?)(?:\.git)?(?:#|$)/.exec(url ?? '')
  return match ? match[1] : null
}

// The facts of a checkout: its repository, branch, commit and whether it has changes to tracked files. Its repository
// is that of the remote named wanted ('owner/name', what package.json asks for), else of its branch's upstream, else of
// a remote that has its branch, else origin's. null where dir is not the top of a checkout of its own (a package in
// node_modules sits in the viewer's checkout).
function gitFacts (dir, wanted = null) {
  const top = git(dir, 'rev-parse', '--show-toplevel')
  if (!top || fs.realpathSync(top) !== fs.realpathSync(dir)) return null
  const branch = git(dir, 'symbolic-ref', '--short', 'HEAD')
  const remotes = (git(dir, 'remote') ?? '').split('\n').filter(Boolean).map(name => ({ name, url: git(dir, 'remote', 'get-url', name) }))
  const upstream = git(dir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')?.split('/')[0]
  const remote = remotes.find(r => wanted && githubRepo(r.url)?.toLowerCase() === wanted.toLowerCase()) ??
    remotes.find(r => r.name === upstream) ??
    remotes.find(r => branch && git(dir, 'rev-parse', '--verify', '--quiet', `refs/remotes/${r.name}/${branch}`)) ??
    remotes.find(r => r.name === 'origin') ?? remotes[0]
  return {
    repo: githubRepo(remote?.url),
    url: remote?.url ?? null,
    branch,
    commit: git(dir, 'rev-parse', 'HEAD'),
    dirty: !!git(dir, 'status', '--porcelain', '--untracked-files=no')
  }
}

function buildInfo () {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const asked = { ...manifest.dependencies, ...manifest.devDependencies }
  const lockFile = path.join(root, 'node_modules/.package-lock.json')
  const locked = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')).packages : {}
  const packages = []
  for (const { name, of = null, dir, package: pkg = name } of PACKAGES) {
    const full = path.join(root, dir)
    if (!fs.existsSync(full)) continue
    // (package.json asks for the package, not for the data nested in it)
    const spec = of ? null : asked[pkg]
    const wanted = { repo: githubRepo(spec), branch: /#(.+)$/.exec(spec ?? '')?.[1] ?? null }
    const marker = path.join(full, MARKER)
    if (fs.existsSync(marker)) {
      packages.push({ name, of, ...wanted, ...JSON.parse(fs.readFileSync(marker, 'utf8')), from: 'local copy' })
      continue
    }
    const facts = gitFacts(full, wanted.repo)
    if (facts) {
      // (a checkout CI made of a pushed branch may stand detached on it)
      const branch = facts.branch ?? (dir === '.' ? process.env.GITHUB_REF_NAME : null) ?? wanted.branch
      packages.push({ name, of, ...facts, branch, from: 'git' })
      continue
    }
    const resolved = locked[dir.replace(/\\/g, '/')]?.resolved
    const commit = /#([0-9a-f]{40})$/.exec(resolved ?? '')?.[1]
    if (commit) packages.push({ name, of, repo: githubRepo(resolved) ?? wanted.repo, branch: wanted.branch, commit, dirty: false, from: 'lockfile' })
    else packages.push({ name, of, ...wanted, commit: null, dirty: false, from: 'package.json' })
  }
  const run = process.env.GITHUB_RUN_ID && `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  return { built: new Date().toISOString(), run: run || null, packages }
}

module.exports = { buildInfo, gitFacts, githubRepo, MARKER }

if (require.main === module) console.log(JSON.stringify(buildInfo(), null, 2))
