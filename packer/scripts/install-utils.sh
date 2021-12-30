#!/bin/bash

sudo apt-get update

sudo apt-get install -y apt-transport-https
sudo apt-get install -y make
sudo apt-get install -y unzip
sudo apt-get install -y jq
sudo apt-get install -y awscli

# Install yq, needed to change agent configuration when starting it
sudo curl -sL https://github.com/mikefarah/yq/releases/download/v4.16.2/yq_linux_amd64 -o /usr/bin/yq
sudo chmod +x /usr/bin/yq
