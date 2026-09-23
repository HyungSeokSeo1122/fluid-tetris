import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { GITHUB_OIDC_HOST } from './github-oidc-stack';

export type SiteEnvironment = 'staging' | 'prod';

export interface SiteStackProps extends cdk.StackProps {
  readonly siteEnvironment: SiteEnvironment;
  /** GitHub repository allowed to assume the deploy role, as `owner/name`. */
  readonly githubRepo: string;
  /** ARN of the account-wide GitHub OIDC provider. Shared by both environments. */
  readonly githubOidcProviderArn: string;
}

/**
 * Private S3 bucket and a CloudFront distribution for one environment.
 * Objects stay private; viewers only reach them through Origin Access Control.
 */
export class SiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, props);

    const siteEnvironment = props.siteEnvironment;
    const retention = bucketRetention(siteEnvironment);

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
      removalPolicy: retention.removalPolicy,
      autoDeleteObjects: retention.autoDeleteObjects,
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
      comment: `Fluid Tetris ${siteEnvironment}`,
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

    const deployRole = new iam.Role(this, 'GitHubActionsRole', {
      roleName: `fluid-tetris-github-deploy-${siteEnvironment}`,
      description: roleDescription(siteEnvironment),
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(props.githubOidcProviderArn, trustConditions(siteEnvironment, props.githubRepo)),
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

    const prefix = variablePrefix(siteEnvironment);
    new cdk.CfnOutput(this, 'AwsBucketName', {
      description: `GitHub variable AWS_${prefix}_BUCKET_NAME`,
      value: bucket.bucketName,
    });
    new cdk.CfnOutput(this, 'AwsDistributionId', {
      description: `GitHub variable AWS_${prefix}_DISTRIBUTION_ID`,
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, 'AwsDeployRoleArn', {
      description: `GitHub variable AWS_${prefix}_DEPLOY_ROLE_ARN`,
      value: deployRole.roleArn,
    });
    new cdk.CfnOutput(this, 'AwsRegion', {
      description: `GitHub variable AWS_${prefix}_REGION`,
      value: this.region,
    });
    new cdk.CfnOutput(this, 'SiteUrl', {
      description: `${label(siteEnvironment)} HTTPS URL on the default CloudFront domain`,
      value: `https://${distribution.distributionDomainName}`,
    });
  }
}

function bucketRetention(siteEnvironment: SiteEnvironment): {
  removalPolicy: cdk.RemovalPolicy;
  autoDeleteObjects: boolean;
} {
  switch (siteEnvironment) {
    case 'staging':
      return { removalPolicy: cdk.RemovalPolicy.DESTROY, autoDeleteObjects: true };
    case 'prod':
      return { removalPolicy: cdk.RemovalPolicy.RETAIN, autoDeleteObjects: false };
    default: {
      const neverEnv: never = siteEnvironment;
      throw new Error(`Unknown environment: ${neverEnv}`);
    }
  }
}

function variablePrefix(siteEnvironment: SiteEnvironment): 'STAGING' | 'PROD' {
  switch (siteEnvironment) {
    case 'staging':
      return 'STAGING';
    case 'prod':
      return 'PROD';
    default: {
      const neverEnv: never = siteEnvironment;
      throw new Error(`Unknown environment: ${neverEnv}`);
    }
  }
}

function label(siteEnvironment: SiteEnvironment): string {
  switch (siteEnvironment) {
    case 'staging':
      return 'Staging';
    case 'prod':
      return 'Production';
    default: {
      const neverEnv: never = siteEnvironment;
      throw new Error(`Unknown environment: ${neverEnv}`);
    }
  }
}

function roleDescription(siteEnvironment: SiteEnvironment): string {
  switch (siteEnvironment) {
    case 'staging':
      return 'Assumed by GitHub Actions on main to publish Fluid Tetris staging.';
    case 'prod':
      return 'Assumed by GitHub Actions on v* tags to publish Fluid Tetris production.';
    default: {
      const neverEnv: never = siteEnvironment;
      throw new Error(`Unknown environment: ${neverEnv}`);
    }
  }
}

/**
 * Staging trusts pushes and manual runs of this repo on main.
 * Prod trusts only `v*` tag pushes. `job_workflow_ref` is not pinned:
 * GitHub sets that claim for reusable workflows, and this deploy job is not one.
 */
function trustConditions(siteEnvironment: SiteEnvironment, githubRepo: string): iam.Conditions {
  const audienceKey = `${GITHUB_OIDC_HOST}:aud`;
  const subjectKey = `${GITHUB_OIDC_HOST}:sub`;
  switch (siteEnvironment) {
    case 'staging':
      return {
        StringEquals: {
          [audienceKey]: 'sts.amazonaws.com',
          [subjectKey]: `repo:${githubRepo}:ref:refs/heads/main`,
        },
      };
    case 'prod':
      return {
        StringEquals: {
          [audienceKey]: 'sts.amazonaws.com',
        },
        StringLike: {
          [subjectKey]: `repo:${githubRepo}:ref:refs/tags/v*`,
        },
      };
    default: {
      const neverEnv: never = siteEnvironment;
      throw new Error(`Unknown environment: ${neverEnv}`);
    }
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
