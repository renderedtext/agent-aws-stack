#!/bin/bash

set -e
set -o pipefail

param_name=$1
if [[ -z "${param_name}" ]]; then
  echo "Name is required. Exiting..."
  exit 1
fi

param_value=$2
if [[ -z "${param_value}" ]]; then
  echo "Value is required. Exiting..."
  exit 1
fi

response=$(aws ssm describe-parameters --filters "Key=Name,Values=${param_name}")
parameters=$(echo $response | jq '.Parameters' | jq length)
if [[ ${parameters} == "0" ]]; then
  echo "Creating SSM parameter '${param_name}'..."
  aws ssm put-parameter \
    --name $param_name \
    --value $param_value \
    --type SecureString
else
  echo "SSM parameter '${param_name}' already exists."
fi