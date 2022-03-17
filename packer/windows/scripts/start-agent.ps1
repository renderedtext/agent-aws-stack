function Set-InstanceHealth {
  $Token = (Invoke-WebRequest -UseBasicParsing -Method Put -Headers @{'X-aws-ec2-metadata-token-ttl-seconds' = '60'} http://169.254.169.254/latest/api/token).content
  $instance_id=(Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/instance-id).content

  aws autoscaling set-instance-health `
    --instance-id "$instance_id" `
    --health-status Unhealthy
}

function Add-GHKeysToKnownHosts {
  $ProgressPreference = 'SilentlyContinue'
  $ErrorActionPreference = 'Stop'

  Write-Output "Adding github SSH keys to known_hosts..."
  if (-not (Test-Path "$HOME\.ssh")) {
    New-Item -ItemType Directory -Path "$HOME\.ssh" > $null
  }

  $metaResponse = (Invoke-WebRequest -UseBasicParsing "https://api.github.com/meta").Content
  $keys = $metaResponse | jq -r '.ssh_keys[]'
  $knownHosts = $keys -replace '^', 'github.com '

  $KnownHostsPath = "$HOME\.ssh\known_hosts"
  if (-not (Test-Path $KnownHostsPath)) {
    New-Item -ItemType File -Path $KnownHostsPath > $null
    Set-Content -Path $KnownHostsPath -Value $knownHosts
  } else {
    Add-Content -Path $KnownHostsPath -Value $knownHosts
  }
}

function Add-AWSConfig {
  [CmdletBinding()]
  param (
      [Parameter()]
      [string]
      $Region
  )

  $ProgressPreference = 'SilentlyContinue'
  $ErrorActionPreference = 'Stop'

  Write-Output "Configuring .aws folder"
  $awsFileContent = @"
[default]
region = $Region
"@

  if (-not (Test-Path "$HOME\.aws")) {
    New-Item -ItemType Directory -Path "$HOME\.aws" > $null
  }

  $awsConfigPath = "$HOME\.aws\config"
  if (Test-Path $awsConfigPath) {
    Remove-Item -Path $awsConfigPath -Force
  }

  New-Item -ItemType File -Path $awsConfigPath > $null
  Set-Content -Path $awsConfigPath -Value $awsFileContent
}

function Update-AgentConfig {
  [CmdletBinding()]
  param (
      [Parameter()]
      [string]
      $Region,

      [Parameter()]
      [string]
      $SSMParamName
  )

  $ProgressPreference = 'SilentlyContinue'
  $ErrorActionPreference = 'Stop'

  Write-Output "Fetching agent params..."
  $agentParams = aws ssm get-parameter --region "$Region" --name "$SSMParamName" --query Parameter.Value --output text

  Write-Output "Fetching agent token..."
  $agentTokenParamName = $agentParams | jq -r '.agentTokenParameterName'
  $env:SemaphoreAgentToken = aws ssm get-parameter --region "$Region" --name "$agentTokenParamName" --query Parameter.Value --output text --with-decryption

  Write-Output "Changing agent configuration..."
  $env:SemaphoreEndpoint = $agentParams | jq -r '.endpoint'
  $env:SemaphoreAgentDisconnectAfterJob = $agentParams | jq -r '.disconnectAfterJob'
  $env:SemaphoreAgentDisconnectAfterIdleTimeout = $agentParams | jq -r '.disconnectAfterIdleTimeout'

  yq e -i '.endpoint = env(SemaphoreEndpoint)' C:\semaphore-agent\config.yaml
  yq e -i '.token = env(SemaphoreAgentToken)' C:\semaphore-agent\config.yaml
  yq e -i '.disconnect-after-job = env(SemaphoreAgentDisconnectAfterJob)' C:\semaphore-agent\config.yaml
  yq e -i '.disconnect-after-idle-timeout = env(SemaphoreAgentDisconnectAfterIdleTimeout)' C:\semaphore-agent\config.yaml

  $agentParams | jq '.envVars[]' | ForEach-Object -Process {
    yq e -P -i ".env-vars = .env-vars + `"$_`"" C:\semaphore-agent\config.yaml
  }
}

$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

trap {Set-InstanceHealth}

$AgentConfigParamName = $args[0]
if (-not $AgentConfigParamName) {
  throw "No agent config parameter name specified."
}

# Configure GH keys and aws config
$Token = (Invoke-WebRequest -UseBasicParsing -Method Put -Headers @{'X-aws-ec2-metadata-token-ttl-seconds' = '60'} http://169.254.169.254/latest/api/token).Content
$Region = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/placement/region).Content
Add-GHKeysToKnownHosts
Add-AWSConfig -Region $Region
Update-AgentConfig -SSMParamName $AgentConfigParamName -Region $Region

Write-Output "Creating agent nssm service..."
nssm install semaphore-agent C:\semaphore-agent\agent.exe start --config-file C:\semaphore-agent\config.yaml
nssm set semaphore-agent AppStdout C:\semaphore-agent\agent.log
nssm set semaphore-agent AppStderr C:\semaphore-agent\agent.log
nssm set semaphore-agent AppEnvironmentExtra :HOME=C:\semaphore-agent
nssm set semaphore-agent AppExit Default Restart
nssm set semaphore-agent AppRestartDelay 10000

Write-Output "Starting agent service..."
nssm start semaphore-agent
Write-Output "Done."
