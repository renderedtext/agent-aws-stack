# Repository Reference

## Core Purpose
- CDK app that provisions Semaphore self-hosted agent fleets on AWS.
- Manages autoscaling EC2 pools, operational Lambdas, AMI build tooling, and supporting scripts.

## CDK Application Layout
- Entry point `bin/aws-semaphore-agent.js` instantiates `AwsSemaphoreAgentStack` and injects runtime parameters via `ArgumentStore`.
- `lib/aws-semaphore-agent-stack.js` composes the stack: EC2 Auto Scaling Group, Launch Template, SSM parameters, IAM roles/policies, CloudWatch alarms, custom resources, and Lambda integrations.
- `lib/argument-store.js` normalises configuration, applies defaults, and validates required environment variables (e.g., endpoint, VPC settings, overprovision strategy).
- Supporting modules:
  - `lib/dynamic-ssh-keys-updater.js` provisions an SSM parameter and scheduled Lambda to refresh GitHub SSH keys.
  - `lib/github-keys.js` caches GitHub SSH keys locally to reduce API calls during synthesis.
  - `lib/ami-hash.js` fingerprints Packer templates to detect AMI drift in the stack.

## Lambda Functions
- `lambdas/agent-scaler/app.js` polls Semaphore occupancy metrics and adjusts the Auto Scaling Group size; publishes metrics to CloudWatch.
- `lambdas/az-rebalance-suspender/app.js` custom resource that suspends the `AZRebalance` process to keep macOS dedicated hosts stable.
- `lambdas/ssh-keys-updater/app.js` daily job that mirrors GitHub SSH keys into the SSM parameter backing agent instances.
- Lambdas share patterns: Node.js 18 runtimes, AWS SDK v3 clients with aggressive timeouts, JSON logging, and explicit retries left to CloudWatch rules.

## Configuration & Parameters
- Runtime settings come from environment variables or a JSON file referenced by `SEMAPHORE_AGENT_STACK_CONFIG`.
- Mandatory variables: `SEMAPHORE_AGENT_STACK_NAME`, `SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME`, plus either `SEMAPHORE_ENDPOINT` or `SEMAPHORE_ORGANIZATION`.
- Defaults cover instance type, scaling limits, OS family, storage sizing, IPv6, and SSH ingress toggles.
- IAM/KMS/SSM identifiers determine permissions for agent tokens, cache buckets, and managed policies.

## AMI Build Tooling
- `packer/linux`, `packer/windows`, `packer/macos` define HCL templates, scripts, and Ansible roles for baking agent images.
- `ci/build-ami.sh` wraps packer invocations; `lib/ami-hash.js` ties template changes to CDK asset updates.
- Make targets (`make packer.validate`, `make packer.build`) orchestrate packer init/validate/build per OS.
- `goss/` provides OS-specific health checks that run inside packer builds or post-provision.

## Scripts & Utilities
- `ci/create-execution-policy-and-bootstrap.sh`, `ci/create-ssm-param.sh`, and `ci/delete-old-images.sh` help bootstrap AWS environments and clean stale AMIs.
- `execution-policy.json` captures baseline IAM permissions to run the stack.
- `bin/aws-semaphore-agent.js` applies optional tags supplied via `SEMAPHORE_AGENT_TAGS`.

## Testing & Validation
- Jest specs live in `test/` and use CDK assertions to verify template outputs (IAM roles, SSM parameters, Launch Templates).
- Run `npm test` before modifying infrastructure primitives; add targeted tests for new resources or argument validations.
- Goss manifests validate baked AMIs; integrate via packer pipelines when altering base images.

## Deployment Workflow
- Install dependencies: `npm install`.
- Synth & inspect: `npm run synth`, `npm run diff`.
- Deploy & clean: `npm run deploy` / `npm run destroy`. CI variants (`deploy:ci`, `destroy:ci`) skip approval prompts.
- AMI lifecycle: `make packer.validate PACKER_OS=<linux|windows|macos>`, then `make packer.build ...` with versioned inputs (e.g., `UBUNTU_VERSION=noble`, `SOURCE_AMI=ami-xxxxx`).

## Troubleshooting Notes
- CDK synth failures usually trace back to missing environment variables; reference defaults in `lib/argument-store.js`.
- GitHub API rate limits: clear `.gh_ssh_keys_*` cache files or wait for expiry when switching networks.
- Autoscaling stuck: inspect CloudWatch metrics published by `agent-scaler` and ensure the SSM token parameter exists and is decryptable.
- Mac dedicated hosts require `SEMAPHORE_AGENT_MAC_DEDICATED_HOSTS` and correct `SEMAPHORE_AGENT_MAC_FAMILY` to avoid AZ placement errors.

## Useful References
- AWS SDK v3 clients are initialised with 1s timeouts—extend carefully if diagnosing latency-sensitive regions.
- Stack outputs live in `cdk.out`; share `npm run diff` snapshots for PR context.
- For new regions or accounts, rerun `cdk bootstrap` (`npm run bootstrap`) with the target environment.
