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
      handler: "worker.handler",
      link: [bucket, processingJobsTable],
      environment: {
        BUCKET_NAME: bucket.name,
        TABLE_NAME: processingJobsTable.name,
      },
      nodejs: { install: ["ffmpeg-static"] },
    });

    const func = new sst.aws.Function("MyFunction", {
      url: true,
      handler: "index.handler",
      link: [bucket, processingJobsTable, workerFunction],
      environment: {
        BUCKET_NAME: bucket.name,
        TABLE_NAME: processingJobsTable.name,
        WORKER_FUNCTION_NAME: workerFunction.name,
      },
    });

    return {
      url: func.url,
    };
  },
});
