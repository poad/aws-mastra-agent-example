#!/usr/bin/env node
import assert from 'assert';
import { PlatformStack } from '../lib/platform-stack.js';
import * as cdk from 'aws-cdk-lib';

const app = new cdk.App();

const account = app.node.tryGetContext('account');
assert(account);

const env = {
  region: process.env.AWS_REGION ?? 'us-west-2',
  account,
};

const platform = new PlatformStack(app, 'MastraAgentExample', {
  env,
});

cdk.RemovalPolicies.of(platform).destroy();
