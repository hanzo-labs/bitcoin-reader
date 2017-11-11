'use strict'

// Import Axios XHR client
var axios = require('axios')

// Import Moment.js
var moment  = require('moment-timezone')

// RFC3339 Time format used by Appengine/Datastore
var rfc3339 = 'YYYY-MM-DDTHH:mm:ssZ'

// Stores the last time block addresses were queries for in updateBloom
var blockAddressQueriedAt = null

// Hanzo Ethereum Webhook
var bitcoinWebhook = 'https://api.hanzo.io/bitcoin/webhook'
var bitcoinWebhookPassword = '3NRD2H3EbnrX4fFPBvHqUxsQjMMdVpbGXRn2jFggnq66bEEczjF3GK4r66JX3veY6WJUrxCSpB2AKsNRBHuDTHZkXBrY258tCpa4xMJPnyrCh5dZaPD5TvCC8BSHgEeMwkaN6Vgcme783fFBeS9eY88NpAgH84XbLL5W5AXahLa2ZSJy4VT8nkRVpSNPE32KGE4Jp3uhuHPUd7eKdYjrX9x8aukgQKtuyCNKdxhh4jw8ZzYZ2JUbgMmTtjduFswc'

// Get random id
function getRandomId() {
  return parseInt(Math.random() * 100000);
}

// Bitcoin Client
class BTCClient {
  address: string
  username: string
  password: string

  constructor(address: string, username: string, password: string) {
    this.address  = address
    this.username = username
    this.password = password
  }

  rpc(...params: string[]) {
    var method  = params.shift()
    var auth    = new Buffer(this.username + ':' + this.password).toString('base64');
    var id      = getRandomId()

    var options = {
      url: this.address,
      method: 'post',
      headers: {
        Authorization:  'Basic ' + auth
        // 'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        method:  method,
        id:      id,
        params:  params,
      }
    }

    console.log(`RPC Request\n${JSON.stringify(options)}`)

    return axios(options).then((res)=> {
      console.log(`RPC Response ${res.data.result}`)
      if (res.data.result) {
        return res.data.result
      }

      throw new Error(res.data.error)
    })
  }
}

// This function updates a bloom filter with new addresses
async function updateBloom(bloom, datastore, network) {
  // Query all the blockaddresses
  var query = datastore.createQuery('blockaddress').filter('Type', '=', network)

  if (blockAddressQueriedAt) {
    query = query.filter('CreatedAt', '>=', blockAddressQueriedAt)
    console.log(`Checking Addresses Created After '${ blockAddressQueriedAt }'`)
  }

  console.log(`Start Getting '${ network }' Block Addresses`)

  // Get all the results
  var [results, qInfo] = (await datastore.runQuery(query))

  console.log(`Found ${ results.length } Block Addresses`)
  console.log('Additional Query Info:\n', JSON.stringify(qInfo))

  blockAddressQueriedAt = moment().toDate()

  // Start building the bloom filter from the results
  for (var result of results) {
    console.log(`Adding BlockAddress ${ result.Address } to Bloom Filter`)
    bloom.add(result.Address)
  }
}

// function strip0x(str) {
//   return str.replace(/^0x/, '')
// }

// This function converts an array into a Datastore compatible array
function toDatastoreArray(array, type) {
  var values = array.map((x)=>{
    var y = {}
    y[`${ type }Value`] = x
    return y
  })

  return {
    values: values
  }
}

function saveReadingBlock(datastore, network, result) {
  var createdAt = moment().toDate()

  // Convert to the Go Compatible Datastore Representation
  var id  = `${ network }/${ result.hash }`
  var data = {
    Id_: id,

	BitcoinBlockHeight:            result.height,
	BitcoinBlockHash:              result.hash,
	BitcoinBlockStrippedSize:      result.strippedsize,
	BitcoinBlockSize:              result.size,
	BitcoinBlockWeight:            result.weight,
	BitcoinBlockVersion:           result.version,
	BitcoinBlockVersionHex:        result.versionHex,
	BitcoinBlockMerkleroot:        result.merkleroot,
	BitcoinBlockTime:              result.time,
	BitcoinBlockMedianTime:        result.mediantime,
	BitcoinBlockNonce:             result.nonce,
	BitcoinBlockBits:              result.bits,
	BitcoinBlockDifficulty:        result.difficulty,
	BitcoinBlockChainwork:         result.chainwork,
	BitcoinBlockPreviousBlockHash: result.previousblockhash,

    Type:   network,
    // Disabled because we aren't running the pending/confirmed code for blocks
    // to save calls
    // Status: "reading",

    UpdatedAt: createdAt,
    CreatedAt: createdAt,
  }

  console.log(`Saving New Block #${ id } In Reading Status`)

  // Save the data to the key
  return [id, data, datastore.save({
    key:  datastore.key(['block', id]),
    data: data,
  }).then((result) => {
    console.log(`Reading Block #${ data.BitcoinBlockHeight } Saved:\n`, JSON.stringify(result))

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
    console.log(`Error Saving New Block #${ data.BitcoinBlockHeight }:\n`, error)
  })]
}

function savePendingBlockTransaction(datastore, number, transaction, vin, vout, network, usage) {
  var query = datastore.createQuery('blockaddress').filter('Type', '=', network).filter('Address', '=', address)

  console.log(`Checking If Address ${ address } Is Being Watched`)

  // Get all the results
  return datastore.runQuery(query).then((resultsAndQInfo) => {
    var [results, qInfo] = resultsAndQInfo
    if (!results || !results[0]) {
      console.log(`Address ${ address } Not Found:\n`, qInfo)
      return
    }

    var createdAt = moment().toDate()

    // Convert to the Go Compatible Datastore Representation
    var id  = `${ network }/${address}/${ transaction.hash }`
    var data = {
      Id_: id,

      BitcoinTransactionHeight        string                 `json:"bitcoinTransactionHeight"`
      BitcoinTransactionHash          string                 `json:"bitcoinTransactionHash"`
      BitcoinTransactionVersion       int64                  `json:"bitcoinTransactionVersion"`
      BitcoinTransactionSize          int64                  `json:"bitcoinTransactionSize"`
      BitcoinTransactionVSize         int64                  `json:"bitcoinTransactionVSize"`
      BitcoinTransactionLocktime      int64                  `json:"bitcoinTransactionLocktime"`
      BitcoinTransactionHex           string                 `json:"bitcoinTransactionHex"`
      BitcoinTransactionBlockHash     string                 `json:"bitcoinTransactionBlockHash"`
      BitcoinTransactionConfirmations int64                  `json:"bitcoinTransactionConfirmations"`
      BitcoinTransactionTime          int64                  `json:"bitcoinTransactionTime"`
      BitcoinTransactionBlockTime     int64                  `json:"bitcoinTransactionBlockTime"`
      BitcoinTransactionType          BitcoinTransactionType `json:"bitcoinTransactionType"`

      EthereumTransactionHash:             transaction.hash,
      EthereumTransactionNonce:            transaction.nonce,
      EthereumTransactionBlockHash:        transaction.blockHash,
      EthereumTransactionBlockNumber:      transaction.blockNumber,
      EthereumTransactionTransactionIndex: transaction.transactionIndex,
      EthereumTransactionFrom:             transaction.from,
      EthereumTransactionTo:               transaction.to,
      EthereumTransactionValue:            transaction.value.toString(10),
      EthereumTransactionGasPrice:         transaction.gasPrice.toString(10),
      EthereumTransactionGas:              transaction.gas.toString(10),
      EthereumTransactionInput:            transaction.input,

      Address: address,
      Usage:   usage,
      Type:    network,
      Status:  'pending',

      UpdatedAt: createdAt,
      CreatedAt: createdAt,
    }

    console.log(`Saving New Block Transaction with Id '${ id }' In Pending Status`)

    // Save the data to the key
    return datastore.save({
      key:  datastore.key(['blocktransaction', id]),
      data: data,
    }).then((result)=> {
      console.log(`Pending Block Transaction ${ transaction.hash } Saved:\n`, JSON.stringify(result))

      console.log(`Issuing Pending Block Transaction ${ transaction.hash } Webhook Event`)
      return axios.post(bitcoinWebhook, {
        name:     'blocktransaction.pending',
        type:     network,
        password: bitcoinWebhookPassword,

        dataId:   data.Id_,
        dataKind: 'blocktransaction',
        data:     data,
      }).then((result) => {
        console.log(`Successfully Issued Pending Block Transaction ${ transaction.hash } Webhook Event`)
      }).catch((error) => {
        console.log(`Error Issuing Pending Block Transaction ${ transaction.hash } Webhook Event:\n`, error)
      })
    }).catch((error) =>{
      console.log(`Error Saving New Block Transaction ${ transaction.hash }:\n`, error)
    })
  }).catch((error) => {
    console.log(`Address ${ address } Not Found Due to Error:\n`, error)
  })
}

function getAndUpdateConfirmedBlockTransaction(web3, datastore, network, number, confirmations) {
  var query = datastore.createQuery('blocktransaction').filter('Type', '=', network).filter('EthereumTransactionBlockNumber', '=', number)

  console.log(`Fetching Pending Block Transactions From Block #${ number }`)

  // Get all the results
  return datastore.runQuery(query).then((resultsAndQInfo) => {
    var [results, qInfo] = resultsAndQInfo

    if (!results || !results.length) {
      console.log(`Block #${ number } Has No Block Transactions:\n`, qInfo)
      return
    }

    // Loop over the blocks
    var ps = results.map((transaction) => {
      var id  = transaction.Id_
      var key = datastore.key(['blocktransaction', id])

      console.log(`Fetching Pending Block Transaction '${ transaction.EthereumTransactionHash }' Receipt`)

      return new Promise((resolve, reject) => {
        web3.eth.getTransactionReceipt(transaction.EthereumTransactionHash, (error, receipt) => {
          console.log(error, JSON.stringify(receipt))

          if (error) {
            return reject(error)
          }

          transaction.EthereumTransactionReceiptBlockHash         = receipt.blockHash
          transaction.EthereumTransactionReceiptBlockNumber       = receipt.blockNumber
          transaction.EthereumTransactionReceiptTransactionHash   = receipt.transactionHash
          transaction.EthereumTransactionReceiptTransactionIndex  = receipt.transactionIndex
          transaction.EthereumTransactionReceiptFrom              = receipt.from
          transaction.EthereumTransactionReceiptTo                = receipt.to
          transaction.EthereumTransactionReceiptCumulativeGasUsed = receipt.cumulativeGasUsed
          transaction.EthereumTransactionReceiptGasUsed           = receipt.gasUsed
          transaction.EthereumTransactionReceiptContractAddress   = receipt.contractAddress

          transaction.Confirmations = confirmations
          transaction.UpdatedAt     = moment().toDate()
          transaction.Status        = 'confirmed'

          console.log(`Updating Pending Block Transaction with Id '${ id }' To Confirmed Status`)

          return resolve(datastore.save({
            key:  key,
            data: transaction,
          }).then((result)=> {
            console.log(`Confirmed Block Transaction ${ transaction.EthereumTransactionHash } Saved:\n`, JSON.stringify(result))

            console.log(`Issuing Confirmed Block Transaction ${ transaction.EthereumTransactionHash } Webhook Event`)
            return axios.post(bitcoinWebhook, {
              name:     'blocktransaction.confirmed',
              type:     network,
              password: bitcoinWebhookPassword,

              dataId:   transaction.Id_,
              dataKind: 'blocktransaction',
              data:     transaction,
            }).then((result) => {
              console.log(`Successfully Issued Confirmed Block Transaction ${ transaction.EthereumTransactionHash } Webhook Event`)
            }).catch((error) => {
              console.log(`Error Issuing Confirmed Block Transaction ${ transaction.EthereumTransactionHash } Webhook Event:\n`, error)
            })
          }).catch((error) =>{
            console.log(`Error Updating Pending Block Transaction ${ transaction.EthereumTransactionHash }:\n`, error)
          }))
        })
      })
    })

    return Promise.all(ps)

    // Save the data to the key
  }).catch((error) => {
    console.log(`No Block Transactions From for Block #${ number } Due To Error:\n`, error)
  })
}


