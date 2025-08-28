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

variable "ami_prefix" {
  type = string
}

variable "arch" {
  type = string
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

variable "systemd_restart_seconds" {
  type    = string
  default = "1800"
}

variable "ubuntu_name" {
  type    = string
  default = "focal"
}

variable "ubuntu_version" {
  type    = string
  default = "20.04"
}

packer {
  required_plugins {
    amazon = {
      version = "1.3.9"
      source  = "github.com/hashicorp/amazon"
    }
  }
}

source "amazon-ebs" "ubuntu" {
  ami_name      = "${var.ami_prefix}-${var.stack_version}-ubuntu-${var.ubuntu_name}-${var.arch}-${var.hash}"
  region        = "${var.region}"
  instance_type = "${var.instance_type}"
  ssh_username  = "ubuntu"

  tags = {
    Name = "Semaphore agent"
    Version = "${var.stack_version}"
    Agent_Version = "${var.agent_version}"
    Toolbox_Version = "${var.toolbox_version}"
    Hash = "${var.hash}"
  }

  source_ami_filter {
    most_recent = true

    // Canonical's ownerId: https://ubuntu.com/server/docs/cloud-images/amazon-ec2
    owners = ["099720109477"]

    filters = {
      name                = "ubuntu/images/*ubuntu-${var.ubuntu_name}-${var.ubuntu_version}-*"
      architecture        = "${var.arch}"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
  }
}

build {
  name = "semaphore-agent-ubuntu-${var.ubuntu_name}"

  sources = [
    "source.amazon-ebs.ubuntu"
  ]

  provisioner "ansible" {
    playbook_file = "ansible/ubuntu-${var.ubuntu_name}.yml"
    user          = "ubuntu"
    use_proxy     = false
    extra_arguments = [
      "--skip-tags",
      "reboot",
      "-e agent_version=${var.agent_version}",
      "-e toolbox_version=${var.toolbox_version}",
      "-e install_erlang=${var.install_erlang}",
      "-e systemd_restart_seconds=${var.systemd_restart_seconds}",
    ]
  }
}
