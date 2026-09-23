import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import type { SiteEnvironment } from './site-stack';

const LOCAL_CALLBACK = 'http://localhost:8080/_auth/callback';
const LOCAL_LOGOUT = 'http://localhost:8080/';

export interface CognitoAuthStackProps extends cdk.StackProps {
  readonly siteEnvironment: SiteEnvironment;
  readonly domainPrefix: string;
}

/**
 * Admin-only Cognito user pool for one environment.
 * The pool lives in the site region. Sign-up is off.
 */
export class CognitoAuthStack extends cdk.Stack {
  readonly userPoolId: string;
  readonly userPoolArn: string;
  readonly userPoolClientId: string;
  readonly authBaseUrl: string;

  constructor(scope: Construct, id: string, props: CognitoAuthStackProps) {
    super(scope, id, props);

    const siteEnvironment = props.siteEnvironment;
    const retained = siteEnvironment === 'prod';

    const userPool = new cognito.UserPool(this, 'Users', {
      userPoolName: `fluid-tetris-${siteEnvironment}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.NONE,
      deletionProtection: retained,
      removalPolicy: retained ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const client = userPool.addClient('Web', {
      userPoolClientName: `fluid-tetris-${siteEnvironment}-web`,
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      authFlows: {
        userPassword: false,
        userSrp: false,
        custom: false,
        adminUserPassword: false,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,
          clientCredentials: false,
        },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
        callbackUrls: [LOCAL_CALLBACK],
        logoutUrls: [LOCAL_LOGOUT],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(1),
    });

    const domain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: props.domainPrefix },
    });
    domain.applyRemovalPolicy(retained ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY);

    this.userPoolId = userPool.userPoolId;
    this.userPoolArn = userPool.userPoolArn;
    this.userPoolClientId = client.userPoolClientId;
    this.authBaseUrl = domain.baseUrl();

    const label = siteEnvironment === 'staging' ? 'Staging' : 'Production';
    new cdk.CfnOutput(this, 'UserPoolId', {
      description: `${label} Cognito user pool id`,
      value: userPool.userPoolId,
    });
  }
}
