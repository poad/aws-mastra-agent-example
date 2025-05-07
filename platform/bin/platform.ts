#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PlatformStack } from '../lib/platform-stack';

const app = new cdk.App();
const stack = new PlatformStack(app, 'mastra-agent-example', {
});

cdk.RemovalPolicies.of(stack).destroy();
