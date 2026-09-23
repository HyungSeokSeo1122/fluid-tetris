import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';

const infraDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(infraDir, 'cdk.out');
const cdkJson = JSON.parse(readFileSync(join(infraDir, 'cdk.json'), 'utf8'));
const expectedRepo = cdkJson.context?.githubRepo;
const expectedRegion = cdkJson.context?.region;
const templates = readdirSync(outDir).filter((name) => name.endsWith('.template.json'));

if (templates.length !== 1) {
  throw new Error(`Expected one synthesized template in cdk.out, found ${templates.length}.`);
}

const templatePath = join(outDir, templates[0]);
const templateText = readFileSync(templatePath, 'utf8');
const template = JSON.parse(templateText);

assert(!templateText.includes('AKIA'), 'template contains an AWS access key id');
assert(!/aws_secret_access_key/i.test(templateText), 'template contains a secret access key field');
assert(!templateText.includes('BEGIN PRIVATE KEY'), 'template contains a private key');
assert(!templateText.includes('AWS::Amplify'), 'template must not use Amplify');

const buckets = resourcesOfType(template, 'AWS::S3::Bucket');
const distributions = resourcesOfType(template, 'AWS::CloudFront::Distribution');
const originControls = resourcesOfType(template, 'AWS::CloudFront::OriginAccessControl');
const roles = resourcesOfType(template, 'AWS::IAM::Role');
const oidcProviders = resourcesOfType(template, 'AWS::IAM::OIDCProvider');
const githubRoles = roles.filter(({ resource }) =>
  JSON.stringify(resource.Properties?.AssumeRolePolicyDocument ?? {}).includes(
    'token.actions.githubusercontent.com',
  ),
);

assert(buckets.length === 1, `expected 1 bucket, found ${buckets.length}`);
assert(distributions.length === 1, `expected 1 distribution, found ${distributions.length}`);
assert(originControls.length === 1, `expected 1 origin access control, found ${originControls.length}`);
assert(githubRoles.length === 1, `expected 1 GitHub deploy role, found ${githubRoles.length}`);
assert(oidcProviders.length === 1, `expected 1 OIDC provider, found ${oidcProviders.length}`);
for (const { resource } of roles) {
  const text = JSON.stringify(resource);
  const isGithub = text.includes('token.actions.githubusercontent.com');
  const isBucketCleanup = text.includes('S3AutoDeleteObjects');
  assert(isGithub || isBucketCleanup, 'unexpected IAM role in the template');
}

const bucket = buckets[0].resource;
const publicAccess = bucket.Properties?.PublicAccessBlockConfiguration;
for (const flag of ['BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls', 'RestrictPublicBuckets']) {
  assert(publicAccess?.[flag] === true, `bucket public access ${flag} is not true`);
}
assert(bucket.Properties?.WebsiteConfiguration === undefined, 'bucket must not be a public website endpoint');

assert(templateText.includes('cloudfront.amazonaws.com'), 'bucket policy does not grant CloudFront');
assert(templateText.includes('s3:GetObject'), 'bucket policy does not grant GetObject');
assert(templateText.includes('aws:SecureTransport'), 'bucket policy does not deny non-TLS access');

const config = distributions[0].resource.Properties?.DistributionConfig;
assert(config?.DefaultRootObject === 'index.html', 'default root object is not index.html');
assert(config?.PriceClass === 'PriceClass_200', `price class is ${config?.PriceClass}`);
assert(config?.HttpVersion === 'http2and3', `HTTP version is ${config?.HttpVersion}`);
const viewerCertificate = config?.ViewerCertificate;
assert(
  viewerCertificate === undefined || viewerCertificate.CloudFrontDefaultCertificate === true,
  'distribution should use the default CloudFront certificate',
);
assert(!JSON.stringify(config).includes('AcmCertificateArn'), 'custom certificate must not be required');
assert(
  config?.DefaultCacheBehavior?.ViewerProtocolPolicy === 'redirect-to-https',
  'default behavior does not redirect to HTTPS',
);
assert(
  config?.DefaultCacheBehavior?.CachePolicyId === CACHING_DISABLED,
  'default behavior should use CachingDisabled so index.html stays fresh',
);

const assetBehavior = (config?.CacheBehaviors ?? []).find((behavior) => behavior.PathPattern === '/assets/*');
assert(assetBehavior, 'missing /assets/* cache behavior');
assert(
  assetBehavior.CachePolicyId === CACHING_OPTIMIZED,
  'hashed assets should use CachingOptimized',
);

const errors = new Map(
  (config?.CustomErrorResponses ?? []).map((error) => [error.ErrorCode, error]),
);
for (const status of [403, 404]) {
  const error = errors.get(status);
  assert(error, `missing custom error response for ${status}`);
  assert(error.ResponseCode === 200, `${status} response code is not 200`);
  assert(error.ResponsePagePath === '/index.html', `${status} does not serve /index.html`);
  assert(error.ErrorCachingMinTTL === 0, `${status} error cache TTL is not 0`);
}

const assume = githubRoles[0].resource.Properties?.AssumeRolePolicyDocument;
const assumeText = JSON.stringify(assume);
assert(typeof expectedRepo === 'string' && !expectedRepo.includes('*'), 'cdk.json githubRepo must be owner/name');
assert(assumeText.includes('token.actions.githubusercontent.com'), 'role is not limited to GitHub OIDC');
assert(assumeText.includes('sts.amazonaws.com'), 'role audience is not sts.amazonaws.com');
assert(
  assumeText.includes(`repo:${expectedRepo}:ref:refs/heads/main`),
  'role trust is not limited to this repo on main',
);
assert(!assumeText.includes('*'), 'GitHub role trust must not use a wildcard');

const requiredDescriptions = [
  'GitHub variable AWS_BUCKET_NAME',
  'GitHub variable AWS_DISTRIBUTION_ID',
  'GitHub variable AWS_DEPLOY_ROLE_ARN',
  'GitHub variable AWS_REGION',
  'HTTPS URL on the default CloudFront domain',
];
const descriptions = Object.values(template.Outputs ?? {}).map((output) => output.Description);
for (const description of requiredDescriptions) {
  assert(descriptions.includes(description), `missing output: ${description}`);
}

const regionOutput = Object.values(template.Outputs ?? {}).find(
  (output) => output.Description === 'GitHub variable AWS_REGION',
);
assert(expectedRegion === 'ap-northeast-2', 'cdk.json region default must stay ap-northeast-2');
assert(
  regionOutput?.Value === expectedRegion,
  `stack region is ${regionOutput?.Value}, expected ${expectedRegion}`,
);
assert(buckets[0].resource.DeletionPolicy === 'Delete', 'bucket should be deleted with the stack');

console.log(`Template ok: ${templates[0]}`);

function resourcesOfType(doc, type) {
  return Object.entries(doc.Resources ?? {})
    .filter(([, resource]) => resource.Type === type)
    .map(([logicalId, resource]) => ({ logicalId, resource }));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
