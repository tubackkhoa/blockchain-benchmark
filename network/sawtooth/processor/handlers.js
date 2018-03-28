// SPDX-License-Identifier: Apache-2.0

/* 
This code was written by Zac Delventhal @delventhalz.
Original source code can be found here: https://github.com/delventhalz/transfer-chain-js/blob/master/processor/handlers.js
 */

"use strict";

const { createHash } = require("crypto");
const { TransactionHandler } = require("sawtooth-sdk/processor/handler");
const { InvalidTransaction } = require("sawtooth-sdk/processor/exceptions");
const { TransactionHeader } = require("sawtooth-sdk/protobuf");

// Encoding helpers and constants
const getAddress = (key, length = 64) => {
  return createHash("sha512")
    .update(key)
    .digest("hex")
    .slice(0, length);
};

const FAMILY = "simple";
const PREFIX = getAddress(FAMILY, 6);

const getAssetAddress = name => PREFIX + "00" + getAddress(name, 62);
const getTransferAddress = asset => PREFIX + "01" + getAddress(asset, 62);

const encode = obj => Buffer.from(JSON.stringify(obj, Object.keys(obj).sort()));
const decode = buf => JSON.parse(buf.toString());

// Add a new asset to state
const createAsset = (asset, owner, context) => {
  const address = getAssetAddress(asset);
  return context.getState([address]).then(entries => {
    const entry = entries[address];
    if (entry && entry.length > 0) {
      throw new InvalidTransaction("Asset name in use");
    }

    return context.setState({
      [address]: encode({ name: asset, owner })
    });
  });
};

// Add a new transfer to state
const transferAsset = (asset, owner, signer, context) => {
  const address = getTransferAddress(asset);
  const assetAddress = getAssetAddress(asset);

  return context.getState([assetAddress]).then(entries => {
    const entry = entries[assetAddress];
    if (!entry || entry.length === 0) {
      throw new InvalidTransaction("Asset does not exist");
    }

    if (signer !== decode(entry).owner) {
      throw new InvalidTransaction("Only an Asset's owner may transfer it");
    }

    return context.setState({
      [address]: encode({ asset, owner })
    });
  });
};

// Accept a transfer, clearing it and changing asset ownership
const acceptTransfer = (asset, signer, context) => {
  const address = getTransferAddress(asset);

  return context.getState([address]).then(entries => {
    const entry = entries[address];
    if (!entry || entry.length === 0) {
      throw new InvalidTransaction("Asset is not being transfered");
    }

    if (signer !== decode(entry).owner) {
      throw new InvalidTransaction(
        "Transfers can only be accepted by the new owner"
      );
    }

    return context.setState({
      [address]: Buffer(0),
      [getAssetAddress(asset)]: encode({ name: asset, owner: signer })
    });
  });
};

// Reject a transfer
const rejectTransfer = (asset, signer, context) => {
  const address = getTransferAddress(asset);

  return context.getState([address]).then(entries => {
    const entry = entries[address];
    if (!entry || entry.length === 0) {
      throw new InvalidTransaction("Asset is not being transfered");
    }

    if (signer !== decode(entry).owner) {
      throw new InvalidTransaction(
        "Transfers can only be rejected by the potential new owner"
      );
    }

    return context.setState({
      [address]: Buffer(0)
    });
  });
};

// Handler for JSON encoded payloads
class JSONHandler extends TransactionHandler {
  constructor() {
    console.log("Initializing JSON handler for Sawtooth Tuna Chain");
    super(FAMILY, ["1.0", "application/json"], [PREFIX]);
  }

  apply(txn, context) {
    // Parse the transaction header and payload

    // const header = TransactionHeader.decode(txn.header);
    const header = txn.header;
    const signer = header.signerPublicKey;
    const cbor = require("cbor");
    const data = cbor.decode(txn.payload);
    const { verb: action, money: asset, account: owner } = data;

    // Call the appropriate function based on the payload's action
    console.log(
      `Handling transaction:  ${action} > ${asset}`,
      owner ? `> ${owner.slice(0, 8)}... ` : "",
      `:: ${signer.slice(0, 8)}...`
    );
    // queries do not affect on the assets
    switch (action) {
      case "create":
      case "open":
        return createAsset(asset, signer, context);
      case "transfer":
        return transferAsset(asset, owner, signer, context);
      case "accept":
        return acceptTransfer(asset, signer, context);
      case "reject":
        return rejectTransfer(asset, signer, context);
      default:
        return Promise.resolve().then(() => {
          throw new InvalidTransaction(
            'Action must be "open", "create", "transfer", "accept", or "reject"'
          );
        });
    }
  }
}

module.exports = {
  JSONHandler
};
