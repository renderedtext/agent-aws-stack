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

echo "Downloading agent..."
sudo mkdir -p /opt/semaphore/agent
sudo curl -sL https://github.com/semaphoreci/agent/releases/download/${agent_version}/agent_Linux_x86_64.tar.gz -o /opt/semaphore/agent/agent.tar.gz
sudo tar -xf /opt/semaphore/agent/agent.tar.gz -C /opt/semaphore/agent
sudo rm /opt/semaphore/agent/agent.tar.gz

echo "Creating hooks diectory..."
sudo mkdir -p /opt/semaphore/agent/hooks
sudo mv /opt/semaphore/terminate-instance.sh /opt/semaphore/agent/hooks/shutdown
sudo chown $USER:$USER -R /opt/semaphore/agent/
cd /opt/semaphore/agent/

echo "Installing the agent..."
export SEMAPHORE_REGISTRATION_TOKEN=$agent_token
export SEMAPHORE_ORGANIZATION=$(echo $agent_params | jq '.organization' | tr -d \")
export SEMAPHORE_AGENT_INSTALLATION_USER=$(echo $agent_params | jq '.vmUser' | tr -d \")
export SEMAPHORE_AGENT_SHUTDOWN_HOOK=/opt/semaphore/agent/hooks/shutdown
export SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB=true
export SEMAPHORE_AGENT_DISCONNECT_AFTER_IDLE_TIMEOUT=60
sudo -E ./install.sh
