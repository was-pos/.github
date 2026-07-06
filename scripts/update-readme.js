// Fetches repo counts + language breakdown for the was-pos org
// and rewrites the marked section of profile/README.md
// Requires an env var ORG_TOKEN with 'repo' + 'read:org' scopes (org-level secret)

const ORG = "was-pos";
const README_PATH = "profile/README.md";
const TOKEN = process.env.ORG_TOKEN;

// GitHub's /languages API counts raw bytes. Notebook .ipynb files are JSON
// with embedded cell outputs (often base64 images), so a few notebooks can
// dwarf the real codebase — exclude them from the percentage breakdown.
const EXCLUDED_LANGUAGES = new Set(["Jupyter Notebook"]);

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
};

async function ghGet(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API error ${res.status} on ${url}`);
  return res.json();
}

async function getAllRepos() {
  let page = 1;
  let repos = [];
  while (true) {
    const batch = await ghGet(
      `https://api.github.com/orgs/${ORG}/repos?type=all&per_page=100&page=${page}`
    );
    repos = repos.concat(batch);
    if (batch.length < 100) break;
    page++;
  }
  // Exclude forks — a forked repo's language stats belong to the upstream
  // project, not to work actually authored by this org.
  const ownRepos = repos.filter((r) => !r.fork);
  const forkCount = repos.length - ownRepos.length;
  if (forkCount > 0) {
    console.log(`Excluded ${forkCount} forked repo(s) from stats.`);
  }
  return ownRepos;
}

async function getLanguageTotals(repos) {
  const totals = {};
  for (const repo of repos) {
    const langs = await ghGet(
      `https://api.github.com/repos/${ORG}/${repo.name}/languages`
    );
    for (const [lang, bytes] of Object.entries(langs)) {
      if (EXCLUDED_LANGUAGES.has(lang)) {
        console.log(`Excluded ${bytes} bytes of ${lang} in ${repo.name}.`);
        continue;
      }
      totals[lang] = (totals[lang] || 0) + bytes;
    }
  }
  return totals;
}

function topLanguagesTable(totals, topN = 5) {
  const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);
  return sorted
    .map(([lang, bytes]) => {
      const pct = ((bytes / sum) * 100).toFixed(1);
      return `| ${lang} | ${pct}% |`;
    })
    .join("\n");
}

async function main() {
  const repos = await getAllRepos();
  const publicCount = repos.filter((r) => !r.private).length;
  const privateCount = repos.filter((r) => r.private).length;
  const languageTotals = await getLanguageTotals(repos);

  const block = `<!--STATS_START-->
**Org stats** _(auto-updated)_

| Metric | Count |
|---|---|
| Public repos | ${publicCount} |
| Private repos | ${privateCount} |
| Total repos | ${repos.length} |

**Top languages across all repos**

| Language | % of codebase |
|---|---|
${topLanguagesTable(languageTotals)}

_Last updated: ${new Date().toISOString().split("T")[0]}_
<!--STATS_END-->`;

  const fs = await import("fs");
  const current = fs.readFileSync(README_PATH, "utf8");
  const updated = current.replace(
    /<!--STATS_START-->[\s\S]*?<!--STATS_END-->/,
    block
  );
  fs.writeFileSync(README_PATH, updated);
  console.log("README updated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
