const chai = require('chai');
const chaiHttp = require('chai-http');
const ServerMock = require('mock-http-server');
const pad = require('@parity/abi/lib/util/pad')

const expect = chai.expect;
chai.use(chaiHttp);

const app = require('../server');
const secret = 'test';
const gasPrice = '0x4f9aca000';

const server = new ServerMock({ host: 'localhost', port: 8545 });

describe('push-release', () => {
	async function pushRelease(commit, network, forkBlock, critical) {
		const requests = [];
		server.on({
			method: 'POST',
			path: '/',
			reply: {
				status: 200,
				headers: {
					'content-type': 'application/json'
				},
				body: parityRespond(requests, network)
			}
		});

		let res = await request(app => app
			.post(`/push-release/v1.7.13/${commit}`)
			.type('form')
			.send({ secret })
		);

		const expectedCritical = critical ? '1' : '0';
		const expectedForkBlock = pad.padU32(forkBlock);

		expect(res).to.have.status(200);
		// Register in operations
		console.log(requests);
		expect(requests[3].method).to.equal('eth_sendTransaction');
		expect(requests[3].params).to.deep.equal([{
			data: `0x932ab270000000000000000000000000${commit}${expectedForkBlock}00000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000010c00000000000000000000000000000000000000000000000000000000000000000${expectedCritical}`,
			from: '0x0066ac7a4608f350bf9a0323d60dde211dfb27c0',
			gasPrice,
			to: '0x0000000000000000bf900003d60dde211dfb0000'
		}]);
	}

	it('should reject invalid secret', async () => {
		let res = await request(app => app
			.post('/push-release/v1.9.5/e92e6c4f796f6338b2a99c499a0fe9c238f2d84f')
			.type('form')
			.send({ secret: 'xxx' })
		);

		expect(res).to.have.status(401);
		expect(res.text).to.equal('Invalid secret');
	});

	it('should gently reject invalid tags', async () => {
		const test = async tag => {
			let res = await request(app => app
				.post(`/push-release/${tag}/e92e6c4f796f6338b2a99c499a0fe9c238f2d84f`)
				.type('form')
				.send({ secret })
			);

			expect(res).to.have.status(202);
			expect(res.text).to.have.string(`child "tag" fails`);
		};

		await test('xxx');
		await test('v1.9.5-ci0');
	});

	it('should reject invalid commit', async () => {
		let res = await request(app => app
			.post('/push-release/v1.7.13/8b749367')
			.type('form')
			.send({ secret })
		);

		expect(res).to.have.status(400);
		expect(res.text).to.have.string(`child "commit" fails`);
	});

	beforeEach(done => server.start(done));
	afterEach(done => server.stop(done));

	it('should push release succesfuly', async () => {
		await pushRelease('e92e6c4f796f6338b2a99c499a0fe9c238f2d84f', 'kovan', 6600000, false);
	});

	it('should support mainnet aliases', async () => {
		await pushRelease('e92e6c4f796f6338b2a99c499a0fe9c238f2d84f', 'mainnet', 4370000, false);
		await pushRelease('e92e6c4f796f6338b2a99c499a0fe9c238f2d84f', 'ethereum', 4370000, false);
		await pushRelease('e92e6c4f796f6338b2a99c499a0fe9c238f2d84f', 'foundation', 4370000, false);
	});

	it('should use network specific critical flag', async () => {
		const kovanTrueCommit = 'a70eb0b39f9341c8be900ceb0fd2d007cf9acab8';
		await pushRelease(kovanTrueCommit, 'kovan', 6600000, true);
		await pushRelease(kovanTrueCommit, 'ropsten', 10, false);
	});

	it('should be backwards compatible with global critical flag', async () => {
		const legacyCommit = 'adc3457a893bac241c00e897df702e9bbc1468d9';
		await pushRelease(legacyCommit, 'kovan', 6600000, false);
	});
});

describe('push-build', () => {
	it('should reject invalid secret', async () => {
		let res = await request(app => app
			.post('/push-build/v1.9.5/x86_64-unknown-linux-gnu')
			.type('form')
			.send({
				secret: 'xxx',
				sha3: 'a00ead491c0e47efe4abefeb27ddc6ed8d1ea4daa43683d8e349e1e7459b74ba',
				commit: 'e92e6c4f796f6338b2a99c499a0fe9c238f2d84f',
				filename: 'parity'
			})
		);

		expect(res).to.have.status(401);
		expect(res.text).to.equal('Invalid secret');
	});

	it('should gently reject invalid tags', async () => {
		const test = async tag => {
			let res = await request(app => app
				.post(`/push-build/${tag}/x86_64-unknown-linux-gnu`)
				.type('form')
				.send({
					secret,
					sha3: 'a00ead491c0e47efe4abefeb27ddc6ed8d1ea4daa43683d8e349e1e7459b74ba',
					commit: 'e92e6c4f796f6338b2a99c499a0fe9c238f2d84f',
					filename: 'parity'
				})
			);

			expect(res).to.have.status(202);
			expect(res.text).to.have.string(`child "tag" fails`);
		};

		await test('xxx');
		await test('v1.9.5-ci0');
	});

	it('should gently reject invalid platform', async () => {
		let res = await request(app => app
			.post(`/push-build/nightly/x86_64-debian-linux-gnu`)
			.type('form')
			.send({
				secret,
				sha3: 'a00ead491c0e47efe4abefeb27ddc6ed8d1ea4daa43683d8e349e1e7459b74ba',
				commit: 'e92e6c4f796f6338b2a99c499a0fe9c238f2d84f',
				filename: 'parity'
			})
		);

		expect(res).to.have.status(202);
		expect(res.text).to.have.string(`child "platform" fails`);
	});

	it('should reject missing fields', async () => {
		let res = await request(app => app
			.post(`/push-build/nightly/x86_64-unknown-linux-gnu`)
			.type('form')
			.send({
				secret,
				sha3: 'a00ead491c0e47efe4abefeb27ddc6ed8d1ea4daa43683d8e349e1e7459b74ba',
				// commit: 'e92e6c4f796f6338b2a99c499a0fe9c238f2d84f',
				filename: 'parity'
			})
		);

		expect(res).to.have.status(400);
		expect(res.text).to.have.string(`child "commit" fails`);
	});

	beforeEach(done => server.start(done));
	afterEach(done => server.stop(done));

	it('should push build succesfuly', async () => {
		const requests = [];
		server.on({
			method: 'POST',
			path: '/',
			reply: {
				status: 200,
				headers: { 'content-type': 'application/json' },
				body: parityRespond(requests)
			}
		});

		let res = await request(app => app
			.post('/push-build/v1.7.13/x86_64-unknown-linux-gnu')
			.type('form')
			.send({
				secret,
				sha3: 'a00ead491c0e47efe4abefeb27ddc6ed8d1ea4daa43683d8e349e1e7459b74ba',
				commit: 'e92e6c4f796f6338b2a99c499a0fe9c238f2d84f',
				filename: 'parity'
			})
		);

		expect(res).to.have.status(200);
		// Githubhint registration
		expect(requests[2].method).to.equal('eth_sendTransaction');
		expect(requests[2].params).to.deep.equal([{
			data: '0x02f2008da00ead491c0e47efe4abefeb27ddc6ed8d1ea4daa43683d8e349e1e7459b74ba0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000004a687474703a2f2f72656c65617365732e7061726974792e696f2f657468657265756d2f76312e372e31332f7838365f36342d756e6b6e6f776e2d6c696e75782d676e752f70617269747900000000000000000000000000000000000000000000',
			from: '0x0066ac7a4608f350bf9a0323d60dde211dfb27c0',
			gasPrice,
			to: '0x0000000000000000bf900003d60dde211dfb0000'
		}]);
		// Build registration
		expect(requests[4].method).to.equal('eth_sendTransaction');
		expect(requests[4].params).to.deep.equal([{
			data: '0x793b0efb000000000000000000000000e92e6c4f796f6338b2a99c499a0fe9c238f2d84f7838365f36342d756e6b6e6f776e2d6c696e75782d676e750000000000000000a00ead491c0e47efe4abefeb27ddc6ed8d1ea4daa43683d8e349e1e7459b74ba',
			from: '0x0066ac7a4608f350bf9a0323d60dde211dfb27c0',
			gasPrice,
			to: '0x0000000000000000bf900003d60dde211dfb0000'
		}]);
	});
});

// Overcoming a bug in chai-http: https://github.com/chaijs/chai-http/issues/156
function request (fn) {
	return new Promise((resolve, reject) => {
		return fn(chai.request(app)).end((err, res) => {
			if (res) {
				resolve(res);
			} else {
				reject(err);
			}
		});
	});
}

function parityRespond (requests, chain) {
	return (req) => {
		let result = null;
		const { method } = req.body;

		if (method === 'net_listening') {
			return JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				result
			});
		}

		requests.push(req.body);

		if (method === 'parity_chain') {
			result = (chain === undefined) ? 'kovan testnet' : chain;
		} else if (method === 'parity_registry') {
			result = '0x0000000000000000000000000000000000001233';
		} else if (method === 'eth_call') {
			result = '0x0000000000000000bf900003d60dde211dfb0000';
		}

		return JSON.stringify({
			jsonrpc: '2.0',
			id: 1,
			result
		})
	}
}
