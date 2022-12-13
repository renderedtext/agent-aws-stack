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
  type = string
}

variable "instance_type" {
  type    = string
  default = "mac2.metal"
}

packer {
  required_plugins {
    amazon = {
      version = ">= 0.0.2"
      source  = "github.com/hashicorp/amazon"
    }
  }
}

source "amazon-ebs" "macos" {
  ami_name      = "${var.ami_prefix}-${var.stack_version}-macos-${var.arch}-${var.hash}"
  region        = "${var.region}"
  instance_type = "${var.instance_type}"
  ssh_username  = "ec2-user"
  ssh_timeout   = "2h"
  tenancy       = "host"
  ebs_optimized = true

  aws_polling {
    delay_seconds = 60
    max_attempts = 60
  }

  launch_block_device_mappings {
    device_name = "/dev/sda1"
    volume_size = 120
    volume_type = "gp3"
    iops = 3000
    throughput = 125
    delete_on_termination = true
  }

  tags = {
    Name = "Semaphore agent"
    Version = "${var.stack_version}"
    Agent_Version = "${var.agent_version}"
    Toolbox_Version = "${var.toolbox_version}"
    Hash = "${var.hash}"
  }

  source_ami_filter {
    most_recent = true
    owners = ["amazon"]

    filters = {
      name                = "amzn-ec2-macos-12.4*"
      architecture        = "${var.arch}*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
  }
}

build {
  name = "semaphore-agent-macos"

  sources = [
    "source.amazon-ebs.macos"
  ]

  provisioner "file" {
    destination = "/tmp/"
    sources = [
      "files/amazon-cloudwatch-agent.json",
      "files/start-agent.sh"
    ]
  }

  provisioner "shell" {
    script = "scripts/provision-ami.sh"
    environment_vars = [
      "AGENT_VERSION=${var.agent_version}",
      "TOOLBOX_VERSION=${var.toolbox_version}"
    ]
  }
}
