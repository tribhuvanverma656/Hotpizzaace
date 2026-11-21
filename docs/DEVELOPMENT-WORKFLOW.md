# GitHub and release workflow

Use two long-lived branches in [Satya2n/hotpizzaace](https://github.com/Satya2n/hotpizzaace):

| Branch    | Purpose                        | Render service                                                          |
| --------- | ------------------------------ | ----------------------------------------------------------------------- |
| `staging` | Active development and testing | [hotpizzaace-development](https://hotpizzaace-development.onrender.com) |
| `main`    | Owner-approved release source  | [hotpizzaace.com](https://hotpizzaace.com), service `hotpizzaace`       |

The workflow is **local change → push to staging → CI → development preview → owner testing → release PR to main**. Updating `staging` does not promote a release to `main`.

## Environment status — 3 November 2026

Production runs owner-approved [PR #18](https://github.com/Satya2n/hotpizzaace/pull/18),
merge `1973014eb741b4e575e8af9e1f4a0d861296dc8e`, retaining PR #19's product-saving
feedback. Render deployment `dep-dbkmipks728c738ru1g0` finished live at 04:59:50 UTC.
Both `main` and `staging` are aligned at that merge at this snapshot; main
[CI #123](https://github.com/Satya2n/hotpizzaace/actions/runs/41580946182) and staging
[CI #124](https://github.com/Satya2n/hotpizzaace/actions/runs/41581623545) passed.
The new nearest-rupee rounding request is separate development work and is not
included in this production release.

The production chef schema and dedicated backend are deployed and its feature flag
is enabled. The separate chef login and owner staff-management UI render, but no
production chef account has been created yet. Barra counter/branch QR ordering
uses cash or direct merchant UPI; website checkout, COD and live online payments
remain paused. Owner password-save investigation remains deferred.

| Environment | Application / source                                                               | Separate Supabase project                         |
| ----------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| Development | [hotpizzaace-development](https://hotpizzaace-development.onrender.com), `staging` | `hotpizzaaceDB` (`kaypgsstngguvrpftpwo`)          |
| Production  | [hotpizzaace.com](https://hotpizzaace.com), `main`, Render service `hotpizzaace`   | `hotpizzaace-production` (`vzehsdwwaybcxvzodqaq`) |

Each environment keeps its own credentials, customers, orders and settings.
Source promotion does not copy development data into production. See
[project status](PROJECT-STATUS.md) for current acceptance and payment configuration,
[Kitchen staff access](KITCHEN-STAFF-ACCESS.md) for the released feature and its
remaining private acceptance, and
[payment readiness](RAZORPAY-PAYMENTS.md) for the postponed private Razorpay handoff.

## Everyday changes

1. Start on `staging` and get the latest code: `git switch staging`, then `git pull --ff-only`.
2. Make the change locally, inspect the diff and run the relevant checks. Use the Node version in `.nvmrc` and the committed lockfile.
3. Commit the change and run `git push origin staging`.
4. Wait for GitHub Actions **Quality checks** and the Render development deployment to pass. Check the deployed commit before testing the preview.
5. Test the changed customer/admin flow on the development preview, including mobile behavior when relevant. Fix problems on `staging` and repeat.

Routine solo work does not need a new branch or a development PR. For a larger change or parallel work, a temporary `feature/*` or `fix/*` branch is optional: open a PR into `staging`, merge after checks, then delete that temporary branch. Keep only `staging` and `main` as permanent branches.

## Release when ready

1. Open a PR from `staging` to `main`, describing the customer-visible changes and verification.
2. Review the diff, successful checks and owner testing before merging. A solo owner can perform this review; it is not an independent approval.
3. When the owner approves, use GitHub's **Create a merge commit** option for `staging` → `main`; do not squash or rebase releases between these permanent branches. Verify the public Render deployment and its deployed commit, then check the changed flow there.
4. Tag an accepted release, such as `v1.0.0`, and record its commit and changes in GitHub release notes. A Git tag alone does not deploy a website.
5. After the release succeeds, fast-forward `staging` to the updated `main` so both histories stay aligned:

```sh
git fetch origin
git switch staging
git merge --ff-only origin/main
git push origin staging
```

If fast-forwarding fails, review the diverging commits before continuing; do not force-push.

The latest approved release on `main` is the production baseline. Later changes on `staging` require their own accepted release PR; domain configuration and Git tags do not promote those changes.

## Checks, data and recovery

GitHub Actions runs lint, regression tests, the production build and TypeScript checking for pushes to `staging`/`main`, every PR and manual runs. The workflow itself has no deployment step; Render handles deployment from its connected branch. See [Actions](https://github.com/Satya2n/hotpizzaace/actions) for each commit's results and [Render configuration](RENDER-SUPABASE.md) for the development service settings.

Keep secrets in ignored local environment files or hosting settings. Do not force-push shared branches. For a faulty release, prepare a revert on `staging`, test it, and release the correction through a PR to `main`.

Git versions source code, not application data. Connected menu edits, orders and saved addresses live in each environment's separate Supabase database; local carts/drafts and the separately labelled browser demo remain browser data. Promoting or reverting source does not copy, restore or delete database records. Review migrations, schema compatibility, backups and database recovery separately from an application rollback.
