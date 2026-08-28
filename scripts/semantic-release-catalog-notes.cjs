const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

module.exports = {
  generateNotes() {
    return execFileSync("bun", [join(__dirname, "catalog-release-notes.ts")], {
      encoding: "utf8",
    });
  },
};
