import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

const GITHUB_OIDC_URL = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';

export interface SiteStackProps extends cdk.StackProps {
  /** GitHub repository allowed to assume the deploy role, as `owner/name`. */
  readonly githubRepo: string;
  /**
   * ARN of an account-wide GitHub OIDC provider that already exists.
   * Leave unset on a fresh account so this stack creates the provider.
   */
  readonly githubOidcProviderArn?: string;
}

/**
 * Private S3 bucket and a CloudFront distribution for the Vite `dist/` build.
 * Objects stay private; viewers only reach them through Origin Access Control.
 */
export class SiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    cdk.Annotations.of(this).acknowledgeWarning(
      '@aws-cdk/aws-cloudfront-origins:listBucketSecurityRisk',
      'defaultRootObject is index.html, so GET / does not list the bucket.',
    );

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          id: 'abort-incomplete-multipart',
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
    });

    // LIST makes a missing key a 404 instead of a 403, so the SPA error
    // response is the not-found path. defaultRootObject still serves
    // index.html at `/` and does not expose a bucket listing there.
    const origin = origins.S3BucketOrigin.withOriginAccessControl(bucket, {
      originAccessLevels: [cloudfront.AccessLevel.READ, cloudfront.AccessLevel.LIST],
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'Fluid Tetris',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: viewerBehavior(origin, cloudfront.CachePolicy.CACHING_DISABLED),
      additionalBehaviors: {
        // Vite fingerprints files under dist/assets. Cache those at the edge.
        '/assets/*': viewerBehavior(origin, cloudfront.CachePolicy.CACHING_OPTIMIZED),
      },
      errorResponses: [spaError(403), spaError(404)],
    });

    const providerArn = githubOidcProviderArn(this, props.githubOidcProviderArn);
    const deployRole = new iam.Role(this, 'GitHubActionsRole', {
      roleName: 'fluid-tetris-github-deploy',
      description: 'Assumed by GitHub Actions on main to publish Fluid Tetris.',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
          [`${GITHUB_OIDC_HOST}:sub`]: `repo:${props.githubRepo}:ref:refs/heads/main`,
        },
      }),
    });

    const deployPolicy = new iam.Policy(this, 'GitHubDeployPolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'ListSiteBucket',
          actions: ['s3:ListBucket', 's3:GetBucketLocation'],
          resources: [bucket.bucketArn],
        }),
        new iam.PolicyStatement({
          sid: 'SyncSiteObjects',
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
          resources: [bucket.arnForObjects('*')],
        }),
        new iam.PolicyStatement({
          sid: 'InvalidateSite',
          actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
          resources: [distribution.distributionArn],
        }),
      ],
    });
    deployPolicy.attachToRole(deployRole);

    new cdk.CfnOutput(this, 'AwsBucketName', {
      description: 'GitHub variable AWS_BUCKET_NAME',
      value: bucket.bucketName,
    });
    new cdk.CfnOutput(this, 'AwsDistributionId', {
      description: 'GitHub variable AWS_DISTRIBUTION_ID',
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, 'AwsDeployRoleArn', {
      description: 'GitHub variable AWS_DEPLOY_ROLE_ARN',
      value: deployRole.roleArn,
    });
    new cdk.CfnOutput(this, 'AwsRegion', {
      description: 'GitHub variable AWS_REGION',
      value: this.region,
    });
    new cdk.CfnOutput(this, 'SiteUrl', {
      description: 'HTTPS URL on the default CloudFront domain',
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}

function viewerBehavior(
  origin: cloudfront.IOrigin,
  cachePolicy: cloudfront.ICachePolicy,
): cloudfront.BehaviorOptions {
  return {
    origin,
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy,
    responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
    compress: true,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
  };
}

function spaError(httpStatus: 403 | 404): cloudfront.ErrorResponse {
  return {
    httpStatus,
    responseHttpStatus: 200,
    responsePagePath: '/index.html',
    ttl: cdk.Duration.seconds(0),
  };
}

function githubOidcProviderArn(scope: cdk.Stack, existingArn: string | undefined): string {
  if (existingArn) {
    return iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      scope,
      'GitHubOidc',
      existingArn,
    ).openIdConnectProviderArn;
  }

  return new iam.OidcProviderNative(scope, 'GitHubOidc', {
    url: GITHUB_OIDC_URL,
    clientIds: ['sts.amazonaws.com'],
  }).openIdConnectProviderArn;
}
