#!/bin/bash

# This script is executed as a cron job, so we need to include a few things in the PATH.
ARCH=$(uname -m)
if [[ ${ARCH} =~ "arm" || ${ARCH} == "aarch64" ]]; then
  export PATH="/opt/homebrew/bin:/opt/homebrew/sbin${PATH+:$PATH}";
else
  export PATH=/usr/local/bin:$PATH
fi

mark_as_unhealthy() {
  local __token__=$(curl -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" --fail --silent --show-error --location "http://169.254.169.254/latest/api/token")
  local __instance_id__=$(curl -H "X-aws-ec2-metadata-token: $__token__" --fail --silent --show-error --location "http://169.254.169.254/latest/meta-data/instance-id")

  # We unset all AWS related variables to make sure the instance profile is used for this.
  unset AWS_ACCESS_KEY_ID
  unset AWS_SECRET_ACCESS_KEY
  unset AWS_SESSION_TOKEN
  rm -rf $HOME/.aws/credentials

  aws autoscaling set-instance-health \
    --instance-id "${__instance_id__}" \
    --health-status Unhealthy
}

procs=$(ps aux | grep "/opt/semaphore/agent/agent start" | grep -v grep)
if [[ -z ${procs} ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Agent is not running - marking instance as unhealthy."

  # Differently from linux/windows, there's no way to properly shutdown a macOS instance from the OS.
  # So, on macOS, we need to use the IMDS and the autoscaling API to terminate the instance.
  mark_as_unhealthy
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Agent is running."
fi
