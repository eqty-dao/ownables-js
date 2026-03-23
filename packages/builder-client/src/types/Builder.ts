export interface UploadOptions {
  templateId?: number;
  name?: string;
  sender?: string;
  signedTransaction?: string;
}

export interface BuilderHttpClient {
  get(url: string, config?: Record<string, unknown>): Promise<{ data: any }>;
  post(
    url: string,
    body: unknown,
    config?: Record<string, unknown>
  ): Promise<{ data: any }>;
}

export interface BuilderClientOptions {
  url?: string;
  secret?: string;
  httpClient?: BuilderHttpClient;
  formDataFactory?: () => FormData;
  logger?: Pick<Console, "debug" | "info" | "warn" | "error">;
}
