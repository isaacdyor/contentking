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
      handler: "worker.handler",
      memory: "2 GB",
      timeout: "15 minutes",
      link: [bucket, processingJobsTable],
      nodejs: { install: ["ffmpeg-static"] },
    });

    const apiFunction = new sst.aws.Function("ApiFunction", {
      url: true,
      handler: "index.handler",
      link: [bucket, processingJobsTable, workerFunction],
    });

    return {
      url: apiFunction.url,
    };
  },
});
