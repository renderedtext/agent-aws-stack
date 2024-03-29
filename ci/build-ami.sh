#!/bin/bash

set -e
set -o pipefail

os=$1
if [[ -z "${os}" ]]; then
  echo "OS is required. Exiting..."
  exit 1
fi

arch=$2
if [[ -z "${arch}" ]]; then
  echo "arch is required. Exiting..."
  exit 1
fi

packer_os=linux
if [[ ${os} == "windows" ]]; then
  packer_os=windows
fi

version=$(cat package.json | jq -r '.version')
hash=$(find Makefile packer/${packer_os} -type f -exec md5sum "{}" + | awk '{print $1}' | sort | md5sum | awk '{print $1}')
image_name="semaphore-agent-v${version}-${os}-${arch}-${hash}"

response=$(aws ec2 describe-images --filters "Name=name,Values=${image_name}")
images=$(echo $response | jq '.Images' | jq length)
if [[ ${images} == "0" ]]; then
  echo "No images published with name ${image_name}. Creating it..."
  make packer.init
  make packer.validate PACKER_OS=${packer_os}
  make packer.build PACKER_OS=${packer_os}
else
  echo "Image with name ${image_name} already exists. Not building anything."
fi