# Semaphore agent AWS stack

This project is a CDK application used to deploy a Semaphore agent stack in AWS.

## Requisites

### AMI

The agents need an AMI id to use. If you haven't created one yet, just run:

```bash
make packer.build
```

This command uses packer to create an AWS EC2 AMI with everything the agent needs.

### CDK bootstrap

The AWS CDK requires a few resources to be around for it to work. It creates them with the `bootstrap` command:

```bash
cdk bootstrap aws://<YOUR_AWS_ACCOUNT_ID>/<YOUR_AWS_REGION>
```

## Generate the cloudformation stack

Under the hood, all the AWS CDK does is create a cloudformation stack. You can check the one it creates with:

```bash
cdk synth
```

## Deploying the stack

In order to deploy it, you are required to pass a few parameters:
- `imageId`: this is the AMI you created with `make packer.build` above.
- `semaphoreOrganization`: this is your Semaphore organization.
- `semaphoreToken`: this is the registration token for your agent type.

Other optional arguments are available:
- `instanceType`: this is the instance type the stack will use for your agents. By default, this is `t2.micro`.
- `minSize`: the minimum size for your agent auto scaling group. By default, this is 0.
- `maxSize`: the maximum size for your agent auto scaling group. By default, this is 1.
- `desiredCapacity`: the initial desired capacity for your agent auto scaling group. By default, this is 1
- `semaphoreAgentVersion`: the version of the agent to deploy. By default, the latest one.
- `warmPoolState`: the state to leave instances in the warm pool. By default, `Stopped`. Possible values are `Running` and `Stopped`.

```bash
cdk deploy \
  --parameters imageId=ami-099f98f5c31d8ba1e \
  --parameters semaphoreOrganization=semaphore \
  --parameters semaphoreToken=YOUR_VERY_SENSITIVE_TOKEN
```

## Destroying the stack

```bash
cdk destroy
```