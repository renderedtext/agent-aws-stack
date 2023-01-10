#!/bin/bash

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
  mark_as_unhealthy
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Agent is running."
fi
