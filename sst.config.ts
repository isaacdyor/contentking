/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "contentking",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    const deepgramAccessToken = new sst.Secret("DeepgramAccessToken");
    const anthropicApiKey = new sst.Secret("AnthropicApiKey");
    const exaApiKey = new sst.Secret("ExaApiKey");

    const bucket = new sst.aws.Bucket("MyBucket");

    const processingJobsTable = new sst.aws.Dynamo("ProcessingJobs", {
      fields: {
        jobId: "string",
      },
      primaryIndex: {
        hashKey: "jobId",
      },
    });

    const workerFunction = new sst.aws.Function("WorkerFunction", {
      memory: "2 GB",
      timeout: "15 minutes",
      handler: "src/worker.handler",
      link: [bucket, processingJobsTable, deepgramAccessToken, anthropicApiKey],
      environment: {
        BUCKET_NAME: bucket.name,
        TABLE_NAME: processingJobsTable.name,
      },
      copyFiles: [{ from: "fonts", to: "fonts" }],

      nodejs: { install: ["ffmpeg-static"] },
      retries: 0,
    });

    const func = new sst.aws.Function("MyFunction", {
      url: true,
      handler: "src/index.handler",
      link: [
        bucket,
        processingJobsTable,
        workerFunction,
        anthropicApiKey,
        exaApiKey,
      ],
      environment: {
        BUCKET_NAME: bucket.name,
        TABLE_NAME: processingJobsTable.name,
        WORKER_FUNCTION_NAME: workerFunction.name,
      },
      retries: 0,
    });

    return {
      url: func.url,
    };
  },
});
