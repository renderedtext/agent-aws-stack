AWS_REGION=us-east-1
AMI_ARCH=x86_64
AMI_PREFIX=semaphore-agent
AGENT_VERSION=v2.1.1
TOOLBOX_VERSION=v1.16.21
PACKER_OS=linux
INSTALL_ERLANG=true
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
	$(MAKE) venv.execute COMMAND='\
		cd packer/$(PACKER_OS) && \
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
	$(MAKE) venv.execute COMMAND='\
		cd packer/$(PACKER_OS) && \
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
