VERSION=$(shell cat package.json | jq -r '.version')
HASH=$(shell find Makefile packer/ -type f -exec md5sum "{}" + | awk '{print $$1}' | sort | md5sum | awk '{print $$1}')
AGENT_VERSION=v2.0.19

venv.execute:
	virtualenv -p python3 venv && \
	. venv/bin/activate && \
	pip3 install -r requirements.txt && \
	$(COMMAND) && \
	deactivate && \
	cd -

packer.fmt:
	cd packer && packer fmt . && cd -

packer.validate:
	$(MAKE) venv.execute COMMAND='\
		cd packer && \
		packer validate \
			-var "stack_version=v$(VERSION)" \
			-var "agent_version=$(AGENT_VERSION)" \
			-var "hash=$(HASH)" \
			.'

packer.build:
	$(MAKE) venv.execute COMMAND='\
		cd packer && \
		packer build \
			-var "stack_version=v$(VERSION)" \
			-var "agent_version=$(AGENT_VERSION)" \
			-var "hash=$(HASH)" \
			ubuntu-bionic.pkr.hcl'

ansible.lint:
	$(MAKE) venv.execute COMMAND='cd packer && ansible-lint'
