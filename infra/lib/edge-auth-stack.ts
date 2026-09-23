import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as esbuild from 'esbuild';
import { Construct } from 'constructs';
import type { SiteEnvironment } from './site-stack';

const AUTH_SOURCE = path.join(__dirname, '../edge/auth.js');
const PLACEHOLDERS = ['__REGION__', '__POOL_ID__', '__CLIENT_ID__', '__AUTH_BASE__'] as const;

export interface EdgeAuthStackProps extends cdk.StackProps {
  readonly siteEnvironment: SiteEnvironment;
  readonly poolRegion: string;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly authBaseUrl: string;
}

/**
 * Viewer-request Lambda@Edge. It has to be deployed from us-east-1.
 * Pool ids are injected when the function is created; the function does not
 * call back into the site stack. The handler is minified so the filled source
 * stays inside CloudFormation's 4096-byte inline code limit.
 */
export class EdgeAuthStack extends cdk.Stack {
  readonly version: lambda.IVersion;

  constructor(scope: Construct, id: string, props: EdgeAuthStackProps) {
    super(scope, id, props);

    const source = minifyAuthSource(fs.readFileSync(AUTH_SOURCE, 'utf8'));
    assertAuthSourceBudget(source);

    const fn = new lambda.Function(this, 'Auth', {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler=async()=>({status:"503",statusDescription:"Error"});'),
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      description: `Fluid Tetris ${props.siteEnvironment} CloudFront sign-in check`,
    });

    const cfn = fn.node.defaultChild as lambda.CfnFunction;
    cfn.code = {
      zipFile: fillAuthSource(source, {
        __REGION__: props.poolRegion,
        __POOL_ID__: props.userPoolId,
        __CLIENT_ID__: props.userPoolClientId,
        __AUTH_BASE__: props.authBaseUrl,
      }),
    };

    const role = fn.role;
    if (role instanceof iam.Role) {
      role.assumeRolePolicy?.addStatements(
        new iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          principals: [new iam.ServicePrincipal('edgelambda.amazonaws.com')],
        }),
      );
    }

    const sourceHash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);
    // The construct id changes with the handler source so CloudFront picks up a new
    // version. Pool ids are tokens, so they also go in the description: a description
    // change replaces the version. Retain the previous version because CloudFront
    // can still be replicating it.
    this.version = new lambda.Version(this, `AuthVersion${sourceHash}`, {
      lambda: fn,
      description: cdk.Fn.join('-', [sourceHash, props.userPoolClientId, props.userPoolId, props.authBaseUrl]),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.version.addPermission('AllowEdgeInvoke', {
      principal: new iam.ServicePrincipal('edgelambda.amazonaws.com'),
      action: 'lambda:InvokeFunction',
    });
  }
}

function fillAuthSource(source: string, replacements: Record<(typeof PLACEHOLDERS)[number], string>): string {
  let parts: string[] = [source];
  for (const key of PLACEHOLDERS) {
    const value = replacements[key];
    const next: string[] = [];
    for (const part of parts) {
      if (cdk.Token.isUnresolved(part)) {
        next.push(part);
        continue;
      }
      const chunks = part.split(key);
      chunks.forEach((chunk, index) => {
        if (index > 0) next.push(value);
        if (chunk.length > 0) next.push(chunk);
      });
    }
    parts = next;
  }
  return cdk.Fn.join('', parts);
}

function minifyAuthSource(source: string): string {
  return esbuild
    .transformSync(source, {
      minify: true,
      target: 'node24',
      loader: 'js',
      legalComments: 'none',
    })
    .code.trim();
}

function assertAuthSourceBudget(source: string): void {
  for (const key of PLACEHOLDERS) {
    if (source.split(key).length !== 2) {
      throw new Error(`edge/auth.js must contain ${key} exactly once`);
    }
  }
  const worst = source
    .replace('__REGION__', 'ap-northeast-2')
    .replace('__POOL_ID__', 'ap-northeast-2_Abcdefghi')
    .replace('__CLIENT_ID__', 'a'.repeat(26))
    .replace('__AUTH_BASE__', `https://${'a'.repeat(63)}.auth.ap-northeast-2.amazoncognito.com`);
  if (Buffer.byteLength(worst) > 4000) {
    throw new Error(`edge/auth.js expands past the 4KB inline Lambda limit (${Buffer.byteLength(worst)} bytes)`);
  }
}
