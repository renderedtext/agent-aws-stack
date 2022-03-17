$ErrorActionPreference = "Stop"

$agentVersion = $args[0]
if (-not $agentVersion) {
  Write-Output "Agent version not specified. Exiting..."
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

# Install agent
$env:SemaphoreAgentShutdownHook = "C:\\semaphore-agent\\hooks\\shutdown.ps1"
$env:SemaphoreRegistrationToken = "DUMMY"
$env:SemaphoreOrganization = "DUMMY"
.\install.ps1
