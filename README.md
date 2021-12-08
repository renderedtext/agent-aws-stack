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

## Deploying the stack

Before anything, you need to [create an encrypted AWS SSM parameter](#create-encrypted-aws-ssm-parameter) to store your semaphore agent token. This is required because that token is a sensitive piece of information and there is no way to create an encrypted AWS SSM parameter in an AWS CDK application without exposing it as plaintext.

After that, you need to set a few required environment variables:
- `SEMAPHORE_ORGANIZATION`: this is your Semaphore organization.
- `SEMAPHORE_AGENT_AMI`: this is the AMI you created with `make packer.build` above.
- `SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME`: this is the name of the encrypted SSM parameter for the agent token you created above.

Then, we can deploy our stack:

```bash
export SEMAPHORE_ORGANIZATION=semaphore
export SEMAPHORE_AGENT_AMI=ami-064da3cef040ac06b
export SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME=semaphore-agent-token
cdk deploy
```

Other optional arguments are also available:

| Environment variable name             | Description |
|---------------------------------------|-------------|
| `SEMAPHORE_AGENT_INSTANCE_TYPE`       | Instance type used for the agents. Default: `t2.micro` |
| `SEMAPHORE_AGENT_ASG_MIN_SIZE`        | Minimum size for the asg. Default: `0` |
| `SEMAPHORE_AGENT_ASG_MAX_SIZE`        | Maximum size for the asg. Default: `1` |
| `SEMAPHORE_AGENT_ASG_DESIRED`         | Desired capacity for the asg. Default: `1` |
| `SEMAPHORE_AGENT_VERSION`             | Agent version to use. Default: `v2.0.17` |
| `SEMAPHORE_AGENT_ASG_WARM_POOL_STATE` | State of warm pool instances: `Stopped` or `Running`. Default: `Stopped` |
| `SEMAPHORE_AGENT_VM_USER`             | VM user used to run the agent. Default: `ubuntu` |
| `SEMAPHORE_AGENT_SECURITY_GROUP_ID`   | Security group id to use for agent instances. If not specified, a security group will be created with (1) an egress rule allowing all outbound traffic and (2) an ingress rule for SSH, if `SEMAPHORE_AGENT_KEY_NAME` is specified |
| `SEMAPHORE_AGENT_KEY_NAME`            | Key name to access agents through SSH. If not specified, no SSH inbound access is allowed |

The stack is deployed in your default VPC, on one of the default subnets.

## Create encrypted AWS SSM parameter

Using the AWS CLI, you can create an AWS SSM parameter, encrypted with the default AWS KMS key for SSM, with the following command:

```
aws ssm put-parameter \
  --name semaphore-agent-token \
  --value "VERY_SENSITIVE_TOKEN" \
  --type SecureString
```

## Destroying the stack

```bash
cdk destroy
```