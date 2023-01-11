function Set-InstanceHealth {
  $Token = (Invoke-WebRequest -UseBasicParsing -Method Put -Headers @{'X-aws-ec2-metadata-token-ttl-seconds' = '60'} http://169.254.169.254/latest/api/token).content
  $instance_id = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/instance-id).content

  # We unset all AWS related variables to make sure the instance profile is always used.
  $env:AWS_ACCESS_KEY_ID = ""
  $env:AWS_SECRET_ACCESS_KEY = ""
  $env:AWS_SESSION_TOKEN = ""

  if (Test-Path "$HOME\.aws\credentials") {
    Remove-Item -Recurse -Force -Path "$HOME\.aws\credentials"
  }

  aws autoscaling set-instance-health `
    --instance-id "$instance_id" `
    --health-status Unhealthy
}

$proc = Get-Process | Where {$_.Path -Like "C:\semaphore-agent\agent.exe"}
if ($proc) {
  Add-Content `
    -Path C:\semaphore-agent\health-check.log `
    -Value "[$(Get-Date -Format 'dd/MM/yyyy HH:mm')] Agent is running."
} else {
  Add-Content `
    -Path C:\semaphore-agent\health-check.log `
    -Value "[$(Get-Date -Format 'dd/MM/yyyy HH:mm')] Agent is not running - marking instance as unhealthy."
  Set-InstanceHealth
}
