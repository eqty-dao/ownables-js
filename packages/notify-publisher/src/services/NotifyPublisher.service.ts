import {
  OwnablesNotificationBuilderService,
  OwnablesNotificationValidatorService,
  type OwnablesNotifyAvailableV1,
} from "@ownables/notify-core";
import type {
  NotifyPublisherTransport,
  OwnablesNotificationPublishResult,
  PublishOwnableAvailableInput,
} from "../types/NotifyPublisher";

export interface NotifyPublisherServiceDeps {
  builder?: OwnablesNotificationBuilderService;
  validator?: OwnablesNotificationValidatorService;
  now?: () => Date;
  idGenerator?: () => string;
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
      ownerAddress: input.ownerAddress,
      accept: input.accept,
    };
    const payload: OwnablesNotifyAvailableV1 = {
      ...payloadBase,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.nft ? { nft: input.nft } : {}),
    };

    this.validator.assertValid(payload);

    const envelope = this.builder.build(payload);
    const publishRequest = {
      topic: input.topic,
      title: envelope.title,
      body: envelope.body,
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
