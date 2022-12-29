variable "stack_version" {
  type = string
}

variable "agent_version" {
  type = string
}

variable "toolbox_version" {
  type = string
}

variable "hash" {
  type = string
}

variable "arch" {
  type = string
}

variable "ami_prefix" {
  type    = string
}

variable "region" {
  type    = string
}

variable "instance_type" {
  type    = string
  default = "t2.micro"
}

variable "install_erlang" {
  type    = string
  default = "true"
}

packer {
  required_plugins {
    amazon = {
      version = ">= 0.0.2"
      source  = "github.com/hashicorp/amazon"
    }
  }
}

source "amazon-ebs" "windows" {
  ami_name       = "${var.ami_prefix}-${var.stack_version}-windows-${var.arch}-${var.hash}"
  region         = "${var.region}"
  instance_type  = "${var.instance_type}"
  user_data_file = "scripts/ec2-userdata.ps1"
  communicator   = "winrm"
  winrm_username = "Administrator"
  winrm_use_ssl  = true
  winrm_insecure = true

  tags = {
    Name = "Semaphore agent"
    Version = "${var.stack_version}"
    Agent_Version = "${var.agent_version}"
    Toolbox_Version = "${var.toolbox_version}"
    Hash = "${var.hash}"
  }

  source_ami_filter {
    most_recent = true

    // Amazon's ownerId
    owners = ["801119661308"]

    filters = {
      // The new AMIs released in 2022.12 use EC2 Launch version 1.3.2003961.
      // See https://docs.aws.amazon.com/AWSEC2/latest/WindowsGuide/ec2-windows-ami-version-history.html.
      //
      // That version has an issue that makes SysprepInstance.ps1 return a bad exit code.
      // See https://docs.aws.amazon.com/AWSEC2/latest/WindowsGuide/ec2launch-version-details.html.
      //
      // A new EC2 launch version 1.3.2003975 is already available,
      // but the AMIs provided by AWS were not yet upgraded.
      // Until AWS provides updated AMIs, we'll use the previous one.
      name                = "Windows_Server-2019-English-Full-ContainersLatest-2022.11*"
      architecture        = "${var.arch}"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
  }
}

build {
  name = "semaphore-agent-windows"

  sources = [
    "source.amazon-ebs.windows"
  ]

  provisioner "file" {
    destination = "C:\\packer-tmp\\"
    sources = [
      "scripts/terminate-instance.ps1",
      "scripts/start-agent.ps1",
      "scripts/provision-ami.ps1",
      "scripts/configure-github-ssh-keys.ps1",
      "files/amazon-cloudwatch-agent.json"
    ]
  }

  provisioner "powershell" {
    inline = [
      "C:\\packer-tmp\\provision-ami.ps1 ${var.agent_version} ${var.toolbox_version}",
      "Remove-Item -Path C:\\packer-tmp -Recurse -Force",
      "C:\\ProgramData\\Amazon\\EC2-Windows\\Launch\\Scripts\\InitializeInstance.ps1 -Schedule",
      "C:\\ProgramData\\Amazon\\EC2-Windows\\Launch\\Scripts\\SysprepInstance.ps1 -NoShutdown"
    ]
  }
}
