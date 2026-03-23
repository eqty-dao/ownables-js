import type { KVStore } from "../interfaces/core";
import type { RelayPollingClient } from "../types/Polling";

type LoggerLike = Pick<Console, "debug" | "info" | "warn" | "error">;

/**
 * @deprecated Relay polling is legacy and will be removed in a future major version.
 * Prefer hub-backed notification flows.
 */
export class PollingService {
  private tries = 3;
  private intervalId?: ReturnType<typeof setInterval>;
  private consecutiveFailures = 0;
  private maxConsecutiveFailures = 5;

  constructor(
    private readonly relay: RelayPollingClient,
    private readonly localStorage: KVStore,
    private readonly logger: LoggerLike = console
  ) {}

  /**
   * Fetch new message hashes from the server and compare with client hashes.
   */
  async checkForNewHashes(address: string) {
    const pkgs = this.localStorage.get("packages") || [];
    const clientHashes = pkgs.map((msg: any) => {
      return msg.uniqueMessageHash;
    });

    try {
      const isAvailable = await this.relay.isAvailable();
      if (!isAvailable) {
        return 0;
      }

      await this.relay.ensureAuthenticated();

      const headers: Record<string, string> = {
        ...this.relay.getAuthHeaders(),
      };
      const lastModified = this.localStorage.get("lastModified");

      if (lastModified) {
        headers["If-Modified-Since"] = lastModified;
      }

      const response = await this.relay.relay.get(
        `messages/${encodeURIComponent(address)}`,
        headers
      );

      // Cast response to handle different response formats
      const responseData = response as any;

      if (responseData.status === 304) {
        return this.localStorage.get("messageCount") || 0;
      }

      if (responseData.status === 200) {
        const messages =
          responseData.data?.messages || responseData.messages || [];
        const serverHashes = messages
          .filter((message: any) => message.hash)
          .map((message: any) => message.hash);

        const newLastModified = responseData.headers?.["last-modified"];
        if (newLastModified) {
          this.localStorage.set("lastModified", newLastModified);
        }
        const newHashes = serverHashes.filter(
          (hash: string) => !clientHashes.includes(hash)
        );

        this.localStorage.set("messageCount", newHashes.length);

        return newHashes.length;
      }

      this.consecutiveFailures = 0;
    } catch (error) {
      this.logger.error("Error fetching message hashes:", error);

      this.consecutiveFailures++;

      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.stopPolling();
        return 0;
      }

      if (this.tries-- <= 0) {
        this.tries = 3;
        this.stopPolling();
      }
    }

    return 0;
  }

  /**
   * Start polling for message hash updates.
   */
  startPolling(
    address: string,
    onUpdate: (count: number) => void,
    interval = 15000
  ): () => void {
    if (this.intervalId || !this.relay.url) {
      return () => {};
    }

    this.checkForNewHashes(address).then(onUpdate);

    const fetchHashes = async () => {
      try {
        const newCount = await this.checkForNewHashes(address);
        onUpdate(newCount);
      } catch (error) {
        this.logger.error("Polling error:", error);
      }
    };

    this.intervalId = setInterval(fetchHashes, interval);

    //cleanup
    return () => {
      clearInterval(this.intervalId);
    };
  }

  stopPolling(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  /**
   * Clear cached headers and hashes
   */
  clearCache() {
    this.localStorage.remove("lastModified");
  }
}
