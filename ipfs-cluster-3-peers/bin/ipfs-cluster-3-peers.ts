#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { IpfsCluster3PeersStack } from '../lib/ipfs-cluster-3-peers-stack';
import * as dotenv from 'dotenv';

dotenv.config();

const app = new cdk.App();
new IpfsCluster3PeersStack(app, 'IpfsCluster3PeersStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
