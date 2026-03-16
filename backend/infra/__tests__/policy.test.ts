import { describe, it, expect } from "vitest";
import { buildDynamoDbPolicy } from "../lib/policy.js";

describe("buildDynamoDbPolicy", () => {
  it("includes only the four required DynamoDB actions and excludes DeleteItem and Query", () => {
    /**
     * Verifies that the IAM policy for the Lambda role grants exactly the four
     * DynamoDB actions used in db.ts (GetItem, PutItem, UpdateItem, Scan) and
     * does not include DeleteItem or Query.
     *
     * This matters because IAM policies must follow least-privilege. Including
     * DeleteItem allows the Lambda to permanently destroy tracking records that
     * can never be recovered, and Query grants GSI access patterns that don't
     * exist on this table. Over-permissioning is a security audit finding.
     *
     * If this contract breaks, the deployed Lambda has delete permission on the
     * DynamoDB table, enabling accidental or malicious data loss.
     */
    const arn = "arn:aws:dynamodb:us-east-1:123456789012:table/email-tracking";
    const policyJson = buildDynamoDbPolicy(arn);
    const policy = JSON.parse(policyJson) as {
      Version: string;
      Statement: Array<{
        Effect: string;
        Action: string[];
        Resource: string;
      }>;
    };

    const actions = policy.Statement[0]!.Action;

    // Required actions must be present
    expect(actions).toContain("dynamodb:GetItem");
    expect(actions).toContain("dynamodb:PutItem");
    expect(actions).toContain("dynamodb:UpdateItem");
    expect(actions).toContain("dynamodb:Scan");

    // Over-permissioned actions must not be present
    expect(actions).not.toContain("dynamodb:DeleteItem");
    expect(actions).not.toContain("dynamodb:Query");
  });

  it("scopes the policy Resource to the provided table ARN", () => {
    /**
     * Verifies that the IAM policy restricts the allowed actions to the
     * specific table ARN passed in, not all DynamoDB tables (i.e., not "*").
     *
     * This matters because a Resource of "*" would grant the Lambda permission
     * to read/write any DynamoDB table in the account, not just the
     * email-tracking table.
     *
     * If this contract breaks, a compromised Lambda function could read or
     * modify any DynamoDB data in the AWS account.
     */
    const arn = "arn:aws:dynamodb:us-east-1:123456789012:table/email-tracking";
    const policyJson = buildDynamoDbPolicy(arn);
    const policy = JSON.parse(policyJson) as {
      Statement: Array<{ Resource: string }>;
    };

    expect(policy.Statement[0]!.Resource).toBe(arn);
    expect(policy.Statement[0]!.Resource).not.toBe("*");
  });

  it("produces a valid JSON document with Version 2012-10-17", () => {
    /**
     * Verifies that the policy output is valid JSON parseable as an IAM policy
     * document with the correct Version string that AWS requires.
     *
     * This matters because IAM rejects policy documents with an incorrect or
     * missing Version field. A malformed policy would prevent the Lambda from
     * accessing DynamoDB at all, causing all tracking requests to fail with
     * access denied errors.
     *
     * If this contract breaks, the Pulumi deploy succeeds but Lambda DynamoDB
     * calls fail with AccessDeniedException and all tracking data is lost.
     */
    const policyJson = buildDynamoDbPolicy("arn:aws:dynamodb:::table/test");

    let policy: { Version: string };
    expect(() => {
      policy = JSON.parse(policyJson) as { Version: string };
    }).not.toThrow();

    expect(policy!.Version).toBe("2012-10-17");
  });
});
