import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

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
    });

    new cdk.aws_lambda.FunctionUrl(this, 'FunctionUrl', {
      function: fn,
      authType: cdk.aws_lambda.FunctionUrlAuthType.NONE,
    });
  }
}
