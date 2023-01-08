#!/bin/bash

set -eo pipefail
ARCH=$(uname -m)

# We need to resize the APFS container to use all the available space on the EBS volume.
DISK_ID=$(diskutil list physical external | head -n1 | cut -d' ' -f1)
APFS_CONTAINER_ID=$(diskutil list physical external | grep Apple_APFS | tr -s ' ' | cut -d' ' -f8)

# We use (yes || true) because `yes` can lead to SIGPIPE errors, which we don't care about here.
echo "Repairing disk $DISK_ID..."
(yes || true) | sudo diskutil repairDisk $DISK_ID

echo "Resizing APFS container $APFS_CONTAINER_ID..."
sudo diskutil apfs resizeContainer $APFS_CONTAINER_ID 0

# Remove all instance history.
# See: https://github.com/aws/ec2-macos-init#clean
sudo /usr/local/bin/ec2-macos-init clean --all

# Before updating Homebrew and installing tools,
# update all the required environment variables.
if [[ ${ARCH} =~ "arm" || ${ARCH} == "aarch64" ]]; then
  export HOMEBREW_PREFIX="/opt/homebrew";
  export HOMEBREW_CELLAR="/opt/homebrew/Cellar";
  export HOMEBREW_REPOSITORY="/opt/homebrew";
  export HOMEBREW_SHELLENV_PREFIX="/opt/homebrew";
  export PATH="/opt/homebrew/bin:/opt/homebrew/sbin${PATH+:$PATH}";
  export MANPATH="/opt/homebrew/share/man${MANPATH+:$MANPATH}:";
  export INFOPATH="/opt/homebrew/share/info:${INFOPATH:-}";
else
  export PATH="/usr/local/bin${PATH+:$PATH}";
fi

# Update Homebrew and install some tools
brew update --verbose
brew upgrade
brew install coreutils
brew install jq
brew install yq
brew cleanup

# Install cloudwatch agent
# ARM binary is not yet available, so we need to use Rosetta.
if [[ ${ARCH} =~ "arm" || ${ARCH} == "aarch64" ]]; then
  /usr/sbin/softwareupdate --install-rosetta --agree-to-license
fi

CLOUDWATCH_AGENT_DOWNLOAD_URL=https://s3.amazonaws.com/amazoncloudwatch-agent/darwin/amd64/latest/amazon-cloudwatch-agent.pkg
curl -L "$CLOUDWATCH_AGENT_DOWNLOAD_URL" -o /tmp/amazon-cloudwatch-agent.pkg
sudo installer -pkg /tmp/amazon-cloudwatch-agent.pkg -target /
rm /tmp/amazon-cloudwatch-agent.pkg
sudo mv /tmp/amazon-cloudwatch-agent.json /opt/aws/amazon-cloudwatch-agent/bin/
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent.json -s

# Create the semaphore user
LARGEST_USER_ID=$(dscl . -list /Users UniqueID | awk '{print $2}' | sort -ug | tail -1)
NEW_USER_ID=$((LARGEST_USER_ID+1))
USER_NAME=semaphore
HOME_DIR=/Users/$USER_NAME
sudo dscl . -create $HOME_DIR
sudo dscl . -create $HOME_DIR UserShell /bin/bash
sudo dscl . -create $HOME_DIR RealName "Semaphore"
sudo dscl . -create $HOME_DIR UniqueID "$NEW_USER_ID"
sudo dscl . -create $HOME_DIR PrimaryGroupID 20
sudo dscl . -create $HOME_DIR NFSHomeDirectory $HOME_DIR
sudo createhomedir -c -u $USER_NAME > /dev/null
sudo chown $USER_NAME $HOME_DIR

# Allow passwordless sudo for the new user
echo "$USER_NAME  ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/$USER_NAME

# Download Semaphore agent
AGENT_TARBALL=agent_Darwin_x86_64.tar.gz
if [[ ${ARCH} =~ "arm" || ${ARCH} == "aarch64" ]]; then
  AGENT_TARBALL=agent_Darwin_arm64.tar.gz
fi

# Create installation directory
sudo mkdir -p /opt/semaphore/agent
cd /opt/semaphore/agent
sudo curl -L https://github.com/semaphoreci/agent/releases/download/$AGENT_VERSION/$AGENT_TARBALL -o agent.tar.gz
sudo tar xvf agent.tar.gz
sudo rm agent.tar.gz

# Create hooks directory
sudo mkdir -p /opt/semaphore/agent/hooks
sudo cp /tmp/terminate-instance.sh /opt/semaphore/agent/hooks/shutdown

# Install Semaphore agent
export SEMAPHORE_AGENT_INSTALLATION_USER=semaphore
export SEMAPHORE_TOOLBOX_VERSION=$TOOLBOX_VERSION
export SEMAPHORE_AGENT_START=false
export SEMAPHORE_REGISTRATION_TOKEN=DUMMY
export SEMAPHORE_ORGANIZATION=DUMMY
export SEMAPHORE_AGENT_SHUTDOWN_HOOK=/opt/semaphore/agent/hooks/shutdown
sudo -E ./install.sh

# Copy agent startup script and apply folder permissions
sudo cp /tmp/start-agent.sh /opt/semaphore/agent/start.sh
sudo chown -R semaphore: /opt/semaphore/agent
