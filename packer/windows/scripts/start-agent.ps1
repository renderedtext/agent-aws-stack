function Set-InstanceHealth {
  $Token = (Invoke-WebRequest -UseBasicParsing -Method Put -Headers @{'X-aws-ec2-metadata-token-ttl-seconds' = '60'} http://169.254.169.254/latest/api/token).content
  $instance_id=(Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/instance-id).content

  aws autoscaling set-instance-health `
    --instance-id "$instance_id" `
    --health-status Unhealthy
}

#
# Retry a command for a fixed amount of times, with a fixed delay between each failure.
#
function Retry-Command {
  [CmdletBinding()]
  Param(
    [Parameter(Mandatory=$true)]
    [scriptblock]$ScriptBlock,

    [Parameter(Mandatory=$false)]
    [int]$MaxAttempts = 30
  )

  Begin {
    $currentAttempt = 0
  }

  Process {
    do {
      $currentAttempt++
      try {
        $ScriptBlock.Invoke()
        return
      } catch {
        Write-Error $_.Exception.InnerException.Message -ErrorAction Continue
        $delay = Get-Random -Minimum 750 -Maximum 5000
        Start-Sleep -Milliseconds $delay
      }
    } while ($currentAttempt -lt $MaxAttempts)

    # Throw an error if we have exhausted our attempts.
    throw "Execution failed after $currentAttempt attempts."
  }
}

function Generate-AgentName {
  $idmsToken = (Invoke-WebRequest -UseBasicParsing -Method Put -Headers @{'X-aws-ec2-metadata-token-ttl-seconds' = '60'} http://169.254.169.254/latest/api/token).content
  $instanceId = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $idmsToken} http://169.254.169.254/latest/meta-data/instance-id).content
  $randomPart = -join (1..12 | ForEach {[char]((97..122) + (48..57) | Get-Random)})
  return $instanceId+"__"+$randomPart
}

# Do not show any progress bars when downloading things
$ProgressPreference = 'SilentlyContinue'

# Stop immediately when an error occurs
$ErrorActionPreference = 'Stop'

# Make sure the EC2 instance is replaced by a new one
# in case anything goes wrong with this script
trap {Set-InstanceHealth}

$AgentConfigParamName = $args[0]
if (-not $AgentConfigParamName) {
  throw "No agent config parameter name specified."
}

$Token = (Invoke-WebRequest -UseBasicParsing -Method Put -Headers @{'X-aws-ec2-metadata-token-ttl-seconds' = '60'} http://169.254.169.254/latest/api/token).Content
$Region = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/placement/region).Content
$RoleName = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/meta-data/iam/security-credentials).Content
$AccountId = (Invoke-WebRequest -UseBasicParsing -Headers @{'X-aws-ec2-metadata-token' = $Token} http://169.254.169.254/latest/dynamic/instance-identity/document).Content | jq -r '.accountId'

# We grab the agent configuration and token from the SSM parameters
# and put them into environment variables for the 'install.ps1' script to use.
Write-Output "Fetching agent params..."
$agentParams = Retry-Command -ScriptBlock {
  aws ssm get-parameter --region "$Region" --name "$AgentConfigParamName" --query Parameter.Value --output text
}

# Create semaphore password and user
# This is the user we will use to run the nssm service for the agent
Add-Type -AssemblyName 'System.Web'
$UserName = "semaphore"
$Password = [System.Web.Security.Membership]::GeneratePassword(16, 0)
$PasswordAsSecureString = $Password | ConvertTo-SecureString -AsPlainText -Force
$Credentials = New-Object System.Management.Automation.PSCredential -ArgumentList ".\$UserName",$PasswordAsSecureString
Write-Output "Creating '$UserName' user..."
New-LocalUser -Name $UserName -PasswordNeverExpires -Password $PasswordAsSecureString | out-null
Add-LocalGroupMember -Group "Administrators" -Member $UserName | out-null

# In order to use Invoke-Command to run a local command as another local user,
# these things need to be enabled and running
Enable-PSRemoting
winrm quickconfig -quiet

# Configure GitHub SSH keys and AWS region.
# These scripts need to be run by the semaphore user
# because they use the $HOME variable to properly configure
# the '$HOME/.ssh' and '$HOME/.aws' folders.
$SSHKeysParamName = $agentParams | jq -r '.sshKeysParameterName'
$SSHKeys = Retry-Command -ScriptBlock {
  aws ssm get-parameter --region "$Region" --name "$SSHKeysParamName" --query Parameter.Value --output text
}

Invoke-Command -ComputerName localhost -Credential $Credentials -ScriptBlock {
  C:\semaphore-agent\configure-github-ssh-keys.ps1 $using:SSHKeys
}

Write-Output "Fetching agent token..."
$agentTokenParamName = $agentParams | jq -r '.agentTokenParameterName'
$agentToken = Retry-Command -ScriptBlock {
  aws ssm get-parameter --region "$Region" --name "$agentTokenParamName" --query Parameter.Value --output text --with-decryption
}

# The installation script needs to be run by the semaphore user
# because it downloads and sets up the toolbox at '$HOME/.toolbox'
Invoke-Command -ComputerName localhost -Credential $Credentials -ScriptBlock {
  Set-Location C:\semaphore-agent
  $env:SemaphoreRegistrationToken = $using:agentToken
  $env:SemaphoreEndpoint = $using:agentParams | jq -r '.endpoint'
  $env:SemaphoreAgentDisconnectAfterJob = $using:agentParams | jq -r '.disconnectAfterJob'
  $env:SemaphoreAgentDisconnectAfterIdleTimeout = $using:agentParams | jq -r '.disconnectAfterIdleTimeout'
  $env:SemaphoreAgentShutdownHook = "C:\\semaphore-agent\\hooks\\shutdown.ps1"
  $env:SemaphoreToolboxVersion = Get-Content -Path C:\semaphore-agent\toolbox_version
  .\install.ps1
}

$agentName = Generate-AgentName
Write-Output "Using name '$agentName' for agent."

$nameExpr = '.name = ""{0}""' -f $agentName
yq e -i $nameExpr C:\semaphore-agent\config.yaml
yq e -i '.upload-job-logs = ""when-trimmed""' C:\semaphore-agent\config.yaml
$agentParams | jq '.envVars[]' | ForEach-Object -Process {
  yq e -P -i ".env-vars = .env-vars + `"$_`"" C:\semaphore-agent\config.yaml
}

# Create nssm service for agent
Write-Output "Creating agent nssm service..."
nssm install semaphore-agent C:\semaphore-agent\agent.exe start --config-file C:\semaphore-agent\config.yaml
nssm set semaphore-agent ObjectName .\$UserName $Password
nssm set semaphore-agent AppStdout C:\semaphore-agent\agent.log
nssm set semaphore-agent AppStderr C:\semaphore-agent\agent.log
nssm set semaphore-agent AppExit Default Restart
nssm set semaphore-agent AppRestartDelay 10000

Write-Output "Starting agent service..."
nssm start semaphore-agent

Write-Output "Disabling PSRemoting and winRM service..."
Disable-PSRemoting -Force
Stop-Service WinRM
Set-Service WinRM -StartupType Disabled

Write-Output "Done."
