extern crate core;

use std::fmt::Display;
use std::panic::UnwindSafe;

use cosmwasm_std::{MessageInfo, Response};
use ownable_std::{create_lto_env, ExternalEventMsg, IdbStateDump, load_lto_deps};
use serde::{Deserialize, Serialize};

use msg::{ExecuteMsg, InstantiateMsg, QueryMsg};

pub mod contract;
pub mod error;
pub mod msg;
pub mod state;

#[derive(Serialize, Deserialize)]
struct AbiInstantiateRequest {
    msg: InstantiateMsg,
    info: MessageInfo,
}

#[derive(Serialize, Deserialize)]
struct AbiExecuteRequest {
    msg: ExecuteMsg,
    info: MessageInfo,
    mem: IdbStateDump,
}

#[derive(Serialize, Deserialize)]
struct AbiQueryRequest {
    msg: QueryMsg,
    mem: IdbStateDump,
}

#[derive(Serialize, Deserialize)]
struct AbiExternalEventRequest {
    msg: ExternalEventMsg,
    info: MessageInfo,
    ownable_id: String,
    mem: IdbStateDump,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
struct HostAbiError {
    code: Option<String>,
    message: String,
}

impl HostAbiError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            code: None,
            message: message.into(),
        }
    }

    fn with_code(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: Some(code.into()),
            message: message.into(),
        }
    }

    fn from_display(err: impl Display) -> Self {
        Self::new(err.to_string())
    }
}

impl From<String> for HostAbiError {
    fn from(value: String) -> Self {
        Self::new(value)
    }
}

impl From<&str> for HostAbiError {
    fn from(value: &str) -> Self {
        Self::new(value)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
struct HostAbiResponse {
    success: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty", with = "serde_bytes")]
    payload: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<String>,
}

impl HostAbiResponse {
    fn ok(payload: Vec<u8>) -> Self {
        Self {
            success: true,
            payload,
            error_code: None,
            error_message: None,
        }
    }

    fn err(error: impl Into<HostAbiError>) -> Self {
        let error = error.into();
        Self {
            success: false,
            payload: Vec::new(),
            error_code: error.code,
            error_message: Some(error.message),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct AbiAttribute {
    key: String,
    value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct AbiEvent {
    #[serde(rename = "type")]
    kind: String,
    attributes: Vec<AbiAttribute>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct AbiResponse {
    attributes: Vec<AbiAttribute>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    events: Vec<AbiEvent>,
}

impl From<Response> for AbiResponse {
    fn from(r: Response) -> Self {
        AbiResponse {
            attributes: r
                .attributes
                .into_iter()
                .map(|a| AbiAttribute { key: a.key, value: a.value })
                .collect(),
            events: r
                .events
                .into_iter()
                .map(|e| AbiEvent {
                    kind: e.ty,
                    attributes: e
                        .attributes
                        .into_iter()
                        .map(|a| AbiAttribute { key: a.key, value: a.value })
                        .collect(),
                })
                .collect(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct AbiResultPayload {
    #[serde(with = "serde_bytes")]
    result: Vec<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mem: Option<IdbStateDump>,
}

fn cbor_from_slice<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, HostAbiError> {
    ciborium::de::from_reader(bytes)
        .map_err(|e| HostAbiError::with_code("INVALID_CBOR", e.to_string()))
}

fn cbor_to_vec<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, HostAbiError> {
    let mut buf = Vec::new();
    ciborium::ser::into_writer(value, &mut buf)
        .map_err(|e| HostAbiError::with_code("SERIALIZATION_FAILED", e.to_string()))?;
    Ok(buf)
}

fn pack_ptr_len(ptr: u32, len: u32) -> u64 {
    ((len as u64) << 32) | (ptr as u64)
}

fn unpack_ptr_len(packed: u64) -> (u32, u32) {
    let ptr = packed as u32;
    let len = (packed >> 32) as u32;
    (ptr, len)
}

fn read_memory(ptr: u32, len: u32) -> Result<Vec<u8>, HostAbiError> {
    if len == 0 {
        return Ok(Vec::new());
    }

    if ptr == 0 {
        return Err(HostAbiError::with_code(
            "INVALID_POINTER",
            "received null pointer for non-empty input",
        ));
    }

    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len as usize) };
    Ok(bytes.to_vec())
}

fn alloc(len: u32) -> u32 {
    if len == 0 {
        return 0;
    }

    let mut buffer = Vec::<u8>::with_capacity(len as usize);
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr as u32
}

unsafe fn free(ptr: u32, len: u32) {
    if ptr == 0 || len == 0 {
        return;
    }

    unsafe {
        drop(Vec::from_raw_parts(
            ptr as *mut u8,
            len as usize,
            len as usize,
        ));
    }
}

fn write_memory(data: &[u8]) -> u64 {
    let len = data.len() as u32;
    if len == 0 {
        return pack_ptr_len(0, 0);
    }

    let ptr = alloc(len);
    if ptr == 0 {
        return pack_ptr_len(0, 0);
    }

    unsafe {
        std::ptr::copy_nonoverlapping(data.as_ptr(), ptr as *mut u8, len as usize);
    }

    pack_ptr_len(ptr, len)
}

fn encode_response(response: &HostAbiResponse) -> u64 {
    let encoded = cbor_to_vec(response).unwrap_or_else(|error| {
        let fallback = HostAbiResponse::err(HostAbiError::with_code(
            "SERIALIZATION_FAILED",
            error.message,
        ));
        cbor_to_vec(&fallback).unwrap_or_default()
    });
    write_memory(&encoded)
}

fn dispatch<E, F>(ptr: u32, len: u32, handler: F) -> u64
where
    E: Into<HostAbiError>,
    F: FnOnce(&[u8]) -> Result<Vec<u8>, E> + UnwindSafe,
{
    let response = match read_memory(ptr, len) {
        Ok(input) => match std::panic::catch_unwind(|| handler(&input)) {
            Ok(handler_result) => match handler_result {
                Ok(payload) => HostAbiResponse::ok(payload),
                Err(error) => HostAbiResponse::err(error.into()),
            },
            Err(_) => {
                HostAbiResponse::err(HostAbiError::with_code("HANDLER_PANIC", "handler panicked"))
            }
        },
        Err(error) => HostAbiResponse::err(error),
    };

    encode_response(&response)
}

fn instantiate_handler(input: &[u8]) -> Result<Vec<u8>, HostAbiError> {
    let request: AbiInstantiateRequest = cbor_from_slice(input)?;
    let mut deps = load_lto_deps(None);

    let response = contract::instantiate(deps.as_mut(), create_lto_env(), request.info, request.msg)
        .map_err(HostAbiError::from_display)?;

    let payload = AbiResultPayload {
        result: cbor_to_vec(&AbiResponse::from(response))?,
        mem: Some(IdbStateDump::from(deps.storage)),
    };

    cbor_to_vec(&payload)
}

fn execute_handler(input: &[u8]) -> Result<Vec<u8>, HostAbiError> {
    let request: AbiExecuteRequest = cbor_from_slice(input)?;
    let mut deps = load_lto_deps(Some(request.mem));

    let response = contract::execute(deps.as_mut(), create_lto_env(), request.info, request.msg)
        .map_err(HostAbiError::from_display)?;

    let payload = AbiResultPayload {
        result: cbor_to_vec(&AbiResponse::from(response))?,
        mem: Some(IdbStateDump::from(deps.storage)),
    };

    cbor_to_vec(&payload)
}

fn query_handler(input: &[u8]) -> Result<Vec<u8>, HostAbiError> {
    let request: AbiQueryRequest = cbor_from_slice(input)?;
    let deps = load_lto_deps(Some(request.mem));

    let response = contract::query(deps.as_ref(), create_lto_env(), request.msg)
        .map_err(HostAbiError::from_display)?;

    let payload = AbiResultPayload {
        result: response.to_vec(),
        mem: None,
    };

    cbor_to_vec(&payload)
}

fn external_event_handler(input: &[u8]) -> Result<Vec<u8>, HostAbiError> {
    let request: AbiExternalEventRequest = cbor_from_slice(input)?;
    let mut deps = load_lto_deps(Some(request.mem));

    let response = contract::register_external_event(
        request.info,
        deps.as_mut(),
        request.msg,
        request.ownable_id,
    )
    .map_err(HostAbiError::from_display)?;

    let payload = AbiResultPayload {
        result: cbor_to_vec(&AbiResponse::from(response))?,
        mem: Some(IdbStateDump::from(deps.storage)),
    };

    cbor_to_vec(&payload)
}

#[no_mangle]
pub extern "C" fn ownable_alloc(len: u32) -> u32 {
    alloc(len)
}

#[no_mangle]
pub extern "C" fn ownable_free(ptr: u32, len: u32) {
    unsafe { free(ptr, len) }
}

#[no_mangle]
pub extern "C" fn ownable_instantiate(ptr: u32, len: u32) -> u64 {
    dispatch(ptr, len, instantiate_handler)
}

#[no_mangle]
pub extern "C" fn ownable_execute(ptr: u32, len: u32) -> u64 {
    dispatch(ptr, len, execute_handler)
}

#[no_mangle]
pub extern "C" fn ownable_query(ptr: u32, len: u32) -> u64 {
    dispatch(ptr, len, query_handler)
}

#[no_mangle]
pub extern "C" fn ownable_external_event(ptr: u32, len: u32) -> u64 {
    dispatch(ptr, len, external_event_handler)
}

#[allow(dead_code)]
fn _round_trip_ptr_len_for_tests(packed: u64) -> (u32, u32) {
    unpack_ptr_len(packed)
}
