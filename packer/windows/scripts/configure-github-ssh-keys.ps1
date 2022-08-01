$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

$SSHKeys = $args[0]
if (-not $SSHKeys) {
  throw "SSH Keys are required."
}

$keys = $SSHKeys | jq -r '.[]'
$knownHosts = $keys -replace '^', 'github.com '
Write-Output "Adding github SSH keys to known_hosts..."
if (-not (Test-Path "$HOME\.ssh")) {
  New-Item -ItemType Directory -Path "$HOME\.ssh" > $null
}

$KnownHostsPath = "$HOME\.ssh\known_hosts"
if (-not (Test-Path $KnownHostsPath)) {
  New-Item -ItemType File -Path $KnownHostsPath > $null
  Set-Content -Path $KnownHostsPath -Value $knownHosts
} else {
  Add-Content -Path $KnownHostsPath -Value $knownHosts
}
