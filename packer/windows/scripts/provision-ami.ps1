$ErrorActionPreference = "Stop"

$agentVersion = $args[0]
if (-not $agentVersion) {
  Write-Output "Agent version not specified. Exiting..."
  Exit 1
}

$toolboxVersion = $args[1]
if (-not $toolboxVersion) {
  Write-Output "Toolbox version not specified. Exiting..."
  Exit 1
}

# Install chocolatey
Write-Output "Installing chocolatey package manager..."
Set-ExecutionPolicy Bypass -Scope Process -Force
Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))

# Install packages through chocolatey
choco install -y 7zip --version 21.7
choco install -y git --version 2.35.1.2
choco install -y jq --version 1.6
choco install -y yq --version 4.21.1
choco install -y nssm --version 2.24.101.20180116

# Make `Update-SessionEnvironment` available
Write-Output "Importing the Chocolatey profile module..."
$ChocolateyInstall = Convert-Path "$((Get-Command choco).path)\..\.."
Import-Module "$ChocolateyInstall\helpers\chocolateyProfile.psm1"
Write-Output "Refreshing the current PowerShell session's environment..."
Update-SessionEnvironment

# no mismatched line endings
git config --system core.autocrlf false

# Install awscli
Write-Output "Installing awscli..."
msiexec.exe /i https://awscli.amazonaws.com/AWSCLIV2.msi

# Install cloudwatch agent
Write-Output "Downloading and installing amazon cloudwatch agent..."
Invoke-WebRequest -OutFile C:\packer-tmp\amazon-cloudwatch-agent.msi -Uri "https://s3.amazonaws.com/amazoncloudwatch-agent/windows/amd64/latest/amazon-cloudwatch-agent.msi"
Start-Process C:\packer-tmp\amazon-cloudwatch-agent.msi -Wait
sc.exe config AmazonCloudWatchAgent start= delayed-auto
Write-Output "Starting amazon cloudwatch agent..."
Copy-Item -Path C:\packer-tmp\amazon-cloudwatch-agent.json -Destination C:\ProgramData\Amazon\AmazonCloudWatchAgent
& 'C:\Program Files\Amazon\AmazonCloudWatchAgent\amazon-cloudwatch-agent-ctl.ps1' -a fetch-config -m ec2 -c file:C:\ProgramData\Amazon\AmazonCloudWatchAgent\amazon-cloudwatch-agent.json -s

# Download and unpack agent
Write-Output "Creating C:\semaphore-agent..."
New-Item -ItemType Directory -Path C:\semaphore-agent > $null
Set-Location C:\semaphore-agent

Write-Output "Downloading and unpacking agent $agentVersion..."
Invoke-WebRequest "https://github.com/semaphoreci/agent/releases/download/$agentVersion/agent_Windows_x86_64.tar.gz" -OutFile agent.tar.gz
tar.exe xvf agent.tar.gz > $null
Remove-Item agent.tar.gz

# Create hooks directory
Write-Output "Moving scripts..."
New-Item -ItemType Directory -Path C:\semaphore-agent\hooks > $null
Move-Item C:\packer-tmp\terminate-instance.ps1 C:\semaphore-agent\hooks\shutdown.ps1
Move-Item C:\packer-tmp\start-agent.ps1 C:\semaphore-agent\start.ps1
Move-Item C:\packer-tmp\health-check.ps1 C:\semaphore-agent\health-check.ps1
Move-Item C:\packer-tmp\configure-github-ssh-keys.ps1 C:\semaphore-agent\configure-github-ssh-keys.ps1

# The agent is installed when the instance starts, but the toolbox version
# is specified during the AMI provisioning phase. To pass that information
# to the agent start script, we place a 'toolbox_version' file in the
# agent installation directory. That file will be read by the start-agent.ps1 script
# when installing the agent and the specified toolbox version will be installed.
New-Item -ItemType File -Path C:\semaphore-agent\toolbox_version
Set-Content -Path C:\semaphore-agent\toolbox_version -Value "$toolboxVersion"
