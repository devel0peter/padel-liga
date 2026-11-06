// Conventional Commits, checked in CI on pull requests (.github/workflows/ci.yml).
//
// Dependabot's commits are skipped (#285): their subject is "chore(deps): Bump
// ..." (capitalized) and their body has long lines, and their text is not ours
// to change. Narrow on purpose: a commit is skipped only with Dependabot's own
// sign-off trailer AND a "Bump" subject in the deps scope, so every human
// commit is still checked. Local check, from the repo root:
//   printf 'chore(deps): Bump qs from 1 to 2\n\nSigned-off-by: dependabot[bot] <support@github.com>\n' | npx commitlint  # passes
//   printf 'chore(deps): Bump qs from 1 to 2\n' | npx commitlint  # fails: subject-case
const DEPENDABOT_SUBJECT = /^(chore|build|fix)\(deps(-dev)?\): Bump /;
const DEPENDABOT_SIGN_OFF = /^Signed-off-by: dependabot\[bot\] <support@github\.com>$/m;

export const isDependabotCommit = (message) => DEPENDABOT_SUBJECT.test(message) && DEPENDABOT_SIGN_OFF.test(message);

export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [isDependabotCommit],
};
