ARG BUILDPLATFORM=linux/arm64
ARG TARGETPLATFORM=linux/arm64
ARG TARGETARCH=arm64

ARG NODE_VERSION=22

FROM --platform=$BUILDPLATFORM node:$NODE_VERSION-slim AS build

RUN npm install -g bun pnpm
WORKDIR /build
COPY package.json ./

RUN pnpm i
COPY . ./

RUN bun run mastra build


FROM --platform=$BUILDPLATFORM amazon/aws-lambda-nodejs:$NODE_VERSION-${TARGETARCH//amd64/x86_64} AS dev

RUN npm install -g pnpm

WORKDIR /work
COPY package.json ./

RUN pnpm i

COPY . ./

ENV PORT=8080

ENTRYPOINT ["pnpm", "dev"]


FROM --platform=$BUILDPLATFORM amazon/aws-lambda-nodejs:$NODE_VERSION-${TARGETARCH//amd64/x86_64}

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter

COPY --from=build /build /var/task

WORKDIR "/var/task"

ENV PORT=8080

ENTRYPOINT [ "node", "--import=./.mastra/output/instrumentation.mjs", ".mastra/output/index.mjs" ]
