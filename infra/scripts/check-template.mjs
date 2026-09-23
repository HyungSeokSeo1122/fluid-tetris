import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';
const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';

const infraDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(infraDir, 'cdk.out');
const cdkJson = JSON.parse(readFileSync(join(infraDir, 'cdk.json'), 'utf8'));
const expectedRepo = cdkJson.context?.githubRepo;
const expectedRegion = cdkJson.context?.region;

assert(typeof expectedRepo === 'string' && !expectedRepo.includes('*'), 'cdk.json githubRepo must be owner/name');
assert(expectedRegion === 'ap-northeast-2', 'cdk.json region default must stay ap-northeast-2');

const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
const templateNames = Object.values(manifest.artifacts)
  .filter((artifact) => artifact.type === 'aws:cloudformation:stack')
  .map((artifact) => artifact.properties.templateFile);
const templates = templateNames.map((name) => {
  const text = readFileSync(join(outDir, name), 'utf8');
  return { name, text, template: JSON.parse(text) };
});

assert(templates.length === 3, `expected 3 templates (oidc, staging, prod), found ${templates.length}`);

for (const entry of templates) {
  assert(!entry.text.includes('AKIA'), `${entry.name} contains an AWS access key id`);
  assert(!/aws_secret_access_key/i.test(entry.text), `${entry.name} contains a secret access key field`);
  assert(!entry.text.includes('BEGIN PRIVATE KEY'), `${entry.name} contains a private key`);
  assert(!entry.text.includes('AWS::Amplify'), `${entry.name} must not use Amplify`);
}

const oidcTemplates = templates.filter((entry) => resourcesOfType(entry.template, 'AWS::IAM::OIDCProvider').length > 0);
const siteTemplates = templates.filter((entry) => resourcesOfType(entry.template, 'AWS::S3::Bucket').length > 0);

assert(oidcTemplates.length === 1, `expected 1 OIDC template, found ${oidcTemplates.length}`);
assert(siteTemplates.length === 2, `expected 2 site templates, found ${siteTemplates.length}`);

const provider = resourcesOfType(oidcTemplates[0].template, 'AWS::IAM::OIDCProvider');
assert(provider.length === 1, 'OIDC stack should contain one provider');
assert(provider[0].resource.Properties?.Url === 'https://token.actions.githubusercontent.com', 'OIDC provider URL is wrong');
assert(
  (provider[0].resource.Properties?.ClientIdList ?? []).includes('sts.amazonaws.com'),
  'OIDC provider audience is wrong',
);
assert(
  resourcesOfType(oidcTemplates[0].template, 'AWS::S3::Bucket').length === 0,
  'OIDC stack must not create a bucket',
);

const seenRoles = new Set();
for (const entry of siteTemplates) {
  const roleName = assertSite(entry, expectedRepo, expectedRegion);
  assert(!seenRoles.has(roleName), `duplicate deploy role ${roleName}`);
  seenRoles.add(roleName);
}

assert(seenRoles.has('fluid-tetris-github-deploy-staging'), 'missing staging deploy role');
assert(seenRoles.has('fluid-tetris-github-deploy-prod'), 'missing prod deploy role');

console.log(`Templates ok: ${templateNames.join(', ')}`);

function assertSite(entry, repo, region) {
  const { name, text, template } = entry;
  const buckets = resourcesOfType(template, 'AWS::S3::Bucket');
  const distributions = resourcesOfType(template, 'AWS::CloudFront::Distribution');
  const originControls = resourcesOfType(template, 'AWS::CloudFront::OriginAccessControl');
  const roles = resourcesOfType(template, 'AWS::IAM::Role');
  const githubRoles = roles.filter(({ resource }) =>
    JSON.stringify(resource.Properties?.AssumeRolePolicyDocument ?? {}).includes(
      'token.actions.githubusercontent.com',
    ),
  );

  assert(buckets.length === 1, `${name}: expected 1 bucket, found ${buckets.length}`);
  assert(distributions.length === 1, `${name}: expected 1 distribution, found ${distributions.length}`);
  assert(originControls.length === 1, `${name}: expected 1 origin access control, found ${originControls.length}`);
  assert(githubRoles.length === 1, `${name}: expected 1 GitHub deploy role, found ${githubRoles.length}`);
  assert(resourcesOfType(template, 'AWS::IAM::OIDCProvider').length === 0, `${name}: site stack must not create the OIDC provider`);

  for (const { resource } of roles) {
    const roleText = JSON.stringify(resource);
    const isGithub = roleText.includes('token.actions.githubusercontent.com');
    const isBucketCleanup = roleText.includes('S3AutoDeleteObjects');
    assert(isGithub || isBucketCleanup, `${name}: unexpected IAM role`);
  }

  const bucket = buckets[0].resource;
  const publicAccess = bucket.Properties?.PublicAccessBlockConfiguration;
  for (const flag of ['BlockPublicAcls', 'BlockPublicPolicy', 'IgnorePublicAcls', 'RestrictPublicBuckets']) {
    assert(publicAccess?.[flag] === true, `${name}: bucket public access ${flag} is not true`);
  }
  assert(bucket.Properties?.WebsiteConfiguration === undefined, `${name}: bucket must not be a public website endpoint`);
  assert(text.includes('cloudfront.amazonaws.com'), `${name}: bucket policy does not grant CloudFront`);
  assert(text.includes('s3:GetObject'), `${name}: bucket policy does not grant GetObject`);
  assert(text.includes('aws:SecureTransport'), `${name}: bucket policy does not deny non-TLS access`);

  const config = distributions[0].resource.Properties?.DistributionConfig;
  assert(config?.DefaultRootObject === 'index.html', `${name}: default root object is not index.html`);
  assert(config?.PriceClass === 'PriceClass_200', `${name}: price class is ${config?.PriceClass}`);
  assert(config?.HttpVersion === 'http2and3', `${name}: HTTP version is ${config?.HttpVersion}`);
  const viewerCertificate = config?.ViewerCertificate;
  assert(
    viewerCertificate === undefined || viewerCertificate.CloudFrontDefaultCertificate === true,
    `${name}: distribution should use the default CloudFront certificate`,
  );
  assert(!JSON.stringify(config).includes('AcmCertificateArn'), `${name}: custom certificate must not be required`);
  assert(
    config?.DefaultCacheBehavior?.ViewerProtocolPolicy === 'redirect-to-https',
    `${name}: default behavior does not redirect to HTTPS`,
  );
  assert(
    config?.DefaultCacheBehavior?.CachePolicyId === CACHING_DISABLED,
    `${name}: default behavior should use CachingDisabled`,
  );

  const assetBehavior = (config?.CacheBehaviors ?? []).find((behavior) => behavior.PathPattern === '/assets/*');
  assert(assetBehavior, `${name}: missing /assets/* cache behavior`);
  assert(assetBehavior.CachePolicyId === CACHING_OPTIMIZED, `${name}: hashed assets should use CachingOptimized`);

  const errors = new Map((config?.CustomErrorResponses ?? []).map((error) => [error.ErrorCode, error]));
  for (const status of [403, 404]) {
    const error = errors.get(status);
    assert(error, `${name}: missing custom error response for ${status}`);
    assert(error.ResponseCode === 200, `${name}: ${status} response code is not 200`);
    assert(error.ResponsePagePath === '/index.html', `${name}: ${status} does not serve /index.html`);
    assert(error.ErrorCachingMinTTL === 0, `${name}: ${status} error cache TTL is not 0`);
  }

  const roleName = githubRoles[0].resource.Properties?.RoleName;
  const assumeText = JSON.stringify(githubRoles[0].resource.Properties?.AssumeRolePolicyDocument ?? {});
  assert(assumeText.includes('sts.amazonaws.com'), `${name}: role audience is not sts.amazonaws.com`);

  if (roleName === 'fluid-tetris-github-deploy-staging') {
    assert(bucket.DeletionPolicy === 'Delete', `${name}: staging bucket should be deleted with the stack`);
    assert(assumeText.includes(`repo:${repo}:ref:refs/heads/main`), `${name}: staging trust is not limited to main`);
    assert(!assumeText.includes('*'), `${name}: staging trust must not use a wildcard`);
    assert(!assumeText.includes('StringLike'), `${name}: staging trust should be an exact subject match`);
    assertOutputs(template, 'STAGING', 'Staging', region);
  } else if (roleName === 'fluid-tetris-github-deploy-prod') {
    assert(bucket.DeletionPolicy === 'Retain', `${name}: prod bucket should be retained`);
    assert(assumeText.includes('StringLike'), `${name}: prod trust should use StringLike for tag names`);
    assert(assumeText.includes(`repo:${repo}:ref:refs/tags/v*`), `${name}: prod trust is not limited to v* tags`);
    assert(!assumeText.includes('refs/heads'), `${name}: prod trust must not allow a branch`);
    assertOutputs(template, 'PROD', 'Production', region);
  } else {
    throw new Error(`${name}: unexpected deploy role ${roleName}`);
  }

  return roleName;
}

function assertOutputs(template, prefix, label, region) {
  const descriptions = Object.values(template.Outputs ?? {}).map((output) => output.Description);
  for (const description of [
    `GitHub variable AWS_${prefix}_BUCKET_NAME`,
    `GitHub variable AWS_${prefix}_DISTRIBUTION_ID`,
    `GitHub variable AWS_${prefix}_DEPLOY_ROLE_ARN`,
    `GitHub variable AWS_${prefix}_REGION`,
    `${label} HTTPS URL on the default CloudFront domain`,
  ]) {
    assert(descriptions.includes(description), `missing output: ${description}`);
  }
  const regionOutput = Object.values(template.Outputs ?? {}).find(
    (output) => output.Description === `GitHub variable AWS_${prefix}_REGION`,
  );
  assert(regionOutput?.Value === region, `stack region is ${regionOutput?.Value}, expected ${region}`);
}

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
