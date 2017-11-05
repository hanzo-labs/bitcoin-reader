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
var ethereumWebhook = 'https://api.hanzo.io/ethereum/webhook';
var ethereumWebhookPassword = '3NRD2H3EbnrX4fFPBvHqUxsQjMMdVpbGXRn2jFggnq66bEEczjF3GK4r66JX3veY6WJUrxCSpB2AKsNRBHuDTHZkXBrY258tCpa4xMJPnyrCh5dZaPD5TvCC8BSHgEeMwkaN6Vgcme783fFBeS9eY88NpAgH84XbLL5W5AXahLa2ZSJy4VT8nkRVpSNPE32KGE4Jp3uhuHPUd7eKdYjrX9x8aukgQKtuyCNKdxhh4jw8ZzYZ2JUbgMmTtjduFswc';
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
    var id = `${network}/${result.number}`;
    var data = {
        Id_: id,
        EthereumBlockNumber: result.number,
        EthereumBlockHash: result.hash,
        EthereumBlockParentHash: result.parentHash,
        EthereumBlockNonce: result.nonce,
        EthereumBlockSha3Uncles: result.sha3Uncles,
        EthereumBlockLogsBloom: result.logsBloom,
        EthereumBlockTransactionsRoot: result.transactionsRoot,
        EthereumBlockStateRoot: result.stateRoot,
        EthereumBlockMiner: result.miner,
        EthereumBlockDifficulty: result.difficulty.toString(10),
        EthereumBlockTotalDifficulty: result.totalDifficulty.toString(10),
        EthereumBlockExtraData: result.extraData,
        EthereumBlockSize: result.size,
        EthereumBlockGasLimit: result.gasLimit,
        EthereumBlockGasUsed: result.gasUsed,
        EthereumBlockTimeStamp: result.timestamp,
        EthereumBlockUncles: toDatastoreArray(result.uncles, 'string'),
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
            console.log(`Reading Block #${data.EthereumBlockNumber} Saved:\n`, JSON.stringify(result));
            console.log(`Issuing New Block #${data.EthereumBlockNumber} Webhook Event`);
            return axios.post(ethereumWebhook, {
                name: 'block.reading',
                type: network,
                password: ethereumWebhookPassword,
                dataId: data.Id_,
                dataKind: 'block',
                data: data,
            }).then((result) => {
                console.log(`Successfully Issued New Block #${data.EthereumBlockNumber} Webhook Event`);
            }).catch((error) => {
                console.log(`Error Issuing New Block #${data.EthereumBlockNumber} Webhook Event:\n`, error);
            });
        }).catch((error) => {
            console.log(`Error Saving New Block #${data.EthereumBlockNumber}:\n`, error);
        })];
}
function updatePendingBlock(datastore, data) {
    console.log(`Updating Reading Block #'${data.Id_}' To Pending Status`);
    // Update the block status to pending
    data.Status = 'pending';
    data.UpdatedAt = moment().toDate();
    // Save the data to the key
    return datastore.save({
        key: datastore.key(['block', data.Id_]),
        data: data,
    }).then((result) => {
        console.log(`Pending Block #${data.EthereumBlockNumber} Updated:\n`, JSON.stringify(result));
        console.log(`Issuing Pending Block #${data.EthereumBlockNumber} Webhook Event`);
        return axios.post(ethereumWebhook, {
            name: 'block.pending',
            type: data.Type,
            password: ethereumWebhookPassword,
            dataId: data.Id_,
            dataKind: 'block',
            data: data,
        }).then((result) => {
            console.log(`Successfully Issued Pending Block #${data.EthereumBlockNumber} Webhook Event`);
        }).catch((error) => {
            console.log(`Error Issuing Pending Block #${data.EthereumBlockNumber} Webhook Event:\n`, error);
        });
    }).catch((error) => {
        console.log(`Error Updating Reading Block #${data.EthereumBlockNumber}:\n`, error);
    });
}
function getAndUpdateConfirmedBlock(datastore, network, number, confirmations) {
    var id = `${network}/${number}`;
    var key = datastore.key(['block', id]);
    console.log(`Fetching Pending Block #'${number}'`);
    // Get the pending block to confirm
    return datastore.get(key).then((result) => {
        var [data] = result;
        if (!data) {
            console.log(`Pending Block #${number} Not Found`);
            return;
        }
        data.Confirmations = confirmations;
        data.UpdatedAt = moment().toDate();
        data.Status = 'confirmed';
        console.log(`Updating Pending Block #${number} To Confirmed Status`);
        // Save the data to the key
        return datastore.save({
            key: key,
            data: data,
        }).then((result) => {
            console.log(`Confirmed Block #${data.EthereumBlockNumber} Updated:\n`, JSON.stringify(result));
            console.log(`Issuing Confirmed Block #${data.EthereumBlockNumber} Webhook Event`);
            return axios.post(ethereumWebhook, {
                name: 'block.confirmed',
                type: network,
                password: ethereumWebhookPassword,
                dataId: data.Id_,
                dataKind: 'block',
                data: data,
            }).then((result) => {
                console.log(`Successfully Issued Confirmed Block #${data.EthereumBlockNumber} Webhook Event`);
            }).catch((error) => {
                console.log(`Error Issuing Confirmed Block #${data.EthereumBlockNumber} Webhook Event:\n`, error);
            });
        }).catch((error) => {
            console.log(`Error Saving Confirmed Block #${data.EthereumBlockNumber}:\n`, error);
        });
    }).catch((error) => {
        console.log(`Error Getting Pending Block #${number}:\n`, error);
    });
}
function savePendingBlockTransaction(datastore, transaction, network, address, usage) {
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
        var id = `${network}/${address}/${transaction.hash}`;
        var data = {
            Id_: id,
            EthereumTransactionHash: transaction.hash,
            EthereumTransactionNonce: transaction.nonce,
            EthereumTransactionBlockHash: transaction.blockHash,
            EthereumTransactionBlockNumber: transaction.blockNumber,
            EthereumTransactionTransactionIndex: transaction.transactionIndex,
            EthereumTransactionFrom: transaction.from,
            EthereumTransactionTo: transaction.to,
            EthereumTransactionValue: transaction.value.toString(10),
            EthereumTransactionGasPrice: transaction.gasPrice.toString(10),
            EthereumTransactionGas: transaction.gas.toString(10),
            EthereumTransactionInput: transaction.input,
            Address: address,
            Usage: usage,
            Type: network,
            Status: 'pending',
            UpdatedAt: createdAt,
            CreatedAt: createdAt,
        };
        console.log(`Saving New Block Transaction with Id '${id}' In Pending Status`);
        // Save the data to the key
        return datastore.save({
            key: datastore.key(['blocktransaction', id]),
            data: data,
        }).then((result) => {
            console.log(`Pending Block Transaction ${transaction.hash} Saved:\n`, JSON.stringify(result));
            console.log(`Issuing Pending Block Transaction ${transaction.hash} Webhook Event`);
            return axios.post(ethereumWebhook, {
                name: 'blocktransaction.pending',
                type: network,
                password: ethereumWebhookPassword,
                dataId: data.Id_,
                dataKind: 'blocktransaction',
                data: data,
            }).then((result) => {
                console.log(`Successfully Issued Pending Block Transaction ${transaction.hash} Webhook Event`);
            }).catch((error) => {
                console.log(`Error Issuing Pending Block Transaction ${transaction.hash} Webhook Event:\n`, error);
            });
        }).catch((error) => {
            console.log(`Error Saving New Block Transaction ${transaction.hash}:\n`, error);
        });
    }).catch((error) => {
        console.log(`Address ${address} Not Found Due to Error:\n`, error);
    });
}
function getAndUpdateConfirmedBlockTransaction(web3, datastore, network, number, confirmations) {
    var query = datastore.createQuery('blocktransaction').filter('Type', '=', network).filter('EthereumTransactionBlockNumber', '=', number);
    console.log(`Fetching Pending Block Transactions From Block #${number}`);
    // Get all the results
    return datastore.runQuery(query).then((resultsAndQInfo) => {
        var [results, qInfo] = resultsAndQInfo;
        if (!results || !results.length) {
            console.log(`Block #${number} Has No Block Transactions:\n`, qInfo);
            return;
        }
        // Loop over the blocks
        var ps = results.map((transaction) => {
            var id = transaction.Id_;
            var key = datastore.key(['blocktransaction', id]);
            console.log(`Fetching Pending Block Transaction '${transaction.EthereumTransactionHash}' Receipt`);
            return new Promise((resolve, reject) => {
                web3.eth.getTransactionReceipt(transaction.EthereumTransactionHash, (error, receipt) => {
                    console.log(error, JSON.stringify(receipt));
                    if (error) {
                        return reject(error);
                    }
                    transaction.EthereumTransactionReceiptBlockHash = receipt.blockHash;
                    transaction.EthereumTransactionReceiptBlockNumber = receipt.blockNumber;
                    transaction.EthereumTransactionReceiptTransactionHash = receipt.transactionHash;
                    transaction.EthereumTransactionReceiptTransactionIndex = receipt.transactionIndex;
                    transaction.EthereumTransactionReceiptFrom = receipt.from;
                    transaction.EthereumTransactionReceiptTo = receipt.to;
                    transaction.EthereumTransactionReceiptCumulativeGasUsed = receipt.cumulativeGasUsed;
                    transaction.EthereumTransactionReceiptGasUsed = receipt.gasUsed;
                    transaction.EthereumTransactionReceiptContractAddress = receipt.contractAddress;
                    transaction.Confirmations = confirmations;
                    transaction.UpdatedAt = moment().toDate();
                    transaction.Status = 'confirmed';
                    console.log(`Updating Pending Block Transaction with Id '${id}' To Confirmed Status`);
                    return resolve(datastore.save({
                        key: key,
                        data: transaction,
                    }).then((result) => {
                        console.log(`Confirmed Block Transaction ${transaction.EthereumTransactionHash} Saved:\n`, JSON.stringify(result));
                        console.log(`Issuing Confirmed Block Transaction ${transaction.EthereumTransactionHash} Webhook Event`);
                        return axios.post(ethereumWebhook, {
                            name: 'blocktransaction.confirmed',
                            type: network,
                            password: ethereumWebhookPassword,
                            dataId: transaction.Id_,
                            dataKind: 'blocktransaction',
                            data: transaction,
                        }).then((result) => {
                            console.log(`Successfully Issued Confirmed Block Transaction ${transaction.EthereumTransactionHash} Webhook Event`);
                        }).catch((error) => {
                            console.log(`Error Issuing Confirmed Block Transaction ${transaction.EthereumTransactionHash} Webhook Event:\n`, error);
                        });
                    }).catch((error) => {
                        console.log(`Error Updating Pending Block Transaction ${transaction.EthereumTransactionHash}:\n`, error);
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
// How many confirmations does it take to confirm? (default: 12)
var confirmations = process.env.CONFIRMATIONS || 12;
// How many concurrent blocks can it be processing? (default: 10)
var inflightLimit = process.env.INFLIGHT_LIMIT || 10;
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
        var network = (process.env.ENVIRONMENT == 'production') ? 'ethereum' : 'ethereum-ropsten';
        // Determine geth/parity node URI
        var nodeURI = (process.env.ENVIRONMENT == 'production') ? 'http://35.202.166.74:80' : 'http://35.192.74.139:80';
        console.log(`Starting Reader For '${network}' Using Node '${nodeURI}'`);
        console.log('Initializing Bloom Filter');
        yield updateBloom(bloom, datastore, network);
        // Import Web3
        var Web3 = require('web3');
        console.log('Connecting to', nodeURI);
        var web3 = new Web3(new Web3.providers.HttpProvider(nodeURI, 10000));
        // Ensure a connection was actually established
        if (!web3.isConnected()) {
            console.log('Could Not Connected');
            console.log(`Are you running 'sudo geth --cache=1024 --rpc --rpcaddr 0.0.0.0 --rpcport 80 --syncmode=fast --rpccorsdomain "*" in your geth node?'`);
            return;
        }
        console.log('Connected');
        // Report current full block
        console.log('Current FullBlock Is', web3.eth.blockNumber);
        // Report Syncing Status
        var lastBlockData = {};
        web3.eth.isSyncing((isSynced, blockData) => {
            if (isSynced) {
                console.log('Syncing Complete');
                return;
            }
            if (lastBlockData.currentBlock != blockData.currentBlock) {
                console.log(`Currently @ ${blockData.currentBlock}, Syncing From ${blockData.startingBlock} To ${blockData.highestBlock}`);
                lastBlockData = blockData;
            }
        });
        var lastBlock = undefined;
        // Query to find the latest block read
        var query = datastore.createQuery('block').filter('Type', '=', network).order('EthereumBlockNumber', { descending: true }).limit(1);
        console.log('Finding Block To Resume At');
        // Get all the results
        var [results, qInfo] = (yield datastore.runQuery(query));
        if (results[0]) {
            // console.log(JSON.stringify(results[0]))
            lastBlock = results[0].EthereumBlockNumber;
            console.log(`Resuming From Block #${lastBlock}`);
        }
        else {
            lastBlock = 'latest';
            console.log(`Resuming From 'latest'`);
        }
        console.log('Additional Query Info:\n', JSON.stringify(qInfo));
        console.log('Start Watching For New Blocks');
        lastBlock = 1962800;
        // Start watching for new blocks
        var filter = web3.eth.filter({
            // 1892728
            fromBlock: lastBlock,
            toBlock: 'latest',
        });
        var lastNumber = lastBlock == 'latest' ? web3.eth.blockNumber : lastBlock - 1;
        var currentNumber = lastNumber;
        var blockNumber = lastNumber;
        var inflight = 0;
        function run() {
            // Ignore if inflight limit reached or blocknumber reached
            if (inflight > inflightLimit || currentNumber >= blockNumber) {
                return;
            }
            console.log(`${inflight} Inflight Requests\nTarget Block #${blockNumber}\nCurrent Block #${currentNumber}`);
            inflight++;
            currentNumber++;
            var number = currentNumber;
            console.log(`Fetching New Block #${number}`);
            web3.eth.getBlock(number, true, function (error, result) {
                return __awaiter(this, void 0, void 0, function* () {
                    if (error) {
                        console.log(`Error Fetching Block #${number}:\n`, error);
                        return;
                    }
                    var [_, data, readingBlockPromise] = saveReadingBlock(datastore, network, result);
                    setTimeout(function () {
                        return __awaiter(this, void 0, void 0, function* () {
                            yield updateBloom(bloom, datastore, network);
                            // Iterate through transactions looking for ones we care about
                            for (var transaction of result.transactions) {
                                console.log(`Processing Block Transaction ${transaction.hash}`);
                                var toAddress = transaction.to;
                                var fromAddress = transaction.from;
                                console.log(`Checking Addresses\nTo:  ${toAddress}\nFrom: ${fromAddress}`);
                                if (bloom.test(toAddress)) {
                                    console.log(`Receiver Address ${toAddress}`);
                                    // Do the actual query and fetch
                                    savePendingBlockTransaction(datastore, transaction, network, toAddress, 'receiver');
                                }
                                if (bloom.test(fromAddress)) {
                                    console.log(`Sender Address ${fromAddress}`);
                                    // Do the actual query and fetch
                                    savePendingBlockTransaction(datastore, transaction, network, fromAddress, 'sender');
                                }
                            }
                        });
                    }, 10000);
                    // Disabled to save calls
                    // readingBlockPromise.then(()=>{
                    //   return updatePendingBlock(datastore, data)
                    // }).then(()=> {
                    //   var confirmationBlock = result.number - confirmations
                    //   return Promise.all([
                    //     // getAndUpdateConfirmedBlock(
                    //     //   datastore,
                    //     //   network,
                    //     //   confirmationBlock,
                    //     //   confirmations
                    //     // ),
                    //     getAndUpdateConfirmedBlockTransaction(
                    //       web3,
                    //       datastore,
                    //       network,
                    //       confirmationBlock,
                    //       confirmations
                    //     ),
                    //   ])
                    // })
                    ((result) => {
                        readingBlockPromise.then(() => {
                            return new Promise((resolve, reject) => {
                                setTimeout(function () {
                                    // It is cheaper on calls to just update the blocktransactions instead
                                    var confirmationBlock = result.number - confirmations;
                                    resolve(getAndUpdateConfirmedBlockTransaction(web3, datastore, network, confirmationBlock, confirmations));
                                    inflight--;
                                }, 12000);
                            });
                        });
                    })(result);
                });
            });
        }
        setInterval(run, 1);
        filter.watch(function (error, result) {
            return __awaiter(this, void 0, void 0, function* () {
                if (error) {
                    console.log('Error While Watching Blocks:\n', error);
                    return;
                }
                // Get currentBlockNumber
                blockNumber = result.blockNumber;
            });
        });
    });
}
main();
//# sourceMappingURL=index.js.map