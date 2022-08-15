AWS_REGION=us-east-1
AMI_ARCH=x86_64
AMI_PREFIX=semaphore-agent
AGENT_VERSION=v2.1.5
TOOLBOX_VERSION=v1.18.13
PACKER_OS=linux
INSTALL_ERLANG=true
VERSION=$(shell cat package.json | jq -r '.version')
HASH=$(shell find Makefile packer/$(PACKER_OS) -type f -exec md5sum "{}" + | awk '{print $$1}' | sort | md5sum | awk '{print $$1}')
CUSTOM_ANSIBLE_ROLES=""

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
	@if [[ $(PACKER_OS) == "linux" ]]; then\
		$(MAKE) packer.validate.linux;\
	else\
		$(MAKE) packer.validate.windows;\
	fi

packer.init:
	$(MAKE) venv.execute COMMAND='cd packer/$(PACKER_OS) && packer init .'

packer.validate.linux:
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
			-var "custom_ansible_roles=$(CUSTOM_ANSIBLE_ROLES)" \
			.'

packer.validate.windows:
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
			.'

packer.build:
	@if [[ $(PACKER_OS) == "linux" ]]; then\
		$(MAKE) packer.build.linux;\
	else\
		$(MAKE) packer.build.windows;\
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
			-var "custom_ansible_roles=$(CUSTOM_ANSIBLE_ROLES)" \
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
			.'

ansible.lint:
	$(MAKE) venv.execute COMMAND='cd packer/linux && ansible-lint'
