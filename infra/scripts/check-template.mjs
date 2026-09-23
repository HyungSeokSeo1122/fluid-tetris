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
const stackArtifacts = Object.values(manifest.artifacts).filter((artifact) => artifact.type === 'aws:cloudformation:stack');
const regionByTemplate = new Map(
  stackArtifacts.map((artifact) => [artifact.properties.templateFile, artifact.environment.split('/').at(-1)]),
);
const templateNames = stackArtifacts.map((artifact) => artifact.properties.templateFile);
const templates = templateNames.map((name) => {
  const text = readFileSync(join(outDir, name), 'utf8');
  return { name, text, template: JSON.parse(text) };
});

const expectedStacks = [
  ['FluidTetrisOidc.template.json', 'ap-northeast-2'],
  ['FluidTetrisStagingAuth.template.json', 'ap-northeast-2'],
  ['FluidTetrisStagingEdge.template.json', 'us-east-1'],
  ['FluidTetrisStaging.template.json', 'ap-northeast-2'],
  ['FluidTetrisProdAuth.template.json', 'ap-northeast-2'],
  ['FluidTetrisProdEdge.template.json', 'us-east-1'],
  ['FluidTetrisProd.template.json', 'ap-northeast-2'],
];
assert(
  templateNames.length === expectedStacks.length &&
    expectedStacks.every(([name, region]) => templateNames.includes(name) && regionByTemplate.get(name) === region),
  `expected OIDC, two auth pools, two us-east-1 edge functions, and two sites. Found ${templateNames
    .map((name) => `${name}@${regionByTemplate.get(name)}`)
    .join(', ')}`,
);

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

assertAuth(templates.find((entry) => entry.name === 'FluidTetrisStagingAuth.template.json'), 'staging', 'ft-stg-');
assertAuth(templates.find((entry) => entry.name === 'FluidTetrisProdAuth.template.json'), 'prod', 'ft-prd-');
assertEdge(templates.find((entry) => entry.name === 'FluidTetrisStagingEdge.template.json'));
assertEdge(templates.find((entry) => entry.name === 'FluidTetrisProdEdge.template.json'));

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
    const trustsOnlyLambda = roleText.includes('lambda.amazonaws.com') && !roleText.includes('edgelambda.amazonaws.com');
    assert(isGithub || trustsOnlyLambda, `${name}: unexpected IAM role`);
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
  assertViewerAuth(config?.DefaultCacheBehavior, `${name} default`);
  assertViewerAuth(assetBehavior, `${name} /assets/*`);

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

  assert(text.includes('/_auth/callback'), `${name}: callback URL is not registered on the CloudFront domain`);
  assert(text.includes('cognito-idp:UpdateUserPoolClient'), `${name}: missing permission to set callback URLs`);
  assert(!text.includes('cognito-idp:*'), `${name}: Cognito permission must be the one client update`);
  assert(!text.includes('USER_PASSWORD'), `${name}: site must not enable password auth flows`);
  assert(!text.includes('"implicit"'), `${name}: OAuth implicit flow must stay off`);
  const cognitoPolicies = resourcesOfType(template, 'AWS::IAM::Policy').filter(({ resource }) =>
    JSON.stringify(resource).includes('cognito-idp:UpdateUserPoolClient'),
  );
  assert(cognitoPolicies.length === 1, `${name}: expected one callback-update policy`);
  const cognitoStatement = cognitoPolicies[0].resource.Properties?.PolicyDocument?.Statement?.[0];
  assert(cognitoStatement?.Resource !== '*', `${name}: callback update must be limited to the user pool`);
  assert(
    JSON.stringify(githubRoles[0].resource).includes('cognito') === false,
    `${name}: deploy role must not administer Cognito`,
  );

  if (roleName === 'fluid-tetris-github-deploy-staging') {
    assert(bucket.DeletionPolicy === 'Delete', `${name}: staging bucket should be deleted with the stack`);
    assert(assumeText.includes(`repo:${repo}:ref:refs/heads/main`), `${name}: staging trust is not limited to main`);
    assert(!assumeText.includes('*'), `${name}: staging trust must not use a wildcard`);
    assert(!assumeText.includes('StringLike'), `${name}: staging trust should be an exact subject match`);
    assertOutputs(template, 'STAGING', 'Staging', region);
  } else if (roleName === 'fluid-tetris-github-deploy-prod') {
    assert(bucket.DeletionPolicy === 'Retain', `${name}: prod bucket should be retained`);
    assert(!text.includes('S3AutoDeleteObjects'), `${name}: prod must not auto-delete the bucket`);
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

function assertAuth(entry, siteEnvironment, domainPrefix) {
  const { name, template } = entry;
  const pools = resourcesOfType(template, 'AWS::Cognito::UserPool');
  const clients = resourcesOfType(template, 'AWS::Cognito::UserPoolClient');
  const domains = resourcesOfType(template, 'AWS::Cognito::UserPoolDomain');
  assert(pools.length === 1, `${name}: expected 1 user pool`);
  assert(clients.length === 1, `${name}: expected 1 app client`);
  assert(domains.length === 1, `${name}: expected 1 hosted UI domain`);

  const pool = pools[0].resource;
  const client = clients[0].resource.Properties;
  assert(pool.Properties?.UserPoolName === `fluid-tetris-${siteEnvironment}`, `${name}: unexpected pool name`);
  assert(pool.Properties?.AdminCreateUserConfig?.AllowAdminCreateUserOnly === true, `${name}: self sign-up must be off`);
  assert(
    pool.Properties?.AccountRecoverySetting?.RecoveryMechanisms?.[0]?.Name === 'admin_only',
    `${name}: password recovery must be admin-only`,
  );
  assert(pool.Properties?.Policies?.PasswordPolicy?.MinimumLength === 12, `${name}: password minimum should be 12`);
  assert(client?.GenerateSecret === false, `${name}: the web client must stay public`);
  assert(JSON.stringify(client?.AllowedOAuthFlows) === JSON.stringify(['code']), `${name}: OAuth must be authorization code only`);
  assert(
    JSON.stringify(client?.ExplicitAuthFlows) === JSON.stringify(['ALLOW_REFRESH_TOKEN_AUTH']),
    `${name}: the client must not allow direct password sign-in`,
  );
  assert(client?.PreventUserExistenceErrors === 'ENABLED', `${name}: user-existence errors must be hidden`);
  assert(!JSON.stringify(client).includes('client_secret'), `${name}: client secret must not be in the template`);
  assert(String(domains[0].resource.Properties?.Domain).startsWith(domainPrefix), `${name}: unexpected Cognito domain prefix`);

  if (siteEnvironment === 'staging') {
    assert(pool.DeletionPolicy === 'Delete', `${name}: staging pool should be deleted with the stack`);
    assert(pool.Properties?.DeletionProtection === 'INACTIVE', `${name}: staging pool should not be deletion-protected`);
  } else {
    assert(pool.DeletionPolicy === 'Retain', `${name}: prod pool should be retained`);
    assert(pool.Properties?.DeletionProtection === 'ACTIVE', `${name}: prod pool should be deletion-protected`);
  }
}

function assertEdge(entry) {
  const { name, text, template } = entry;
  const functions = resourcesOfType(template, 'AWS::Lambda::Function').filter((item) =>
    JSON.stringify(item.resource.Properties?.Code ?? {}).includes('token_use'),
  );
  assert(functions.length === 1, `${name}: expected the sign-in function`);
  const fn = functions[0].resource.Properties;
  assert(fn.Runtime === 'nodejs24.x', `${name}: sign-in function runtime is ${fn.Runtime}`);
  assert(fn.Timeout === 5, `${name}: viewer-request timeout must be 5 seconds`);
  assert(fn.MemorySize === 128, `${name}: viewer-request memory must be 128 MB`);
  for (const required of ['HttpOnly', 'Secure', 'SameSite=Lax', 'code_challenge_method', 'S256']) {
    assert(text.includes(required), `${name}: sign-in function is missing ${required}`);
  }
  assert(!/client_secret|SignUp|USER_PASSWORD/i.test(text), `${name}: sign-in function must not offer sign-up or a client secret`);
  const trust = JSON.stringify(
    resourcesOfType(template, 'AWS::IAM::Role').find((item) =>
      JSON.stringify(item.resource).includes('edgelambda.amazonaws.com'),
    )?.resource ?? {},
  );
  assert(trust.includes('edgelambda.amazonaws.com'), `${name}: function role must trust edgelambda`);
  const permission = resourcesOfType(template, 'AWS::Lambda::Permission').find((item) =>
    item.resource.Properties?.Principal === 'edgelambda.amazonaws.com',
  );
  assert(permission, `${name}: missing edgelambda invoke permission`);
  const version = resourcesOfType(template, 'AWS::Lambda::Version').find((item) => item.resource.DeletionPolicy === 'Retain');
  assert(version, `${name}: published sign-in version should be retained`);
}

function assertViewerAuth(behavior, label) {
  const associations = behavior?.LambdaFunctionAssociations ?? [];
  assert(associations.length === 1, `${label}: expected one Lambda@Edge association`);
  assert(associations[0].EventType === 'viewer-request', `${label}: auth must run on viewer-request`);
  assert(associations[0].IncludeBody === false, `${label}: viewer-request must not read the body`);
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
