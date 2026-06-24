use cosmwasm_std::Addr;
use ownable_std::{AttachmentInput, NFT};
use ownable_std_macros::{
    ownables_attach, ownables_close, ownables_instantiate_msg, ownables_query_attachments,
    ownables_query_closed, ownables_query_info, ownables_query_metadata, ownables_transfer,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[ownables_instantiate_msg]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub struct InstantiateMsg {
    pub name: String,
    pub description: String,
}

#[ownables_transfer]
#[ownables_attach]
#[ownables_close]
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {}

#[ownables_query_info]
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
