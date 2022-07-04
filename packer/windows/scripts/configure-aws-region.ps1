$ErrorActionPreference = 'Stop'

$Region = $args[0]
if (-not $Region) {
  throw "AWS region is required"
}

Write-Output "Configuring .aws folder"
$awsFileContent = @"
[profile instance]
region = $Region
credential_source = Ec2InstanceMetadata
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
