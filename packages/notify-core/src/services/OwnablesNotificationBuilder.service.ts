import type {
  OwnablesNotificationEnvelope,
  OwnablesNotifyAvailableV1,
} from "../types/Notify";

const shortenAddress = (address: string): string => {
  if (address.length <= 10) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export class OwnablesNotificationBuilderService {
  build(payload: OwnablesNotifyAvailableV1): OwnablesNotificationEnvelope {
    const ownableName = payload.metadata?.name?.trim();
    const title = ownableName ? `${ownableName} available` : "New Ownable available";

    const shortIssuer = shortenAddress(payload.issuerAddress);

    const body =
      payload.scope === "nft"
        ? `Issued by ${shortIssuer} for NFT #${payload.nft?.tokenId ?? "?"}. Review and accept to download.`
        : `Issued by ${shortIssuer}. Review and accept to download.`;

    return {
      title,
      body,
      payload,
    };
  }
}
