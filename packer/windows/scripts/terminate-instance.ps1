$Token = (Invoke-WebRequest -UseBasicParsing -Method Put -Headers @{'X-aws-ec2-metadata-token-ttl-seconds' = '60'} http://169.254.169.254/latest/api/token).content
$InstanceId = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/instance-id).content
$Region = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/placement/region).content

# We unset all AWS related variables to make sure the instance profile is always used.
# Before, we were using a specific AWS CLI profile that activates the instance profile,
# but that didn't work if people messed up the ~/.aws/config file.
$env:AWS_ACCESS_KEY_ID = ""
$env:AWS_SECRET_ACCESS_KEY = ""
$env:AWS_SESSION_TOKEN = ""
Remove-Item -Recurse -Force -Path $HOME\.aws\credentials

if ($env:SEMAPHORE_AGENT_SHUTDOWN_REASON -eq "IDLE") {
  aws autoscaling terminate-instance-in-auto-scaling-group `
    --region "$Region" `
    --instance-id "$InstanceId" `
    "--should-decrement-desired-capacity" 2> $null
} else {
  aws autoscaling terminate-instance-in-auto-scaling-group `
    --region "$Region" `
    --instance-id "$InstanceId" `
    "--no-should-decrement-desired-capacity" 2> $null
}
