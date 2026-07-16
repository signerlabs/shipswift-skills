---
id: infra-cdk
title: AWS Infrastructure with CDK
description: Production-ready AWS infrastructure using CDK — App Runner for HTTP services, Aurora Serverless for database, Cognito for auth, Lambda for serverless functions, and S3 for storage
tier: free
tags: [AWS, CDK, infrastructure, App Runner, Aurora, Lambda, Cognito, deployment]
---

## What This Solves

Manually configuring AWS resources through the Console is error-prone, unrepeatable, and impossible to version control. As your app grows from a side project to a real product, you will inevitably need to reproduce your infrastructure for staging environments, disaster recovery, or a second project.

AWS CDK (Cloud Development Kit) solves this by letting you define your entire AWS infrastructure in TypeScript. You get:

- **Reproducibility** — One `cdk deploy` stands up your entire stack from scratch
- **Version control** — Infrastructure changes go through the same PR review as application code
- **Type safety** — TypeScript catches misconfigurations at compile time, not at 3am in production
- **Least-privilege by default** — CDK's `grant*` methods generate minimal IAM policies automatically
- **Cost visibility** — All resources are declared in code, making it easy to audit what you are paying for

This recipe provides a complete, production-tested CDK stack for indie iOS apps: App Runner for your HTTP backend, Aurora Serverless v2 for PostgreSQL, Cognito for authentication, Lambda for serverless tasks, and S3 for file storage.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              iOS Client                                │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              │              ▼
        ┌──────────────┐       │    ┌────────────────────┐
        │   Cognito    │       │    │   API Gateway       │
        │  User Pool   │◄──────┼────│  (JWT Authorizer)   │
        │ + Hosted UI  │       │    └─────────┬──────────┘
        └──────┬───────┘       │              │
               │               │              ▼
               ▼               │    ┌────────────────────┐
        ┌──────────────┐       │    │    App Runner       │
        │Identity Pool │◄──────┘    │   (Hono backend)    │
        │(anon + auth) │            └─────────┬──────────┘
        └──────────────┘                      │
                                ┌─────────────┴─────────────┐
                                │                           │
                                ▼                           ▼
                      ┌──────────────┐            ┌────────────────┐
                      │  RDS Proxy   │            │   S3 Bucket    │
                      │ (conn pool)  │            │  (file store)  │
                      └──────┬───────┘            └────────────────┘
                             │
                             ▼
                      ┌──────────────┐
                      │   Aurora     │
                      │Serverless v2 │
                      └──────────────┘
```

**Service roles:**

| Service | Purpose | Why this one |
|---------|---------|-------------|
| **Cognito User Pool** | User authentication | Native Apple/Google sign-in, JWT auto-refresh |
| **Cognito Identity Pool** | Anonymous guests + credential management | Unique ID for every visitor, temporary AWS credentials |
| **API Gateway HTTP API** | API gateway | JWT Authorizer for unified auth, low latency |
| **App Runner** | Backend runtime | Auto-deploy from GitHub, auto-scale, zero server management |
| **Aurora Serverless v2** | Database | Auto-scale, pay-per-use, PostgreSQL compatible |
| **RDS Proxy** | Connection pooling | Prevents connection storms, improves stability |
| **Secrets Manager** | Secret storage | Auto-rotation, secure database credential storage |
| **S3** | File storage | Unlimited capacity, low cost |
| **Lambda** | Serverless functions | DB migrations, scheduled tasks, event processing |
| **VPC** | Network isolation | Private subnets protect your database |

## Dependencies

```json
{
  "devDependencies": {
    "aws-cdk-lib": "^2.175.0",
    "constructs": "^10.4.2",
    "@aws-cdk/aws-apprunner-alpha": "^2.175.0-alpha.0",
    "source-map-support": "^0.5.21",
    "typescript": "^5.7.0"
  }
}
```

Install with:

```bash
npm install --save-dev aws-cdk-lib constructs @aws-cdk/aws-apprunner-alpha source-map-support
npm install -g aws-cdk
```

Add CDK scripts to your `package.json`:

```json
{
  "scripts": {
    "cdk:synth": "cdk synth",
    "cdk:deploy": "cdk deploy --require-approval never",
    "cdk:diff": "cdk diff",
    "cdk:destroy": "cdk destroy"
  }
}
```

## Implementation

### Project Structure

```
your-project/
├── cdk/
│   ├── app.ts                       # CDK entry point
│   ├── project-stack.ts             # Main stack
│   └── constructs/
│       ├── vpc-construct.ts         # VPC networking
│       ├── database-construct.ts    # Aurora + RDS Proxy
│       ├── apprunner-construct.ts   # App Runner service
│       ├── auth-construct.ts        # Cognito User Pool + Identity Pool
│       └── api-construct.ts         # API Gateway + JWT Authorizer
├── lib/
│   └── lambda/
│       └── db-migrate/
│           └── index.ts             # Database migration handler
├── src/                             # Application code
├── drizzle/                         # Database migrations
├── cdk.json
├── tsconfig.json
└── package.json
```

### CDK Entry Point

```typescript
// cdk/app.ts
import "source-map-support/register.js";
import * as cdk from "aws-cdk-lib";
import { ProjectStack } from "./project-stack.js";

const app = new cdk.App();

// Read configuration from cdk.json context
const enableAppRunner = app.node.tryGetContext("enableAppRunner") === "true";
const enableDatabase = app.node.tryGetContext("enableDatabase") === "true";
const enableAuth = app.node.tryGetContext("enableAuth") === "true";
const enableSocialLogin =
  app.node.tryGetContext("enableSocialLogin") === "true";
const githubConnectionArn =
  app.node.tryGetContext("githubConnectionArn") || "";
const githubRepositoryUrl =
  app.node.tryGetContext("githubRepositoryUrl") || "";
const githubBranch = app.node.tryGetContext("githubBranch") || "main";

new ProjectStack(app, "MyProjectStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  enableAppRunner,
  enableDatabase,
  enableAuth,
  enableSocialLogin,
  githubConnectionArn,
  githubRepositoryUrl,
  githubBranch,
});
```

### CDK Configuration

```jsonc
// cdk.json
{
  "app": "npx tsx cdk/app.ts",
  "context": {
    "enableAppRunner": "true",
    "enableDatabase": "true",
    "enableAuth": "true",
    "enableSocialLogin": "false",
    "githubConnectionArn": "",
    "githubRepositoryUrl": "https://github.com/your-org/your-repo",
    "githubBranch": "main"
  }
}
```

### Main Stack

```typescript
// cdk/project-stack.ts
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { VpcConstruct } from "./constructs/vpc-construct.js";
import { DatabaseConstruct } from "./constructs/database-construct.js";
import { AppRunnerConstruct } from "./constructs/apprunner-construct.js";
import { AuthConstruct } from "./constructs/auth-construct.js";
import { ApiConstruct } from "./constructs/api-construct.js";

export interface ProjectStackProps extends cdk.StackProps {
  enableAppRunner?: boolean;
  enableDatabase?: boolean;
  enableAuth?: boolean;
  enableSocialLogin?: boolean;
  githubConnectionArn?: string;
  githubRepositoryUrl?: string;
  githubBranch?: string;
}

export class ProjectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ProjectStackProps) {
    super(scope, id, props);

    // ── VPC (required when database or App Runner with VPC is enabled) ──
    const vpc = new VpcConstruct(this, "Vpc");

    // ── Database ──
    let database: DatabaseConstruct | undefined;
    if (props.enableDatabase) {
      database = new DatabaseConstruct(this, "Database", {
        vpc: vpc.vpc,
      });
    }

    // ── App Runner ──
    if (
      props.enableAppRunner &&
      props.githubConnectionArn &&
      props.githubRepositoryUrl
    ) {
      new AppRunnerConstruct(this, "AppRunner", {
        vpc: vpc.vpc,
        githubConnectionArn: props.githubConnectionArn,
        repositoryUrl: props.githubRepositoryUrl,
        branch: props.githubBranch ?? "main",
        databaseProxyEndpoint: database?.proxyEndpoint,
        databaseSecretArn: database?.secretArn,
        databaseName: database?.databaseName,
        databaseSecurityGroup: database?.proxySecurityGroup,
      });
    }

    // ── Auth ──
    if (props.enableAuth) {
      const auth = new AuthConstruct(this, "Auth", {
        enableSocialLogin: props.enableSocialLogin ?? false,
      });

      // API Gateway (requires auth)
      new ApiConstruct(this, "Api", {
        userPool: auth.userPool,
        userPoolClient: auth.userPoolClient,
        appRunnerUrl: "https://YOUR_APPRUNNER_URL", // replace after first deploy
      });
    }

    // ── Tags ──
    cdk.Tags.of(this).add("Project", "MyProject");
    cdk.Tags.of(this).add("Environment", "Production");
    cdk.Tags.of(this).add("ManagedBy", "CDK");
  }
}
```

### VPC Construct

Three-tier network: public (NAT Gateway), private (App Runner, RDS Proxy, Lambda), and isolated (Aurora database).

```typescript
// cdk/constructs/vpc-construct.ts
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";

export class VpcConstruct extends Construct {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),

      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: "Isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],

      // Dev: 1 NAT Gateway to save cost (~$32/mo each)
      // Prod: set to 2 for high availability
      natGateways: 1,
    });

    // VPC Endpoints — avoid NAT charges for AWS service calls
    this.vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    this.vpc.addInterfaceEndpoint("CloudWatchLogsEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });
  }
}
```

### App Runner Construct

Deploys your Hono backend directly from GitHub with auto-deploy on push.

```typescript
// cdk/constructs/apprunner-construct.ts
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apprunner from "@aws-cdk/aws-apprunner-alpha";
import { Construct } from "constructs";

export interface AppRunnerConstructProps {
  vpc: ec2.Vpc;
  githubConnectionArn: string;
  repositoryUrl: string;
  branch?: string;
  databaseProxyEndpoint?: string;
  databaseSecretArn?: string;
  databaseName?: string;
  databaseSecurityGroup?: ec2.SecurityGroup;
  environmentVariables?: { [key: string]: string };
  cpu?: apprunner.Cpu;
  memory?: apprunner.Memory;
}

export class AppRunnerConstruct extends Construct {
  public readonly service: apprunner.Service;
  public readonly serviceUrl: string;

  constructor(scope: Construct, id: string, props: AppRunnerConstructProps) {
    super(scope, id);

    // Security Group
    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
      description: "App Runner service security group",
      allowAllOutbound: true,
    });

    // Allow App Runner to reach RDS Proxy
    if (props.databaseSecurityGroup) {
      props.databaseSecurityGroup.addIngressRule(
        securityGroup,
        ec2.Port.tcp(5432),
        "Allow App Runner to connect to RDS Proxy"
      );
    }

    // VPC Connector
    const vpcConnector = new apprunner.VpcConnector(this, "VpcConnector", {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [securityGroup],
    });

    // IAM Role
    const instanceRole = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
    });

    // Grant Secrets Manager read access
    if (props.databaseSecretArn) {
      instanceRole.addToPolicy(
        new iam.PolicyStatement({
          actions: ["secretsmanager:GetSecretValue"],
          resources: [props.databaseSecretArn],
        })
      );
    }

    // Build environment variables
    const envVars: { [key: string]: string } = {
      NODE_ENV: "production",
      ...props.environmentVariables,
    };
    if (props.databaseProxyEndpoint) {
      envVars.DB_HOST = props.databaseProxyEndpoint;
    }
    if (props.databaseName) {
      envVars.DB_NAME = props.databaseName;
    }
    if (props.databaseSecretArn) {
      envVars.DB_SECRET_ARN = props.databaseSecretArn;
    }

    // App Runner Service
    this.service = new apprunner.Service(this, "Service", {
      source: apprunner.Source.fromGitHub({
        repositoryUrl: props.repositoryUrl,
        branch: props.branch ?? "main",
        configurationSource: apprunner.ConfigurationSourceType.API,
        connection: apprunner.GitHubConnection.fromConnectionArn(
          props.githubConnectionArn
        ),
        codeConfigurationValues: {
          runtime: apprunner.Runtime.NODEJS_22,
          port: "3000",
          buildCommand: "npm ci --include=dev && npm run build",
          startCommand: "node dist/src/server.js",
          environmentVariables: envVars,
        },
      }),
      vpcConnector,
      instanceRole,
      cpu: props.cpu ?? apprunner.Cpu.QUARTER_VCPU,
      memory: props.memory ?? apprunner.Memory.HALF_GB,
      autoDeploymentsEnabled: true,
    });

    this.serviceUrl = this.service.serviceUrl;

    // Outputs
    new cdk.CfnOutput(this, "ServiceUrl", {
      value: `https://${this.service.serviceUrl}`,
      description: "App Runner Service URL",
    });

    new cdk.CfnOutput(this, "ServiceArn", {
      value: this.service.serviceArn,
      description: "App Runner Service ARN",
    });
  }
}
```

### Aurora Serverless v2 Construct

PostgreSQL database with automatic scaling and connection pooling via RDS Proxy.

```typescript
// cdk/constructs/database-construct.ts
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface DatabaseConstructProps {
  vpc: ec2.Vpc;
  databaseName?: string;
}

export class DatabaseConstruct extends Construct {
  public readonly cluster: rds.DatabaseCluster;
  public readonly proxy: rds.DatabaseProxy;
  public readonly proxyEndpoint: string;
  public readonly secretArn: string;
  public readonly databaseName: string;
  public readonly proxySecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseConstructProps) {
    super(scope, id);

    this.databaseName = props.databaseName ?? "app_database";

    // Database credentials — auto-generated password
    const secret = new secretsmanager.Secret(this, "DatabaseSecret", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "postgres" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
    this.secretArn = secret.secretArn;

    // Security groups
    const auroraSecurityGroup = new ec2.SecurityGroup(this, "AuroraSG", {
      vpc: props.vpc,
      description: "Aurora cluster security group",
    });

    this.proxySecurityGroup = new ec2.SecurityGroup(this, "ProxySG", {
      vpc: props.vpc,
      description: "RDS Proxy security group",
    });

    // RDS Proxy -> Aurora
    auroraSecurityGroup.addIngressRule(
      this.proxySecurityGroup,
      ec2.Port.tcp(5432),
      "Allow RDS Proxy to connect to Aurora"
    );

    // Aurora Serverless v2
    this.cluster = new rds.DatabaseCluster(this, "AuroraCluster", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_15_8,
      }),
      defaultDatabaseName: this.databaseName,
      credentials: rds.Credentials.fromSecret(secret),

      // Serverless v2 capacity
      serverlessV2MinCapacity: 0.5, // Minimum 0.5 ACU (~$43/mo)
      serverlessV2MaxCapacity: 16,
      writer: rds.ClusterInstance.serverlessV2("Writer"),

      // Network
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [auroraSecurityGroup],

      // Backup
      backup: {
        retention: cdk.Duration.days(7),
      },

      // Enable Data API for dev debugging (disable in prod)
      enableDataApi: true,

      // Dev settings — change for production
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // RDS Proxy — connection pooling
    this.proxy = this.cluster.addProxy("DatabaseProxy", {
      secrets: [secret],
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.proxySecurityGroup],
      maxConnectionsPercent: 60,
      requireTLS: true,
    });

    this.proxyEndpoint = this.proxy.endpoint;

    // Outputs
    new cdk.CfnOutput(this, "ProxyEndpoint", {
      value: this.proxy.endpoint,
      description: "RDS Proxy endpoint",
    });

    new cdk.CfnOutput(this, "ClusterArn", {
      value: this.cluster.clusterArn,
      description: "Aurora cluster ARN (for Data API queries)",
    });

    new cdk.CfnOutput(this, "SecretArn", {
      value: secret.secretArn,
      description: "Database credentials secret ARN",
    });
  }
}
```

### Lambda Functions

Use `NodejsFunction` for automatic TypeScript bundling with esbuild. ARM64 architecture is 20% cheaper.

```typescript
// cdk/constructs/lambda-helpers.ts
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambda from "aws-cdk-lib/aws-lambda";
import {
  NodejsFunction,
  OutputFormat,
} from "aws-cdk-lib/aws-lambda-nodejs";
import * as cr from "aws-cdk-lib/custom-resources";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

// ── Standard Lambda ──

export function createLambdaFunction(
  scope: Construct,
  id: string,
  options: {
    entry: string;
    vpc: ec2.Vpc;
    securityGroups: ec2.SecurityGroup[];
    environment?: { [key: string]: string };
    secret?: secretsmanager.ISecret;
    timeout?: cdk.Duration;
    memorySize?: number;
  }
): NodejsFunction {
  const fn = new NodejsFunction(scope, id, {
    functionName: id.toLowerCase(),
    entry: options.entry,
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: options.memorySize ?? 512,
    timeout: options.timeout ?? cdk.Duration.minutes(1),
    environment: {
      NODE_ENV: "production",
      ...options.environment,
    },
    vpc: options.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: options.securityGroups,
    bundling: {
      minify: true,
      sourceMap: true,
      target: "es2022",
      format: OutputFormat.ESM,
      externalModules: ["@aws-sdk/*"], // SDK v3 is built-in
      nodeModules: ["drizzle-orm", "postgres"],
    },
  });

  if (options.secret) {
    options.secret.grantRead(fn);
  }

  return fn;
}

// ── Database Migration (CDK Custom Resource) ──

export function createMigrationResource(
  scope: Construct,
  options: {
    entry: string;
    vpc: ec2.Vpc;
    securityGroups: ec2.SecurityGroup[];
    environment: { [key: string]: string };
    secret: secretsmanager.ISecret;
  }
): cdk.CustomResource {
  const migrationFn = new NodejsFunction(scope, "MigrationFunction", {
    entry: options.entry,
    handler: "handler",
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: 512,
    timeout: cdk.Duration.minutes(5),
    environment: options.environment,
    vpc: options.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: options.securityGroups,
    bundling: {
      minify: true,
      sourceMap: true,
      target: "es2022",
      format: OutputFormat.ESM,
      externalModules: ["@aws-sdk/*"],
      nodeModules: ["drizzle-orm", "postgres"],
      commandHooks: {
        afterBundling(inputDir: string, outputDir: string) {
          return [
            `mkdir -p ${outputDir}/drizzle/migrations`,
            `cp -r ${inputDir}/drizzle/migrations/* ${outputDir}/drizzle/migrations/`,
          ];
        },
        beforeBundling: () => [],
        beforeInstall: () => [],
      },
    },
  });

  options.secret.grantRead(migrationFn);

  const provider = new cr.Provider(scope, "MigrationProvider", {
    onEventHandler: migrationFn,
  });

  return new cdk.CustomResource(scope, "MigrationResource", {
    serviceToken: provider.serviceToken,
    properties: {
      // Force execution on every deploy
      timestamp: Date.now(),
    },
  });
}

// ── Scheduled Lambda (EventBridge) ──

export function createScheduledLambda(
  scope: Construct,
  id: string,
  options: {
    fn: NodejsFunction;
    schedule: events.Schedule;
  }
): events.Rule {
  const rule = new events.Rule(scope, `${id}Schedule`, {
    schedule: options.schedule,
  });
  rule.addTarget(new targets.LambdaFunction(options.fn));
  return rule;
}
```

### Cognito Auth Construct

User Pool with optional Apple/Google social login, plus Identity Pool for anonymous guests.

```typescript
// cdk/constructs/auth-construct.ts
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface AuthConstructProps {
  enableSocialLogin?: boolean;
}

export class AuthConstruct extends Construct {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly identityPool: cognito.CfnIdentityPool;

  constructor(scope: Construct, id: string, props: AuthConstructProps) {
    super(scope, id);

    // ── User Pool ──
    this.userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,

      // IMPORTANT: signInAliases cannot be changed after creation
      signInAliases: {
        email: true,
        phone: true,
        username: false,
      },

      autoVerify: { email: true, phone: true },

      standardAttributes: {
        email: { required: true, mutable: true },
        phoneNumber: { required: false, mutable: true },
        fullname: { required: false, mutable: true },
      },

      // Password policy — also immutable after creation
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },

      accountRecovery: cognito.AccountRecovery.EMAIL_AND_PHONE_WITHOUT_MFA,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      deletionProtection: false,
    });

    // Advanced security (audit mode)
    const cfnUserPool = this.userPool.node
      .defaultChild as cognito.CfnUserPool;
    cfnUserPool.addPropertyOverride("UserPoolAddOns", {
      AdvancedSecurityMode: "AUDIT",
    });

    // Cognito Domain (for Hosted UI)
    this.userPool.addDomain("Domain", {
      cognitoDomain: {
        domainPrefix: "my-app-auth", // must be globally unique
      },
    });

    // ── Identity Providers (optional) ──
    const identityProviders: cognito.UserPoolClientIdentityProvider[] = [
      cognito.UserPoolClientIdentityProvider.COGNITO,
    ];
    const providerDependencies: cognito.UserPoolIdentityProviderApple[] = [];

    if (props.enableSocialLogin) {
      // Apple Sign In
      const appleProvider =
        new cognito.UserPoolIdentityProviderApple(this, "AppleIdp", {
          userPool: this.userPool,
          clientId: "com.yourcompany.app.auth", // Apple Services ID
          teamId: "YOUR_TEAM_ID",
          keyId: "YOUR_KEY_ID",
          privateKey: "PLACEHOLDER", // Set real key in Secrets Manager
          scopes: ["email", "name"],
          attributeMapping: {
            email: cognito.ProviderAttribute.APPLE_EMAIL,
            fullname: cognito.ProviderAttribute.APPLE_NAME,
          },
        });
      identityProviders.push(
        cognito.UserPoolClientIdentityProvider.custom("SignInWithApple")
      );
      providerDependencies.push(appleProvider);

      // Google Sign In
      const googleProvider =
        new cognito.UserPoolIdentityProviderGoogle(this, "GoogleIdp", {
          userPool: this.userPool,
          clientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
          clientSecretValue: cdk.SecretValue.unsafePlainText(
            "YOUR_GOOGLE_CLIENT_SECRET"
          ),
          scopes: ["email", "profile", "openid"],
          attributeMapping: {
            email: cognito.ProviderAttribute.GOOGLE_EMAIL,
            fullname: cognito.ProviderAttribute.GOOGLE_NAME,
          },
        });
      identityProviders.push(
        cognito.UserPoolClientIdentityProvider.custom("Google")
      );
      providerDependencies.push(googleProvider as any);
    }

    // ── App Client ──
    this.userPoolClient = this.userPool.addClient("IOSClient", {
      generateSecret: false, // iOS does not use client secrets

      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),

      enableTokenRevocation: true,
      preventUserExistenceErrors: true,

      // IMPORTANT: must include COGNITO or Hosted UI shows a selection page
      supportedIdentityProviders: identityProviders,

      authFlows: {
        userPassword: true,
        userSrp: true,
      },

      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN, // Required for account deletion
        ],
        callbackUrls: ["myapp://callback"],
        logoutUrls: ["myapp://signout"],
      },
    });

    // Ensure App Client is created after Identity Providers
    for (const dep of providerDependencies) {
      this.userPoolClient.node.addDependency(dep);
    }

    // ── Identity Pool (anonymous + authenticated) ──
    this.identityPool = new cognito.CfnIdentityPool(this, "IdentityPool", {
      allowUnauthenticatedIdentities: true,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
        },
      ],
    });

    // Unauthenticated (anonymous) role
    const unauthRole = new iam.Role(this, "CognitoUnauthRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "unauthenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    // Authenticated role
    const authRole = new iam.Role(this, "CognitoAuthRole", {
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    // Attach roles to Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(
      this,
      "IdentityPoolRoleAttachment",
      {
        identityPoolId: this.identityPool.ref,
        roles: {
          unauthenticated: unauthRole.roleArn,
          authenticated: authRole.roleArn,
        },
      }
    );

    // ── Outputs ──
    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      description: "Cognito User Pool ID",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "Cognito App Client ID",
    });

    new cdk.CfnOutput(this, "IdentityPoolId", {
      value: this.identityPool.ref,
      description: "Cognito Identity Pool ID",
    });
  }
}
```

### API Gateway Construct

HTTP API with JWT Authorizer. Public routes (health check, webhooks) bypass authentication.

```typescript
// cdk/constructs/api-construct.ts
import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";

export interface ApiConstructProps {
  userPool: cognito.UserPool;
  userPoolClient: cognito.UserPoolClient;
  appRunnerUrl: string;
}

export class ApiConstruct extends Construct {
  public readonly httpApi: apigatewayv2.HttpApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    // HTTP API
    this.httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    // JWT Authorizer
    const stack = cdk.Stack.of(this);
    const jwtAuthorizer =
      new apigatewayv2Authorizers.HttpJwtAuthorizer(
        "CognitoJwtAuthorizer",
        `https://cognito-idp.${stack.region}.amazonaws.com/${props.userPool.userPoolId}`,
        {
          jwtAudience: [props.userPoolClient.userPoolClientId],
          identitySource: ["$request.header.Authorization"],
        }
      );

    // Public routes (no auth required)
    const publicPaths = [
      { path: "/health", methods: [apigatewayv2.HttpMethod.GET] },
      {
        path: "/v1/subscriptions/webhook",
        methods: [apigatewayv2.HttpMethod.POST],
      },
    ];

    publicPaths.forEach(({ path, methods }) => {
      this.httpApi.addRoutes({
        path,
        methods,
        integration: new apigatewayv2Integrations.HttpUrlIntegration(
          `${path.replace(/\//g, "")}Integration`,
          `${props.appRunnerUrl}${path}`
        ),
      });
    });

    // Protected routes (JWT required) — catch-all proxy
    this.httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new apigatewayv2Integrations.HttpUrlIntegration(
        "ProxyIntegration",
        `${props.appRunnerUrl}/{proxy}`
      ),
      authorizer: jwtAuthorizer,
    });

    // Outputs
    new cdk.CfnOutput(this, "ApiUrl", {
      value: this.httpApi.apiEndpoint,
      description: "API Gateway endpoint URL",
    });
  }
}
```

### Secrets Management

Use the "create" pattern instead of "reference" pattern. CDK creates the secret with placeholders, and you update the real values manually after the first deploy.

```typescript
// In your stack or a dedicated construct
import * as cdk from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

// Create with placeholder values
const appSecret = new secretsmanager.Secret(this, "AppSecret", {
  secretName: "my-app/secrets",
  description: "Application secrets (API keys, OAuth credentials)",
  secretObjectValue: {
    AUTH_APPLE_PRIVATE_KEY: cdk.SecretValue.unsafePlainText("PLACEHOLDER"),
    AUTH_GOOGLE_CLIENT_SECRET: cdk.SecretValue.unsafePlainText("PLACEHOLDER"),
    OPENAI_API_KEY: cdk.SecretValue.unsafePlainText("PLACEHOLDER"),
  },
});
```

**CRITICAL**: Never change the placeholder text after the first deploy. If you change it, CDK will overwrite your real secrets with the new placeholder value.

After the first deploy, update with real values:

```bash
aws secretsmanager put-secret-value \
  --secret-id my-app/secrets \
  --secret-string '{
    "AUTH_APPLE_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
    "AUTH_GOOGLE_CLIENT_SECRET": "GOCSPX-xxxxx",
    "OPENAI_API_KEY": "sk-proj-xxxxx"
  }' \
  --profile wei --region us-east-1
```

## Integration Checklist

### 1. AWS Account Setup

```bash
# Install AWS CLI
brew install awscli

# Configure a named profile
aws configure --profile wei
# Enter: Access Key ID, Secret Access Key, region (us-east-1), output (json)

# Verify access
aws sts get-caller-identity --profile wei
```

### 2. CDK Bootstrap (one-time per account/region)

```bash
# Bootstrap CDK in your account
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1 --profile wei
```

### 3. GitHub Connection (for App Runner auto-deploy)

1. Open AWS Console > App Runner > GitHub connections
2. Click "Add new" and authorize your GitHub account
3. Copy the Connection ARN into `cdk.json`

### 4. First Deploy (two-step for social login)

```bash
# Step 1: Deploy without social login to create Secrets
# Set in cdk.json: "enableSocialLogin": "false"
npm run cdk:deploy

# Step 2: Update secrets with real values
aws secretsmanager put-secret-value \
  --secret-id my-app/secrets \
  --secret-string '{"AUTH_APPLE_PRIVATE_KEY":"...","AUTH_GOOGLE_CLIENT_SECRET":"..."}' \
  --profile wei --region us-east-1

# Step 3: Enable social login and redeploy
# Set in cdk.json: "enableSocialLogin": "true"
npm run cdk:deploy
```

### 5. Subsequent Deploys

```bash
# Preview changes
npm run cdk:diff

# Deploy
npm run cdk:deploy
```

## Common Customizations

### Adding S3 File Storage

```typescript
import * as s3 from "aws-cdk-lib/aws-s3";

const bucket = new s3.Bucket(this, "FileStorage", {
  bucketName: "my-app-files",
  removalPolicy: cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: true, // dev only
  cors: [
    {
      allowedMethods: [
        s3.HttpMethods.GET,
        s3.HttpMethods.PUT,
        s3.HttpMethods.POST,
      ],
      allowedOrigins: ["*"],
      allowedHeaders: ["*"],
    },
  ],
  lifecycleRules: [
    {
      // Auto-delete temporary uploads after 7 days
      prefix: "tmp/",
      expiration: cdk.Duration.days(7),
    },
  ],
});

// Grant App Runner access
bucket.grantReadWrite(instanceRole);
```

### Adding SES Email Permissions

```typescript
instanceRole.addToPolicy(
  new iam.PolicyStatement({
    actions: ["ses:SendEmail", "ses:SendRawEmail"],
    resources: ["*"],
  })
);
```

### Multi-Environment Deployment

```typescript
// cdk/app.ts
const stage = app.node.tryGetContext("stage") || "dev";

new ProjectStack(app, `MyProject-${stage}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "us-east-1",
  },
  // Use stage to control settings
  enableAppRunner: true,
  enableDatabase: true,
  // ...
});

// Apply stage-specific tags
cdk.Tags.of(app).add("Stage", stage);
```

Deploy to different stages:

```bash
npx cdk deploy -c stage=dev
npx cdk deploy -c stage=prod
```

### Per-User S3 Access (Identity Pool)

```typescript
// Anonymous users can only access their own directory
unauthRole.addToPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
    resources: [
      `arn:aws:s3:::${bucket.bucketName}/guests/\${cognito-identity.amazonaws.com:sub}/*`,
    ],
  })
);

// Authenticated users get broader access
authRole.addToPolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ],
    resources: [
      `arn:aws:s3:::${bucket.bucketName}/users/\${cognito-identity.amazonaws.com:sub}/*`,
      `arn:aws:s3:::${bucket.bucketName}`,
    ],
  })
);
```

### RDS Data API for Development Debugging

When `enableDataApi: true` is set on the Aurora cluster, you can query the database directly from your local machine without VPN or Bastion Host:

```bash
# Get ARNs from CDK outputs
CLUSTER_ARN="arn:aws:rds:us-east-1:123456789:cluster:my-aurora-cluster"
SECRET_ARN="arn:aws:secretsmanager:us-east-1:123456789:secret:my-db-creds-xxxxx"

# Run SQL queries
aws rds-data execute-statement \
  --resource-arn "$CLUSTER_ARN" \
  --secret-arn "$SECRET_ARN" \
  --database app_database \
  --sql "SELECT * FROM users LIMIT 10" \
  --profile wei --region us-east-1
```

Disable Data API in production — it increases attack surface and is slower than RDS Proxy.

## Known Pitfalls

### 1. App Runner Cannot Reach RDS Proxy

**Symptom**: Connection timeout or refused.

**Cause**: Security group rules are missing or misconfigured.

**Fix**: Ensure the RDS Proxy security group allows inbound traffic from the App Runner security group on port 5432.

```typescript
proxySecurityGroup.addIngressRule(
  appRunnerSecurityGroup,
  ec2.Port.tcp(5432),
  "Allow App Runner to connect to RDS Proxy"
);
```

### 2. Lambda Cannot Access Secrets Manager

**Symptom**: `getaddrinfo ENOTFOUND secretsmanager.*.amazonaws.com`

**Cause**: Lambda is in a private subnet with no route to AWS service endpoints.

**Fix**: Add a VPC endpoint for Secrets Manager, or ensure your VPC has a NAT Gateway.

```typescript
vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
  service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
});
```

### 3. CDK Deploy Stuck on Custom Resource

**Symptom**: Deployment hangs at `CREATE_IN_PROGRESS` for 60+ minutes.

**Cause**: The Lambda backing the Custom Resource timed out (network issues) or threw an unhandled error (no CloudFormation response sent).

**Fix**:
1. Check Lambda logs in CloudWatch > Log groups
2. Verify the Lambda has correct VPC/subnet/security-group configuration
3. Increase Lambda timeout
4. Ensure the migration code properly handles CloudFormation callback responses

### 4. Cognito signInAliases Cannot Be Modified

**Symptom**: `Updates are not allowed for property - UsernameAttributes`

**Cause**: Cognito User Pool `signInAliases` and `passwordPolicy` are immutable after creation.

**Fix**: Delete and recreate the User Pool, or plan your initial configuration carefully to include all login methods you might need.

### 5. App Runner Build Fails

**Symptom**: `Build failed` in App Runner deployment logs.

**Common causes**:
- Missing `--include=dev` in build command (TypeScript compiler is a devDependency)
- Wrong Node.js runtime version
- Missing environment variables during build

**Fix**:
```typescript
codeConfigurationValues: {
  runtime: apprunner.Runtime.NODEJS_22,
  buildCommand: "npm ci --include=dev && npm run build",
  startCommand: "node dist/src/server.js",
}
```

### 6. TypeScript Path Aliases Fail in Production

**Symptom**: Works locally, but `Cannot find module '@/xxx'` after deployment.

**Cause**: TypeScript `paths` are only for type checking. esbuild and the Node.js runtime do not resolve them.

**Fix**: Use relative imports instead of path aliases.

```typescript
// Avoid
import { db } from "@/db/client";

// Use relative paths
import { db } from "../db/client";
```

### 7. CDK Overwrites Your Real Secrets

**Symptom**: After `cdk deploy`, your API keys in Secrets Manager are replaced with "PLACEHOLDER".

**Cause**: You changed the placeholder text in your CDK code, so CDK detected a diff and applied it.

**Fix**: Never modify the placeholder values in `secretObjectValue` after the initial deploy. The placeholders exist only so CDK can create the secret — you update real values manually via the AWS CLI.

### 8. API Gateway Returns 401

**Symptom**: Authenticated requests are rejected.

**Checklist**:
1. Is the JWT token expired? (default: 1 hour)
2. Does the token come from the correct User Pool?
3. Does `jwtAudience` match the App Client ID?
4. Is the header format correct? `Authorization: Bearer <token>`

### 9. Cost Awareness

| Resource | Dev Config | Estimated Monthly Cost |
|----------|-----------|----------------------|
| NAT Gateway | 1 instance | ~$32 |
| Aurora Serverless v2 | 0.5-2 ACU | ~$43 |
| App Runner | 0.25 vCPU / 0.5 GB | ~$5 |
| Secrets Manager | 1 secret | ~$0.40 |
| **Total** | | **~$80/mo** |

To minimize cost during development:

```typescript
natGateways: 1,                              // Single NAT Gateway
serverlessV2MinCapacity: 0.5,                // Minimum Aurora capacity
cpu: apprunner.Cpu.QUARTER_VCPU,             // Smallest App Runner
memory: apprunner.Memory.HALF_GB,
removalPolicy: cdk.RemovalPolicy.DESTROY,    // Easy cleanup
deletionProtection: false,
```

### Production Readiness Checklist

- [ ] `deletionProtection: true` on Aurora and Cognito
- [ ] `removalPolicy: cdk.RemovalPolicy.RETAIN` on database and secrets
- [ ] Multi-AZ deployment: `natGateways: 2`
- [ ] Aurora backup: `retention: cdk.Duration.days(30)`
- [ ] CloudWatch alarms for error rates and latency
- [ ] VPC Flow Logs enabled
- [ ] Secrets rotation configured
- [ ] `enableDataApi: false` on Aurora cluster
