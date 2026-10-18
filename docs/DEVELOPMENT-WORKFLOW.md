# GitHub and release workflow

Recorded 18 October 2026. The owner supplied [Satya2n/hotpizzaace](https://github.com/Satya2n/hotpizzaace); local Git is initialized and connected to its existing history. `.github/workflows/ci.yml` and `.nvmrc` configure the quality pipeline described below. The original README commit is preserved. Supabase, Hostinger and automated deployment remain Phase 2 work. Check the repository's [Actions page](https://github.com/Satya2n/hotpizzaace/actions) for the result of each uploaded commit.

## Ownership and setup needed now

1. The repository owner is `Satya2n`; repository visibility and collaborator permissions should be reviewed in GitHub before adding other contributors. Use a private repository for business code where appropriate.
2. `.gitignore` excludes dependencies, build output, local environment secrets, logs and test output. Never commit customer-data exports, production secrets or credentials. Public demo credentials are examples and must be replaced before live use.
3. The prototype baseline includes the lockfile and QA notes. CI checks every pull request, pushes to `main`/`staging`, and manual runs from Actions. The job/check name is **Quality checks**.
4. Node **24.20.0** is pinned in `.nvmrc` and used by CI. Use `nvm use` when nvm is installed. Verify the supported runtime on Hostinger during Phase 2.
5. Agree a branch protection plan. GitHub Free offers private repositories and an Actions allowance, but enforced required checks and review rules on private repositories require personal Pro or business Team (or above). On Free, reviews/checks are a working convention rather than an enforced merge barrier.

## Suggested release path

`feature/* → pull request into staging → automated checks → staging app → ordering/admin QA → pull request into main → checks/review → production app → release tag`

- `feature/*` or `fix/*`: one focused change, with a meaningful commit and PR description.
- `staging`: the combined candidate release. During Phase 2 connect a separate Hostinger app and development Supabase project with test payments. The staging app should have restricted access where supported and must not receive live customer/payment data.
- `main`: the production source. Merge the tested release through a PR. Configure required checks and prevent direct/force pushes when the selected GitHub plan supports enforcement. If at least two maintainers are available, require an independent PR review; a solo owner can still review the diff and merge after successful checks, without claiming an independent approval.
- After production smoke checks pass, tag the deployed commit, for example `v1.0.0` for the first accepted live launch, `v1.0.1` for a fix or `v1.1.0` for a compatible feature. Record the commit, date, changes and any migration in release notes. These are examples; no tag exists yet.

GitHub Actions should install exactly the lockfile dependencies with `npm ci`, run lint and the domain/store tests, run the production build, and run TypeScript checking against the generated build types. Add browser journeys when the hosted staging flow exists. Keep the jobs free of production credentials. Avoid deploying unreviewed pull-request code with privileged secrets.

The configured workflow uses read-only repository permissions, pins checkout/setup-node to verified release commit SHAs, and cancels stale runs on the same PR/branch. It contains no deploy step or production secrets. `npm ci` runs in a fresh runner; builds must precede the explicit type check so Next.js route types are generated. See the CI job's logs for individual results.

For an ordinary change, create a branch such as `feature/menu-improvement`, commit the change, push that branch, and open a PR targeting `staging`. Merge the tested release from `staging` to `main` through another PR. If working solo, review the diff and successful checks before merging. Do not use force pushes to update shared release branches.

## Hostinger connection in Phase 2

Managed Node deployment supports selecting a GitHub branch and redeploying on pushes to it. Use separate app slots for staging and production, with separate variables, callback URLs and payment/webhook secrets. Confirm slots and resource limits on the chosen plan.

Do not assume Hostinger waits for GitHub Actions. Checks and approval must happen before the production branch changes; make the deployment build run the relevant checks too so a failing check stops that build. A native managed-Node auto-deployment toggle or a wait-for-CI integration has not been verified. Manual Redeploy fetches the latest connected branch, so it must not be described as selecting any historical artifact.

## Recovery and database changes

For a faulty code release, open a revert PR, run checks and redeploy the corrected branch. Keep a record of the last healthy release commit and test the recovery process on staging. Code versions in Git do not back up the database. Supabase migrations, backup/restore and deployment compatibility must be planned separately; avoid destructive schema changes that break the previous code release.

Admin edits to menu/prices, live orders and addresses are application data, not Git commits. Phase 2 needs database backups and an audit trail for sensitive admin changes. In the current prototype these edits live only in browser storage, and pushing the code to GitHub will not transfer them.

## References verified for this plan

- [GitHub Node.js CI](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)
- [GitHub Actions billing and included usage](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Private-repository branch protection availability](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Hostinger GitHub branch selection](https://www.hostinger.com/support/how-to-migrate-a-node-js-application-to-hostinger/)
- [Hostinger deployment on push](https://www.hostinger.com/support/how-to-deploy-apps-built-with-codex-on-hostinger/)
- [Hostinger manual redeploy](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/)
