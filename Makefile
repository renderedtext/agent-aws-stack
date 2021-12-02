packer.fmt:
	cd packer && packer fmt . && cd -

packer.validate:
	cd packer && packer validate . && cd -

packer.build:
	cd packer && packer build linux-ami.pkr.hcl && cd -
