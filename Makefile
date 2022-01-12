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
	$(MAKE) venv.execute COMMAND='cd packer && packer validate -var "agent_version=$(AGENT_VERSION)" .'

packer.build:
	$(MAKE) venv.execute COMMAND='cd packer && packer build -var "agent_version=$(AGENT_VERSION)" ubuntu-bionic.pkr.hcl'

ansible.lint:
	$(MAKE) venv.execute COMMAND='cd packer && ansible-lint'
