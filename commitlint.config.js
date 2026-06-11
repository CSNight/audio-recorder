export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", ["feat", "fix", "docs", "style", "chore", "refactor", "test", "build"]],
    "scope-case": [2, "always", "lower-case"],
  },
  ignores: [(commit) => commit.startsWith("Merge "), (commit) => commit.startsWith("Revert ")],
}
