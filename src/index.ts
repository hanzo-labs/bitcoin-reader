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
  var network = (process.env.ENVIRONMENT == 'production') ? 'ethereum' : 'ethereum-ropsten'

  // Determine geth/parity node URI
  var nodeURI = (process.env.ENVIRONMENT == 'production') ? 'http://35.202.166.74:80' : 'http://35.192.74.139:80'

  console.log(`Starting Reader For '${ network }' Using Node '${ nodeURI }'`)

  console.log('Initializing Bloom Filter')

  await updateBloom(bloom, datastore, network)

  // Import Web3
  var Web3 = require('web3')

  console.log('Connecting to', nodeURI)

  var web3 = new Web3(new Web3.providers.HttpProvider(nodeURI, 10000))

  // Ensure a connection was actually established
  if (!web3.isConnected()) {
    console.log('Could Not Connected')
    console.log(`Are you running 'sudo geth --cache=1024 --rpc --rpcaddr 0.0.0.0 --rpcport 80 --syncmode=fast --rpccorsdomain "*" in your geth node?'`)
    return
  }

  console.log('Connected')

  // Report current full block
  console.log('Current FullBlock Is', web3.eth.blockNumber)

  // Report Syncing Status
  var lastBlockData = {}
  web3.eth.isSyncing((isSynced, blockData) => {
    if (isSynced) {
      console.log('Syncing Complete')
      return
    }
    if (lastBlockData.currentBlock != blockData.currentBlock) {
      console.log(`Currently @ ${ blockData.currentBlock }, Syncing From ${ blockData.startingBlock } To ${ blockData.highestBlock }`)
      lastBlockData = blockData
    }
  })

  var lastBlock = undefined

  // Query to find the latest block read
  var query = datastore.createQuery('block').filter('Type', '=', network).order('EthereumBlockNumber', { descending: true }).limit(1)

  console.log('Finding Block To Resume At')

  // Get all the results
  var [results, qInfo] = (await datastore.runQuery(query))

  if (results[0]) {
    // console.log(JSON.stringify(results[0]))
    lastBlock = results[0].EthereumBlockNumber
    console.log(`Resuming From Block #${ lastBlock }`)
  } else {
    lastBlock = 'latest'
    console.log(`Resuming From 'latest'`)
  }
  console.log('Additional Query Info:\n', JSON.stringify(qInfo))

  console.log('Start Watching For New Blocks')

  // lastBlock = 1962800

  // Start watching for new blocks
  var filter = web3.eth.filter({
    // 1892728
    fromBlock: lastBlock,
    toBlock:   'latest', //1892800,
  })

  var lastNumber    = lastBlock == 'latest' ? web3.eth.blockNumber : lastBlock - 1
  var currentNumber = lastNumber
  var blockNumber   = lastNumber
  var inflight      = 0

  function run() {
    // Ignore if inflight limit reached or blocknumber reached
    if (inflight > inflightLimit || currentNumber >= blockNumber) {
      return
    }

    console.log(`\nInflight Requests: ${ inflight }\nCurrent Block  #${ currentNumber }\nTarget Block #${ blockNumber }\n`)

    inflight++

    currentNumber++
    var number = currentNumber

    console.log(`Fetching New Block #${ number }`)

    web3.eth.getBlock(number, true, async function(error, result) {
      if (error) {
        console.log(`Error Fetching Block #${ number }:\n`, error)
        return
      }

      var [_, data, readingBlockPromise] = saveReadingBlock(datastore, network, result)

      setTimeout(async function() {
        await updateBloom(bloom, datastore, network)

        // Iterate through transactions looking for ones we care about
        for(var transaction of result.transactions) {
          console.log(`Processing Block Transaction ${ transaction.hash }`)

          var toAddress   = transaction.to
          var fromAddress = transaction.from

          console.log(`Checking Addresses\nTo:  ${ toAddress }\nFrom: ${ fromAddress }`)

          if (bloom.test(toAddress)) {
            console.log(`Receiver Address ${ toAddress }`)

            // Do the actual query and fetch
            savePendingBlockTransaction(
              datastore,
              transaction,
              network,
              toAddress,
              'receiver',
            )
          }

          if (bloom.test(fromAddress)) {
            console.log(`Sender Address ${ fromAddress }`)

            // Do the actual query and fetch
            savePendingBlockTransaction(
              datastore,
              transaction,
              network,
              fromAddress,
              'sender'
            )
          }
        }
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
            setTimeout(function() {
              // It is cheaper on calls to just update the blocktransactions instead
              var confirmationBlock = result.number - confirmations
              resolve(getAndUpdateConfirmedBlockTransaction(
                web3,
                datastore,
                network,
                confirmationBlock,
                confirmations))
              inflight--
            }, 12000)
          })
        })
      })(result)
    })
  }

  setInterval(run, 1)

  filter.watch(async function(error, result) {
    if (error) {
      console.log('Error While Watching Blocks:\n', error)
      return
    }

    // Get currentBlockNumber
    blockNumber = result.blockNumber
  })
}

main()
