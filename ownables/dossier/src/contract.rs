use crate::error::ContractError;
use crate::msg::{ExecuteMsg, IngestEventMsg, InstantiateMsg, QueryMsg, RegisterPublicEventMsg};
use crate::state::{
    ATTACHMENTS, CLOSED, METADATA, NETWORK_ID, NFT_ITEM, OWNABLE_INFO, PACKAGE_CID,
};
use cosmwasm_std::{
    Addr, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult, to_json_binary,
};
use cw2::set_contract_version;
use ownable_std::{
    Attachment, AttachmentInput, GetAttachmentsResponse, InfoResponse, Metadata, OwnableInfo,
    ensure_owner,
};

const CONTRACT_NAME: &str = "crates.io:ownable-dossier";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");
const OWNABLE_TYPE: &str = "dossier";

pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let ownable_info = OwnableInfo {
        owner: info.sender.clone(),
        issuer: info.sender.clone(),
        ownable_type: Some(OWNABLE_TYPE.to_string()),
    };

    let metadata = Metadata {
        image: None,
        image_data: None,
        external_url: None,
        description: Some(msg.description),
        name: Some(msg.name),
        background_color: None,
        animation_url: None,
        youtube_url: None,
    };

    NETWORK_ID.save(deps.storage, &msg.network_id)?;
    if let Some(nft) = msg.nft {
        NFT_ITEM.save(deps.storage, &nft)?;
    }
    METADATA.save(deps.storage, &metadata)?;
    CLOSED.save(deps.storage, &false)?;
    ATTACHMENTS.save(deps.storage, &Vec::new())?;
    OWNABLE_INFO.save(deps.storage, &ownable_info)?;
    PACKAGE_CID.save(deps.storage, &msg.package)?;

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("owner", ownable_info.owner.to_string())
        .add_attribute("issuer", ownable_info.issuer.to_string())
        .add_attribute("ownable_type", OWNABLE_TYPE))
}

pub fn execute(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::Transfer { to } => try_transfer(info, deps, to),
        ExecuteMsg::Attach { attachments } => try_attach(info, deps, attachments),
        ExecuteMsg::Close {} => try_close(info, deps),
    }
}

pub fn try_transfer(info: MessageInfo, deps: DepsMut, to: Addr) -> Result<Response, ContractError> {
    OWNABLE_INFO.update(deps.storage, |mut config| -> Result<_, ContractError> {
        ensure_owner(&config, &info.sender, || ContractError::Unauthorized {
            val: "Unauthorized transfer attempt".to_string(),
        })?;

        if info.sender == to {
            return Err(ContractError::CustomError {
                val: "Unable to transfer: Recipient address is current owner".to_string(),
            });
        }

        config.owner = to.clone();
        Ok(config)
    })?;

    Ok(Response::new()
        .add_attribute("method", "try_transfer")
        .add_attribute("new_owner", to.to_string()))
}

pub fn try_attach(
    info: MessageInfo,
    deps: DepsMut,
    attachments: Vec<AttachmentInput>,
) -> Result<Response, ContractError> {
    let ownership = OWNABLE_INFO.load(deps.storage)?;
    ensure_owner(&ownership, &info.sender, || ContractError::Unauthorized {
        val: "Unauthorized".into(),
    })?;

    if attachments.is_empty() {
        return Err(ContractError::CustomError {
            val: "At least one attachment is required".to_string(),
        });
    }

    if CLOSED.load(deps.storage)? {
        return Err(ContractError::ClosedError {
            val: "Dossier is already closed".to_string(),
        });
    }

    let added = attachments.len();
    ATTACHMENTS.update(deps.storage, |mut existing| -> Result<_, ContractError> {
        existing.extend(attachments.into_iter().map(|attachment| Attachment {
            name: attachment.name,
            cid: attachment.cid,
        }));
        Ok(existing)
    })?;

    Ok(Response::new()
        .add_attribute("method", "try_attach")
        .add_attribute("attachments_added", added.to_string()))
}

pub fn try_close(info: MessageInfo, deps: DepsMut) -> Result<Response, ContractError> {
    let ownership = OWNABLE_INFO.load(deps.storage)?;
    ensure_owner(&ownership, &info.sender, || ContractError::Unauthorized {
        val: "Unauthorized".into(),
    })?;

    let is_closed = CLOSED.update(deps.storage, |is_closed| -> Result<_, ContractError> {
        if is_closed {
            return Err(ContractError::ClosedError {
                val: "Dossier is already closed".to_string(),
            });
        }
        Ok(true)
    })?;

    Ok(Response::new()
        .add_attribute("method", "try_close")
        .add_attribute("is_closed", is_closed.to_string()))
}

pub fn register(
    _info: MessageInfo,
    _deps: DepsMut,
    event: RegisterPublicEventMsg,
) -> Result<Response, ContractError> {
    Err(ContractError::MatchEventError {
        val: event.event_type,
    })
}

pub fn ingest(
    _info: MessageInfo,
    _deps: DepsMut,
    _event: IngestEventMsg,
) -> Result<Response, ContractError> {
    Err(ContractError::NotImplemented {})
}

pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::GetInfo {} => query_ownable_info(deps),
        QueryMsg::GetMetadata {} => query_ownable_metadata(deps),
        QueryMsg::GetAttachments {} => query_attachments(deps),
        QueryMsg::IsClosed {} => query_closed_state(deps),
    }
}

fn query_closed_state(deps: Deps) -> StdResult<Binary> {
    let is_closed = CLOSED.load(deps.storage)?;
    to_json_binary(&is_closed)
}

fn query_attachments(deps: Deps) -> StdResult<Binary> {
    let attachments = ATTACHMENTS.load(deps.storage)?;
    to_json_binary(&GetAttachmentsResponse { attachments })
}

fn query_ownable_info(deps: Deps) -> StdResult<Binary> {
    let nft = NFT_ITEM.may_load(deps.storage)?;
    let ownable_info = OWNABLE_INFO.load(deps.storage)?;
    to_json_binary(&InfoResponse {
        owner: ownable_info.owner,
        issuer: ownable_info.issuer,
        nft,
        ownable_type: ownable_info.ownable_type,
    })
}

fn query_ownable_metadata(deps: Deps) -> StdResult<Binary> {
    let metadata = METADATA.load(deps.storage)?;
    to_json_binary(&metadata)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::from_json;
    use cosmwasm_std::testing::{mock_dependencies, mock_env};
    use cosmwasm_std::{Addr, MessageInfo};
    use ownable_std::NFT;

    fn mock_info(sender: &str) -> MessageInfo {
        MessageInfo {
            sender: Addr::unchecked(sender),
            funds: Vec::new(),
        }
    }

    fn instantiate_dossier(deps: DepsMut) {
        instantiate(
            deps,
            mock_env(),
            mock_info("owner"),
            InstantiateMsg {
                name: "Dossier".to_string(),
                description: "A living file dossier".to_string(),
                ownable_id: "dossier-1".to_string(),
                ownable_type: Some("static_image".to_string()),
                network_id: 1,
                package: "bafy-package".to_string(),
                nft: Some(NFT {
                    network: "eip155:1".to_string(),
                    id: 1u128.into(),
                    address: "nft-contract-address".to_string(),
                    lock_service: None,
                }),
            },
        )
        .expect("instantiate dossier");
    }

    #[test]
    fn instantiate_pins_dossier_type_and_empty_attachment_state() {
        let mut deps = mock_dependencies();
        instantiate_dossier(deps.as_mut());

        let info: InfoResponse =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::GetInfo {}).expect("query info"))
                .expect("decode info");
        let attachments: GetAttachmentsResponse = from_json(
            query(deps.as_ref(), mock_env(), QueryMsg::GetAttachments {})
                .expect("query attachments"),
        )
        .expect("decode attachments");
        let is_closed: bool = from_json(
            query(deps.as_ref(), mock_env(), QueryMsg::IsClosed {}).expect("query closed"),
        )
        .expect("decode closed");

        assert_eq!(info.ownable_type.as_deref(), Some("dossier"));
        assert!(attachments.attachments.is_empty());
        assert!(!is_closed);
    }

    #[test]
    fn register_rejects_lock_events_for_non_lockable_dossier() {
        let mut deps = mock_dependencies();
        instantiate_dossier(deps.as_mut());

        let error = register(
            mock_info("owner"),
            deps.as_mut(),
            RegisterPublicEventMsg {
                source: "0xsource".to_string(),
                event_type: "lock".to_string(),
                data: vec![1, 2, 3],
                block_number: 1,
                transaction_hash: vec![0xaa],
                transaction_index: 0,
                log_index: 0,
            },
        )
        .expect_err("dossier must reject lock register events");

        match error {
            ContractError::MatchEventError { val } => assert_eq!(val, "lock"),
            other => panic!("expected unknown event error, got {other:?}"),
        }
    }

    #[test]
    fn attaches_flat_rows_and_preserves_versions_by_name() {
        let mut deps = mock_dependencies();
        instantiate_dossier(deps.as_mut());

        execute(
            deps.as_mut(),
            mock_env(),
            mock_info("owner"),
            ExecuteMsg::Attach {
                attachments: vec![
                    AttachmentInput {
                        name: "passport.pdf".to_string(),
                        cid: "bafy-v1".to_string(),
                    },
                    AttachmentInput {
                        name: "passport.pdf".to_string(),
                        cid: "bafy-v2".to_string(),
                    },
                ],
            },
        )
        .expect("attach versions");

        let response: GetAttachmentsResponse = from_json(
            query(deps.as_ref(), mock_env(), QueryMsg::GetAttachments {})
                .expect("query attachments"),
        )
        .expect("decode attachments");

        assert_eq!(
            response.attachments,
            vec![
                Attachment {
                    name: "passport.pdf".to_string(),
                    cid: "bafy-v1".to_string(),
                },
                Attachment {
                    name: "passport.pdf".to_string(),
                    cid: "bafy-v2".to_string(),
                },
            ]
        );
    }

    #[test]
    fn close_prevents_new_attachments() {
        let mut deps = mock_dependencies();
        instantiate_dossier(deps.as_mut());

        execute(
            deps.as_mut(),
            mock_env(),
            mock_info("owner"),
            ExecuteMsg::Close {},
        )
        .expect("close dossier");

        let error = execute(
            deps.as_mut(),
            mock_env(),
            mock_info("owner"),
            ExecuteMsg::Attach {
                attachments: vec![AttachmentInput {
                    name: "passport.pdf".to_string(),
                    cid: "bafy-v1".to_string(),
                }],
            },
        )
        .expect_err("closed dossier rejects new attachments");

        match error {
            ContractError::ClosedError { val } => {
                assert!(val.contains("already closed"));
            }
            other => panic!("expected closed error, got {other:?}"),
        }
    }
}
