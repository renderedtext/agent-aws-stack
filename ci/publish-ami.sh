#!/usr/local/bin/bash

set -e
set -o pipefail

get_image_name() {
  ami_id=$1
  aws ec2 describe-images \
    --image-ids ${ami_id} \
    --region ${source_region} \
    --output text \
    --query 'Images[*].Name'
}

get_image_state() {
  ami_id=$1
  region=$2

  aws ec2 describe-images \
    --region ${region} \
    --image-ids ${ami_id} \
    --output text \
    --query 'Images[*].State'
}

wait_until_available() {
  local region=$1
  local ami_id=$2

  while true; do
    state=$(get_image_state ${ami_id} ${region});
    if [[ "$state" == "available" ]]; then
      echo "'${ami_id}' in ${region} is available."
      break
    elif [[ "$state" == "pending" ]]; then
      echo "'${ami_id}' in ${region} is still pending. Waiting 10s..."
      sleep 10
    else
      echo "'${ami_id}' in ${region} is in a bad state ${state}. Exiting..."
      exit 1
    fi
  done
}

ami_id=$1
if [[ -z "${ami_id}" ]]; then
  echo "AMI id is required. Exiting..."
  exit 1
fi

# These are all the regions where the AMI will be available, other than ${source_region}
regions=(
  us-east-2
  us-west-1
  us-west-2
)

source_region=us-east-1
name=$(get_image_name ${ami_id})

echo "Copying '${ami_id}' to other regions with name '${name}'..."

declare -A images;
images[${source_region}]=${ami_id}

for region in ${regions[*]}; do
  echo "Copying '${ami_id}' to '${region}'..."

  id=$(aws ec2 copy-image \
    --source-image-id ${ami_id} \
    --source-region ${source_region} \
    --name ${name} \
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