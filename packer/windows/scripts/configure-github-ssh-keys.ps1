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
