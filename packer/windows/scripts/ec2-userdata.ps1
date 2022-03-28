<powershell>
Start-Transcript

Write-Output "Running User Data Script"
Set-ExecutionPolicy Unrestricted -Scope LocalMachine -Force -ErrorAction Ignore

# Don't set this before Set-ExecutionPolicy as it throws an error
$ErrorActionPreference = "stop"

Remove-Item -Path WSMan:\Localhost\listener\listener* -Recurse
$Cert = New-SelfSignedCertificate -CertstoreLocation Cert:\LocalMachine\My -DnsName "packer"
New-Item -Path WSMan:\LocalHost\Listener -Transport HTTPS -Address * -CertificateThumbPrint $Cert.Thumbprint -Force

Write-Output "Setting up WinRM"
winrm set "winrm/config" '@{MaxTimeoutms="1800000"}'
winrm set "winrm/config/winrs" '@{MaxMemoryPerShellMB="1024"}'
winrm set "winrm/config/service/auth" '@{Basic="true"}'
netsh advfirewall firewall add rule name="Port 5986" protocol=TCP dir=in localport=5986 action=allow

Stop-Transcript
</powershell>