#!/bin/bash

set -e
set -o pipefail

agent_config_param_name=$1
if [[ -z "$agent_config_param_name" ]]; then
  echo "No agent config parameter name specified. Exiting..."
  exit 1
fi

token=$(curl -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" --fail --silent --show-error --location "http://169.254.169.254/latest/api/token")
region=$(curl -H "X-aws-ec2-metadata-token: $token" --fail --silent --show-error --location "http://169.254.169.254/latest/meta-data/placement/region")

echo "Fetching agent params..."
agent_params=$(aws ssm get-parameter --region "$region" --name "$agent_config_param_name" --query Parameter.Value --output text)
agent_version=$(echo $agent_params | jq '.agentVersion' | tr -d \")

echo "Fetching agent token..."
agent_token_param_name=$(echo $agent_params | jq '.agentTokenParameterName' | tr -d \")
agent_token=$(aws ssm get-parameter --region "$region" --name "$agent_token_param_name" --query Parameter.Value --output text --with-decryption)

echo "Changing agent configuration..."
organization=$(echo $agent_params | jq '.organization' | tr -d \")
disconnect_after_job=$(echo $agent_params | jq '.disconnectAfterJob' | tr -d \")
disconnect_after_idle_timeout=$(echo $agent_params | jq '.disconnectAfterIdleTimeout' | tr -d \")
yq e -i ".endpoint = \"$organization.semaphoreci.com\"" /opt/semaphore/agent/config.yaml
yq e -i ".token = \"$agent_token\"" /opt/semaphore/agent/config.yaml
yq e -i ".disconnect-after-job = $disconnect_after_job" /opt/semaphore/agent/config.yaml
yq e -i ".disconnect-after-idle-timeout = $disconnect_after_idle_timeout" /opt/semaphore/agent/config.yaml

echo "Starting agent..."
sudo systemctl start semaphore-agent

echo "Done."