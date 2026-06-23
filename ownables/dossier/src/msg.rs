use cosmwasm_std::Addr;
use schemars::JsonSchema;
use serde_json::Value;
use serde::{Deserialize, Serialize};
use ownable_std_macros::{
    ownables_attach, ownables_close, ownables_transfer, ownables_lock,
    ownables_query_info, ownables_query_locked, ownables_query_metadata,
    ownables_query_attachments, ownables_query_closed, ownables_instantiate_msg
};
use ownable_std::{AttachmentInput, NFT};

#[ownables_instantiate_msg]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct InstantiateMsg {
    pub name: String,
    pub description: String,
}

#[ownables_transfer]
#[ownables_lock]
#[ownables_attach]
#[ownables_close]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {}

#[ownables_query_info]
#[ownables_query_locked]
#[ownables_query_metadata]
#[ownables_query_attachments]
#[ownables_query_closed]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegisterPublicEventMsg {
    pub source: String,
    pub event_type: String,
    pub data: Vec<u8>,
    pub block_number: u64,
    pub transaction_hash: Vec<u8>,
    pub transaction_index: u32,
    pub log_index: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, JsonSchema)]
pub struct OwnableEventSource {
    pub id: String,
    pub owner: String,
    pub issuer: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct IngestEventMsg {
    pub source: OwnableEventSource,
    pub event_type: String,
    pub attributes: Value,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EncodePublicEventMsg {
    pub event_type: String,
    pub data: Vec<u8>,
}
