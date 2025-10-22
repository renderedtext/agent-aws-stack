# Semaphore agent AWS stack

This project is a CDK application used to deploy a fleet of Semaphore agents in your AWS account.

## Features

- Run self-hosted agents in Linux and Windows machines
- Dynamically increase and decrease the number of agents available based on your job demand
- Deploy multiple stacks of agents, one for each self-hosted agent type
- Access the agent EC2 instances through SSH or using AWS Systems Manager Session Manager
- Use an S3 bucket to cache the dependencies needed for your jobs
- Control the size of your agent instances and of your agent pool

Check out the [docs](https://docs.semaphoreci.com/ci-cd-environment/aws-support).

## Custom base AMI

Set the `SOURCE_AMI` environment variable when running the Packer targets if you need to pin the build to a specific Ubuntu kernel. For example:

```
SOURCE_AMI=ami-0123456789abcdef0 make packer.build PACKER_OS=linux UBUNTU_VERSION=noble
```

The helper script `ci/build-ami.sh` also accepts the desired AMI ID as an optional third argument so it can be used in the same way:

```
./ci/build-ami.sh ubuntu-noble x86_64 ami-0123456789abcdef0
```
