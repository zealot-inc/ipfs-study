#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PreparationStack } from '../lib/preparation-stack';
import { IpfsCluster3PeersStack } from '../lib/ipfs-cluster-3-peers-stack';
import * as dotenv from 'dotenv';

dotenv.config();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new cdk.App();

new PreparationStack(app, 'PreparationStack', { env });

new IpfsCluster3PeersStack(app, 'IpfsCluster3PeersStack', { env });
