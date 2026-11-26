// Sernau published two Lean source roots in a single Git commit.
export const sernauCommit = "72fead102f663d5c7a407964a13dc0cf9d977207";
const editions = new Map([
  ["grh", "sernau-grh-72fead102f66"],
  ["grh-compact", "sernau-compact-72fead102f66"],
]);
const selectors = new Map([...editions].map(([edition, selector]) => [selector, edition]));

export function externalEdition(selector) {
  return selectors.get(selector) || null;
}

export function snapshotSelector(params) {
  const value = params.get("snapshot");
  if (value !== sernauCommit) return value;
  const edition = params.get("edition") ?? "grh-compact";
  return editions.get(edition) || sernauCommit + "/" + edition;
}

export function setSnapshotAddress(url, selector) {
  const edition = externalEdition(selector);
  url.searchParams.set("snapshot", edition ? sernauCommit : selector);
  if (edition) url.searchParams.set("edition", edition);
  else url.searchParams.delete("edition");
  return url;
}

export function sourceTreeURL(revision) {
  const repository = revision.sourceRepository || "leanprover-community/riemann-hypothesis";
  const commit = revision.sourcePin || revision.pin;
  const directory = revision.sourcePath || "src";
  return "https://github.com/" + repository + "/tree/" + commit + "/" + directory;
}
