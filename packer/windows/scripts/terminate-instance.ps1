$Token = (Invoke-WebRequest -UseBasicParsing -Method Put -Headers @{'X-aws-ec2-metadata-token-ttl-seconds' = '60'} http://169.254.169.254/latest/api/token).content
$InstanceId = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/instance-id).content
$Region = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/placement/region).content

if ($env:SEMAPHORE_AGENT_SHUTDOWN_REASON -eq "IDLE") {
  aws autoscaling terminate-instance-in-auto-scaling-group --profile "instance" --region "$Region" --instance-id "$InstanceId" "--should-decrement-desired-capacity" 2> $null
} else {
  aws autoscaling terminate-instance-in-auto-scaling-group --profile "instance" --region "$Region" --instance-id "$InstanceId" "--no-should-decrement-desired-capacity" 2> $null
}
