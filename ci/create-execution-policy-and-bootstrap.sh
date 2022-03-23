#!/bin/bash

aws_account_id=$1
if [[ -z "${aws_account_id}" ]]; then
  echo "AWS account id is required. Exiting..."
  exit 1
fi

aws_region=$2
if [[ -z "${aws_region}" ]]; then
  echo "AWS account region is required. Exiting..."
  exit 1
fi

policy_name="agent-aws-stack-test-execution-policy"
policy_arn="arn:aws:iam::${aws_account_id}:policy/${policy_name}"

policy=$(aws iam get-policy --policy-arn "${policy_arn}" --query 'Policy.Arn' --output text)
if [[ $? -eq 0 ]]; then
  echo "Deleting old versions of ${policy_arn}..."
  version_ids=($(aws iam list-policy-versions \
    --policy-arn ${policy_arn} \
    | jq -r '.Versions[] | select(.IsDefaultVersion | not) | .VersionId'))

  for version_id in "${version_ids[@]}"; do
    echo "Deleting version ${version_id}..."
    aws iam delete-policy-version \
      --policy-arn ${policy_arn} \
      --version-id ${version_id}
  done

  echo "All non-default versions of ${policy_arn} were deleted. Creating new version..."
  new_version=$(aws iam create-policy-version \
    --policy-arn ${policy_arn} \
    --policy-document file://$(pwd)/execution-policy.json \
    --set-as-default \
    --query 'PolicyVersion.VersionId' \
    --output text)

  if [[ $? -ne 0 ]]; then
    echo "Error creating new policy version. Exiting..."
    exit 1
  fi

  echo "Created new version ${new_version} of ${policy_arn}."
else
  echo "Creating ${policy_arn}..."
  policy_arn=$(aws iam create-policy \
    --policy-name ${policy_name} \
    --policy-document file://$(pwd)/execution-policy.json \
    --description "Policy used by Cloudformation to deploy the agent-aws-stack CDK application" \
    --query 'Policy.Arn' \
    --output text)

  if [[ $? -ne 0 ]]; then
    echo "Error creating new policy. Exiting..."
    exit 1
  fi

  echo "Created ${policy_arn}."
fi

echo "Bootstrapping application..."

# For the bootstrap part, it doesn't really matter which stack
# we are deploying, only that the CDK required resources are bootstrapped,
# so we just use the linux config for this.
SEMAPHORE_AGENT_STACK_CONFIG=./ci/linux-config.json npm run bootstrap -- aws://${aws_account_id}/${aws_region} \
  --cloudformation-execution-policies "${policy_arn}" \
  --verbose