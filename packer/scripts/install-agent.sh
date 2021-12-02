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

# Installs agent, but keeps it stopped for now
# It will be started when the instance goes into rotation
mkdir hooks
mv /tmp/terminate-instance.sh /opt/semaphore/agent/hooks/shutdown
export SEMAPHORE_AGENT_SHUTDOWN_HOOK=/opt/semaphore/agent/hooks/shutdown
export SEMAPHORE_AGENT_DISCONNECT_AFTER_JOB=true
export SEMAPHORE_AGENT_DO_NOT_START=true
sudo -E ./install.sh
