import axios from "axios";
import type {
  UploadOptions,
  BuilderHttpClient,
  BuilderClientOptions,
} from "../types/Builder";

export default class BuilderService {
  private static hasWarnedDeprecation = false;
  private static readonly DEFAULT_SERVER_WALLETS_ENDPOINT =
    "/api/v1/ServerWalletAddresses";
  private static readonly DEFAULT_UPLOAD_ENDPOINT = "/api/v1/upload";
  private static readonly DEFAULT_UPLOAD_NETWORK_QUERY_KEY = "networkId";

  // Base mainnet = 8453, Base Sepolia = 84532
  private static readonly BASE_MAINNET_CHAIN_ID = 8453;
  private static readonly BASE_SEPOLIA_CHAIN_ID = 84532;

  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly serverWalletsEndpoint: string;
  private readonly uploadEndpoint: string;
  private readonly uploadNetworkQueryKey: string;
  private readonly httpClient: BuilderHttpClient;
  private readonly formDataFactory: () => FormData;
  private readonly logger: Pick<Console, "debug" | "info" | "warn" | "error">;

  constructor(
    private chainId: number,
    options: BuilderClientOptions = {}
    ) {
    if (!BuilderService.hasWarnedDeprecation) {
      (options.logger ?? console).warn(
        "[@ownables/builder-client] Deprecated: migrate to @ownables/builder for browser-first deploy flow."
      );
      BuilderService.hasWarnedDeprecation = true;
    }

    this.url = options.url ?? "";
    this.apiKey = options.apiKey ?? options.secret;
    this.serverWalletsEndpoint =
      options.serverWalletsEndpoint ??
      BuilderService.DEFAULT_SERVER_WALLETS_ENDPOINT;
    this.uploadEndpoint =
      options.uploadEndpoint ?? BuilderService.DEFAULT_UPLOAD_ENDPOINT;
    this.uploadNetworkQueryKey =
      options.uploadNetworkQueryKey ??
      BuilderService.DEFAULT_UPLOAD_NETWORK_QUERY_KEY;
    this.httpClient = options.httpClient ?? axios;
    this.formDataFactory = options.formDataFactory ?? (() => new FormData());
    this.logger = options.logger ?? console;
  }

  public isAvailable(): boolean {
    return !!this.url;
  }

  /**
   * Infers network code from chainId
   * Base mainnet (8453) = 'L' (mainnet)
   * Base Sepolia (84532) = 'T' (testnet)
   */
  public getNetworkCode(): "L" | "T" {
    if (this.chainId === BuilderService.BASE_MAINNET_CHAIN_ID) {
      return "L";
    } else if (this.chainId === BuilderService.BASE_SEPOLIA_CHAIN_ID) {
      return "T";
    } else {
      // Default to testnet for unknown chain IDs
      this.logger.warn(
        `Unknown chainId ${this.chainId}, defaulting to testnet (T)`
      );
      return "T";
    }
  }

  public async getAddress() {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      const response = await this.httpClient.get(
        `${this.url}${this.serverWalletsEndpoint}`
      );

      if (!response.data) {
        throw new Error("No data returned from server");
      }

      const networkCode = this.getNetworkCode();
      const address =
        networkCode === "L"
          ? response.data.serverWalletAddress_L ??
            response.data.serverLtoWalletAddress_L
          : response.data.serverWalletAddress_T ??
            response.data.serverLtoWalletAddress_T;

      if (!address) {
        throw new Error(
          `Server wallet address not found for network ${networkCode}`
        );
      }

      return address;
    } catch (error: any) {
      this.logger.error("Failed to fetch builder address:", error);
      const errorMessage =
        error.response?.data?.error ||
        error.message ||
        "Failed to get server wallet address";
      this.logger.error("Error details:", errorMessage);
      return null;
    }
  }

  /**
   * Gets the template cost for a given template ID
   * @param templateId Template ID (default: 1)
   * @returns Promise with cost information in ETH
   */
  public async getTemplateCost(
    templateId: number = 1
  ): Promise<{ eth: string; usd?: string }> {
    if (!this.isAvailable()) {
      throw new Error("Builder service URL not configured");
    }

    try {
      const networkCode = this.getNetworkCode();
      const response = await this.httpClient.get(
        `${this.url}/api/v1/templateCost?templateId=${templateId}`,
        {
          headers: this.apiKey ? { "X-API-Key": this.apiKey } : {},
        }
      );

      const costData = response.data[networkCode]?.base;
      if (!costData) {
        throw new Error("Template cost not found");
      }

      return {
        eth: costData.ETH || costData,
        usd: costData.USD,
      };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error ||
        error.message ||
        "Failed to get template cost";
      throw new Error(errorMessage);
    }
  }

  /**
   * Uploads an ownable zip file to the builder service
   * @param zipFile - The zip file as Uint8Array or Blob
   * @param options - Optional upload parameters (templateId, name, sender, signedTransaction)
   * @returns Promise with requestId and message
   */
  public async upload(
    zipFile: Uint8Array | Blob,
    options?: UploadOptions
  ): Promise<{ requestId: string; message: string }> {
    if (!this.isAvailable()) {
      throw new Error("Builder service URL not configured");
    }

    const networkCode = this.getNetworkCode();
    const formData = this.formDataFactory();

    // Convert Uint8Array to Blob if needed
    let fileBlob: Blob | File;
    if (zipFile instanceof Blob) {
      fileBlob = zipFile;
    } else {
      // Create a new ArrayBuffer copy to ensure type compatibility
      const arrayBuffer: ArrayBuffer = new ArrayBuffer(zipFile.length);
      const view = new Uint8Array(arrayBuffer);
      view.set(zipFile);
      fileBlob = new Blob([arrayBuffer], { type: "application/zip" });
    }

    formData.append("file", fileBlob, "ownable-package.zip");

    // Add optional fields
    if (options?.templateId !== undefined) {
      formData.append("templateId", options.templateId.toString());
    }
    if (options?.name) {
      formData.append("name", options.name);
    }
    if (options?.sender) {
      formData.append("sender", options.sender);
    }
    if (options?.signedTransaction) {
      formData.append("signedTransaction", options.signedTransaction);
    }

    try {
      const response = await this.httpClient.post(
        `${this.url}${this.uploadEndpoint}?${this.uploadNetworkQueryKey}=${networkCode}`,
        formData,
        {
          headers: {
            ...(this.apiKey ? { "X-API-Key": this.apiKey } : {}),
            "Content-Type": "multipart/form-data",
          },
        }
      );

      const requestId =
        typeof response.data.requestId === "string"
          ? response.data.requestId
          : response.data.requestId?.requestId || response.data.requestId;

      return {
        requestId: requestId,
        message: response.data.message || "Request queued",
      };
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error || error.message || "Upload failed";
      throw new Error(`Failed to upload ownable: ${errorMessage}`);
    }
  }
}
