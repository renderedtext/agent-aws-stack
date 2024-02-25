# Shutdown hook is not executed in a login shell,
# and launchD has no default built-in mechanism for loading environments
# like systemD's environment generators, so we need to set the PATH
# environment variable (and any other variables we might expect) here.
ARCH=$(uname -m)
if [[ ${ARCH} =~ "arm" || ${ARCH} == "aarch64" ]]; then
  export PATH="/opt/homebrew/bin:/opt/homebrew/sbin${PATH+:$PATH}";
else
  export PATH=/usr/local/bin:$PATH
fi

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
  # Enter standby LifecycleState because the EC2 health check will fail while we're replacing the root volume
  # We also decrement desired capacity so the ASG doesn't create a new replacement instance in the meantime
  # The instance will exit standby automatically in start-agent.sh after reboot
  asg_name=$(aws autoscaling describe-auto-scaling-instances --region "$region" --instance-ids "$instance_id" --output text --query "AutoScalingInstances[0].AutoScalingGroupName")
  aws autoscaling enter-standby \
    --region "$region" \
    --instance-ids "$instance_id" \
    --auto-scaling-group-name "$asg_name" \
    --should-decrement-desired-capacity
  # https://aws.amazon.com/blogs/compute/new-reset-amazon-ec2-mac-instances-to-a-known-state-using-replace-root-volume-capability/
  ami_id=$(curl -H "X-aws-ec2-metadata-token: $token" --fail --silent --show-error --location "http://169.254.169.254/latest/meta-data/ami-id")
  aws ec2 create-replace-root-volume-task \
    --region "$region" \
    --instance-id "$instance_id" \
    --image-id "$ami_id" \
    –-delete-replaced-root-volume
fi
