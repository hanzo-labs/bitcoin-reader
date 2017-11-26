'use strict'

// Import the Bloomfilter
var { BloomFilter } = require('bloomfilter')

// Imports the Google Cloud client library
var Datastore = require('@google-cloud/datastore')

// How many confirmations does it take to confirm? (default: 2)
var confirmations = process.env.CONFIRMATIONS || 2

// How many concurrent blocks can it be processing? (default: 4)
var inflightLimit = process.env.INFLIGHT_LIMIT || 4

async function main() {
  // Initialize the Bloomfilter for a 1*10^-6 error rate for 1 million entries)
  var bloom = new BloomFilter(4096 * 4096 * 2, 20)

  // Your Google Cloud Platform project ID
  var projectId = 'YOUR_PROJECT_ID'

  // Instantiates a client
  var datastore = Datastore({
    projectId: 'crowdstart-us',
    namespace: '_blockchains'
  })

  // Determine ethereum network
  var network = (process.env.ENVIRONMENT == 'production') ? 'bitcoin' : 'bitcoin-testnet'

  // Determine geth/parity node URI
  var nodeURI = (process.env.ENVIRONMENT == 'production') ? 'http://35.192.49.112:19283' : 'http://104.154.51.133:19283'

  // Determine username/password
  var username = (process.env.ENVIRONMENT == 'production' ? 'XqB3yYNcTzNspDQHVgZZNtr3hFZqWbM7PAv4xUnNJv5wCJch5Knc5LStphCsSqRw' : 'dxYJutheHpZkcUssz3A95nPdB2LKh5uc43kvAtdDmyfG37hv6ACEbWhM6jhwfeme')
  var password = (process.env.ENVIRONMENT == 'production' ? 'CmRuJvYSV2xE4aXRWKUXhKSpCVys7ceEkQ3eEBLTczPrF6h86ZzUkQK7QerjbgwZ' : 'CCMdzTzntX4P7yuYKFHCHqZFjtEUMDPRLDXRmPzkqsyNncREpnT6YLN66frXWAgu')

  console.log(`Starting Reader For '${ network }' Using Node '${ nodeURI }'`)

  console.log('Initializing Bloom Filter')

  // await updateBloom(bloom, datastore, network)

  console.log('Connecting to', nodeURI)

  // Create BTC Client
  var client = new BTCClient(nodeURI, username, password, inflightLimit)

  // Determine Connectivity by getting the current block number
  var currentNumber = await client.rpc('getblockcount')

  // Ensure a connection was actually established
  if (currentNumber instanceof Error) {
    console.log('Could Not Connected')

    return
  }

  console.log('Connected')

  // Report current full block
  console.log('Current FullBlock Is', currentNumber)

  var lastNumber

  // Query to find the latest block read
  var query = datastore.createQuery('block').filter('Type', '=', network).order('BitcoinBlockHeight', { descending: true }).limit(1)

  console.log('Finding Block To Resume At')

  // Get all the results
  var [results, qInfo] = (await datastore.runQuery(query))

  if (results[0]) {
    // console.log(JSON.stringify(results[0]))
    lastNumber = results[0].BitcoinBlockHeight
    console.log(`Resuming From Block #${ lastNumber }`)
  } else {
    lastNumber = currentNumber
    console.log(`Resuming From 'latest'`)
  }

  console.log('Additional Query Info:\n', JSON.stringify(qInfo))

  console.log('Start Watching For New Blocks')

  // currentNumber = 1231590
  // lastNumber    = 1231600
  var blockNumber = lastNumber

  async function run() {
    // Determine Connectivity by getting the current block number
    blockNumber = await client.rpc('getblockcount')

    if (currentNumber instanceof Error) {
      console.log('Could Not Connected')
    }

    console.log(`Current Block  #${ currentNumber }\nTarget Block #${ blockNumber }\n`)

    // Ignore if blocknumber reached
    if (currentNumber >= blockNumber) {
      return
    }

    console.log(`\nInflight Requests: ${ client.inflight }\n`)

    var number = currentNumber
    currentNumber++

    console.log(`Fetching New Block #${ number }`)

    client.rpc('getblockhash', number).then((blockHash) => {
      return client.rpc('getblock', blockHash)
    }).then((block) => {
      var [_, data, readingBlockPromise] = saveReadingBlock(datastore, network, block);

      ((block) => {
        readingBlockPromise.then(() => {
          return new Promise((resolve, reject) => {
            setTimeout(function() {
              // It is cheaper on calls to just update the blocktransactions instead
              var confirmationBlock = number - confirmations
              resolve(getAndUpdateConfirmedBlockTransaction(
                client,
                datastore,
                network,
                confirmationBlock,
                confirmations))
            }, 12000)
          })
        })
      })(block);

      setTimeout(async function() {
        await updateBloom(bloom, datastore, network)

        // Iterate through transactions looking for ones we care about
        for(var tx of block.tx) {
          console.log(`Processing Block Transaction ${ tx }`)

          if (!tx) {
            console.log(`It happened! Block:\n${ JSON.stringify(block) }\nTransaction:\n${ tx }`)
            process.exit()
          }

          client.rpc('getrawtransaction', tx, true).then((transaction) => {
            // Add height to the transaction for easy referencing
            transaction.height = number
            var ps = []
            for (var i in transaction.vin) {
              var vin = transaction.vin[i];
              // Skip coinbase transactions
              if (!vin.txid) {
                continue
              }

              ((vin, transaction) => {

                var p = client.rpc('getrawtransaction', vin.txid, true).then((previousTransaction) => {
                  return {
                    transaction: transaction,
                    previousTransaction: previousTransaction,
                    previousVOut: previousTransaction.vout[vin.vout],
                    vIn: vin,
                  }
                })
                ps.push(p)
              })(vin, transaction);
            }

            // Loop through vOuts to determine if there are transactions
            // received
            for (var i in transaction.vout) {
              var vOut        = transaction.vout[i]
              var vOutAddress = vOut.scriptPubKey.addresses[0]

              if (bloom.test(vOutAddress)) {
                console.log(`Receiver Address ${ vOutAddress }`)

                // Do the actual query and fetch
                savePendingBlockTransaction(
                  datastore,
                  number,
                  transaction,
                  null,
                  vOut,
                  i,
                  network,
                  vOutAddress,
                  'receiver',
                )
              }
            }

            return Promise.all(ps)
          }).then((...psResults) => {
            // Loop through vIns to determine if there are transactions
            // sent
            for (var i in psResults) {
              var psResult     = psResults[i][0]
              var vIn          = psResult.vIn
              var previousVOut = psResult.previousVOut
              var transaction  = psResult.transaction
              var vInAddress   = previousVOut.scriptPubKey.addresses[0]

              // Merge Previous vOut and vIn
              var vIn.value = previousVOut.value

              if (bloom.test(vInAddress)) {
                console.log(`Sender Address ${ vInAddress }`)

                // Do the actual query and fetch
                savePendingBlockTransaction(
                  datastore,
                  number,
                  transaction,
                  vIn,
                  null,
                  i,
                  network,
                  vInAddress,
                  'sender',
                )
              }
            }
          }).catch((error) => {
            // console.log(`Error Fetching Previous Block Transaction for vIn:\n`, error)
          })
        }
      }, 10000);
    }).catch((error) => {
      console.log(`Error Fetching Block #${ number }:\n`, error)
    })

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
  }

  setInterval(run, 10000)

  // filter.watch(async function(error, result) {
  //   if (error) {
  //     console.log('Error While Watching Blocks:\n', error)
  //     return
  //   }

  //   // Get currentBlockNumber
  //   blockNumber = result.blockNumber
  // })
}

main()
