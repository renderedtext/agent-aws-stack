#!/bin/bash

set -e
set -o pipefail

latest_tag=$(git describe --tags --abbrev=0)
image_ids=($(aws ec2 describe-images \
  --filters "Name=name,Values=semaphore-agent-*" "Name=is-public,Values=false" \
  --query 'Images[*].ImageId' \
  --output text
))

for image_id in "${image_ids[@]}"; do
  image_name=$(aws ec2 describe-images \
    --image-ids "${image_id}" \
    --query 'Images[*].Name' \
    --output text
  )

  if [[ "${image_name}" == *"${latest_tag}"* ]]; then
    echo "Image ${image_name} is for latest tag - skipping."
    continue
  fi

  snapshot_id=$(aws ec2 describe-images \
    --image-ids "${image_id}" \
    --query 'Images[*].BlockDeviceMappings[*].Ebs.SnapshotId' \
    --output text
  )

  echo "De-registering image '${image_id}' (${image_name})..."
  aws ec2 deregister-image --image-id ${image_id}

  if [[ -n ${snapshot_id} ]]; then
    echo "Deleting snapshot '${snapshot_id}'..."
    aws ec2 delete-snapshot --snapshot-id ${snapshot_id}
  fi
done

echo "Done."