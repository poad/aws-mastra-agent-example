import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { compileCloudFrontBundles } from './process/setup-function.js';
import { compileClientBundles } from './process/setup-client.js';
import * as ecrdeploy from 'cdk-ecr-deployment';

function createLangfuseCredentials({
  langfuseEndpoint,
  langfusePublicKey,
  langfuseSecretKey,
}: {
  langfuseEndpoint?: string,
  langfusePublicKey?: string,
  langfuseSecretKey?: string,
}): Record<string, string> {
  if (langfuseEndpoint && langfusePublicKey && langfuseSecretKey) {
    return {
      LANGFUSE_ENDPOINT: langfuseEndpoint,
      LANGFUSE_PUBLIC_KEY: langfusePublicKey,
      LANGFUSE_SECRET_KEY: langfuseSecretKey,
    };
  }
  return {};
}

export class PlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const langfuseEndpoint = this.node.tryGetContext('langfuse-endpoint');
    const langfusePublicKey = this.node.tryGetContext('langfuse-public-key');
    const langfuseSecretKey = this.node.tryGetContext('langfuse-secret-key');
    const langfuseCredentials = createLangfuseCredentials({
      langfuseEndpoint,
      langfusePublicKey,
      langfuseSecretKey,
    });

    const s3bucket = new cdk.aws_s3.Bucket(this, 'S3Bucket', {
      bucketName: 'mastra-agent',
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      accessControl: cdk.aws_s3.BucketAccessControl.PRIVATE,
      publicReadAccess: false,
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
    });

    s3bucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['s3:*'],
        principals: [new cdk.aws_iam.AccountPrincipal(this.account)],
        resources: [`${s3bucket.bucketArn}/*`],
        conditions: {
          StringEquals: {
            's3:ResourceAccount': this.account,
          },
        },
      }),
    );

    const mcpFunctionName = 'mastra-agent-mcp-server';
    const mcpLogGroup = new cdk.aws_logs.LogGroup(this, 'McpLogGroup', {
      logGroupName: `/aws/lambda/${mcpFunctionName}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: cdk.aws_logs.RetentionDays.ONE_DAY,
    });

    const mcp = new cdk.aws_lambda_nodejs.NodejsFunction(this, 'McpServerLambda', {
      functionName: mcpFunctionName,
      architecture: cdk.aws_lambda.Architecture.ARM_64,
      runtime: cdk.aws_lambda.Runtime.NODEJS_22_X,
      entry: './lambda/mcp-server/index.ts',
      retryAttempts: 0,
      logGroup: mcpLogGroup,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      bundling: {
        // No externalModules since we want to bundle everything
        nodeModules: [
          '@modelcontextprotocol/sdk',
          'hono',
          'zod',
        ],
        externalModules: [
          'dotenv',
          '@hono/node-server',
        ],
        // minify: true, // コードの最小化
        sourceMap: true, // ソースマップを有効化（デバッグ用）
        keepNames: true,
        format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
        target: 'node22', // Target Node.js 22.x
        banner: 'import { createRequire } from \'module\';const require = createRequire(import.meta.url);',
      },
      loggingFormat: cdk.aws_lambda.LoggingFormat.JSON,
      applicationLogLevelV2: cdk.aws_lambda.ApplicationLogLevel.TRACE,
      systemLogLevelV2: cdk.aws_lambda.SystemLogLevel.INFO,
    });

    // API Gateway
    const api = new cdk.aws_apigateway.RestApi(this, 'MCPAPI', {
      restApiName: 'MCP API for Mastra Agent',
      description: 'API for MCP',
      defaultCorsPreflightOptions: {
        allowOrigins: cdk.aws_apigateway.Cors.ALL_ORIGINS,
        allowMethods: cdk.aws_apigateway.Cors.ALL_METHODS,
      },
      deployOptions: {
        stageName: 'v1',
      },
      endpointTypes: [cdk.aws_apigateway.EndpointType.REGIONAL],
    });

    const mcpResource = api.root.addResource('mcp');
    mcpResource.addMethod('ANY', new cdk.aws_apigateway.LambdaIntegration(mcp));


    const parameterName = 'mastra/agent/mcp-server-url';

    const functionName = 'mastra-agent';

    const logGroup = new cdk.aws_logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: cdk.aws_logs.RetentionDays.ONE_DAY,
    });

    const repo = new cdk.aws_ecr.Repository(this, 'EcrRepository', {
      repositoryName: 'mastra-agent-example',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        {
          maxImageCount: 1, // Keep only the latest image
        },
      ],
    });

    const assets = new cdk.aws_ecr_assets.DockerImageAsset(this, 'EcrImageAssets', {
      directory: '.',
      platform: cdk.aws_ecr_assets.Platform.LINUX_ARM64,
    });

    const deployment = new ecrdeploy.ECRDeployment(this, 'DeployDockerImage', {
      src: new ecrdeploy.DockerImageName(assets.imageUri),
      dest: new ecrdeploy.DockerImageName(`${this.account}.dkr.ecr.${this.region}.amazonaws.com/${repo.repositoryName}:latest`),
      imageArch: ['arm64'],
    });


    const fn = new cdk.aws_lambda.DockerImageFunction(this, 'Lambda', {
      functionName,
      architecture: cdk.aws_lambda.Architecture.ARM_64,
      code: cdk.aws_lambda.DockerImageCode.fromEcr(repo, {
        tag: assets.imageUri.split(':')[1], // Use the tag from the Docker image
      }),
      retryAttempts: 0,
      logGroup,
      environment: {
        // Lambda Web Adapter の設定
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_INVOKE_MODE: 'response_stream',
        RUST_LOG: 'info',
        PORT: '8080',
        AWS_LWA_PORT: '8080',
        AWS_LWA_REMOVE_BASE_PATH: '/agent',

        MCP_SERVER_ENDPOINT_URL: `${api.url}mcp`,
        ...langfuseCredentials,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      loggingFormat: cdk.aws_lambda.LoggingFormat.JSON,
      role: new cdk.aws_iam.Role(this, 'FunctionExecutionRole', {
        roleName: `${functionName}-execution-role`,
        assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AWSLambdaExecute'),
        ],
        inlinePolicies: {
          'bedrock-policy': new cdk.aws_iam.PolicyDocument({
            statements: [
              new cdk.aws_iam.PolicyStatement({
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                  'bedrock:InvokeModel*',
                  'logs:PutLogEvents',
                ],
                resources: ['*'],
              }),
            ],
          }),
          'ssm-policy': new cdk.aws_iam.PolicyDocument({
            statements: [
              new cdk.aws_iam.PolicyStatement({
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                  'ssm:GetParameter',
                  'ssm:GetParameters',
                  'ssm:GetParametersByPath',
                ],
                resources: [
                  `arn:aws:ssm:${this.region}:${this.account}:parameter/${parameterName}`,
                  `arn:aws:ssm:${this.region}:${this.account}:parameter/${parameterName}/*`,
                ],
              }),
            ],
          }),
        },
      }),
    });

    fn.node.addDependency(deployment);

    const functionUrl = fn.addFunctionUrl({
      authType: cdk.aws_lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: cdk.aws_lambda.InvokeMode.RESPONSE_STREAM,
    });


    // CloudFront Functionリソースの定義
    compileCloudFrontBundles();

    const websiteIndexPageForwardFunction = new cdk.aws_cloudfront.Function(this, 'WebsiteIndexPageForwardFunction', {
      functionName: 'mastra-client-index-forward',
      code: cdk.aws_cloudfront.FunctionCode.fromFile({
        filePath: 'function/index.js',
      }),
      runtime: cdk.aws_cloudfront.FunctionRuntime.JS_2_0,
    });
    const functionAssociations = [
      {
        eventType: cdk.aws_cloudfront.FunctionEventType.VIEWER_REQUEST,
        function: websiteIndexPageForwardFunction,
      },
    ];

    const oac = new cdk.aws_cloudfront.S3OriginAccessControl(this, 'OriginAccessControl', {
      originAccessControlName: 'mastra-client-oac',
      signing: cdk.aws_cloudfront.Signing.SIGV4_NO_OVERRIDE,
    });

    const lambdaOac = new cdk.aws_cloudfront.FunctionUrlOriginAccessControl(this, 'LambdaOriginAccessControl', {
      originAccessControlName: 'mastra-agent-api-oac',
      signing: cdk.aws_cloudfront.Signing.SIGV4_ALWAYS,
    });

    const cfDistribution = new cdk.aws_cloudfront.Distribution(this, 'CloudFront', {
      comment: 'Mastra AI Agent Client',
      defaultBehavior: {
        origin: cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(s3bucket, {
          originAccessControl: oac,
          originId: 's3',
        }),
        compress: true,
        functionAssociations,
        allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cdk.aws_cloudfront.CachePolicy.CACHING_DISABLED,
        viewerProtocolPolicy:
          cdk.aws_cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      },
      additionalBehaviors: {
        ['/agent/*']: {
          origin: cdk.aws_cloudfront_origins.FunctionUrlOrigin.withOriginAccessControl(
            functionUrl,
            {
              originId: 'lambda',
              readTimeout: cdk.Duration.minutes(1),
              originAccessControl: lambdaOac,
            },
          ),
          viewerProtocolPolicy: cdk.aws_cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cdk.aws_cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cdk.aws_cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: new cdk.aws_cloudfront.ResponseHeadersPolicy(
            this,
            'AgentResponseHeadersPolicy',
            {
              corsBehavior: {
                accessControlAllowOrigins: [
                  'http://localhost:4173',
                  'http://localhost:5173',
                ],
                accessControlAllowHeaders: ['*'],
                accessControlAllowMethods: ['ALL'],
                accessControlAllowCredentials: false,
                originOverride: true,
              },
            },
          ),
        },
      },
      httpVersion: cdk.aws_cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cdk.aws_cloudfront.PriceClass.PRICE_CLASS_200,
    });

    // Add permission Lambda Function URLs
    fn.addPermission('AllowCloudFrontServicePrincipalFunctionUrl', {
      principal: new cdk.aws_iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunctionUrl',
      sourceArn: `arn:aws:cloudfront::${cdk.Stack.of(this).account}:distribution/${cfDistribution.distributionId}`,
    });
    fn.addPermission('AllowCloudFrontServicePrincipal', {
      principal: new cdk.aws_iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cloudfront::${cdk.Stack.of(this).account}:distribution/${cfDistribution.distributionId}`,
    });

    compileClientBundles({});

    const deployRole = new cdk.aws_iam.Role(this, 'DeployWebsiteRole', {
      roleName: `${s3bucket.bucketName}-deploy-role`,
      assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        's3-policy': new cdk.aws_iam.PolicyDocument({
          statements: [
            new cdk.aws_iam.PolicyStatement({
              effect: cdk.aws_iam.Effect.ALLOW,
              actions: ['s3:*'],
              resources: [`${s3bucket.bucketArn}/`, `${s3bucket.bucketArn}/*`],
            }),
          ],
        }),
      },
    });

    new cdk.aws_s3_deployment.BucketDeployment(this, 'DeployWebsite', {
      sources: [cdk.aws_s3_deployment.Source.asset(`${process.cwd()}/../client/dist`)],
      destinationBucket: s3bucket,
      destinationKeyPrefix: '/',
      exclude: ['.DS_Store', '*/.DS_Store'],
      prune: true,
      retainOnDelete: false,
      role: deployRole,
    });
  }
}
