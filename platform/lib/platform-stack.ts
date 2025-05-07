import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { compileBundles } from './process/setup';

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
    // const enableDevelopment = {
    //   target: 'dev',
    // };

    // TODO: LambdaLeyer + NodejsFunction では zip 化する前のサイズが制限を超えてしまうため Docker イメージとしてデプロイする
    // const webAdapter = cdk.aws_lambda.LayerVersion
    //   .fromLayerVersionArn(
    //     this,
    //     'LayerVersion',
    //     `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerArm64:25`);

    const functionName = 'mastra-agent';

    const logGroup = new cdk.aws_logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: cdk.aws_logs.RetentionDays.ONE_DAY,
    });
    const fn = new cdk.aws_lambda.DockerImageFunction(this, 'Lambda', {
      functionName,
      architecture: cdk.aws_lambda.Architecture.ARM_64,
      code: cdk.aws_lambda.DockerImageCode.fromImageAsset('.', {
        platform: cdk.aws_ecr_assets.Platform.LINUX_ARM64,
        // target: 'dev'
      }),
      retryAttempts: 0,
      logGroup,
      environment: {
        // Lambda Web Adapter の設定
        // AWS_LWA_INVOKE_MODE: 'response_stream',
        RUST_LOG: 'info',
        PORT: '3000',
        ...langfuseCredentials,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      // bundling: {
      //   commandHooks: {
      //     afterBundling: (inputDir: string, outputDir: string) => [
      //       `cp -pR ${inputDir}/platform/.mastra/output ${outputDir}/.mastra/`,
      //       `cp ${inputDir}/platform/src/run.sh ${outputDir}`,
      //     ],
      //     beforeInstall(): string[] {
      //       return [''];
      //     },
      //     beforeBundling(): string[] {
      //       return [''];
      //     },
      //   },
      //   externalModules: [
      //   // Lambda レイヤーで提供されるモジュールは除外できる（オプション）
      //     '/opt/nodejs/node_modules/aws-lambda-web-adapter',

      //     'dotenv',
      //   ],
      //   nodeModules: ['express'], // 依存関係を指定
      //   // minify: true, // コードの最小化
      //   sourceMap: true, // ソースマップを有効化（デバッグ用）
      //   keepNames: true,
      //   format: cdk.aws_lambda_nodejs.OutputFormat.ESM,
      //   banner: 'import { createRequire } from \'module\';const require = createRequire(import.meta.url);',
      // },
      loggingFormat: cdk.aws_lambda.LoggingFormat.JSON,
      role: new cdk.aws_iam.Role(this, 'FunctionExecutionRole', {
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
        },
      }),

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

    // CloudFront Functionリソースの定義
    compileBundles();

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

    new cdk.aws_cloudfront.Distribution(this, 'CloudFront', {
      comment: 'Mastra AI Agent Client',
      defaultBehavior: {
        origin: cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(s3bucket, {
          originAccessControl: oac,
        }),
        compress: true,
        functionAssociations,
        allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cdk.aws_cloudfront.CachePolicy.CACHING_OPTIMIZED,
        cachedMethods: cdk.aws_cloudfront.CachedMethods.CACHE_GET_HEAD,
        viewerProtocolPolicy:
          cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        ['/agent/*']: {
          origin: new cdk.aws_cloudfront_origins.FunctionUrlOrigin(fn.addFunctionUrl({
            authType: cdk.aws_lambda.FunctionUrlAuthType.AWS_IAM,
            invokeMode: cdk.aws_lambda.InvokeMode.RESPONSE_STREAM,
          }),
          {
            originId: 'lambda',
            readTimeout: cdk.Duration.minutes(1),
          }),
          viewerProtocolPolicy: cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cdk.aws_cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_ALL,
          originRequestPolicy: cdk.aws_cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: new cdk.aws_cloudfront.ResponseHeadersPolicy(
            this,
            'ResponseHeadersPolicy',
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
    });

    // fn.addEnvironment('ALLOW_CORS_ORIGIN', `https://${distribution.distributionDomainName}`);

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
