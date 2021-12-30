AGENT_VERSION=v2.0.18

packer.fmt:
	cd packer && packer fmt . && cd -

packer.validate:
	cd packer && packer validate -var "agent_version=$(AGENT_VERSION)" . && cd -

packer.build:
	cd packer && packer build -var "agent_version=$(AGENT_VERSION)" linux-ami.pkr.hcl && cd -
