$proc = Get-Process | Where {$_.Path -Like "C:\semaphore-agent\agent.exe"}
if ($proc) {
  "[$(Get-Date -Format 'dd/MM/yyyy HH:mm')] Agent is running." | Out-File -FilePath C:\semaphore-agent\health-check.log -Append -Encoding utf8
} else {
  "[$(Get-Date -Format 'dd/MM/yyyy HH:mm')] Agent is not running - marking instance as unhealthy." | Out-File -FilePath C:\semaphore-agent\health-check.log -Append -Encoding utf8

  # We shut down the instance using the OS here (instead of IMDS and autoscaling API),
  # because this script will only be needed when the agent itself can't terminate the instance
  # using IMDS and the autoscaling API. That can happen because the job messed up with the
  # IMDS setup in the VM or some other weird behavior.
  Stop-Computer
}
