import path from 'node:path';
import cdk from 'aws-cdk-lib';
import lambda from 'aws-cdk-lib/aws-lambda';
import nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import logs from 'aws-cdk-lib/aws-logs';
import s3 from 'aws-cdk-lib/aws-s3';
import s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import scheduler from 'aws-cdk-lib/aws-scheduler';
import targets from 'aws-cdk-lib/aws-scheduler-targets';
import type { Construct } from 'constructs';
import { type IssuerKind, LIVE_RECORD_PREFIX, PROBE_OBJECT_KEY, RECORD_PREFIX } from '../src/lib/record.ts';

/** 常時起動用の発行Lambdaを呼ぶ間隔（実行環境を起動させたままにする） */
const WARM_ISSUE_INTERVAL = cdk.Duration.minutes(5);

/** コールドスタート用の発行Lambdaを呼ぶ間隔（毎回ほぼ新しい実行環境になるよう空ける） */
const COLD_ISSUE_INTERVAL = cdk.Duration.hours(1);

/** 確認Lambdaを呼ぶ間隔（失効時刻の精度になる） */
const CHECK_INTERVAL = cdk.Duration.minutes(5);

/** 計測用Lambdaのメモリ（MB） */
const FUNCTION_MEMORY_SIZE_MB = 256;

/** 発行Lambdaのタイムアウト（URLの署名と記録1件の書き込みだけ） */
const ISSUER_TIMEOUT = cdk.Duration.seconds(30);

/** 確認Lambdaのタイムアウト（確認中のURLを20件ずつ、1件あたり最大10秒でGETする） */
const CHECKER_TIMEOUT = cdk.Duration.minutes(2);

/** 計測用Lambdaの共通設定 */
const FUNCTION_DEFAULTS = {
  runtime: lambda.Runtime.NODEJS_24_X,
  architecture: lambda.Architecture.ARM_64,
  memorySize: FUNCTION_MEMORY_SIZE_MB,
  // 失敗時に再試行すると、同じ呼び出しで2本目のURLを発行したり確認が重なったりするため再試行しない
  retryAttempts: 0,
  bundling: {
    // ランタイム同梱のSDKではなく、lockファイルで固定したバージョンを同梱する
    externalModules: [],
  },
} satisfies Partial<nodejs.NodejsFunctionProps>;

/** ロググループの保持期間 */
const LOG_RETENTION = logs.RetentionDays.TWO_WEEKS;

/**
 * 署名付きURLの有効期間を計測するためのスタック
 *
 * @description 発行Lambda（常時起動用・コールドスタート用）が署名付きURLを発行してバケットに記録し、
 * 確認Lambdaが5分おきにGETして、失敗した時刻を失効時刻として記録する
 */
export class PresignedUrlLifetimeStack extends cdk.Stack {
  /**
   * スタックを作る
   *
   * @param scope - 親コンストラクト
   * @param id - スタックID
   * @param props - スタックのプロパティ
   */
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'Bucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    new s3deploy.BucketDeployment(this, 'ProbeObject', {
      destinationBucket: bucket,
      sources: [s3deploy.Source.data(PROBE_OBJECT_KEY, 'probe')],
      // 既定の prune: true だと、デプロイし直したときに記録まで消えてしまう
      prune: false,
      logGroup: this.createLogGroup('ProbeObjectLogs'),
    });

    const warmIssuer = this.createIssuer('WarmIssuer', 'warm', bucket);
    const coldIssuer = this.createIssuer('ColdIssuer', 'cold', bucket);

    const checker = new nodejs.NodejsFunction(this, 'Checker', {
      ...FUNCTION_DEFAULTS,
      entry: path.join(import.meta.dirname, '../src/handlers/check.ts'),
      timeout: CHECKER_TIMEOUT,
      environment: { BUCKET_NAME: bucket.bucketName },
      logGroup: this.createLogGroup('CheckerLogs'),
    });
    bucket.grantRead(checker, `${RECORD_PREFIX}*`);
    bucket.grantPut(checker, `${RECORD_PREFIX}*`);
    bucket.grantDelete(checker, `${LIVE_RECORD_PREFIX}*`);

    new scheduler.Schedule(this, 'WarmIssuerSchedule', {
      schedule: scheduler.ScheduleExpression.rate(WARM_ISSUE_INTERVAL),
      target: new targets.LambdaInvoke(warmIssuer, { retryAttempts: 0 }),
    });
    new scheduler.Schedule(this, 'ColdIssuerSchedule', {
      schedule: scheduler.ScheduleExpression.rate(COLD_ISSUE_INTERVAL),
      target: new targets.LambdaInvoke(coldIssuer, { retryAttempts: 0 }),
    });
    new scheduler.Schedule(this, 'CheckerSchedule', {
      schedule: scheduler.ScheduleExpression.rate(CHECK_INTERVAL),
      target: new targets.LambdaInvoke(checker, { retryAttempts: 0 }),
    });

    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'WarmIssuerName', { value: warmIssuer.functionName });
    new cdk.CfnOutput(this, 'ColdIssuerName', { value: coldIssuer.functionName });
    new cdk.CfnOutput(this, 'CheckerName', { value: checker.functionName });
  }

  /**
   * 発行Lambdaを作る
   *
   * @param id - コンストラクトID
   * @param issuerKind - 発行Lambdaの種類
   * @param bucket - 固定オブジェクトと記録を置くバケット
   * @returns 発行Lambda
   */
  private createIssuer(id: string, issuerKind: IssuerKind, bucket: s3.IBucket): nodejs.NodejsFunction {
    const issuer = new nodejs.NodejsFunction(this, id, {
      ...FUNCTION_DEFAULTS,
      entry: path.join(import.meta.dirname, '../src/handlers/issue.ts'),
      timeout: ISSUER_TIMEOUT,
      environment: { BUCKET_NAME: bucket.bucketName, ISSUER_KIND: issuerKind },
      logGroup: this.createLogGroup(`${id}Logs`),
    });
    // 署名付きURLは発行したロールの権限で評価されるため、固定オブジェクトの読み取り権限が要る
    bucket.grantRead(issuer, PROBE_OBJECT_KEY);
    bucket.grantPut(issuer, `${LIVE_RECORD_PREFIX}*`);
    return issuer;
  }

  /**
   * スタック削除時に一緒に消えるロググループを作る
   *
   * @param id - コンストラクトID
   * @returns ロググループ
   */
  private createLogGroup(id: string): logs.LogGroup {
    return new logs.LogGroup(this, id, {
      retention: LOG_RETENTION,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
