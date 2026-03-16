import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as path from "path";
import { buildDynamoDbPolicy } from "./lib/policy";

// DynamoDB table for email tracking records.
// PK: pixel_id (string). PAY_PER_REQUEST billing avoids capacity planning
// for a low-volume personal tracker.
const table = new aws.dynamodb.Table("email-tracking", {
  name: "email-tracking",
  billingMode: "PAY_PER_REQUEST",
  attributes: [
    { name: "pixel_id", type: "S" },
  ],
  hashKey: "pixel_id",
});

// IAM role assumed by the Lambda runtime.
const lambdaRole = new aws.iam.Role("lambda-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
});

// Attach AWS-managed basic execution policy (CloudWatch logs).
new aws.iam.RolePolicyAttachment("lambda-basic-execution", {
  role: lambdaRole.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});

// Inline policy granting least-privilege access to the tracking table.
// Only the four actions used by db.ts are included; DeleteItem and Query
// are omitted — they are not called and granting them violates least-privilege.
new aws.iam.RolePolicy("lambda-dynamodb-policy", {
  role: lambdaRole.id,
  policy: table.arn.apply(buildDynamoDbPolicy),
});

// Lambda function bundled from backend/dist/index.js.
// The asset path is relative to the Pulumi project root (backend/infra/),
// so ../dist points to backend/dist/.
const lambda = new aws.lambda.Function("email-tracker", {
  name: "email-tracker",
  runtime: aws.lambda.Runtime.NodeJS20dX,
  handler: "index.handler",
  role: lambdaRole.arn,
  code: new pulumi.asset.FileArchive(path.join(__dirname, "..", "dist")),
  environment: {
    variables: {
      TABLE_NAME: table.name,
    },
  },
});

// Lambda Function URL with no auth so the tracking pixel can be fetched
// by any mail client without AWS credentials.
const functionUrl = new aws.lambda.FunctionUrl("email-tracker-url", {
  functionName: lambda.name,
  authorizationType: "NONE",
});

// Stack output consumed by downstream stacks and the extension config.
export const url = functionUrl.functionUrl;
