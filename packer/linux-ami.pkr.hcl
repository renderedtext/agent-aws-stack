variable "ami_prefix" {
  type    = string
  default = "semaphore-agent-base"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "instance_type" {
  type    = string
  default = "t2.micro"
}

variable "agent_version" {
  type = string
}

locals {
  timestamp = regex_replace(timestamp(), "[- TZ:]", "")
}

packer {
  required_plugins {
    amazon = {
      version = ">= 0.0.2"
      source  = "github.com/hashicorp/amazon"
    }
  }
}

source "amazon-ebs" "ubuntu" {
  ami_name      = "${var.ami_prefix}-linux-${var.agent_version}-${local.timestamp}"
  region        = "${var.region}"
  instance_type = "${var.instance_type}"
  ssh_username  = "ubuntu"

  tags = {
    Name = "Semaphore agent base image"
  }

  source_ami_filter {
    most_recent = true

    // Canonical's ownerId: https://ubuntu.com/server/docs/cloud-images/amazon-ec2
    owners = ["099720109477"]

    filters = {
      name                = "ubuntu/images/*ubuntu-bionic-18.04-amd64-server-*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
  }
}

build {
  name = "semaphore-agent-base"

  sources = [
    "source.amazon-ebs.ubuntu"
  ]

  provisioner "shell" {
    scripts = [
      "scripts/install-utils.sh"
    ]
  }

  provisioner "file" {
    destination = "/tmp/"
    sources = [
      "scripts/install-agent.sh",
      "scripts/start-agent.sh",
      "scripts/terminate-instance.sh",
    ]
  }

  provisioner "shell" {
    inline = [
      "sudo /tmp/install-agent.sh ${var.agent_version}",
      "sudo mv /tmp/start-agent.sh /opt/semaphore/agent/start.sh"
    ]
  }
}
