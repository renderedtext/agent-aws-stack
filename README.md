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

Before anything, you need to [create an encrypted AWS SSM parameter](#create-encrypted-aws-ssm-parameter) to store your Semaphore agent token.

This is required because those tokens are sensitive pieces of information and there is no way to create an encrypted AWS SSM parameter in an AWS CDK application without exposing it as plaintext.

After that, you need to set a few required environment variables:
- `SEMAPHORE_AGENT_STACK_NAME`: this is the name of your stack. If you want to deploy multiple instances of this stack, you'll need to use a different name for each one.
- `SEMAPHORE_ORGANIZATION`: this is your Semaphore organization.
- `SEMAPHORE_AGENT_AMI`: this is the AMI you created with `make packer.build` above.
- `SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME`: this is the name of the encrypted SSM parameter for the agent token you created above.

Then, we can deploy our stack:

```bash
export SEMAPHORE_AGENT_STACK_NAME=YOUR_STACK_NAME
export SEMAPHORE_ORGANIZATION=YOUR_ORGANIZATION
export SEMAPHORE_AGENT_AMI=ami-0442a81fe8739be5a
export SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME=YOUR_SSM_PARAMETER_TOKEN_NAME
cdk deploy
```

Other optional arguments are also available:

| Environment variable name                       | Description |
|-------------------------------------------------|-------------|
| `SEMAPHORE_AGENT_INSTANCE_TYPE`                 | Instance type used for the agents. Default: `t2.micro` |
| `SEMAPHORE_AGENT_ASG_MIN_SIZE`                  | Minimum size for the asg. Default: `0` |
| `SEMAPHORE_AGENT_ASG_MAX_SIZE`                  | Maximum size for the asg. Default: `1` |
| `SEMAPHORE_AGENT_ASG_DESIRED`                   | Desired capacity for the asg. Default: `1` |
| `SEMAPHORE_AGENT_ASG_WARM_POOL_STATE`           | State of warm pool instances: `Stopped` or `Running`. Default: `Stopped` |
| `SEMAPHORE_AGENT_SECURITY_GROUP_ID`             | Security group id to use for agent instances. If not specified, a security group will be created with (1) an egress rule allowing all outbound traffic and (2) an ingress rule for SSH, if `SEMAPHORE_AGENT_KEY_NAME` is specified |
| `SEMAPHORE_AGENT_KEY_NAME`                      | Key name to access agents through SSH. If not specified, no SSH inbound access is allowed |
| `SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB`          | If the agent should shutdown or not after completing a job. Default is `true` |
| `SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT` | Number of seconds of idleness after which the agent will shutdown. Default is `300`. Note: setting this to 0 will disable the scaling down behavior of the stack, since the agents won't shutdown due to idleness |
| `SEMAPHORE_AGENT_CACHE_BUCKET_NAME`             | S3 bucket name to use for caching. If this is not set, the cache CLI won't work. |

The stack is deployed in your default VPC, on one of the default subnets.

## Create encrypted AWS SSM parameter

Using the AWS CLI, you can create the required AWS SSM parameters, encrypted with the default AWS KMS key for SSM, with the following command:

```
aws ssm put-parameter \
  --name YOUR_PARAMETER_NAME \
  --value "VERY_SENSITIVE_TOKEN" \
  --type SecureString
```

Note: when resetting the agent token, you'll need to update this parameter with the new token.

## Delete the stack

You can delete the stack using the AWS CDK CLI with `cdk destroy` or using the AWS Cloudformation UI.
