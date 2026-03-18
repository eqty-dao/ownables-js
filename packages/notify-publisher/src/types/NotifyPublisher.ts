import type { OwnablesNotifyAvailableV1 } from "@ownables/notify-core";

export interface OwnablesNotificationPublishRequest {
  topic: string;
  title: string;
  body: string;
  icon?: string;
  payload: OwnablesNotifyAvailableV1;
}

export interface OwnablesNotificationPublishResult {
  transportId?: string;
  eventId: string;
}

export interface NotifyPublisherTransport {
  publish(
    request: OwnablesNotificationPublishRequest
  ): Promise<{ transportId?: string }>;
}

export type PublishOwnableAvailableInput = Omit<OwnablesNotifyAvailableV1, "type" | "eventId" | "createdAt"> & {
  eventId?: string;
  createdAt?: string;
  topic: string;
};
