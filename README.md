# push-release
## Push Parity releases to the chain

This is a PM2 node.js service which accepts simple RESTful-compliant HTTP requests as a trigger for updating an on-chain _Operations_ contract with a new release. It effectively provides a proxy for turning secret-authenticated RESTful requests into transactions sent to a chain's _Operations_ contract.

## Specification

The two requests it can act upon are both POSTs (with params passed as URL-encoded data) and are at:

- `/push-release/<branch>/<commit>`: Pushes a the new release `commit` of `branch` . The `branch` should be one of `stable`, `beta`, `nightly` (equivalent to `master`) or `testing`. The `commit` should be the 40-digit hex-encoded Git commit hash of this release.
- `/push-build/<branch>/<platform>`: Pushes a single `platform`'s build of a release on `branch`. The `branch` is as above. The `platform` should be compliant according to `Operations` contract. The additional POST data is `commit` (as above), `filename` (the filename of the build in the build artefacts directory) and `sha3` (the hex-encoded Keccak-256 hash of the binary).

To ensure only valid updates are processed, all requests must provide an authentication token. The Keccak-256 hash of this token is stored in this script and any authentication token which is passed must be the pre-image of this hash. It should be passed as a 64-digit, hex-encoded POST parameter with key `secret`.

### Options

The configuration is managed in `config` directory. [The `default.json`](config/default.json) file as the name suggested is used as a base configuration, every entry can
be overwritten in env-specific config files (see [`kovan.json`](config/kovan.json) as an example). Feel free to add your override to that directory.

To load a specific config file run with `NODE_ENV` environment variable set to the name of the config file. E.g. `NODE_ENV="kovan" node server.js`
will run the server using `kovan.json` settings.

Some parameters can also be overridden by environment variables. See [`config/custom-environment-variables.json`])config/custom-environment-variables.json) for all possible options. Notable ones:

- `ACCOUNT_ADDRESS` The address of the account used to send transactions
- `ACCOUNT_PASSWORD` The password of the account. If no password is supplied, it is assumed that the account is already unlocked.
- `HTTP_PORT` The HTTP port the service will be running on.
- `RPC_PORT` The port of Parity's JSON-RPC HTTP interface.
- `SECRET_HASH` The hash of the secret. The pre-image to this hash must be provided by any requests.

## Deployment

We assume you have a preselected _signing account_ and _secret token_. The _Operations_ contract on the chain this server will be deployed to must accept transactions from the _signing account_ for the set of updates that this will proxy. You'll also need to work out the Keccak-256 hash of the _secret token_ (you can use `require('js-sha3').keccak_256(secret_token)` to determine this).

0. Deploy Node.js, NPM and `pm2` on the host:
   ```
   sudo apt-get install build-essential checkinstall libssl-dev
   curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.0/install.sh | bash
   source ~/.bashrc
   nvm install stable
   nvm alias default stable
   npm install pm2 yarn -g
   ```

10. Install `parity` on the host:
   ```
   $ bash <(curl https://get.parity.io -kL)
   ```

20. Set it up to run as a service:
   ```
   cat > run-parity.sh <<EOF
   #!/bin/bash
   /usr/bin/parity --jsonrpc-port 8545 --warp --unlock 0xsigning_account_address --password /root/password
   EOF
   ```

   Ensure your _signing account_ key is in the `parity` keys directory and that its address matches `0xsigning_account_address`. Ensure this account is ready for use by creating a secured file containing its password at `/root/password`, and don't forget to `chmod 400 /root/password` to ensure maximum security. If this should run on Ropsten or some other chain, be sure to include the according `--chain` parameter.

30. Clone `push-release` repository on the desired host:
   ```
   git clone https://github.com/paritytech/push-release
   ```

40. Navigate in to the directory of push-release:
   ```
   cd push-release
   ```

50. Edit `config/yournetwork.js` and run with `NODE_ENV=yournetwork` or supply environment variables:
   - Set `SECRET_HASH` to reflect the hash of the _secret token_ you created earlier.
   - Set `ACCOUNT_ADDRESS` to have the `address:` of your `signing account` you decided on earlier. If you are not `--unlock`ing the account when running `parity`, you'll also need to provide the `ACCOUNT_PASSWORD`.
   - Set `ASSETS_BASE_URL` to reflect the base URL of your build artefact's server address.

60. Install any required NPM modules:
   ```
   yarn install
   ```

70. Start the services:
   ```
   pm2 start --name parity ../run-parity.sh
   pm2 start push-release.json --only push-release
   ```


## On-chain setup

Prior to setting up the server, it's important to deploy the contracts and have the accounts and keys set up. If you already have a functional _Operations_ contract and _master key_ then you can skip down to "Setting up Parity's OperationsProxy contract". This all assumes you are working from Parity Wallet.

10. Create the _master key_. This is the key which owns the _Operations_ contract and should be kept in cold storage. Accounts -> New Account; write down the recovery phrase (and put it somewhere safe), and name the key _master key_. Back up the new JSON file.

15. Transfer some ether into the _master key_ (Transfer button on an existing funded account).

20. Deploy the _Operations_ contract:
   - Contracts -> Develop Contract
   - Paste contents of [_Operations_ contract](https://github.com/paritytech/contracts/blob/master/Operations.sol)
   - Compile
   - Deploy (From Account: `master key`, Contract Name: Operations)
   - Create, provide password and wait until confirmed.

30. Register _Operations_ contract in Registry:
   - Applications -> Registry
   - Select account _master key_ in top right
   - Manage names -> name: _operations_, _reserve this name_ -> Reserve
   - Provide password and wait until confirmed
   - Manage entries of a name -> name: _operations_, _A - Ethereum address_, value: [_Operations_ contract's address] -> Save    - Provide password and wait until confirmed

35. Setting up Parity's _OperationsProxy_ contract:

40. Create the _manual key_. This is the key which generally stays offline, but can be used to confirm stable and beta releases. Accounts -> New Account; write down the recovery phrase (and put it somewhere safe), and name the key _manual key_. Back up the new JSON file.

50. Create the _server key_. This is the key which our newly provisioned server uses to push stable, beta and nightly releases (however, all but the latter need to be confirmed manually). Accounts -> New Account; write down the recovery phrase (and put it somewhere safe), and name the key _manual key_. Back up the new JSON file.

60. Transfer some ether into these two accounts (Transfer button on an existing funded account).

70. Deploy the Parity-specific _OperationsProxy_ contract:
   - Contracts -> Develop Contract
   - Paste contents of [_OperationsProxy_ contract](https://github.com/paritytech/contracts/blob/master/OperationsProxy.sol)
   - Compile
   - Deploy
      - From Account: _master key_
      - Contract Name: OperationsProxy
      - owner: _master key_
      - stable: _server key_
      - beta: _server key_
      - nightly: _server key_
      - stableConfirmer: _manual key_
      - betaConfirmer: _manual key_
      - nightlyConfirmer: `<null>`
      - e.g.: ![image](https://cloud.githubusercontent.com/assets/138296/21752102/274eb584-d5d3-11e6-8d83-822c1ea4f5bb.png)
   - Create, provide password and wait until confirmed.

80. Register Parity's _OperationsProxy_ contract in Registry:
   - Applications -> Registry
   - Select account _master key_ in top right
   - Manage names -> name: _parityoperations_, _reserve this name_ -> Reserve
   - Provide password and wait until confirmed
   - Manage entries of a name -> name: _parityoperations_, _A - Ethereum address_, value: [_OperationsProxy_ contract's address] -> Save
   - Provide password and wait until confirmed

90. Configure Parity's _OperationsProxy_ to be the maintainer of Parity client releases in `Operations`:
   - Contracts -> Operations -> Execute
   - from account: _master key_
   - function to execute: setClientOwner
   - newOwner: _parity operations_ (the contract address)
   - Execute, provide password and wait until confirmed


## Final usage

We assume this is set up on server resolving from `update-server.parity.io`. At this point, the CI may use two requests, given here as `curl` commands:

When a new release has been made (but before builds are known) use:

```
curl --data "secret=$SECRET" http://update-server.parity.io:1337/push-release/$BRANCH/$COMMIT
```

Ensure that `$COMMIT` (the Git commit hash, 40-character hex) and `$BRANCH` (the release branch name) are set properly from the CI's environment.

When a build is confirmed for a new release, you should use:

```
curl --data "commit=$COMMIT&sha3=$SHA3&filename=$FILENAME&secret=$SECRET" http://update-server.parity.io:1337/push-build/$BRANCH/$PLATFORM
```

Ensure that `$COMMIT` (the Git commit hash, 40-character hex), `$SHA3` (the build binary's Keccak-256 hash, 64-character hex), `$BRANCH` (the release branch name), `$FILENAME` (the filename of the build's binary in the build artefact's path) and `$PLATFORM` (the host platform for this build) are set according to the release from the CI's environment.

In both cases, `$SECRET` should be the _secret token_.

Under this configuration, when stable and beta builds are made, they will require confirming through the _manual key_ prior to becoming active. At present there is no way of doing this except manually checking the events on the `OperationsProxy` contract and issuing the according `confirm` transactions from _manual key_ account.
