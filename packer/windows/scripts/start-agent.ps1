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

function Install-Agent {
  [CmdletBinding()]
  param (
      [Parameter()]
      [string]
      $Region,

      [Parameter()]
      [string]
      $SSMParamName,

      [Parameter()]
      [string]
      $UserName,

      [Parameter()]
      [string]
      $UserPassword
  )

  $ProgressPreference = 'SilentlyContinue'
  $ErrorActionPreference = 'Stop'

  Write-Output "Fetching agent params..."
  $agentParams = aws ssm get-parameter --region "$Region" --name "$SSMParamName" --query Parameter.Value --output text

  Write-Output "Fetching agent token..."
  $agentTokenParamName = $agentParams | jq -r '.agentTokenParameterName'
  $env:SemaphoreRegistrationToken = aws ssm get-parameter --region "$Region" --name "$agentTokenParamName" --query Parameter.Value --output text --with-decryption
  $env:SemaphoreEndpoint = $agentParams | jq -r '.endpoint'
  $env:SemaphoreAgentDisconnectAfterJob = $agentParams | jq -r '.disconnectAfterJob'
  $env:SemaphoreAgentDisconnectAfterIdleTimeout = $agentParams | jq -r '.disconnectAfterIdleTimeout'
  $env:SemaphoreAgentShutdownHook = "C:\\semaphore-agent\\hooks\\shutdown.ps1"
  .\install.ps1

  $agentParams | jq '.envVars[]' | ForEach-Object -Process {
    yq e -P -i ".env-vars = .env-vars + `"$_`"" C:\semaphore-agent\config.yaml
  }

  Write-Output "Creating agent nssm service..."
  nssm install semaphore-agent C:\semaphore-agent\agent.exe start --config-file C:\semaphore-agent\config.yaml
  nssm set semaphore-agent ObjectName .\$UserName $UserPassword
  nssm set semaphore-agent AppStdout C:\semaphore-agent\agent.log
  nssm set semaphore-agent AppStderr C:\semaphore-agent\agent.log
  nssm set semaphore-agent AppExit Default Restart
  nssm set semaphore-agent AppRestartDelay 10000

  Write-Output "Starting agent service..."
  nssm start semaphore-agent
  Write-Output "Done."
}

$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

trap {Set-InstanceHealth}

$AgentConfigParamName = $args[0]
if (-not $AgentConfigParamName) {
  throw "No agent config parameter name specified."
}

# Create semaphore user
$UserName = "semaphore"
Add-Type -AssemblyName 'System.Web'
$Password = [System.Web.Security.Membership]::GeneratePassword(16, 0)
$PasswordAsSecureString = $Password | ConvertTo-SecureString -AsPlainText -Force

Write-Output "Creating '$UserName' user..."
New-LocalUser -Name $UserName -PasswordNeverExpires -Password $PasswordAsSecureString | out-null
Add-LocalGroupMember -Group "Administrators" -Member $UserName | out-null

# Login as semaphore-agent
$credentials = New-Object System.Management.Automation.PSCredential -ArgumentList ".\$UserName",$PasswordAsSecureString
New-PSSession -Credential $credentials | Enter-PSSession

# Configure GH keys and aws config
$Token = (Invoke-WebRequest -UseBasicParsing -Method Put -Headers @{'X-aws-ec2-metadata-token-ttl-seconds' = '60'} http://169.254.169.254/latest/api/token).Content
$Region = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/placement/region).Content
Add-GHKeysToKnownHosts
Add-AWSConfig -Region $Region

# Install agent and create nssm service for it
Install-Agent -SSMParamName $AgentConfigParamName -Region $Region -UserName $UserName -UserPassword $Password
