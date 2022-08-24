token=$(curl -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 60" --fail --silent --show-error --location "http://169.254.169.254/latest/api/token")
instance_id=$(curl -H "X-aws-ec2-metadata-token: $token" --fail --silent --show-error --location "http://169.254.169.254/latest/meta-data/instance-id")
region=$(curl -H "X-aws-ec2-metadata-token: $token" --fail --silent --show-error --location "http://169.254.169.254/latest/meta-data/placement/region")

# We unset all AWS related variables to make sure the instance profile is always used.
# Before, we were using a specific AWS CLI profile that activates the instance profile,
# but that didn't work if people messed up the ~/.aws/config file.
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY
unset AWS_SESSION_TOKEN
rm -rf $HOME/.aws/credentials

if [[ $SEMAPHORE_AGENT_SHUTDOWN_REASON == "IDLE" ]]; then
  aws autoscaling terminate-instance-in-auto-scaling-group \
    --region "$region" \
    --instance-id "$instance_id" \
    --should-decrement-desired-capacity
else
  aws autoscaling terminate-instance-in-auto-scaling-group \
    --region "$region" \
    --instance-id "$instance_id" \
    --no-should-decrement-desired-capacity
fi
