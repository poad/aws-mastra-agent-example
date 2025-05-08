#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PlatformStack } from '../lib/platform-stack';
import assert from 'assert';

const app = new cdk.App();

const account = app.node.tryGetContext('account');
assert(account);

const env = {
  region: process.env.AWS_REGION ?? 'us-west-2',
  account,
};

const platform = new PlatformStack(app, 'mastra-agent-example', {
  env,
});

cdk.RemovalPolicies.of(platform).destroy();
