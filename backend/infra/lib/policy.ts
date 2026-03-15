/**
 * Builds the IAM policy JSON for the Lambda execution role.
 *
 * Only the four DynamoDB actions actually used by db.ts are granted:
 * GetItem, PutItem, UpdateItem, Scan. DeleteItem and Query are intentionally
 * omitted to follow least-privilege — neither is called by the backend.
 */
export function buildDynamoDbPolicy(tableArn: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Scan",
        ],
        Resource: tableArn,
      },
    ],
  });
}
