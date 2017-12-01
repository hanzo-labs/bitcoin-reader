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
  inflight: number
  inflightLimit: number
  _fnQueue: {(): void}[]

  constructor(address: string, username: string, password: string, inflightLimit = 10) {
    this.address  = address
    this.username = username
    this.password = password
    this.inflight = 0
    this.inflightLimit = inflightLimit
    this._fnQueue = []
  }

  _enqueue(fn: {():void} ) {
    this._fnQueue.push(fn)
    // console.log(`Enqueuing a request, Queue Size: ${ this._fnQueue.length }`)
    this._next()
  }

  _next() {
    if (this._fnQueue.length > 0 && this.inflight < this.inflightLimit) {
      var fn = this._fnQueue.shift()
      fn()
      // console.log(`Executing a request, Inflight: ${ this.inflight }`)
      this._next()
    }
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

    var fn: { ():void }
    var self = this

    // console.log(`RPC Request\n${JSON.stringify(options)}`)
    var p = new Promise((resolve, reject) => {
      fn = ()=> {
        self.inflight++
        // console.log(`RPC POST: ${ JSON.stringify(options.data) }`)
        var p = axios(options).then((res) => {
          self.inflight--
          // console.log(`RPC Response ${res.data.result}`)
          if (res.data.result) {
            // console.log(`RPC POST SUCCESS`)
            resolve(res.data.result)
          } else {
            // console.log(`RPC POST FAILURE`)
            reject(new Error(res.data.error))
          }
          self._next()
        })
      }
    })

    this._enqueue(fn)

    return p
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
    console.log(`Saved Reading Block #${ data.BitcoinBlockHeight }:\n`, JSON.stringify(result))

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

function savePendingBlockTransaction(datastore, blockHeight, transaction, vIn, vOut, vIdx, network, address, usage) {
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
    var id  = `${ network }/${address}/${ transaction.txid }`
    var data = {
      Id_: id,

      BitcoinTransactionBlockHash:     transaction.blockhash,
      BitcoinTransactionBlockHeight:   transaction.height,

      BitcoinTransactionTxId:          transaction.txid,
      BitcoinTransactionHash:          transaction.hash,
      BitcoinTransactionVersion:       transaction.version,
      BitcoinTransactionSize:          transaction.size,
      BitcoinTransactionVSize:         transaction.vsize,
      BitcoinTransactionLocktime:      transaction.locktime,
      BitcoinTransactionHex:           transaction.hex,
      BitcoinTransactionConfirmations: transaction.confirmations,
      BitcoinTransactionTime:          transaction.time,
      BitcoinTransactionBlockTime:     transaction.blocktime,
      BitcoinTransactionType:          vIn ? 'vin' : vOut ? 'vout' : 'error',
      BitcoinTransactionUsed:          false,

      Address: address,
      Usage:   usage,
      Type:    network,
      Status:  'pending',

      UpdatedAt: createdAt,
      CreatedAt: createdAt,
    }

    // console.log(`Transaction:\n${ JSON.stringify(transaction)}\nvIn:\n${ JSON.stringify(vIn) }\nvOut:\n${ JSON.stringify(vOut) }\n`)
    // console.log(`Type: ${ vIn ? 'vin' : vOut ? 'vout' : 'error' }`)

    if (vIn) {
      data.BitcoinTransactionVInTransactionTxId  = vIn.txid
      data.BitcoinTransactionVInTransactionIndex = vIn.vout
      data.BitcoinTransactionVInIndex            = vIdx
      data.BitcoinTransactionVInValue            = vIn.value

      console.log(`Updating a Used Block Transaction ${ vIn.txid }`)
      var query = datastore.createQuery('blocktransaction').filter('Type', '=', network).filter('BitcoinTransactionTxId', '=', vIn.txid)
      datastore.runQuery(query).then((resultsAndQInfo) => {
        var [results, qInfo] = resultsAndQInfo
        if (!results || !results[0]) {
          console.log(`Transaction ${ vIn.txid } Not Found:\n`, qInfo)
          return
        }

        var transaction = results[0]
        var id  = transaction.Id_
        var key = datastore.key(['blocktransaction', id])

        transaction.BitcoinTransactionUsed = true

        console.log(`Saving Used Block Transaction ${ id }`)
        // console.log(`Transaction: ${ JSON.stringify(transaction) }`)
        return datastore.save({
          key:  key,
          data: transaction,
        }).then((result)=> {
          console.log(`Saved Used Block Transaction ${ id }`)
        }).catch((error) =>{
          console.log(`Error Saving Used Block Transaction ${ id }`)
        })
      })
    } else if (vOut) {
      data.BitcoinTransactionVOutIndex = vOut.n
      data.BitcoinTransactionVOutValue = vOut.value
    }

    console.log(`Saving New Block Transaction ${ id } In Pending Status`)
    // console.log(`Transaction ${ JSON.stringify(transaction) }`)

    // Save the data to the key
    return datastore.save({
      key:  datastore.key(['blocktransaction', id]),
      data: data,
    }).then((result)=> {
      console.log(`Saved Pending Block Transaction ${ id }:\n`, JSON.stringify(result))

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
    }).catch((error) =>{
      console.log(`Error Saving New Block Transaction ${ id }`)
    })
  }).catch((error) => {
    console.log(`Address ${ address } Not Found Due to Error:\n`, error)
  })
}

function getAndUpdateConfirmedBlockTransaction(client, datastore, network, number, confirmations) {
  var query = datastore.createQuery('blocktransaction').filter('Type', '=', network).filter('BitcoinTransactionBlockHeight', '=', number)

  console.log(`Fetching Pending Block Transactions From Block #${ number }`)

  // Get all the results
  return datastore.runQuery(query).then((resultsAndQInfo) => {
    var [results, qInfo] = resultsAndQInfo

    if (!results || !results.length) {
      console.log(`Block #${ number } Has No Block Transactions:\n`, qInfo)
      return
    }
    console.log(`Block #${ number } Has ${ results.length } Block Transactions:\n`, qInfo)

    // Loop over the blocks
    var ps = results.map((transaction) => {
      var id  = transaction.Id_
      var key = datastore.key(['blocktransaction', id])

      console.log(`Fetching Pending Block Transaction ${ transaction.Id_ }`)

      return new Promise((resolve, reject) => {
        client.rpc('getrawtransaction', transaction.BitcoinTransactionTxId, true).then((tx) => {

          transaction.Confirmations = confirmations
          transaction.UpdatedAt     = moment().toDate()
          transaction.Status        = 'confirmed'

          console.log(`Updating Pending Block Transaction ${ id } To Confirmed Status`)

          return resolve(datastore.save({
            key:  key,
            data: transaction,
          }).then((result)=> {
            console.log(`Saved Confirmed Block Transaction ${ id }:\n`, JSON.stringify(result))

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
          }).catch((error) =>{
            console.log(`Error Updating Pending Block Transaction ${ id }:\n`, error)
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


