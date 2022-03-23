variable "stack_version" {
  type = string
}

variable "agent_version" {
  type = string
}

variable "hash" {
  type = string
}

variable "ami_prefix" {
  type    = string
  default = "semaphore-agent"
}

variable "arch" {
  type    = string
  default = "amd64-server"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "instance_type" {
  type    = string
  default = "t2.micro"
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
    Arch = "${var.arch}"
    Agent_Version = "${var.agent_version}"
    OS_Version = "Windows Server 2019"
    Hash = "${var.hash}"
  }

  source_ami_filter {
    most_recent = true

    // Amazon's ownerId
    owners = ["801119661308"]

    filters = {
      name                = "Windows_Server-2019-English-Full-Containers*"
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
    source = "scripts/terminate-instance.ps1"
    destination = "C:\\packer-tmp\\terminate-instance.ps1"
  }

  provisioner "file" {
    source = "scripts/start-agent.ps1"
    destination = "C:\\packer-tmp\\start-agent.ps1"
  }

  provisioner "file" {
    source = "scripts/provision-ami.ps1"
    destination = "C:\\packer-tmp\\provision-ami.ps1"
  }

  provisioner "file" {
    source = "files/amazon-cloudwatch-agent.json"
    destination = "C:\\packer-tmp\\amazon-cloudwatch-agent.json"
  }

  provisioner "powershell" {
    inline = [
      "C:\\packer-tmp\\provision-ami.ps1 ${var.agent_version}",
      "Remove-Item -Path C:\\packer-tmp -Recurse -Force",
      "C:\\ProgramData\\Amazon\\EC2-Windows\\Launch\\Scripts\\InitializeInstance.ps1 -Schedule",
      "C:\\ProgramData\\Amazon\\EC2-Windows\\Launch\\Scripts\\SysprepInstance.ps1 -NoShutdown"
    ]
  }
}
