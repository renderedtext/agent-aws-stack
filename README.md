# Semaphore agent AWS stack

This project is a CDK application used to deploy a fleet of Semaphore agents in your AWS account.

## Building the AMI

The agents need an AMI to use. If you haven't created one yet, just run:

```bash
make packer.build
```

This command uses packer to create an AMI with everything the agent needs in your AWS account. The AMI is based on the AMD 64 Ubuntu 20.04 server.

## Deploying the stack

<b>1. CDK bootstrap</b>

The AWS CDK requires a few resources to be around for it to work properly. It creates them with the `bootstrap` command:

```bash
npm run bootstrap -- aws://YOUR_AWS_ACCOUNT_ID/YOUR_AWS_REGION
```

<b>2. Create the encrypted SSM parameter for the agent type registration token</b>

When creating your agent type through the Semaphore UI, you get a registration token. [Create an encrypted AWS SSM parameter](#create-encrypted-aws-ssm-parameter) with it. Then, set the `SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME` and `SEMAPHORE_AGENT_TOKEN_KMS_KEY` environment variables:

```bash
export SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME=YOUR_SSM_PARAMETER_NAME
export SEMAPHORE_AGENT_TOKEN_KMS_KEY=YOUR_KMS_KEY_ID
```

Note: if you have encrypted the SSM parameter with the default `alias/aws/ssm` key, `SEMAPHORE_AGENT_TOKEN_KMS_KEY` does not need to be set.

<b>3. Set required environment variables</b>

The stack requires three environment variables to be set:

```bash
export SEMAPHORE_AGENT_STACK_NAME=YOUR_STACK_NAME
export SEMAPHORE_ORGANIZATION=YOUR_ORGANIZATION
```

[Other environment variables](#configuration) may be configured as well.

<b>4. Deploy the stack</b>

```bash
npm run deploy
```

## Configuration

| Environment variable name                       | Required | Default  | Description |
|-------------------------------------------------|----------|----------|-------------|
| `SEMAPHORE_ORGANIZATION`                        | Yes      | -        | The name of your Semaphore organization. |
| `SEMAPHORE_AGENT_STACK_NAME`                    | Yes      | -        | The name of the stack. This will end up being used as the Cloudformation stack name, and as a prefix to name all the resources of the stack. When deploying multiple stacks for multiple agent types, different stack names are required |
| `SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME`          | Yes      | -        | The AWS SSM parameter name containing the Semaphore agent registration token |
| `SEMAPHORE_AGENT_INSTANCE_TYPE`                 | No       | t2.micro | Instance type used for the agents |
| `SEMAPHORE_AGENT_ASG_MIN_SIZE`                  | No       | 0        | Minimum size for the asg |
| `SEMAPHORE_AGENT_ASG_MAX_SIZE`                  | No       | 1        | Maximum size for the asg |
| `SEMAPHORE_AGENT_ASG_DESIRED`                   | No       | 1        | Desired capacity for the asg |
| `SEMAPHORE_AGENT_USE_DYNAMIC_SCALING`           | No       | true     | Whether to use a lambda to dynamically scale the number of agents in the auto scaling group based on the job demand |
| `SEMAPHORE_AGENT_SECURITY_GROUP_ID`             | No       | -        | Security group id to use for agent instances. If not specified, a security group will be created with (1) an egress rule allowing all outbound traffic and (2) an ingress rule for SSH, if `SEMAPHORE_AGENT_KEY_NAME` is specified. |
| `SEMAPHORE_AGENT_KEY_NAME`                      | No       | -        | Key name to access agents through SSH. If not specified, no SSH inbound access is allowed |
| `SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB`          | No       | true     | If the agent should shutdown or not after completing a job |
| `SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT` | No       | 300      | Number of seconds of idleness after which the agent will shutdown. Note: setting this to 0 will disable the scaling down behavior of the stack, since the agents won't shutdown due to idleness. |
| `SEMAPHORE_AGENT_CACHE_BUCKET_NAME`             | No       | -        | Existing S3 bucket name to use for caching. If this is not set, the cache CLI won't work. |
| `SEMAPHORE_AGENT_TOKEN_KMS_KEY`                 | No       | -        | KMS key id used to encrypt and decrypt `SEMAPHORE_AGENT_TOKEN_PARAMETER_NAME`. If nothing is given, the default `alias/aws/ssm` key is assumed. |
| `SEMAPHORE_AGENT_VPC_ID`                        | No       | -        | The id of an existing VPC to use when launching agent instances. By default, it is blank, and the default VPC on your AWS account will be used. |
| `SEMAPHORE_AGENT_SUBNETS`                       | No       | -        | Comma-separated list of existing VPC subnet ids where EC2 instances will run. This is required when using `SEMAPHORE_AGENT_VPC_ID`. If `SEMAPHORE_AGENT_SUBNETS` is set, but `SEMAPHORE_AGENT_VPC_ID` is blank, the subnets will be ignored, and the default VPC will be used. Private and public subnets are possible, but isolated subnets cannot be used. |
| `SEMAPHORE_AGENT_AMI`                           | No       | -        | The AMI used for all the instances. If empty, the stack will use the default AMIs, by looking them up by their name. If the default AMI isn't enough, you can use your own AMIs, but they need to be based off of the stack's default AMI. |

## In-place updates

When changing the configuration of your stack, you can update it in-place. AWS CDK will use AWS Cloudformation changesets to apply the required changes. Before updating it, you can check what will be different with the `diff` command:

```bash
npm run diff
```

To update it, use:

```bash
npm run deploy
```

## Create encrypted AWS SSM parameter

Using the AWS CLI, you can create the AWS SSM parameter for your agent token using the following commands:

<b>1. Create KMS key for encryption</b>

```bash
aws kms create-key
```

The output of that command will give you a KMS key id.

Note: if no customer managed key is required, and you want to use the default `alias/aws/ssm` key in your account, this step can be skipped.

<b>2. Create the SSM parameter</b>

Using the id for the KMS key created in the previous step, run:

```bash
aws ssm put-parameter \
  --name YOUR_PARAMETER_NAME \
  --value "VERY_SENSITIVE_TOKEN" \
  --type SecureString \
  --key-id PREVIOUSLY_CREATED_KMS_KEY_ID
```

If you didn't create a KMS key and want to use the default `alias/aws/ssm` key in your account, you can omit the `--key-id` parameter:

```bash
aws ssm put-parameter \
  --name YOUR_PARAMETER_NAME \
  --value "VERY_SENSITIVE_TOKEN" \
  --type SecureString
```

Note: when resetting the agent token, you'll need to update this parameter with the new token.

## Delete the stack

To delete the stack, use:

```bash
npm run destroy
```

Note: make sure `SEMAPHORE_AGENT_STACK_NAME` is pointing to the stack you really want to destroy.
