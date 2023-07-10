#!/bin/bash

# This script is executed as a cron job, so we need to include a few things in the PATH.
ARCH=$(uname -m)
if [[ ${ARCH} =~ "arm" || ${ARCH} == "aarch64" ]]; then
  export PATH="/opt/homebrew/bin:/opt/homebrew/sbin${PATH+:$PATH}";
else
  export PATH=/usr/local/bin:$PATH
fi

procs=$(ps aux | grep "/opt/semaphore/agent/agent start" | grep -v grep)
if [[ -z ${procs} ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Agent is not running - marking instance as unhealthy."

  # We shut down the instance using the OS here (instead of IMDS and autoscaling API),
  # because this script will only be needed when the agent itself can't terminate the instance
  # using IMDS and the autoscaling API. That can happen because the job messed up with the
  # IMDS setup in the VM or some other weird behavior.
  sudo shutdown -h now
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Agent is running."
fi
