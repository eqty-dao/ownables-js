export interface RelayPollingClient {
  url?: string;
  relay: { get(path: string, headers?: Record<string, string>): Promise<any> };
  isAvailable(): Promise<boolean>;
  ensureAuthenticated(): Promise<boolean>;
  getAuthHeaders(): Record<string, string>;
}
