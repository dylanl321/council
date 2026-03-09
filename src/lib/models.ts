import { ChatBedrockConverse } from "@langchain/aws";

export const model = new ChatBedrockConverse({
  model: "us.anthropic.claude-opus-4-6-v1",
  region: "us-east-1",
  streaming: true,
  maxTokens: 1000,
});

export const shortModel = new ChatBedrockConverse({
  model: "us.anthropic.claude-opus-4-6-v1",
  region: "us-east-1",
  streaming: true,
  maxTokens: 500,
});
