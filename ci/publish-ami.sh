#!/usr/local/bin/bash

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

source_region=us-east-1
version=$(cat package.json | jq -r '.version')
hash=$(find Makefile packer/ -type f -exec md5sum "{}" + | awk '{print $1}' | sort | md5sum | awk '{print $1}')
image_name="semaphore-agent-v${version}-${os}-${arch}-${hash}"
all_regions=(
  us-east-1
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

get_missing_regions() {
  missing_regions=()
  for region in ${all_regions[*]}; do
    id=$(aws ec2 describe-images \
      --filters "Name=name,Values=${image_name}" "Name=is-public,Values=true" \
      --region ${region} \
      --output text \
      --query 'Images[*].ImageId'
    )

    if [[ -z ${id} ]]; then
      missing_regions+=(${region})
    fi
  done

  echo "${missing_regions[@]}"
}

get_private_image() {
  local image_name=$1
  local region=$2
  aws ec2 describe-images \
    --filters "Name=name,Values=${image_name}" "Name=is-public,Values=false" \
    --region ${region} \
    --output text \
    --query 'Images[*].ImageId'
}

get_image_id() {
  local image_name=$1
  local region=$2
  aws ec2 describe-images \
    --filters "Name=name,Values=${image_name}" \
    --region ${region} \
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

source_image_id=$(get_image_id ${image_name} ${source_region})
if [[ -z ${source_image_id} ]]; then
  echo "Couldn't find an AMI with name '${image_name}' in ${source_region}. Exiting..."
  exit 1
fi

echo "Determining which regions are missing a public image with name '${image_name}'..."
missing_regions=($(get_missing_regions))

declare -A images;
for missing_region in ${missing_regions[*]}; do
  private_image_id=$(get_private_image ${image_name} ${missing_region})
  if [[ -z ${private_image_id} ]]; then
    echo "${missing_region} is missing image. Copying..."

    new_image_id=$(aws ec2 copy-image \
      --source-image-id ${source_image_id} \
      --source-region ${source_region} \
      --name ${image_name} \
      --region ${missing_region} \
      --query "ImageId" \
      --output text
    )

    echo "Created '${new_image_id}' in ${missing_region}."
    images[${missing_region}]=${new_image_id}
  else
    echo "${missing_region} already has a private image '${private_image_id}'."
    images[${missing_region}]=${private_image_id}
  fi
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
