'use strict'

// Import the Bloomfilter
var { BloomFilter } = require('bloomfilter')

// Imports the Google Cloud client library
var Datastore = require('@google-cloud/datastore')

// How many confirmations does it take to confirm? (default: 12)
var confirmations = process.env.CONFIRMATIONS || 12

// How many concurrent blocks can it be processing? (default: 10)
var inflightLimit = process.env.INFLIGHT_LIMIT || 10

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
  var client = new BTCClient(nodeURI, username, password)

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

  // lastBlock = 1962800

  var blockNumber   = lastNumber
  var inflight      = 0

  async function run() {
    // Determine Connectivity by getting the current block number
    var blockNumber = await client.rpc('getblockcount')

    if (currentNumber instanceof Error) {
      console.log('Could Not Connected')
    }

    // Ignore if inflight limit reached or blocknumber reached
    if (inflight > inflightLimit || currentNumber >= blockNumber) {
      return
    }

    console.log(`\nInflight Requests: ${ inflight }\nCurrent Block  #${ currentNumber }\nTarget Block #${ blockNumber }\n`)

    inflight++

    currentNumber++
    var number = currentNumber

    console.log(`Fetching New Block #${ number }`)

    client.rpc('getblockhash', number).then((blockHash) => {
      return client.rpc('getblock', blockHash)
    }).then((block) => {
      var [_, data, readingBlockPromise] = saveReadingBlock(datastore, network, block)

      setTimeout(async function() {
        await updateBloom(bloom, datastore, network)

        // Iterate through transactions looking for ones we care about
        for(var tx of block.tx) {
          console.log(`Processing Block Transaction ${ transaction.hash }`)

          client.rpc('getrawtransaction', tx, '1').then((transaction) => {
            var ps = []
            for (var vin of transaction.vin) {
              ((vin) => {
                var p = client.rpc('getrawtransaction', vin.txid, '1').then((prevTx) => {
                  return {
                    transaction: transaction,
                    vIn: prevTx.vout[vin.vout]
                  }
                })
                ps.push(p)
              })();
            }

            for (var i in tx.vout) {
              var vOut        = tx.vout[i]
              var transaction = tx
              var vOutAddress = vOut.addresses[0]

              if (bloom.test(vOutAddress)) {
                console.log(`Receiver Address ${ vOutAddress }`)

                // Do the actual query and fetch
                savePendingBlockTransaction(
                  datastore,
                  number,
                  transaction,
                  null,
                  vOut,
                  network,
                  vOutAddress,
                  'receiver',
                )
              }
            }

            return Promise.all(ps)
          }).then((...psResults) => {
            for (var psResult of psResults) {
              var txVIn       = psResult.value
              var vIn         = txVIn.vIn
              var transaction = txVIn.transaction
              var vInAddress  = vIn.addresses[0]

              if (bloom.test(vInAddress)) {
                console.log(`Receiver Address ${ vInAddress }`)

                // Do the actual query and fetch
                savePendingBlockTransaction(
                  datastore,
                  number,
                  transaction,
                  vin,
                  null,
                  network,
                  vOutAddress,
                  'receiver',
                )
              }
            }
          }).catch(() => {

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

  //     ((result) => {
  //       readingBlockPromise.then(() => {
  //         return new Promise((resolve, reject) => {
  //           setTimeout(function() {
  //             // It is cheaper on calls to just update the blocktransactions instead
  //             var confirmationBlock = result.number - confirmations
  //             resolve(getAndUpdateConfirmedBlockTransaction(
  //               web3,
  //               datastore,
  //               network,
  //               confirmationBlock,
  //               confirmations))
  //             inflight--
  //           }, 12000)
  //         })
  //       })
  //     })(result)
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
