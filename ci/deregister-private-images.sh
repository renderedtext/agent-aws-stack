#!/bin/bash

set -e
set -o pipefail

response=$(aws ec2 describe-images --filters "Name=name,Values=semaphore-agent-*" "Name=is-public,Values=false")
image_ids=($(echo $response | jq '.Images[].ImageId' | xargs))

for image_id in "${image_ids[@]}"; do
  echo "De-registering image '${image_id}'..."
  aws ec2 deregister-image --image-id ${image_id}
done

echo "Done."