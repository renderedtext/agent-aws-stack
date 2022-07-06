$ErrorActionPreference = 'Stop'

$Region = $args[0]
if (-not $Region) {
  throw "AWS region is required"
}

$AccountId = $args[1]
if (-not $AccountId) {
  throw "AWS account ID is required"
}

$RoleName = $args[2]
if (-not $RoleName) {
  throw "Role name is required"
}

Write-Output "Configuring .aws folder"
$awsFileContent = @"
[default]
region = $Region

[profile semaphore__agent-aws-stack-instance-profile]
region = $Region
role_arn = arn:aws:iam::$AccountId`:role/$RoleName
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
