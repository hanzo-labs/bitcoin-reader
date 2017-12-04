'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// Import Axios XHR client
var axios = require('axios');
// Import Moment.js
var moment = require('moment-timezone');
// RFC3339 Time format used by Appengine/Datastore
var rfc3339 = 'YYYY-MM-DDTHH:mm:ssZ';
// Stores the last time block addresses were queries for in updateBloom
var blockAddressQueriedAt = null;
// Hanzo Ethereum Webhook
var bitcoinWebhook = 'https://api.hanzo.io/bitcoin/webhook';
var bitcoinWebhookPassword = '3NRD2H3EbnrX4fFPBvHqUxsQjMMdVpbGXRn2jFggnq66bEEczjF3GK4r66JX3veY6WJUrxCSpB2AKsNRBHuDTHZkXBrY258tCpa4xMJPnyrCh5dZaPD5TvCC8BSHgEeMwkaN6Vgcme783fFBeS9eY88NpAgH84XbLL5W5AXahLa2ZSJy4VT8nkRVpSNPE32KGE4Jp3uhuHPUd7eKdYjrX9x8aukgQKtuyCNKdxhh4jw8ZzYZ2JUbgMmTtjduFswc';
// Get random id
function getRandomId() {
    return parseInt(Math.random() * 100000);
}
// Bitcoin Client
class BTCClient {
    constructor(address, username, password, inflightLimit = 10) {
        this.address = address;
        this.username = username;
        this.password = password;
        this.inflight = 0;
        this.inflightLimit = inflightLimit;
        this._fnQueue = [];
    }
    _enqueue(fn) {
        this._fnQueue.push(fn);
        // console.log(`Enqueuing a request, Queue Size: ${ this._fnQueue.length }`)
        this._next();
    }
    _next() {
        if (this._fnQueue.length > 0 && this.inflight < this.inflightLimit) {
            var fn = this._fnQueue.shift();
            fn();
            // console.log(`Executing a request, Inflight: ${ this.inflight }`)
            this._next();
        }
    }
    rpc(...params) {
        var method = params.shift();
        var auth = new Buffer(this.username + ':' + this.password).toString('base64');
        var id = getRandomId();
        var options = {
            url: this.address,
            method: 'post',
            headers: {
                Authorization: 'Basic ' + auth
                // 'Content-Type': 'application/json',
            },
            data: {
                jsonrpc: '2.0',
                method: method,
                id: id,
                params: params,
            }
        };
        var fn;
        var self = this;
        // console.log(`RPC Request\n${JSON.stringify(options)}`)
        var p = new Promise((resolve, reject) => {
            fn = () => {
                self.inflight++;
                // console.log(`RPC POST: ${ JSON.stringify(options.data) }`)
                var p = axios(options).then((res) => {
                    self.inflight--;
                    // console.log(`RPC Response ${res.data.result}`)
                    if (res.data.result) {
                        // console.log(`RPC POST SUCCESS`)
                        resolve(res.data.result);
                    }
                    else {
                        // console.log(`RPC POST FAILURE`)
                        reject(new Error(res.data.error));
                    }
                    self._next();
                });
            };
        });
        this._enqueue(fn);
        return p;
    }
}
// This function updates a bloom filter with new addresses
function updateBloom(bloom, datastore, network) {
    return __awaiter(this, void 0, void 0, function* () {
        // Query all the blockaddresses
        var query = datastore.createQuery('blockaddress').filter('Type', '=', network);
        if (blockAddressQueriedAt) {
            query = query.filter('CreatedAt', '>=', blockAddressQueriedAt);
            console.log(`Checking Addresses Created After '${blockAddressQueriedAt}'`);
        }
        console.log(`Start Getting '${network}' Block Addresses`);
        // Get all the results
        var [results, qInfo] = (yield datastore.runQuery(query));
        console.log(`Found ${results.length} Block Addresses`);
        console.log('Additional Query Info:\n', JSON.stringify(qInfo));
        blockAddressQueriedAt = moment().toDate();
        // Start building the bloom filter from the results
        for (var result of results) {
            console.log(`Adding BlockAddress ${result.Address} to Bloom Filter`);
            bloom.add(result.Address);
        }
    });
}
// function strip0x(str) {
//   return str.replace(/^0x/, '')
// }
// This function converts an array into a Datastore compatible array
function toDatastoreArray(array, type) {
    var values = array.map((x) => {
        var y = {};
        y[`${type}Value`] = x;
        return y;
    });
    return {
        values: values
    };
}
function saveReadingBlock(datastore, network, result) {
    var createdAt = moment().toDate();
    // Convert to the Go Compatible Datastore Representation
    var id = `${network}/${result.hash}`;
    var data = {
        Id_: id,
        BitcoinBlockHeight: result.height,
        BitcoinBlockHash: result.hash,
        BitcoinBlockStrippedSize: result.strippedsize,
        BitcoinBlockSize: result.size,
        BitcoinBlockWeight: result.weight,
        BitcoinBlockVersion: result.version,
        BitcoinBlockVersionHex: result.versionHex,
        BitcoinBlockMerkleroot: result.merkleroot,
        BitcoinBlockTime: result.time,
        BitcoinBlockMedianTime: result.mediantime,
        BitcoinBlockNonce: result.nonce,
        BitcoinBlockBits: result.bits,
        BitcoinBlockDifficulty: result.difficulty,
        BitcoinBlockChainwork: result.chainwork,
        BitcoinBlockPreviousBlockHash: result.previousblockhash,
        Type: network,
        // Disabled because we aren't running the pending/confirmed code for blocks
        // to save calls
        // Status: "reading",
        UpdatedAt: createdAt,
        CreatedAt: createdAt,
    };
    console.log(`Saving New Block #${id} In Reading Status`);
    // Save the data to the key
    return [id, data, datastore.save({
            key: datastore.key(['block', id]),
            data: data,
        }).then((result) => {
            console.log(`Saved Reading Block #${data.BitcoinBlockHeight}:\n`, JSON.stringify(result));
            // console.log(`Issuing New Block #${ data.BitcoinBlockHeight } Webhook Event`)
            // return axios.post(bitcoinWebhook, {
            //   name:     'block.reading',
            //   type:     network,
            //   password: bitcoinWebhookPassword,
            //   dataId:   data.Id_,
            //   dataKind: 'block',
            //   data:     data,
            // }).then((result) => {
            //   console.log(`Successfully Issued New Block #${ data.BitcoinBlockHeight } Webhook Event`)
            // }).catch((error) => {
            //   console.log(`Error Issuing New Block #${ data.BitcoinBlockHeight } Webhook Event:\n`, error)
            // })
        }).catch((error) => {
            console.log(`Error Saving New Block #${data.BitcoinBlockHeight}:\n`, error);
        })];
}
function savePendingBlockTransaction(datastore, blockHeight, transaction, vIn, vOut, vIdx, network, address, usage) {
    var query = datastore.createQuery('blockaddress').filter('Type', '=', network).filter('Address', '=', address);
    console.log(`Checking If Address ${address} Is Being Watched`);
    // Get all the results
    return datastore.runQuery(query).then((resultsAndQInfo) => {
        var [results, qInfo] = resultsAndQInfo;
        if (!results || !results[0]) {
            console.log(`Address ${address} Not Found:\n`, qInfo);
            return;
        }
        var createdAt = moment().toDate();
        // Convert to the Go Compatible Datastore Representation
        var id = `${network}/${address}/${transaction.txid}`;
        var data = {
            Id_: id,
            BitcoinTransactionBlockHash: transaction.blockhash,
            BitcoinTransactionBlockHeight: transaction.height,
            BitcoinTransactionTxId: transaction.txid,
            BitcoinTransactionHash: transaction.hash,
            BitcoinTransactionVersion: transaction.version,
            BitcoinTransactionSize: transaction.size,
            BitcoinTransactionVSize: transaction.vsize,
            BitcoinTransactionLocktime: transaction.locktime,
            BitcoinTransactionHex: transaction.hex,
            BitcoinTransactionConfirmations: transaction.confirmations,
            BitcoinTransactionTime: transaction.time,
            BitcoinTransactionBlockTime: transaction.blocktime,
            BitcoinTransactionType: vIn ? 'vin' : vOut ? 'vout' : 'error',
            BitcoinTransactionUsed: false,
            BitcoinTransactionVInTransactionTxId: '',
            BitcoinTransactionVInTransactionIndex: 0,
            BitcoinTransactionVInIndex: 0,
            BitcoinTransactionVInValue: 0,
            BitcoinTransactionVOutIndex: 0,
            BitcoinTransactionVOutValue: 0,
            Address: address,
            Usage: usage,
            Type: network,
            Status: 'pending',
            UpdatedAt: createdAt,
            CreatedAt: createdAt,
        };
        // console.log(`Transaction:\n${ JSON.stringify(transaction)}\nvIn:\n${ JSON.stringify(vIn) }\nvOut:\n${ JSON.stringify(vOut) }\n`)
        // console.log(`Type: ${ vIn ? 'vin' : vOut ? 'vout' : 'error' }`)
        if (vIn) {
            data.BitcoinTransactionVInTransactionTxId = vIn.txid;
            data.BitcoinTransactionVInTransactionIndex = vIn.vout;
            data.BitcoinTransactionVInIndex = vIdx;
            data.BitcoinTransactionVInValue = vIn.value * 1e9;
            console.log(`Updating a Used Block Transaction ${vIn.txid}`);
            var query = datastore.createQuery('blocktransaction').filter('Type', '=', network).filter('BitcoinTransactionTxId', '=', vIn.txid);
            datastore.runQuery(query).then((resultsAndQInfo) => {
                var [results, qInfo] = resultsAndQInfo;
                if (!results || !results[0]) {
                    console.log(`Transaction ${vIn.txid} Not Found:\n`, qInfo);
                    return;
                }
                var transaction = results[0];
                var id = transaction.Id_;
                var key = datastore.key(['blocktransaction', id]);
                transaction.BitcoinTransactionUsed = true;
                console.log(`Saving Used Block Transaction ${id}`);
                // console.log(`Transaction: ${ JSON.stringify(transaction) }`)
                return datastore.save({
                    key: key,
                    data: transaction,
                }).then((result) => {
                    console.log(`Saved Used Block Transaction ${id}`);
                }).catch((error) => {
                    console.log(`Error Saving Used Block Transaction ${id}`);
                });
            });
        }
        else if (vOut) {
            data.BitcoinTransactionVOutIndex = vOut.n;
            data.BitcoinTransactionVOutValue = vOut.value * 1e9;
        }
        console.log(`Saving New Block Transaction ${id} In Pending Status`);
        // console.log(`Transaction ${ JSON.stringify(transaction) }`)
        // Save the data to the key
        return datastore.save({
            key: datastore.key(['blocktransaction', id]),
            data: data,
        }).then((result) => {
            console.log(`Saved Pending Block Transaction ${id}:\n`, JSON.stringify(result));
            // console.log(`Issuing Pending Block Transaction ${ transaction.hash } Webhook Event`)
            // return axios.post(bitcoinWebhook, {
            //   name:     'blocktransaction.pending',
            //   type:     network,
            //   password: bitcoinWebhookPassword,
            //   dataId:   data.Id_,
            //   dataKind: 'blocktransaction',
            //   data:     data,
            // }).then((result) => {
            //   console.log(`Successfully Issued Pending Block Transaction ${ transaction.hash } Webhook Event`)
            // }).catch((error) => {
            //   console.log(`Error Issuing Pending Block Transaction ${ transaction.hash } Webhook Event:\n`, error)
            // })
        }).catch((error) => {
            console.log(`Error Saving New Block Transaction ${id}`);
        });
    }).catch((error) => {
        console.log(`Address ${address} Not Found Due to Error:\n`, error);
    });
}
function getAndUpdateConfirmedBlockTransaction(client, datastore, network, number, confirmations) {
    var query = datastore.createQuery('blocktransaction').filter('Type', '=', network).filter('BitcoinTransactionBlockHeight', '=', number);
    console.log(`Fetching Pending Block Transactions From Block #${number}`);
    // Get all the results
    return datastore.runQuery(query).then((resultsAndQInfo) => {
        var [results, qInfo] = resultsAndQInfo;
        if (!results || !results.length) {
            console.log(`Block #${number} Has No Block Transactions:\n`, qInfo);
            return;
        }
        console.log(`Block #${number} Has ${results.length} Block Transactions:\n`, qInfo);
        // Loop over the blocks
        var ps = results.map((transaction) => {
            var id = transaction.Id_;
            var key = datastore.key(['blocktransaction', id]);
            console.log(`Fetching Pending Block Transaction ${transaction.Id_}`);
            return new Promise((resolve, reject) => {
                client.rpc('getrawtransaction', transaction.BitcoinTransactionTxId, true).then((tx) => {
                    transaction.Confirmations = confirmations;
                    transaction.UpdatedAt = moment().toDate();
                    transaction.Status = 'confirmed';
                    console.log(`Updating Pending Block Transaction ${id} To Confirmed Status`);
                    return resolve(datastore.save({
                        key: key,
                        data: transaction,
                    }).then((result) => {
                        console.log(`Saved Confirmed Block Transaction ${id}:\n`, JSON.stringify(result));
                        // console.log(`Issuing Confirmed Block Transaction ${ transaction.EthereumTransactionHash } Webhook Event`)
                        // return axios.post(bitcoinWebhook, {
                        //   name:     'blocktransaction.confirmed',
                        //   type:     network,
                        //   password: bitcoinWebhookPassword,
                        //   dataId:   transaction.Id_,
                        //   dataKind: 'blocktransaction',
                        //   data:     transaction,
                        // }).then((result) => {
                        //   console.log(`Successfully Issued Confirmed Block Transaction ${ transaction.EthereumTransactionHash } Webhook Event`)
                        // }).catch((error) => {
                        //   console.log(`Error Issuing Confirmed Block Transaction ${ transaction.EthereumTransactionHash } Webhook Event:\n`, error)
                        // })
                    }).catch((error) => {
                        console.log(`Error Updating Pending Block Transaction ${id}:\n`, error);
                    }));
                });
            });
        });
        return Promise.all(ps);
        // Save the data to the key
    }).catch((error) => {
        console.log(`No Block Transactions From for Block #${number} Due To Error:\n`, error);
    });
}
// Import the Bloomfilter
var { BloomFilter } = require('bloomfilter');
// Imports the Google Cloud client library
var Datastore = require('@google-cloud/datastore');
// How many confirmations does it take to confirm? (default: 2)
var confirmations = process.env.CONFIRMATIONS || 2;
// How many concurrent blocks can it be processing? (default: 4)
var inflightLimit = process.env.INFLIGHT_LIMIT || 4;
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // Initialize the Bloomfilter for a 1*10^-6 error rate for 1 million entries)
        var bloom = new BloomFilter(4096 * 4096 * 2, 20);
        // Your Google Cloud Platform project ID
        var projectId = 'YOUR_PROJECT_ID';
        // Instantiates a client
        var datastore = Datastore({
            projectId: 'crowdstart-us',
            namespace: '_blockchains'
        });
        // Determine ethereum network
        var network = (process.env.ENVIRONMENT == 'production') ? 'bitcoin' : 'bitcoin-testnet';
        // Determine geth/parity node URI
        var nodeURI = (process.env.ENVIRONMENT == 'production') ? 'http://35.192.49.112:19283' : 'http://104.154.51.133:19283';
        // Determine username/password
        var username = (process.env.ENVIRONMENT == 'production' ? 'XqB3yYNcTzNspDQHVgZZNtr3hFZqWbM7PAv4xUnNJv5wCJch5Knc5LStphCsSqRw' : 'dxYJutheHpZkcUssz3A95nPdB2LKh5uc43kvAtdDmyfG37hv6ACEbWhM6jhwfeme');
        var password = (process.env.ENVIRONMENT == 'production' ? 'CmRuJvYSV2xE4aXRWKUXhKSpCVys7ceEkQ3eEBLTczPrF6h86ZzUkQK7QerjbgwZ' : 'CCMdzTzntX4P7yuYKFHCHqZFjtEUMDPRLDXRmPzkqsyNncREpnT6YLN66frXWAgu');
        console.log(`Starting Reader For '${network}' Using Node '${nodeURI}'`);
        console.log('Initializing Bloom Filter');
        // await updateBloom(bloom, datastore, network)
        console.log('Connecting to', nodeURI);
        // Create BTC Client
        var client = new BTCClient(nodeURI, username, password, inflightLimit);
        // Determine Connectivity by getting the current block number
        var currentNumber = yield client.rpc('getblockcount');
        // Ensure a connection was actually established
        if (currentNumber instanceof Error) {
            console.log('Could Not Connected');
            return;
        }
        console.log('Connected');
        // Report current full block
        console.log('Current FullBlock Is', currentNumber);
        var lastNumber;
        // Query to find the latest block read
        var query = datastore.createQuery('block').filter('Type', '=', network).order('BitcoinBlockHeight', { descending: true }).limit(1);
        console.log('Finding Block To Resume At');
        // Get all the results
        var [results, qInfo] = (yield datastore.runQuery(query));
        if (results[0]) {
            // console.log(JSON.stringify(results[0]))
            lastNumber = currentNumber = results[0].BitcoinBlockHeight;
            console.log(`Resuming From Block #${currentNumber}`);
        }
        else {
            lastNumber = currentNumber;
            console.log(`Resuming From 'latest'`);
        }
        console.log('Additional Query Info:\n', JSON.stringify(qInfo));
        console.log('Start Watching For New Blocks');
        currentNumber = 1231590;
        lastNumber = 1231600;
        var blockNumber = lastNumber;
        function run() {
            return __awaiter(this, void 0, void 0, function* () {
                // Determine Connectivity by getting the current block number
                blockNumber = yield client.rpc('getblockcount');
                if (currentNumber instanceof Error) {
                    console.log('Could Not Connected');
                }
                console.log(`Current Block  #${currentNumber}\nTarget Block #${blockNumber}\n`);
                // Ignore if blocknumber reached
                if (currentNumber >= blockNumber) {
                    return;
                }
                console.log(`\nInflight Requests: ${client.inflight}\n`);
                var number = currentNumber;
                currentNumber++;
                console.log(`Fetching New Block #${number}`);
                client.rpc('getblockhash', number).then((blockHash) => {
                    return client.rpc('getblock', blockHash);
                }).then((block) => {
                    var [_, data, readingBlockPromise] = saveReadingBlock(datastore, network, block);
                    ((block) => {
                        readingBlockPromise.then(() => {
                            return new Promise((resolve, reject) => {
                                setTimeout(function () {
                                    // It is cheaper on calls to just update the blocktransactions instead
                                    var confirmationBlock = number - confirmations;
                                    resolve(getAndUpdateConfirmedBlockTransaction(client, datastore, network, confirmationBlock, confirmations));
                                }, 12000);
                            });
                        });
                    })(block);
                    setTimeout(function () {
                        return __awaiter(this, void 0, void 0, function* () {
                            yield updateBloom(bloom, datastore, network);
                            // Iterate through transactions looking for ones we care about
                            for (var tx of block.tx) {
                                // console.log(`Processing Block Transaction ${ tx }`)
                                if (!tx) {
                                    console.log(`It happened! Block:\n${JSON.stringify(block)}\nTransaction:\n${tx}`);
                                    process.exit();
                                }
                                client.rpc('getrawtransaction', tx, true).then((transaction) => {
                                    // Add height to the transaction for easy referencing
                                    transaction.height = number;
                                    var ps = [];
                                    for (var i in transaction.vin) {
                                        var vin = transaction.vin[i];
                                        // Skip coinbase transactions
                                        if (!vin.txid) {
                                            continue;
                                        }
                                        ((vin, transaction) => {
                                            var p = client.rpc('getrawtransaction', vin.txid, true).then((previousTransaction) => {
                                                return {
                                                    transaction: transaction,
                                                    previousTransaction: previousTransaction,
                                                    previousVOut: previousTransaction.vout[vin.vout],
                                                    vIn: vin,
                                                };
                                            });
                                            ps.push(p);
                                        })(vin, transaction);
                                    }
                                    // Loop through vOuts to determine if there are transactions
                                    // received
                                    for (var i in transaction.vout) {
                                        var vOut = transaction.vout[i];
                                        var vOutAddress = vOut.scriptPubKey.addresses[0];
                                        if (bloom.test(vOutAddress)) {
                                            console.log(`Receiver Address ${vOutAddress}`);
                                            // Do the actual query and fetch
                                            savePendingBlockTransaction(datastore, number, transaction, null, vOut, i, network, vOutAddress, 'receiver');
                                        }
                                    }
                                    return Promise.all(ps);
                                }).then((...psResults) => {
                                    // Loop through vIns to determine if there are transactions
                                    // sent
                                    for (var i in psResults) {
                                        var psResult = psResults[i][0];
                                        var vIn = psResult.vIn;
                                        var previousVOut = psResult.previousVOut;
                                        var transaction = psResult.transaction;
                                        var vInAddress = previousVOut.scriptPubKey.addresses[0];
                                        // Merge Previous vOut and vIn
                                        vIn.value = previousVOut.value;
                                        if (bloom.test(vInAddress)) {
                                            console.log(`Sender Address ${vInAddress}`);
                                            // Do the actual query and fetch
                                            savePendingBlockTransaction(datastore, number, transaction, vIn, null, i, network, vInAddress, 'sender');
                                        }
                                    }
                                }).catch((error) => {
                                    // console.log(`Error Fetching Previous Block Transaction for vIn:\n`, error)
                                });
                            }
                        });
                    }, 10000);
                }).catch((error) => {
                    console.log(`Error Fetching Block #${number}:\n`, error);
                });
                //   web3.eth.getBlock(number, true, async function(error, result) {
                //     var [_, data, readingBlockPromise] = saveReadingBlock(datastore, network, result)
                //     setTimeout(async function() {
                //       await updateBloom(bloom, datastore, network)
                //       // Iterate through transactions looking for ones we care about
                //       for(var transaction of result.transactions) {
                //         console.log(`Processing Block Transaction ${ transaction.hash }`)
                //         var toAddress   = transaction.to
                //         var fromAddress = transaction.from
                //         console.log(`Checking Addresses\nTo:  ${ toAddress }\nFrom: ${ fromAddress }`)
                //         if (bloom.test(toAddress)) {
                //           console.log(`Receiver Address ${ toAddress }`)
                //           // Do the actual query and fetch
                //           savePendingBlockTransaction(
                //             datastore,
                //             transaction,
                //             network,
                //             toAddress,
                //             'receiver',
                //           )
                //         }
                //         if (bloom.test(fromAddress)) {
                //           console.log(`Sender Address ${ fromAddress }`)
                //           // Do the actual query and fetch
                //           savePendingBlockTransaction(
                //             datastore,
                //             transaction,
                //             network,
                //             fromAddress,
                //             'sender'
                //           )
                //         }
                //       }
                //     }, 10000);
                //     // Disabled to save calls
                //     // readingBlockPromise.then(()=>{
                //     //   return updatePendingBlock(datastore, data)
                //     // }).then(()=> {
                //     //   var confirmationBlock = result.number - confirmations
                //     //   return Promise.all([
                //     //     // getAndUpdateConfirmedBlock(
                //     //     //   datastore,
                //     //     //   network,
                //     //     //   confirmationBlock,
                //     //     //   confirmations
                //     //     // ),
                //     //     getAndUpdateConfirmedBlockTransaction(
                //     //       web3,
                //     //       datastore,
                //     //       network,
                //     //       confirmationBlock,
                //     //       confirmations
                //     //     ),
                //     //   ])
                //     // })
                //   })
            });
        }
        setInterval(run, 10000);
        // filter.watch(async function(error, result) {
        //   if (error) {
        //     console.log('Error While Watching Blocks:\n', error)
        //     return
        //   }
        //   // Get currentBlockNumber
        //   blockNumber = result.blockNumber
        // })
    });
}
main();
//# sourceMappingURL=index.js.map