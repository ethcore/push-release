'use strict';

const Parity = require('@parity/parity.js');
const transport = new Parity.Api.Transport.Http('http://localhost:8545');
const api = new Parity.Api(transport);
var request = require('request');
var express = require('express');
var bodyParser = require('body-parser');
var keccak256 = require('js-sha3').keccak_256;

var app = express();
app.use(bodyParser.urlencoded({extended: true}));

const githubRepo = 'paritytech/parity';

const tracks = {
  stable: 1,
  beta: 2,
  nightly: 3,
  master: 3,
  testing: 4
};

const enabled = {
  stable: true,
  beta: true
};

const account = {address: '0x0066AC7A4608f350BF9a0323D60dDe211Dfb27c0', password: null};
const baseUrl = 'http://d1h4xl4cr1h0mo.cloudfront.net';
const tokenHash = 'ffa69b8d6bc6f7466e51ff21931295be5d5234dafc5f3ff034f68d59918744c4';

var network;
api.parity.netChain().then(n => {
  network = (n === 'homestead' || n === 'mainnet' || n === 'foundation' ? 'foundation' : n.indexOf('kovan.json') !== -1 ? 'kovan' : n);
  console.log(`On network ${network}`);
}).catch(e => {
  console.log('Error with RPC!', e);
});

const supportedPlatforms = {
  'x86_64-apple-darwin': true,
  'x86_64-pc-windows-msvc': true,
  'x86_64-unknown-linux-gnu': true
};

function sendTransaction (abi, address, method, args) {
  let o = api.newContract(abi, address);
  let tx = {
    from: account.address,
    to: address,
    gasPrice: '0x4F9ACA000',
    data: o.getCallData(o.instance[method], {}, args)
  };
  return account.password === null
    ? api.eth.sendTransaction(tx)
    : api.personal.signAndSendTransaction(tx, account.password);
}
/*
function sendTransaction(abi, address, method, args) {
  let o = api.newContract(abi, address);
  return api.parity.postTransaction({
    from: account.address,
    to: address,
    data: o.getCallData(o.instance[method], {}, args)
  });
}
*/
app.post('/push-release/:tag/:commit', function (req, res) {
  if (keccak256(req.body.secret) !== tokenHash) {
    res.end('Bad request.');
    return;
  }

  console.log(`curl --data "secret=${req.body.secret} http://localhost:1338/push-release/${req.params.tag}/${req.params.commit}`);

  let commit = req.params.commit;
  let tag = req.params.tag;
  let isCritical = false; // TODO: should take from Git release notes for stable/beta.
  let goodTag = (tag === 'nightly' || tag.startsWith('v'));

  var out;
  console.log(`Pushing commit: ${commit} (tag: ${tag}/${goodTag})`);

  if (goodTag) {
    request.get({headers: { 'User-Agent': githubRepo }, url: `https://raw.githubusercontent.com/${githubRepo}/${commit}/util/src/misc.rs`}, function (error, response, body) {
      if (error) throw error;
      let branch = body.match(`const THIS_TRACK. ..static str = "([a-z]*)";`)[1];
      let track = tracks[branch] ? branch : 'testing';
      console.log(`Track: ${branch} => ${track} (${tracks[track]}) [enabled: ${enabled[track]}]`);

      if (enabled[track]) {
        request.get({headers: { 'User-Agent': githubRepo }, url: `https://raw.githubusercontent.com/${githubRepo}/${commit}/ethcore/src/ethereum/mod.rs`}, function (error, response, body) {
          if (error) throw error;
          let pattern = `pub const FORK_SUPPORTED_${network.toUpperCase()}: u64 = (\\d+);`;
          let m = body.match(pattern);
          if (m === null) {
            console.log(`Unable to detect supported fork with pattern: ${pattern}.`);
            return;
          }
          let forkSupported = m[1];

          out = `RELEASE: ${commit}/${track}/${branch}/${forkSupported}`;
          console.log(`Fork supported: ${forkSupported}`);

          request.get({headers: { 'User-Agent': githubRepo }, url: `https://raw.githubusercontent.com/${githubRepo}/${commit}/Cargo.toml`}, function (error, response, body) {
            if (error) throw error;
            let version = body.match(/version = "([0-9]+)\.([0-9]+)\.([0-9]+)"/).slice(1);
            let semver = +version[0] * 65536 + +version[1] * 256 + +version[2];

            console.log(`Version: ${version.join('.')} = ${semver}`);

            api.parity.registryAddress().then(a => {
              console.log(`Registry address: ${a}`);
              var registry = api.newContract(RegistrarABI, a);
              return registry.instance.getAddress.call({}, [api.util.sha3('parityoperations'), 'A']);
            }).then(a => {
              console.log(`Parity operations address: ${a}`);
              console.log(`Registering release: 0x000000000000000000000000${commit}, ${forkSupported}, ${tracks[track]}, ${semver}, ${isCritical}`);
              // Should be this...
              // api.newContract(OperationsABI, a).instance.addRelease.postTransaction({from: account.address}, [`0x000000000000000000000000${commit}`, forkSupported, tracks[track], semver, isCritical])
              // ...but will have to be this for now...
              return sendTransaction(OperationsABI, a, 'addRelease', [`0x000000000000000000000000${commit}`, forkSupported, tracks[track], semver, isCritical]);
            }).then(h => {
              console.log(`Transaction sent with hash: ${h}`);
            });
          });
        });
      }
    });
  }
  res.end(out);
});

app.post('/push-build/:tag/:platform', function (req, res) {
  if (keccak256(req.body.secret) !== tokenHash) {
    res.end('Bad request.');
    return;
  }

  console.log(`curl --data "secret=${req.body.secret}&commit=${req.body.commit}&filename=${req.body.filename}&sha3=${req.body.sha3} http://localhost:1338/push-build/${req.params.tag}/${req.params.platform}`);

  let tag = req.params.tag;
  let platform = req.params.platform;
  let commit = req.body.commit;
  let filename = req.body.filename;
  let sha3 = req.body.sha3;
  let url = `${baseUrl}/${tag}/${platform}/${filename}`;
  let goodTag = (tag === 'nightly' || tag.startsWith('v'));
  let goodPlatform = !!supportedPlatforms[platform];

  let out = `BUILD: ${platform}/${commit} -> ${sha3}/${tag}/${filename}/${goodTag}/${goodPlatform} [${url}]`;
  console.log(out);

  if (sha3 !== '' && goodTag && goodPlatform) {
    request.get({headers: { 'User-Agent': githubRepo }, url: `https://raw.githubusercontent.com/${githubRepo}/${commit}/util/src/misc.rs`}, function (error, response, body) {
      if (error) throw error;
      let branch = body.match(`const THIS_TRACK. ..static str = "([a-z]*)";`)[1];
      let track = tracks[branch] ? branch : 'testing';
      console.log(`Track: ${branch} => ${track} (${tracks[track]}) [enabled: ${!!enabled[track]}]`);

      if (enabled[track]) {
        var reg;
        api.parity.registryAddress().then(a => {
          reg = api.newContract(RegistrarABI, a);
          return reg.instance.getAddress.call({}, [api.util.sha3('githubhint'), 'A']);
        }).then(g => {
          console.log(`Registering on GithubHint: ${sha3}, ${url}`);
          // Should be this...
          // api.newContract(GitHubHintABI, g).instance.hintURL.postTransaction({from: account.address}, [`0x${sha3}`, url]).then(() => {
          // ...but will have to be this for now...
          return sendTransaction(GitHubHintABI, g, 'hintURL', [`0x${sha3}`, url]);
        }).then(h => {
          console.log(`Transaction sent with hash: ${h}`);

          return reg.instance.getAddress.call({}, [api.util.sha3('parityoperations'), 'A']);
        }).then(o => {
          console.log(`Registering platform binary: ${commit}, ${platform}, ${sha3}`);
          // Should be this...
          // return api.newContract(OperationsABI, o).instance.addChecksum.postTransaction({from: account.address}, [`0x000000000000000000000000${commit}`, platform, `0x${sha3}`]);
          // ...but will have to be this for now...
          return sendTransaction(OperationsABI, o, 'addChecksum', [`0x000000000000000000000000${commit}`, platform, `0x${sha3}`]);
        }).then(h => {
          console.log(`Transaction sent with hash: ${h}`);
        });
      }
    });
  }
  res.end(out);
});

var server = app.listen(1337, function () {
  var host = server.address().address;
  var port = server.address().port;
  console.log('push-release service listening at http://%s:%s', host, port);
});

const RegistrarABI = require('./res/registrar.json');
const GitHubHintABI = require('./res/githubhint.json');
const OperationsABI = require('./res/operations.json');
