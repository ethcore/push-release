const chai = require('chai');
const chaiHttp = require('chai-http');
const ServerMock = require('mock-http-server');

const expect = chai.expect;
chai.use(chaiHttp);

const app = require('../server');
const secret = 'test';
const gasPrice = '0x4f9aca000';

const server = new ServerMock({ host: 'localhost', port: 8545 });

describe('push-release', () => {
	it('should reject invalid secret', async () => {
		let res = await request(app => app
			.post('/push-release/v1.9.5/8b749367fd5fea897cee98bd892fff1ce90f8260')
			.type('form')
			.send({ secret: 'xxx' })
		);

		expect(res).to.have.status(401);
		expect(res.text).to.equal('Invalid secret');
	});

	it('should gently reject invalid tags', async () => {
		const test = async tag => {
			let res = await request(app => app
				.post(`/push-release/${tag}/8b749367fd5fea897cee98bd892fff1ce90f8260`)
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
		const requests = [];
		server.on({
			method: 'POST',
			path: '/',
			reply: {
				status: 200,
				headers: { 'content-type': 'application/json' },
				body (req) {
					requests.push(req.body);
					return JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						result: 'kovan'
					})
				}
			}
		});

		let res = await request(app => app
			.post('/push-release/v1.7.13/c060d9584dae34e0e215f061bd61b2ebd375956b')
			.type('form')
			.send({ secret })
		);

		expect(res).to.have.status(200);
		// Register in operations
		expect(requests[3].method).to.equal('eth_sendTransaction');
		expect(requests[3].params).to.deep.equal([{
			data: '0x932ab270000000000000000000000000c060d9584dae34e0e215f061bd61b2ebd375956b00000000000000000000000000000000000000000000000000000000004d50f800000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000010a000000000000000000000000000000000000000000000000000000000000000000',
			from: '0x0066ac7a4608f350bf9a0323d60dde211dfb27c0',
		gasPrice,
			to: '0x'
		}]);
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
				commit: '8b749367fd5fea897cee98bd892fff1ce90f8260',
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
					commit: '8b749367fd5fea897cee98bd892fff1ce90f8260',
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
				commit: '8b749367fd5fea897cee98bd892fff1ce90f8260',
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
				// commit: '8b749367fd5fea897cee98bd892fff1ce90f8260',
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
				body (req) {
					requests.push(req.body);
					return JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						result: 'kovan'
					})
				}
			}
		});

		let res = await request(app => app
			.post('/push-build/v1.7.13/x86_64-unknown-linux-gnu')
			.type('form')
			.send({
				secret,
				sha3: 'a00ead491c0e47efe4abefeb27ddc6ed8d1ea4daa43683d8e349e1e7459b74ba',
				commit: 'c060d9584dae34e0e215f061bd61b2ebd375956b',
				filename: 'parity'
			})
		);

		expect(res).to.have.status(200);
		// Githubhint registration
		expect(requests[2].method).to.equal('eth_sendTransaction');
		expect(requests[2].params).to.deep.equal([{
			data: '0x02f2008da00ead491c0e47efe4abefeb27ddc6ed8d1ea4daa43683d8e349e1e7459b74ba0000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000004c687474703a2f2f64316834786c3463723168306d6f2e636c6f756466726f6e742e6e65742f76312e372e31332f7838365f36342d756e6b6e6f776e2d6c696e75782d676e752f7061726974790000000000000000000000000000000000000000',
			from: '0x0066ac7a4608f350bf9a0323d60dde211dfb27c0',
			gasPrice,
			to: '0x'
		}]);
		// Build registration
		expect(requests[4].method).to.equal('eth_sendTransaction');
		expect(requests[4].params).to.deep.equal([{
			data: '0x793b0efb000000000000000000000000c060d9584dae34e0e215f061bd61b2ebd375956b7838365f36342d756e6b6e6f776e2d6c696e75782d676e750000000000000000a00ead491c0e47efe4abefeb27ddc6ed8d1ea4daa43683d8e349e1e7459b74ba',
			from: '0x0066ac7a4608f350bf9a0323d60dde211dfb27c0',
			gasPrice,
			to: '0x'
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
