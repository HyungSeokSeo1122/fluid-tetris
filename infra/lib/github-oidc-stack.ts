import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';
export const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';

/**
 * One GitHub OIDC provider per AWS account. Staging and prod roles share it.
 */
export class GitHubOidcStack extends cdk.Stack {
  readonly providerArn: string;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const provider = new iam.OidcProviderNative(this, 'GitHubOidc', {
      url: GITHUB_OIDC_URL,
      clientIds: ['sts.amazonaws.com'],
    });
    this.providerArn = provider.openIdConnectProviderArn;

    new cdk.CfnOutput(this, 'GitHubOidcProviderArn', {
      description: 'GitHub OIDC provider ARN',
      value: this.providerArn,
    });
  }
}
