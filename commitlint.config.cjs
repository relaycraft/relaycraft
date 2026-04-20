const allowedTypes = ["feat", "fix", "refactor", "style", "chore", "docs", "perf"];

module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", allowedTypes],
    "type-case": [2, "always", "lower-case"],
    "type-empty": [2, "never"],
    "scope-case": [2, "always", ["kebab-case", "lower-case"]],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "subject-max-length": [2, "always", 72],
    "header-max-length": [2, "always", 88],
    "body-leading-blank": [2, "always"],
    "footer-leading-blank": [2, "always"],
  },
};
