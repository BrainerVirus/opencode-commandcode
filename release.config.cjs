module.exports = {
  branches: ["main"],
  plugins: [
    // Path-gated: prints major|minor|patch only when src/plugin/catalog files
    // changed since the previous v* tag. Empty output skips npm + GitHub.
    [
      "@semantic-release/exec",
      {
        analyzeCommitsCmd: "bun scripts/analyze-release-scope.ts",
      },
    ],
    "./scripts/semantic-release-catalog-notes.cjs",
    "@semantic-release/release-notes-generator",
    "./scripts/semantic-release-changelog.cjs",
    "@semantic-release/npm",
    "@semantic-release/github",
  ],
};
