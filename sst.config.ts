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
    const func = new sst.aws.Function("MyFunction", {
      url: true,
      memory: "2 GB",
      timeout: "15 minutes",
      handler: "index.handler",
      copyFiles: [{ from: "clip.mp4" }],
      nodejs: { install: ["ffmpeg-static"] },
    });

    return {
      url: func.url,
    };
  },
});
