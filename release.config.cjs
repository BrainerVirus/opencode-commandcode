module.exports = {
  branches: ["main"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "./scripts/semantic-release-catalog-notes.cjs",
    "@semantic-release/release-notes-generator",
    "./scripts/semantic-release-changelog.cjs",
    "@semantic-release/npm",
    "@semantic-release/github",
  ],
};
