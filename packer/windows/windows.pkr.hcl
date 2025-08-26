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
      version = "1.3.9"
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
      name                = "EC2LaunchV2-Windows_Server-2019-English-Full-Base*"
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
      "scripts/health-check.ps1",
      "scripts/provision-ami.ps1",
      "scripts/configure-github-ssh-keys.ps1",
      "scripts/gen-pre-signed-url.py",
      "files/amazon-cloudwatch-agent.json"
    ]
  }

  provisioner "powershell" {
    inline = [
      "C:\\packer-tmp\\provision-ami.ps1 ${var.agent_version} ${var.toolbox_version}",
      "Remove-Item -Path C:\\packer-tmp -Recurse -Force",
      "& 'C:\\Program Files\\Amazon\\EC2Launch\\EC2Launch.exe' reset --block",
      "& 'C:\\Program Files\\Amazon\\EC2Launch\\EC2Launch.exe' sysprep --block --shutdown"
    ]
  }
}
