use cw_storage_plus::Item;
use ownable_std::{Attachment, Metadata, NFT, OwnableInfo};

pub const OWNABLE_INFO: Item<OwnableInfo> = Item::new("ownable_info");
pub const METADATA: Item<Metadata> = Item::new("metadata");
pub const NFT_ITEM: Item<NFT> = Item::new("nft");
pub const LOCKED: Item<bool> = Item::new("is_locked");
pub const CLOSED: Item<bool> = Item::new("is_closed");
pub const ATTACHMENTS: Item<Vec<Attachment>> = Item::new("attachments");
pub const PACKAGE_CID: Item<String> = Item::new("package_cid");
pub const NETWORK_ID: Item<u32> = Item::new("network_id");
