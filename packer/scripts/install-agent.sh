#!/bin/bash

agent_version=$1
if [[ -z "$agent_version" ]]; then
  echo "No agent version specified. Exiting..."
  exit 1
fi

# Create semaphore user
sudo useradd semaphore -m -U -G sudo -s /bin/bash
echo "semaphore ALL=(ALL) NOPASSWD: ALL" | sudo tee -a /etc/sudoers

# Download agent
sudo mkdir -p /opt/semaphore/agent
sudo curl -sL https://github.com/semaphoreci/agent/releases/download/${agent_version}/agent_Linux_x86_64.tar.gz -o /opt/semaphore/agent/agent.tar.gz
sudo tar -xf /opt/semaphore/agent/agent.tar.gz -C /opt/semaphore/agent
sudo rm /opt/semaphore/agent/agent.tar.gz

# Create hooks directory
sudo mkdir -p /opt/semaphore/agent/hooks
sudo mv /tmp/terminate-instance.sh /opt/semaphore/agent/hooks/shutdown
sudo chown semaphore:semaphore -R /opt/semaphore/agent/
cd /opt/semaphore/agent/

# Install agent
export SEMAPHORE_REGISTRATION_TOKEN=DUMMY
export SEMAPHORE_ORGANIZATION=DUMMY
export SEMAPHORE_AGENT_INSTALLATION_USER=semaphore
export SEMAPHORE_AGENT_SHUTDOWN_HOOK=/opt/semaphore/agent/hooks/shutdown
export SEMAPHORE_AGENT_START=false
sudo -E ./install.sh
