#!/bin/bash

[[ -z "${AGENT_VERSION}" ]] && echo "AGENT_VERSION is not set" && exit 1
[[ -z "${SEMAPHORE_ORGANIZATION}" ]] && echo "SEMAPHORE_ORGANIZATION is not set" && exit 1
[[ -z "${SEMAPHORE_REGISTRATION_TOKEN}" ]] && echo "SEMAPHORE_REGISTRATION_TOKEN is not set" && exit 1
[[ -z "${SEMAPHORE_AGENT_INSTALLATION_USER}" ]] && echo "SEMAPHORE_AGENT_INSTALLATION_USER is not set" && exit 1

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
