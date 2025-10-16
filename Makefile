AWS_REGION=us-east-1
AMI_ARCH=x86_64
AMI_PREFIX=semaphore-agent
AMI_INSTANCE_TYPE=t2.micro
AGENT_VERSION=v2.2.16
TOOLBOX_VERSION=v1.20.5
PACKER_OS=linux
UBUNTU_VERSION=focal

# Set Ubuntu name and version number based on UBUNTU_VERSION
ifeq ($(UBUNTU_VERSION),focal)
  UBUNTU_NAME=focal
  UBUNTU_VERSION_NUMBER=20.04
else ifeq ($(UBUNTU_VERSION),noble)
  UBUNTU_NAME=noble
  UBUNTU_VERSION_NUMBER=24.04
else ifeq ($(UBUNTU_VERSION),jammy)
  UBUNTU_NAME=jammy
  UBUNTU_VERSION_NUMBER=22.04
else
  UBUNTU_NAME=focal
  UBUNTU_VERSION_NUMBER=20.04
endif

INSTALL_ERLANG=true
SYSTEMD_RESTART_SECONDS=1800
VERSION=$(shell cat package.json | jq -r '.version')
HASH=$(shell find Makefile packer/$(PACKER_OS) -type f -exec md5sum "{}" + | awk '{print $$1}' | sort | md5sum | awk '{print $$1}')

MONOREPO_TMP_DIR ?= /tmp/monorepo
SECURITY_TOOLBOX_TMP_DIR ?= $(MONOREPO_TMP_DIR)/security-toolbox
SECURITY_TOOLBOX_BRANCH ?= main

check.prepare:
	rm -rf $(MONOREPO_TMP_DIR)
	git clone --depth 1 --filter=blob:none --sparse https://github.com/semaphoreio/semaphore $(MONOREPO_TMP_DIR) && \
		cd $(MONOREPO_TMP_DIR) && \
		git config core.sparseCheckout true && \
		git sparse-checkout init --cone && \
		git sparse-checkout set security-toolbox && \
		git checkout $(SECURITY_TOOLBOX_BRANCH) && cd -

check.static: check.prepare
	docker run -it -v $$(pwd):/app \
		-v $(SECURITY_TOOLBOX_TMP_DIR):$(SECURITY_TOOLBOX_TMP_DIR) \
		-e PIP_BREAK_SYSTEM_PACKAGES=1 \
		registry.semaphoreci.com/ruby:3 \
		bash -c 'cd /app && $(SECURITY_TOOLBOX_TMP_DIR)/code --language js -d'

check.deps: check.prepare
	docker run -it -v $$(pwd):/app \
		-v $(SECURITY_TOOLBOX_TMP_DIR):$(SECURITY_TOOLBOX_TMP_DIR) \
		-e PIP_BREAK_SYSTEM_PACKAGES=1 \
		registry.semaphoreci.com/ruby:3 \
		bash -c 'cd /app && $(SECURITY_TOOLBOX_TMP_DIR)/dependencies --language js -d'

venv.execute:
	python3 -m venv venv && \
	. venv/bin/activate && \
	pip install --upgrade pip && \
	pip install -r requirements.txt && \
	$(COMMAND) && \
	deactivate && \
	cd -

packer.fmt:
	cd packer/$(PACKER_OS) && packer fmt . && cd -

packer.validate:
	@if [ $(PACKER_OS) = "windows" ]; then \
		$(MAKE) packer.validate.windows; \
	else \
		$(MAKE) packer.validate.linux; \
	fi

packer.validate.linux:
	$(MAKE) venv.execute COMMAND='\
		cd packer/linux && \
		packer validate \
			-var "stack_version=v$(VERSION)" \
			-var "agent_version=$(AGENT_VERSION)" \
			-var "toolbox_version=$(TOOLBOX_VERSION)" \
			-var "hash=$(HASH)" \
			-var "region=$(AWS_REGION)" \
			-var "ami_prefix=$(AMI_PREFIX)" \
			-var "arch=$(AMI_ARCH)" \
			-var "install_erlang=$(INSTALL_ERLANG)" \
			-var "systemd_restart_seconds=$(SYSTEMD_RESTART_SECONDS)" \
			-var "instance_type=$(AMI_INSTANCE_TYPE)" \
			-var "ubuntu_name=$(UBUNTU_NAME)" \
			-var "ubuntu_version=$(UBUNTU_VERSION_NUMBER)" \
			.'

packer.validate.windows:
	$(MAKE) venv.execute COMMAND='\
		cd packer/windows && \
		packer validate \
			-var "stack_version=v$(VERSION)" \
			-var "agent_version=$(AGENT_VERSION)" \
			-var "toolbox_version=$(TOOLBOX_VERSION)" \
			-var "hash=$(HASH)" \
			-var "region=$(AWS_REGION)" \
			-var "ami_prefix=$(AMI_PREFIX)" \
			-var "arch=$(AMI_ARCH)" \
			-var "install_erlang=$(INSTALL_ERLANG)" \
			-var "instance_type=$(AMI_INSTANCE_TYPE)" \
			.'

packer.validate.macos:
	$(MAKE) venv.execute COMMAND='\
		cd packer/macos && \
		packer validate \
			-var "stack_version=v$(VERSION)" \
			-var "agent_version=$(AGENT_VERSION)" \
			-var "toolbox_version=$(TOOLBOX_VERSION)" \
			-var "hash=$(HASH)" \
			-var "region=$(AWS_REGION)" \
			-var "ami_prefix=$(AMI_PREFIX)" \
			-var "arch=$(AMI_ARCH)" \
			-var "instance_type=$(AMI_INSTANCE_TYPE)" \
			.'

packer.init:
	$(MAKE) venv.execute COMMAND='cd packer/$(PACKER_OS) && packer init .'

packer.build:
	@if [ $(PACKER_OS) = "windows" ]; then \
		$(MAKE) packer.build.windows; \
	elif [ $(PACKER_OS) = "macos" ]; then \
		$(MAKE) packer.build.macos; \
	else \
		$(MAKE) packer.build.linux; \
	fi

packer.build.linux:
	$(MAKE) venv.execute COMMAND='\
		cd packer/linux && \
		packer build \
			-var "stack_version=v$(VERSION)" \
			-var "agent_version=$(AGENT_VERSION)" \
			-var "toolbox_version=$(TOOLBOX_VERSION)" \
			-var "hash=$(HASH)" \
			-var "region=$(AWS_REGION)" \
			-var "ami_prefix=$(AMI_PREFIX)" \
			-var "arch=$(AMI_ARCH)" \
			-var "install_erlang=$(INSTALL_ERLANG)" \
			-var "systemd_restart_seconds=$(SYSTEMD_RESTART_SECONDS)" \
			-var "instance_type=$(AMI_INSTANCE_TYPE)" \
			-var "ubuntu_name=$(UBUNTU_NAME)" \
			-var "ubuntu_version=$(UBUNTU_VERSION_NUMBER)" \
			.'

packer.build.windows:
	$(MAKE) venv.execute COMMAND='\
		cd packer/windows && \
		packer build \
			-var "stack_version=v$(VERSION)" \
			-var "agent_version=$(AGENT_VERSION)" \
			-var "toolbox_version=$(TOOLBOX_VERSION)" \
			-var "hash=$(HASH)" \
			-var "region=$(AWS_REGION)" \
			-var "ami_prefix=$(AMI_PREFIX)" \
			-var "arch=$(AMI_ARCH)" \
			-var "install_erlang=$(INSTALL_ERLANG)" \
			-var "instance_type=$(AMI_INSTANCE_TYPE)" \
			.'

# In order to run this, you need to make sure you have an available dedicated host.
# Otherwise, you will get a UnavailableHostRequirements error
# For mac1 family AMIs (intel), use AMI_ARCH=x86_64 and AMI_INSTANCE_TYPE=mac1.metal
# For mac2 family AMIs (ARM), use AMI_ARCH=arm64 and AMI_INSTANCE_TYPE=mac2.metal
packer.build.macos:
	$(MAKE) venv.execute COMMAND='\
		cd packer/macos && \
		packer build \
			-var "stack_version=v$(VERSION)" \
			-var "agent_version=$(AGENT_VERSION)" \
			-var "toolbox_version=$(TOOLBOX_VERSION)" \
			-var "hash=$(HASH)" \
			-var "region=$(AWS_REGION)" \
			-var "ami_prefix=$(AMI_PREFIX)" \
			-var "arch=$(AMI_ARCH)" \
			-var "instance_type=$(AMI_INSTANCE_TYPE)" \
			.'

ansible.lint:
	$(MAKE) venv.execute COMMAND='cd packer/linux && ansible-lint'
