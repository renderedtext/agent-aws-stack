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

source "amazon-ebs" "ubuntu" {
  ami_name      = "${var.ami_prefix}-${var.stack_version}-ubuntu-bionic-${var.arch}-${var.hash}"
  region        = "${var.region}"
  instance_type = "${var.instance_type}"
  ssh_username  = "ubuntu"

  tags = {
    Name = "Semaphore agent"
    Version = "${var.stack_version}"
    Arch = "${var.arch}"
    Agent_Version = "${var.agent_version}"
    OS_Version = "Ubuntu Bionic 18.04"
    Hash = "${var.hash}"
  }

  source_ami_filter {
    most_recent = true

    // Canonical's ownerId: https://ubuntu.com/server/docs/cloud-images/amazon-ec2
    owners = ["099720109477"]

    filters = {
      name                = "ubuntu/images/*ubuntu-bionic-18.04-${var.arch}-*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
  }
}

build {
  name = "semaphore-agent-ubuntu-bionic"

  sources = [
    "source.amazon-ebs.ubuntu"
  ]

  provisioner "ansible" {
    playbook_file = "ansible/ubuntu-bionic.yml"
    user          = "ubuntu"
    extra_arguments = [
      "--skip-tags",
      "reboot",
      "--extra-vars", "agent_version=${var.agent_version}"
    ]
  }
}
