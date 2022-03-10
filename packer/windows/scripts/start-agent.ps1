function Add-GHKeysToKnownHosts {
  Write-Output "Adding github SSH keys to known_hosts..."
  if (-not (Test-Path "$HOME\.ssh")) {
    New-Item -ItemType Directory -Path "$HOME\.ssh" > $null
  }

  $metaResponse = (Invoke-WebRequest -UseBasicParsing "https://api.github.com/meta").Content
  $keys = $metaResponse | jq -r '.ssh_keys[]'
  $knownHosts = $keys -replace '^', 'github.com'

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

  Write-Output "Fetching agent params..."
  $agentParams = aws ssm get-parameter --region "$Region" --name "$SSMParamName" --query Parameter.Value --output text

  Write-Output "Fetching agent token..."
  $agentTokenParamName = $agentParams | jq -r '.agentTokenParameterName'
  $env:SemaphoreAgentToken = aws ssm get-parameter --region "$Region" --name "$agentTokenParamName" --query Parameter.Value --output text --with-decryption

  Write-Output "Changing agent configuration..."
  $env:SemaphoreOrganization = $agentParams | jq -r '.organization'
  $env:SemaphoreAgentDisconnectAfterJob = $agentParams | jq -r '.disconnectAfterJob'
  $env:SemaphoreAgentDisconnectAfterIdleTimeout = $agentParams | jq -r '.disconnectAfterIdleTimeout'

  yq e -i '.endpoint = env(SemaphoreOrganization)' C:\semaphore-agent\config.yaml
  yq e -i '.token = env(SemaphoreAgentToken)' C:\semaphore-agent\config.yaml
  yq e -i '.disconnect-after-job = env(SemaphoreAgentDisconnectAfterJob)' C:\semaphore-agent\config.yaml
  yq e -i '.disconnect-after-idle-timeout = env(SemaphoreAgentDisconnectAfterIdleTimeout)' C:\semaphore-agent\config.yaml

  $agentParams | jq '.envVars[]' | ForEach-Object -Process {
    yq e -P -i ".env-vars = .env-vars + `"$_`"" C:\semaphore-agent\config.yaml
  }
}

$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

$AgentConfigParamName = $args[0]
if (-not $AgentConfigParamName) {
  Write-Output "No agent config parameter name specified. Exiting..."
  Exit 1
}

# Configure GH keys and aws config
$Token = (Invoke-WebRequest -UseBasicParsing -Method Put -Headers @{'X-aws-ec2-metadata-token-ttl-seconds' = '60'} http://169.254.169.254/latest/api/token).Content
$Region = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/placement/region).Content
Add-GHKeysToKnownHosts
Add-AWSConfig -Region $Region
Update-AgentConfig -SSMParamName $AgentConfigParamName -Region $Region

Write-Output "Starting agent..."
Start-Process C:\semaphore-agent\agent.exe -ArgumentList '--config-file', 'C:\semaphore-agent\config.yaml'
Write-Output "Done."
