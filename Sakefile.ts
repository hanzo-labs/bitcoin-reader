use('sake-bundle')
use('sake-outdated')
use('sake-version')

task('build', (opts) => {
  exec.sync('tsc')
})

task('start', ['build'], function* (opts) {
  require('./index.js')
})

task('start', ['build'], function* (opts) {
  require('./index.js')
})

task('auth', 'authenticate google sdk', (opts) => {
  exec('gcloud auth login')
})

task('deploy', 'deploy reader to appengine', ['build'], (opts) => {
  exec('gcloud app deploy --quiet --project crowdstart-us app.ethereum.yaml --version=v1')
})

task('browse', 'view application from web browser', (opts) => {
  exec('gcloud app browse -s ethereum-reader --project crowdstart-us app.ethereum.yaml')
})

task('logs', 'view application logs', (opts) => {
  exec('gcloud app logs tail -s ethereum-reader --project crowdstart-us app.ethereum.yaml')
})

task('deploy:test', 'deploy reader to appengine', ['build'], (opts) => {
  exec('gcloud app deploy --quiet --project crowdstart-us app.ethereum-ropsten.yaml --version=v1')
})

task('browse:test', 'view application from web browser', (opts) => {
  exec('gcloud app browse -s ethereum-ropsten-reader --project crowdstart-us app.ethereum-ropsten.yaml')
})

task('logs:test', 'view application logs', (opts) => {
  exec('gcloud app logs tail -s ethereum-ropsten-reader --project crowdstart-us app.ethereum-ropsten.yaml')
})
