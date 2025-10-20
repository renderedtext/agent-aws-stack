# Repository Guidelines

## Project Structure & Module Organization
- `bin/aws-semaphore-agent.js` boots the CDK app and passes stack parameters.
- `lib/` hosts stack logic and helpers for AMI hashes, GitHub keys, and SSH key rotation.
- `lambdas/` packages runtime handlers (`agent-scaler`, `az-rebalance-suspender`, `ssh-keys-updater`) deployed with the stack.
- `packer/` contains OS-specific templates and Ansible roles; reuse `ci/build-ami.sh` for repeatable builds.
- Supporting automation lives in `ci/`, `goss/`, and the Jest suite under `test/`.

## Triage & Deep Dives
- Use `DOCUMENTATION.md` for architecture context, dependency maps, and troubleshooting cues before triaging incidents or planning new work.

## Build, Test, and Development Commands
- Install dependencies with `npm install` and export AWS credentials before invoking CDK.
- `npm run synth` emits the CloudFormation template into `cdk.out` for fast validation.
- `npm run diff` compares the stack with AWS; attach its output to infrastructure PRs.
- `npm run deploy` (or `npm run deploy:ci`) pushes the stack; follow with `npm run destroy` for clean teardown.
- AMIs are baked via `make packer.build PACKER_OS=linux UBUNTU_VERSION=noble SOURCE_AMI=ami-xxxx` once `make packer.validate` succeeds.

## Coding Style & Naming Conventions
- JavaScript sources use 2-space indentation, single quotes, and `const`/`let` semantics; mirror the patterns in `lib/*.js`.
- Export CommonJS modules via `module.exports` and match exports to filenames (for example `github-keys.js` exposes `githubKeys`).
- Keep new folders lowercase-hyphenated and favor small helpers over inline logic to retain declarative stacks.

## Testing Guidelines
- Use Jest (`npm test`) with files suffixed `.test.js` under `test/`; follow the structure in `argument-store.test.js`.
- Mock AWS services with CDK assertions or spies and avoid live AWS calls in unit suites.
- Add regression tests for every Lambda or stack behaviour change and run them locally before pushing.

## Commit & Pull Request Guidelines
- Follow the conventional commit style already in history (`feat(packer/linux): support jammy`) to signal scope and intent.
- Squash noisy work-in-progress commits before review; keep messages imperative and under 72 characters.
- PRs should include a succinct summary, relevant `npm run diff` or Packer logs, linked issues, and note any operational impact.

## Security & Configuration Tips
- Never commit AWS credentials or Semaphore tokens; reference parameters managed in SSM or KMS instead.
- Keep `execution-policy.json` and IAM statements least-privileged, and request review when adding new permissions or dedicated hosts.
