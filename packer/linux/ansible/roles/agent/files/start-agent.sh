#!/bin/bash

set -eo pipefail

#
# If anything goes wrong with the instance startup,
# we make the instance unhealthy, so the auto scaling group can rotate it.
#
on_failure() {
  local exit_code=$1
  if [[ $exit_code != 0 ]] ; then
    local __token__=$(fetch_idms_token)
    local __instance_id__=$(curl -H "X-aws-ec2-metadata-token: $__token__" --fail --silent --show-error --location "http://169.254.169.254/latest/meta-data/instance-id")
    aws autoscaling set-instance-health \
      --instance-id "${__instance_id__}" \
      --health-status Unhealthy
  fi
}

#
# Generates a random number of seconds between 0.750s - 5s.
#
random_sleep() {
  random_number=$(shuf -i 750-5000 -n 1)
  delay=$(echo "$random_number / 1000.0" | bc -l)
  echo "$delay"
}

#
# Retry a command for a while, with random sleeps after failures.
#
retry_cmd() {
  local __cmd__=$1
  local __result__=0
  local __max_retries__=30
  local __sleep__=1

  for __i__ in $(seq 1 $__max_retries__); do
    __output__=$(eval "$__cmd__")
    __result__="$?"

    if [ $__result__ -eq "0" ]; then
      echo $__output__
      return 0
    fi

    if [[ $__i__ == $__max_retries__ ]]; then
      return $__result__
    else
      __sleep__=$(random_sleep)
      sleep $__sleep__
    fi
  done
}

#
# Fetch an instance metadata service token.
# This token is required for all the other requests to the instance metadata service endpoints.
#
fetch_idms_token() {
  local __token__=$(curl \
    -X PUT \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" \
    --fail \
    --silent \
    --show-error \
    --location "http://169.254.169.254/latest/api/token"
  )

  echo $__token__
}

#
# Fetch the agent configuration parameters from the SSM parameter store.
#
fetch_agent_params() {
  local __region__=$1
  local __param_name__=$2

  local __agent_params__=$(retry_cmd "aws ssm get-parameter \
    --region '$__region__' \
    --name '$__param_name__' \
    --query Parameter.Value \
    --output text"
  )

  if [[ $? != 0 ]]; then
    echo "Error fetching agent params."
    return 1
  else
    echo $__agent_params__
    return 0
  fi
}

#
# Fetch the agent registration token from the SSM parameter store.
#
fetch_agent_token() {
  local __region__=$1
  local __param_name__=$2
  local __token__=$(retry_cmd "aws ssm get-parameter \
    --region '$__region__' \
    --name '$__param_name__' \
    --query Parameter.Value \
    --output text \
    --with-decryption"
  )

  if [[ $? != 0 ]]; then
    echo "Error fetching agent token."
    return 1
  else
    echo $__token__
    return 0
  fi
}

generate_agent_name() {
  local __use_pre_signed_url__=$1

  # If we are using pre-signed AWS STS GetCallerIdentity URLs,
  # we call the Python script to generate it.
  # Otherwise, just generate a random one, prefixing it with the instance ID from IMDS.
  if [[ "${__use_pre_signed_url__}" == "true" ]]; then
    /opt/semaphore/agent/gen-pre-signed-url.py
  else
    local __token__=$(fetch_idms_token)
    local __instance_id__=$(curl --fail --silent --show-error -H "X-aws-ec2-metadata-token: $__token__" --location "http://169.254.169.254/latest/meta-data/instance-id")
    local __random_part__=$(tr -dc A-Za-z0-9 </dev/urandom | head -c 13)
    echo "${__instance_id__}__${__random_part__}"
  fi
}

#
# Update the agent configuration YAML,
# using the agent's configuration parameters and registration token.
#
change_agent_config() {
  local __agent_params__=$1
  local __agent_token__=$2

  echo "Changing agent configuration..."

  # Find parameter values from the SSM agent configuration parameter
  local __endpoint__=$(echo $__agent_params__ | jq -r '.endpoint')
  local __disconnect_after_job__=$(echo $__agent_params__ | jq -r '.disconnectAfterJob')
  local __disconnect_after_idle_timeout__=$(echo $__agent_params__ | jq -r '.disconnectAfterIdleTimeout')
  local __use_pre_signed_url__=$(echo $__agent_params__ | jq -r '.disconnectAfterIdleTimeout')
  local __agent_name__=$(generate_agent_name $__use_pre_signed_url__)

  # Update agent YAML configuration
  yq e -i ".name = \"$__agent_name__\"" /opt/semaphore/agent/config.yaml
  yq e -i ".endpoint = \"$__endpoint__\"" /opt/semaphore/agent/config.yaml
  yq e -i ".token = \"$__agent_token__\"" /opt/semaphore/agent/config.yaml
  yq e -i ".disconnect-after-job = $__disconnect_after_job__" /opt/semaphore/agent/config.yaml
  yq e -i ".disconnect-after-idle-timeout = $__disconnect_after_idle_timeout__" /opt/semaphore/agent/config.yaml
  yq e -i ".upload-job-logs = \"when-trimmed\"" /opt/semaphore/agent/config.yaml
  echo $__agent_params__ | jq '.envVars[]' | xargs -I {} yq e -P -i '.env-vars = .env-vars + "{}"' /opt/semaphore/agent/config.yaml

  # Update agent configuration file permissions
  sudo chown semaphore:semaphore /opt/semaphore/agent/config.yaml
}

#
# Fetch the SSH public keys from the SSM parameter store,
# and place them into the .ssh/known_hosts folder.
#
configure_known_hosts() {
  local __region__=$1
  local __param_name__=$2

  echo "Creating .ssh folder..."
  sudo mkdir -p /home/semaphore/.ssh

  echo "Fetching SSH keys from SSM parameter '$__param_name__'..."
  local __keys__=$(retry_cmd "aws ssm get-parameter \
    --region '$__region__' \
    --name '$__param_name__' \
    --query Parameter.Value \
    --output text"
  )

  if [[ $? != 0 ]]; then
    echo "Error fetching SSH keys."
    return 1
  fi

  echo "Adding keys to .ssh/known_hosts..."
  echo $__keys__ | jq -r '.[]' | sed 's/^/github.com /' | sudo tee -a /home/semaphore/.ssh/known_hosts

  echo "Updating permissions on .ssh folder..."
  sudo chown -R semaphore:semaphore /home/semaphore/.ssh
}

#
# Main script starts here.
#
trap 'on_failure $? $LINENO' EXIT

agent_config_param_name=$1
if [[ -z "$agent_config_param_name" ]]; then
  echo "No agent config parameter name specified. Exiting..."
  exit 1
fi

token=$(fetch_idms_token)
region=$(curl \
  -H "X-aws-ec2-metadata-token: $token" \
  --fail \
  --silent \
  --show-error \
  --location "http://169.254.169.254/latest/meta-data/placement/region"
)

# The parameters required for the agent configuration are stored in an SSM parameter.
# We need to fetch them before proceeding with anything else.
echo "Fetching agent params from SSM parameter '$agent_config_param_name'..."
agent_params=$(fetch_agent_params $region $agent_config_param_name)

# In order for code checkout to work properly,
# we need to let the instance know about GitHub's public SSH keys.
ssh_keys_param=$(echo $agent_params | jq -r '.sshKeysParameterName')
configure_known_hosts $region $ssh_keys_param

# Fetch agent token from its SSM parameter,
# and update the agent configuration YAML.
agent_token_param_name=$(echo $agent_params | jq -r '.agentTokenParameterName')
echo "Fetching agent token from SSM parameter '$agent_token_param_name'..."
agent_token=$(fetch_agent_token $region $agent_token_param_name)
change_agent_config $agent_params $agent_token

# After upgrading the agent configuration, start the agent systemd service.
echo "Starting agent..."
sudo systemctl start semaphore-agent

# Create cron job to continously check if agent is running
echo "* * * * * semaphore /opt/semaphore/agent/health-check.sh >> /opt/semaphore/agent/health-check.log" | sudo tee -a /etc/cron.d/semaphore_agent_healthcheck
sudo /etc/init.d/cron reload
