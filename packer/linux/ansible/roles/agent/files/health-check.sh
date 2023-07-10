#!/bin/bash

procs=$(ps aux | grep "/opt/semaphore/agent/agent start" | grep -v grep)
if [[ -z ${procs} ]]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Agent is not running - marking instance as unhealthy."

  # We shut down the instance using the OS here (instead of IMDS and autoscaling API),
  # because this script will only be needed when the agent itself can't terminate the instance
  # using IMDS and the autoscaling API. That can happen because the job messed up with the
  # IMDS setup in the VM or some other weird behavior.
  sudo poweroff
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Agent is running."
fi
