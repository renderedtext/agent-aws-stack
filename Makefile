AWS_REGION=us-east-1
AMI_ARCH=x86_64
AMI_PREFIX=semaphore-agent
AMI_INSTANCE_TYPE=t2.micro
AGENT_VERSION=v2.2.8
TOOLBOX_VERSION=v1.20.5
PACKER_OS=linux
INSTALL_ERLANG=true
SYSTEMD_RESTART_SECONDS=1800
VERSION=$(shell cat package.json | jq -r '.version')
HASH=$(shell find Makefile packer/$(PACKER_OS) -type f -exec md5sum "{}" + | awk '{print $$1}' | sort | md5sum | awk '{print $$1}')

SECURITY_TOOLBOX_BRANCH ?= master
SECURITY_TOOLBOX_TMP_DIR ?= /tmp/security-toolbox

check.prepare:
	rm -rf $(SECURITY_TOOLBOX_TMP_DIR)
	git clone git@github.com:renderedtext/security-toolbox.git $(SECURITY_TOOLBOX_TMP_DIR) && (cd $(SECURITY_TOOLBOX_TMP_DIR) && git checkout $(SECURITY_TOOLBOX_BRANCH) && cd -)

check.static: check.prepare
	docker run -it -v $$(pwd):/app \
		-v $(SECURITY_TOOLBOX_TMP_DIR):$(SECURITY_TOOLBOX_TMP_DIR) \
		registry.semaphoreci.com/ruby:2.7 \
		bash -c 'cd /app && $(SECURITY_TOOLBOX_TMP_DIR)/code --language js -d'

check.deps: check.prepare
	docker run -it -v $$(pwd):/app \
		-v $(SECURITY_TOOLBOX_TMP_DIR):$(SECURITY_TOOLBOX_TMP_DIR) \
		registry.semaphoreci.com/ruby:2.7 \
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
