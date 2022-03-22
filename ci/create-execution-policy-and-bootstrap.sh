#!/bin/bash

policy_name=$1
if [[ -z "${policy_name}" ]]; then
  echo "Policy name is required. Exiting..."
  exit 1
fi

aws_account_id=$2
if [[ -z "${aws_account_id}" ]]; then
  echo "AWS account id is required. Exiting..."
  exit 1
fi

aws_region=$3
if [[ -z "${aws_region}" ]]; then
  echo "AWS account region is required. Exiting..."
  exit 1
fi

policy_arn="arn:aws:iam::${aws_account_id}:policy/${policy_name}"

policy=$(aws iam get-policy --policy-arn "${policy_arn}" --query 'Policy.Arn' --output text)
if [[ $? -eq 0 ]]; then
  echo "Deleting ${policy_arn}..."
  aws iam delete-policy --policy-arn ${policy_arn}
  echo "${policy_arn} deleted."
fi

echo "Creating ${policy_arn}..."
policy_arn=$(aws iam create-policy \
  --policy-name ${policy_name} \
  --policy-document file://$(pwd)/policy__execution.json \
  --description "Policy used by Cloudformation to deploy the agent-aws-stack CDK application"
  --query 'Policy.Arn' \
  --output text)

echo "Policy '$policy_arn' created. Bootstrapping application..."
npm run bootstrap -- aws://${aws_account_id}/${aws_region} \
  --cloudformation-execution-policies "${policy_arn}" \
  --verbose
