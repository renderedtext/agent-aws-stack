AGENT_VERSION=v2.0.19

venv.execute:
	python3 -m venv venv && \
	. venv/bin/activate && \
	pip install -r requirements.txt && \
	$(COMMAND) && \
	deactivate && \
	cd -

packer.fmt:
	cd packer && packer fmt . && cd -

packer.validate:
	$(MAKE) venv.execute COMMAND='cd packer && packer validate -var "agent_version=$(AGENT_VERSION)" .'

packer.init:
	$(MAKE) venv.execute COMMAND='cd packer && packer init .'

packer.build:
	$(MAKE) venv.execute COMMAND='cd packer && packer build -var "agent_version=$(AGENT_VERSION)" ubuntu-bionic.pkr.hcl'

ansible.lint:
	$(MAKE) venv.execute COMMAND='cd packer && ansible-lint'
