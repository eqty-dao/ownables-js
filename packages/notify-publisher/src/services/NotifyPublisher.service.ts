import {
  OwnablesNotificationBuilderService,
  OwnablesNotificationValidatorService,
  normalizeCaip10Account,
  normalizeEvmAddress,
  parseCaip10Account,
  type OwnablesNotifyAvailableV1,
} from "@ownables/notify-core";
import type {
  NotifyPublisherTransport,
  OwnablesNotificationPublishResult,
  PublishOwnableAvailableInput,
} from "../types/NotifyPublisher.js";

export interface NotifyPublisherServiceDeps {
  builder?: OwnablesNotificationBuilderService;
  validator?: OwnablesNotificationValidatorService;
  now?: () => Date;
  idGenerator?: () => string;
}

function assertNotifyTarget(inputOwnerAccount: string, inputOwnerAddress: string, target: { account: string }): string {
  let payloadOwnerAccount: string;
  let targetAccount: string;

  try {
    payloadOwnerAccount = normalizeCaip10Account(inputOwnerAccount);
  } catch {
    throw new Error("Invalid notify payload ownerAccount");
  }

  try {
    targetAccount = normalizeCaip10Account(target.account);
  } catch {
    throw new Error("Invalid notify target account");
  }

  if (payloadOwnerAccount !== targetAccount) {
    throw new Error("Notify target account does not match payload ownerAccount");
  }

  const targetAddress = parseCaip10Account(targetAccount);
  if (targetAddress.namespace === "eip155") {
    const payloadOwnerAddress = normalizeEvmAddress(
      inputOwnerAddress,
      "Invalid notify payload ownerAddress"
    );
    if (targetAddress.address !== payloadOwnerAddress) {
      throw new Error("Notify target account does not match payload ownerAddress");
    }
  }

  return targetAccount;
}

export class NotifyPublisherService {
  private readonly builder: OwnablesNotificationBuilderService;
  private readonly validator: OwnablesNotificationValidatorService;
  private readonly now: () => Date;
  private readonly idGenerator: () => string;

  constructor(
    private readonly transport: NotifyPublisherTransport,
    deps: NotifyPublisherServiceDeps = {}
  ) {
    this.builder = deps.builder ?? new OwnablesNotificationBuilderService();
    this.validator = deps.validator ?? new OwnablesNotificationValidatorService();
    this.now = deps.now ?? (() => new Date());
    this.idGenerator =
      deps.idGenerator ??
      (() =>
        `evt_${this.now().toISOString().replace(/[-:.TZ]/g, "")}_${Math.random()
          .toString(16)
          .slice(2, 10)}`);
  }

  async publishOwnableAvailable(
    input: PublishOwnableAvailableInput
  ): Promise<OwnablesNotificationPublishResult> {
    const payloadBase: OwnablesNotifyAvailableV1 = {
      type: "ownables.v1.available",
      eventId: input.eventId ?? this.idGenerator(),
      createdAt: input.createdAt ?? this.now().toISOString(),
      ownableId: input.ownableId,
      cid: input.cid,
      scope: input.scope,
      issuerAddress: input.issuerAddress,
      ownerAccount: input.ownerAccount,
      ownerAddress: input.ownerAddress,
      url: input.url,
    };
    const payload: OwnablesNotifyAvailableV1 = {
      ...payloadBase,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.nft ? { nft: input.nft } : {}),
    };

    this.validator.assertValid(payload);
    const account = assertNotifyTarget(input.ownerAccount, input.ownerAddress, input.target);

    const envelope = this.builder.build(payload);
    const publishRequest = {
      account,
      title: envelope.title,
      body: envelope.body,
      url: payload.url,
      payload: envelope.payload,
      ...(payload.metadata?.icon ? { icon: payload.metadata.icon } : {}),
    };
    const result = await this.transport.publish(publishRequest);

    if (result.transportId) {
      return {
        transportId: result.transportId,
        eventId: payload.eventId,
      };
    }

    return { eventId: payload.eventId };
  }
}
