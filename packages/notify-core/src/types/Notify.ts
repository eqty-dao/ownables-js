export type OwnablesNotificationScope = "direct" | "nft";

export interface OwnablesNotificationMetadata {
  name?: string;
  icon?: string;
  description?: string;
}

export interface OwnablesNotificationNftRef {
  network: string;
  contract: string;
  tokenId: string;
}

export interface OwnablesNotificationAccept {
  url: string;
  method?: "GET" | "POST";
}

export interface OwnablesNotifyAvailableV1 {
  type: "ownables.v1.available";
  eventId: string;
  createdAt: string;
  ownableId: string;
  cid: string;
  scope: OwnablesNotificationScope;
  issuerAddress: string;
  ownerAddress: string;
  accept: OwnablesNotificationAccept;
  metadata?: OwnablesNotificationMetadata;
  nft?: OwnablesNotificationNftRef;
}

export interface OwnablesNotificationEnvelope {
  title: string;
  body: string;
  payload: OwnablesNotifyAvailableV1;
}

export interface OwnablesNotificationValidationResult {
  valid: boolean;
  errors: string[];
}
