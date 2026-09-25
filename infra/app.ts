import cdk from 'aws-cdk-lib';
import { PresignedUrlLifetimeStack } from './stack.ts';

const app = new cdk.App();
new PresignedUrlLifetimeStack(app, 'PresignedUrlLifetimeStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'ap-northeast-1',
  },
});
