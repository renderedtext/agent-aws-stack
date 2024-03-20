#!/usr/bin/env python3

import boto3
client = boto3.client('sts')
url = client.generate_presigned_url('get_caller_identity', Params={}, ExpiresIn=15*60, HttpMethod='GET')
print(url)