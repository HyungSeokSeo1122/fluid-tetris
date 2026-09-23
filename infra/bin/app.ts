#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SiteStack } from '../lib/site-stack';

const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const OIDC_PROVIDER_ARN_PATTERN =
  /^arn:aws:iam::\d{12}:oidc-provider\/token\.actions\.githubusercontent\.com$/;
const DEFAULT_REGION = 'ap-northeast-2';
const DEFAULT_GITHUB_REPO = 'HyungSeokSeo1122/fluid-tetris';

const app = new cdk.App();

const account = requireAccount(app);
const region = resolveRegion(app);
const githubRepo = requireGithubRepo(app);
const githubOidcProviderArn = readContext(app, 'githubOidcProviderArn');

if (account === '000000000000') {
  console.warn(
    'Dry-run account 000000000000. This template is for cdk synth only. Set CDK_DEFAULT_ACCOUNT to your real account id before cdk deploy.',
  );
}

if (githubOidcProviderArn) {
  assertOidcProviderArn(githubOidcProviderArn);
}

const stack = new SiteStack(app, 'FluidTetrisSite', {
  env: { account, region },
  description: 'Fluid Tetris static site (private S3 + CloudFront OAC).',
  githubRepo,
  githubOidcProviderArn,
});

cdk.Tags.of(stack).add('Project', 'fluid-tetris');

function requireAccount(scope: cdk.App): string {
  const account = readContext(scope, 'account') ?? process.env.CDK_DEFAULT_ACCOUNT;
  if (!account) {
    throw new Error(
      'Missing AWS account id. Synth does not call AWS, but the account is stamped into the template. ' +
        'Credential-free dry run: CDK_DEFAULT_ACCOUNT=000000000000 npm run check. ' +
        'Real deploy: set CDK_DEFAULT_ACCOUNT from `aws sts get-caller-identity`, or pass -c account=123456789012.',
    );
  }
  if (!/^\d{12}$/.test(account)) {
    throw new Error(`AWS account id must be 12 digits. Received: ${account}`);
  }
  return account;
}

function resolveRegion(scope: cdk.App): string {
  // The CDK CLI rewrites CDK_DEFAULT_REGION to its own resolved region
  // (us-east-1 when no AWS config exists) before the app starts. The stack
  // region therefore comes from context, defaulting to Seoul in cdk.json.
  const region = readContext(scope, 'region') ?? DEFAULT_REGION;
  if (!/^[a-z]{2}(-[a-z]+)+-\d+$/.test(region)) {
    throw new Error(`Region must look like ap-northeast-2. Received: ${region}`);
  }
  return region;
}

function requireGithubRepo(scope: cdk.App): string {
  const repo = readContext(scope, 'githubRepo') ?? DEFAULT_GITHUB_REPO;
  if (!GITHUB_REPO_PATTERN.test(repo)) {
    throw new Error(`githubRepo must look like owner/name. Received: ${repo}`);
  }
  return repo;
}

function assertOidcProviderArn(arn: string): void {
  if (!OIDC_PROVIDER_ARN_PATTERN.test(arn)) {
    throw new Error(
      'githubOidcProviderArn must be arn:aws:iam::ACCOUNT:oidc-provider/token.actions.githubusercontent.com. ' +
        `Received: ${arn}`,
    );
  }
}

function readContext(scope: cdk.App, key: string): string | undefined {
  const value: unknown = scope.node.tryGetContext(key);
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Context ${key} must be a string.`);
  }
  return value;
}
