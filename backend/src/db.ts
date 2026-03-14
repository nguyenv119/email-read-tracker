import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { EmailTrackingRecord, OpenEvent } from "@mailtrack/shared";

const client = new DynamoDBClient({});
export const docClient = DynamoDBDocumentClient.from(client);

function getTableName(): string {
  const tableName = process.env["TABLE_NAME"];
  if (!tableName) {
    throw new Error(
      "Missing required environment variable: TABLE_NAME must be set"
    );
  }
  return tableName;
}

/** Write a new EmailTrackingRecord to DynamoDB. */
export async function putRecord(record: EmailTrackingRecord): Promise<void> {
  const tableName = getTableName();
  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: record,
    })
  );
}

/** Retrieve an EmailTrackingRecord by pixel_id. Returns undefined if not found. */
export async function getRecord(
  pixelId: string
): Promise<EmailTrackingRecord | undefined> {
  const tableName = getTableName();
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { pixel_id: pixelId },
    })
  );
  return result.Item as EmailTrackingRecord | undefined;
}

/** Scan the full table and return all EmailTrackingRecords, paginating through all pages. */
export async function scanRecords(): Promise<EmailTrackingRecord[]> {
  const tableName = getTableName();
  const allItems: EmailTrackingRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;

  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );
    if (result.Items) {
      allItems.push(...(result.Items as EmailTrackingRecord[]));
    }
    lastEvaluatedKey = result.LastEvaluatedKey as
      | Record<string, unknown>
      | undefined;
  } while (lastEvaluatedKey !== undefined);

  return allItems;
}

/** Append an OpenEvent to the opens list for the given pixel_id. */
export async function updateOpens(
  pixelId: string,
  openEvent: OpenEvent
): Promise<void> {
  const tableName = getTableName();
  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { pixel_id: pixelId },
      UpdateExpression:
        "SET opens = list_append(if_not_exists(opens, :empty), :newOpen)",
      ExpressionAttributeValues: {
        ":newOpen": [openEvent],
        ":empty": [],
      },
    })
  );
}
