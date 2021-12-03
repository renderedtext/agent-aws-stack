#!/bin/bash

token=$(curl -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" --fail --silent --show-error --location "http://169.254.169.254/latest/api/token")
region=$(curl -H "X-aws-ec2-metadata-token: $token" --fail --silent --show-error --location "http://169.254.169.254/latest/meta-data/placement/region")
agent_params=$(aws ssm get-parameter --region "$region" --name "semaphore-agent-params" --query Parameter.Value --output text)

AGENT_VERSION=$(echo $agent_params | jq '.agentVersion' | tr -d \")
SEMAPHORE_ORGANIZATION=$(echo $agent_params | jq '.organization' | tr -d \")
SEMAPHORE_REGISTRATION_TOKEN=$(echo $agent_params | jq '.token' | tr -d \")
SEMAPHORE_AGENT_INSTALLATION_USER=$(echo $agent_params | jq '.vmUser' | tr -d \")

# Download agent
sudo mkdir -p /opt/semaphore/agent
sudo curl -L https://github.com/semaphoreci/agent/releases/download/${AGENT_VERSION}/agent_Linux_x86_64.tar.gz -o /opt/semaphore/agent/agent.tar.gz
sudo tar -xf /opt/semaphore/agent/agent.tar.gz -C /opt/semaphore/agent
sudo rm /opt/semaphore/agent/agent.tar.gz
sudo chown $USER:$USER -R /opt/semaphore/agent/
cd /opt/semaphore/agent/

# Install and start agent
mkdir hooks
mv /opt/semaphore/terminate-instance.sh /opt/semaphore/agent/hooks/shutdown
export SEMAPHORE_AGENT_SHUTDOWN_HOOK=/opt/semaphore/agent/hooks/shutdown
export SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB=true
sudo -E ./install.sh
