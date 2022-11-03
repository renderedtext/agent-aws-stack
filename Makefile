AWS_REGION=us-east-1
AMI_ARCH=x86_64
AMI_PREFIX=semaphore-agent
AGENT_VERSION=v2.1.13
TOOLBOX_VERSION=v1.19.13
PACKER_OS=linux
INSTALL_ERLANG=true
SYSTEMD_RESTART_SECONDS=1800
VERSION=$(shell cat package.json | jq -r '.version')
HASH=$(shell find Makefile packer/$(PACKER_OS) -type f -exec md5sum "{}" + | awk '{print $$1}' | sort | md5sum | awk '{print $$1}')

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
			.'

packer.init:
	$(MAKE) venv.execute COMMAND='cd packer/$(PACKER_OS) && packer init .'

packer.build:
	@if [ $(PACKER_OS) = "windows" ]; then \
		$(MAKE) packer.build.windows; \
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
			.'

ansible.lint:
	$(MAKE) venv.execute COMMAND='cd packer/linux && ansible-lint'
