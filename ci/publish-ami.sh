#!/usr/local/bin/bash

set -e
set -o pipefail

get_image_id() {
  local image_name=$1
  aws ec2 describe-images \
    --filters "Name=name,Values=${image_name}" \
    --region ${source_region} \
    --output text \
    --query 'Images[*].ImageId'
}

get_image_state() {
  local image_id=$1
  local region=$2

  aws ec2 describe-images \
    --region ${region} \
    --image-ids ${image_id} \
    --output text \
    --query 'Images[*].State'
}

wait_until_available() {
  local region=$1
  local image_id=$2

  while true; do
    state=$(get_image_state ${image_id} ${region});
    if [[ "$state" == "available" ]]; then
      echo "'${image_id}' in ${region} is available."
      break
    elif [[ "$state" == "pending" ]]; then
      echo "'${image_id}' in ${region} is still pending. Waiting 10s..."
      sleep 10
    else
      echo "'${image_id}' in ${region} is in a bad state ${state}. Exiting..."
      exit 1
    fi
  done
}

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

version=$(cat package.json | jq -r '.version')
hash=$(find Makefile packer/ -type f -exec md5sum "{}" + | awk '{print $1}' | sort | md5sum | awk '{print $1}')
image_name="semaphore-agent-v${version}-${os}-${arch}-${hash}"
source_region=us-east-1
image_id=$(get_image_id ${image_name})

# These are all the regions where the AMI will be available, except the ${source_region} (us-east-1)
regions=(
  us-east-2
  us-west-1
  us-west-2
  af-south-1
  ap-east-1
  ap-southeast-3
  ap-south-1
  ap-northeast-3
  ap-northeast-2
  ap-southeast-1
  ap-southeast-2
  ap-northeast-1
  ca-central-1
  eu-central-1
  eu-west-1
  eu-west-2
  eu-south-1
  eu-west-3
  eu-north-1
  me-south-1
  sa-east-1
)

echo "Copying '${image_id}' to other regions with name '${image_name}'..."

declare -A images;
images[${source_region}]=${image_id}

for region in ${regions[*]}; do
  echo "Copying to '${region}'..."

  id=$(aws ec2 copy-image \
    --source-image-id ${image_id} \
    --source-region ${source_region} \
    --name ${image_name} \
    --region ${region} \
    --query "ImageId" \
    --output text
  )

  echo "Created '${id}' in ${region}."
  images[${region}]=${id}
done

for region in "${!images[@]}"; do
  image=${images[$region]}
  wait_until_available ${region} ${image}
  echo "Making '${image}' public..."
  aws ec2 modify-image-attribute \
    --region ${region} \
    --image-id ${image} \
    --launch-permission "Add=[{Group=all}]"
done

echo "Done."