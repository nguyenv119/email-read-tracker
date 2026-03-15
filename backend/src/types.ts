/**
 * Minimal Lambda Function URL event shape.
 * The full type is in @types/aws-lambda but we avoid that dep to keep the bundle small.
 */
export interface LambdaUrlEvent {
  rawPath: string;
  requestContext: {
    http: {
      method: string;
      sourceIp?: string;
    };
  };
  headers?: Record<string, string>;
  body?: string | null;
  isBase64Encoded?: boolean;
}

/** Response shape expected by Lambda Function URL. */
export interface LambdaResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}
