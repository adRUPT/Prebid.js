import { expect } from 'chai';
import adapterManager from 'src/adaptermanager';
import { spec, masSizeOrdering, resetUserSync } from 'modules/rubiconBidAdapter';
import { parse as parseQuery } from 'querystring';
import { newBidder } from 'src/adapters/bidderFactory';
import { userSync } from 'src/userSync';
import { config } from 'src/config';
import * as utils from 'src/utils';

var CONSTANTS = require('src/constants.json');

const INTEGRATION = `pbjs_lite_v$prebid.version$`; // $prebid.version$ will be substituted in by gulp in built prebid

describe('the rubicon adapter', () => {
  let sandbox,
    bidderRequest;

  function createVideoBidderRequest() {
    let bid = bidderRequest.bids[0];
    bid.mediaType = 'video';
    bid.params.video = {
      'language': 'en',
      'p_aso.video.ext.skip': true,
      'p_aso.video.ext.skipdelay': 15,
      'playerHeight': 320,
      'playerWidth': 640,
      'size_id': 201,
      'aeParams': {
        'p_aso.video.ext.skip': '1',
        'p_aso.video.ext.skipdelay': '15'
      }
    };
  }

  function createVideoBidderRequestNoVideo() {
    let bid = bidderRequest.bids[0];
    bid.mediaType = 'video';
    bid.params.video = '';
  }

  function createVideoBidderRequestNoPlayer() {
    let bid = bidderRequest.bids[0];
    bid.mediaType = 'video';
    bid.params.video = {
      'language': 'en',
      'p_aso.video.ext.skip': true,
      'p_aso.video.ext.skipdelay': 15,
      'size_id': 201,
      'aeParams': {
        'p_aso.video.ext.skip': '1',
        'p_aso.video.ext.skipdelay': '15'
      }
    };
  }

  beforeEach(() => {
    sandbox = sinon.sandbox.create();

    bidderRequest = {
      bidderCode: 'rubicon',
      auctionId: 'c45dd708-a418-42ec-b8a7-b70a6c6fab0a',
      bidderRequestId: '178e34bad3658f',
      bids: [
        {
          bidder: 'rubicon',
          params: {
            accountId: '14062',
            siteId: '70608',
            zoneId: '335918',
            userId: '12346',
            keywords: ['a', 'b', 'c'],
            inventory: {
              rating: '5-star',
              prodtype: 'tech'
            },
            visitor: {
              ucat: 'new',
              lastsearch: 'iphone'
            },
            position: 'atf',
            referrer: 'localhost'
          },
          adUnitCode: '/19968336/header-bid-tag-0',
          code: 'div-1',
          sizes: [[300, 250], [320, 50]],
          bidId: '2ffb201a808da7',
          bidderRequestId: '178e34bad3658f',
          auctionId: 'c45dd708-a418-42ec-b8a7-b70a6c6fab0a',
          transactionId: 'd45dd707-a418-42ec-b8a7-b70a6c6fab0b'
        }
      ],
      start: 1472239426002,
      auctionStart: 1472239426000,
      timeout: 5000
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('MAS mapping / ordering', () => {
    it('should sort values without any MAS priority sizes in regular ascending order', () => {
      let ordering = masSizeOrdering([126, 43, 65, 16]);
      expect(ordering).to.deep.equal([16, 43, 65, 126]);
    });

    it('should sort MAS priority sizes in the proper order w/ rest ascending', () => {
      let ordering = masSizeOrdering([43, 9, 65, 15, 16, 126]);
      expect(ordering).to.deep.equal([15, 9, 16, 43, 65, 126]);

      ordering = masSizeOrdering([43, 15, 9, 65, 16, 126, 2]);
      expect(ordering).to.deep.equal([15, 2, 9, 16, 43, 65, 126]);

      ordering = masSizeOrdering([8, 43, 9, 65, 16, 126, 2]);
      expect(ordering).to.deep.equal([2, 9, 8, 16, 43, 65, 126]);
    });
  });

  describe('buildRequests implementation', () => {
    describe('for requests', () => {
      describe('to fastlane', () => {
        it('should make a well-formed request objects', () => {
          sandbox.stub(Math, 'random').callsFake(() => 0.1);
          let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
          expect(request.url).to.equal('//fastlane.rubiconproject.com/a/api/fastlane.json');

          let data = parseQuery(request.data);

          let expectedQuery = {
            'account_id': '14062',
            'site_id': '70608',
            'zone_id': '335918',
            'size_id': '15',
            'alt_size_ids': '43',
            'p_pos': 'atf',
            'rp_floor': '0.01',
            'rp_secure': /[01]/,
            'rand': '0.1',
            'tk_flint': INTEGRATION,
            'x_source.tid': 'd45dd707-a418-42ec-b8a7-b70a6c6fab0b',
            'p_screen_res': /\d+x\d+/,
            'tk_user_key': '12346',
            'kw': 'a,b,c',
            'tg_v.ucat': 'new',
            'tg_v.lastsearch': 'iphone',
            'tg_i.rating': '5-star',
            'tg_i.prodtype': 'tech',
            'tg_fl.eid': 'div-1',
            'rf': 'localhost'
          };

          // test that all values above are both present and correct
          Object.keys(expectedQuery).forEach(key => {
            let value = expectedQuery[key];
            if (value instanceof RegExp) {
              expect(data[key]).to.match(value);
            } else {
              expect(data[key]).to.equal(value);
            }
          });
        });

        it('page_url should use params.referrer, config.getConfig("pageUrl"), utils.getTopWindowUrl() in that order', () => {
          sandbox.stub(utils, 'getTopWindowUrl').callsFake(() => 'http://www.prebid.org');

          let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
          expect(parseQuery(request.data).rf).to.equal('localhost');

          delete bidderRequest.bids[0].params.referrer;
          [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
          expect(parseQuery(request.data).rf).to.equal('http://www.prebid.org');

          let origGetConfig = config.getConfig;
          sandbox.stub(config, 'getConfig').callsFake(function(key) {
            if (key === 'pageUrl') {
              return 'http://www.rubiconproject.com';
            }
            return origGetConfig.apply(config, arguments);
          });
          [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
          expect(parseQuery(request.data).rf).to.equal('http://www.rubiconproject.com');

          bidderRequest.bids[0].params.secure = true;
          [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
          expect(parseQuery(request.data).rf).to.equal('https://www.rubiconproject.com');
        });

        it('should use rubicon sizes if present (including non-mappable sizes)', () => {
          const sizesBidderRequest = clone(bidderRequest);
          sizesBidderRequest.bids[0].params.sizes = [55, 57, 59, 801];

          let [request] = spec.buildRequests(sizesBidderRequest.bids, sizesBidderRequest);
          let data = parseQuery(request.data);

          expect(data['size_id']).to.equal('55');
          expect(data['alt_size_ids']).to.equal('57,59,801');
        });

        it('should not validate bid request if no valid sizes', () => {
          const sizesBidderRequest = clone(bidderRequest);
          sizesBidderRequest.bids[0].sizes = [[621, 250], [300, 251]];

          let result = spec.isBidRequestValid(sizesBidderRequest.bids[0]);

          expect(result).to.equal(false);
        });

        it('should not validate bid request if no account id is present', () => {
          const noAccountBidderRequest = clone(bidderRequest);
          delete noAccountBidderRequest.bids[0].params.accountId;

          let result = spec.isBidRequestValid(noAccountBidderRequest.bids[0]);

          expect(result).to.equal(false);
        });

        it('should allow a floor override', () => {
          const floorBidderRequest = clone(bidderRequest);
          floorBidderRequest.bids[0].params.floor = 2;

          let [request] = spec.buildRequests(floorBidderRequest.bids, floorBidderRequest);
          let data = parseQuery(request.data);

          expect(data['rp_floor']).to.equal('2');
        });

        it('should send digitrust params', () => {
          window.DigiTrust = {
            getUser: function() {}
          };
          sandbox.stub(window.DigiTrust, 'getUser').callsFake(() =>
            ({
              success: true,
              identity: {
                privacy: {optout: false},
                id: 'testId',
                keyv: 'testKeyV'
              }
            })
          );

          let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
          let data = parseQuery(request.data);

          let expectedQuery = {
            'dt.id': 'testId',
            'dt.keyv': 'testKeyV',
            'dt.pref': '0'
          };

          // test that all values above are both present and correct
          Object.keys(expectedQuery).forEach(key => {
            let value = expectedQuery[key];
            expect(data[key]).to.equal(value);
          });

          delete window.DigiTrust;
        });

        it('should not send digitrust params when DigiTrust not loaded', () => {
          let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
          let data = parseQuery(request.data);

          let undefinedKeys = ['dt.id', 'dt.keyv'];

          // Test that none of the DigiTrust keys are part of the query
          undefinedKeys.forEach(key => {
            expect(typeof data[key]).to.equal('undefined');
          });
        });

        it('should not send digitrust params due to optout', () => {
          window.DigiTrust = {
            getUser: function() {}
          };
          sandbox.stub(window.DigiTrust, 'getUser').callsFake(() =>
            ({
              success: true,
              identity: {
                privacy: {optout: true},
                id: 'testId',
                keyv: 'testKeyV'
              }
            })
          );

          let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
          let data = parseQuery(request.data);

          let undefinedKeys = ['dt.id', 'dt.keyv'];

          // Test that none of the DigiTrust keys are part of the query
          undefinedKeys.forEach(key => {
            expect(typeof data[key]).to.equal('undefined');
          });

          delete window.DigiTrust;
        });

        it('should not send digitrust params due to failure', () => {
          window.DigiTrust = {
            getUser: function() {}
          };
          sandbox.stub(window.DigiTrust, 'getUser').callsFake(() =>
            ({
              success: false,
              identity: {
                privacy: {optout: false},
                id: 'testId',
                keyv: 'testKeyV'
              }
            })
          );

          let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
          let data = parseQuery(request.data);

          let undefinedKeys = ['dt.id', 'dt.keyv'];

          // Test that none of the DigiTrust keys are part of the query
          undefinedKeys.forEach(key => {
            expect(typeof data[key]).to.equal('undefined');
          });

          delete window.DigiTrust;
        });

        describe('digiTrustId config', () => {
          var origGetConfig;
          beforeEach(() => {
            window.DigiTrust = {
              getUser: sandbox.spy()
            };
          });

          afterEach(() => {
            delete window.DigiTrust;
          });

          it('should send digiTrustId config params', () => {
            sandbox.stub(config, 'getConfig').callsFake((key) => {
              var config = {
                digiTrustId: {
                  success: true,
                  identity: {
                    privacy: {optout: false},
                    id: 'testId',
                    keyv: 'testKeyV'
                  }
                }
              };
              return config[key];
            });

            let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
            let data = parseQuery(request.data);

            let expectedQuery = {
              'dt.id': 'testId',
              'dt.keyv': 'testKeyV'
            };

            // test that all values above are both present and correct
            Object.keys(expectedQuery).forEach(key => {
              let value = expectedQuery[key];
              expect(data[key]).to.equal(value);
            });

            // should not have called DigiTrust.getUser()
            expect(window.DigiTrust.getUser.notCalled).to.equal(true);
          });

          it('should not send digiTrustId config params due to optout', () => {
            sandbox.stub(config, 'getConfig').callsFake((key) => {
              var config = {
                digiTrustId: {
                  success: true,
                  identity: {
                    privacy: {optout: true},
                    id: 'testId',
                    keyv: 'testKeyV'
                  }
                }
              }
              return config[key];
            });

            let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
            let data = parseQuery(request.data);

            let undefinedKeys = ['dt.id', 'dt.keyv'];

            // Test that none of the DigiTrust keys are part of the query
            undefinedKeys.forEach(key => {
              expect(typeof data[key]).to.equal('undefined');
            });

            // should not have called DigiTrust.getUser()
            expect(window.DigiTrust.getUser.notCalled).to.equal(true);
          });

          it('should not send digiTrustId config params due to failure', () => {
            sandbox.stub(config, 'getConfig').callsFake((key) => {
              var config = {
                digiTrustId: {
                  success: false,
                  identity: {
                    privacy: {optout: false},
                    id: 'testId',
                    keyv: 'testKeyV'
                  }
                }
              }
              return config[key];
            });

            let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
            let data = parseQuery(request.data);

            let undefinedKeys = ['dt.id', 'dt.keyv'];

            // Test that none of the DigiTrust keys are part of the query
            undefinedKeys.forEach(key => {
              expect(typeof data[key]).to.equal('undefined');
            });

            // should not have called DigiTrust.getUser()
            expect(window.DigiTrust.getUser.notCalled).to.equal(true);
          });

          it('should not send digiTrustId config params if they do not exist', () => {
            sandbox.stub(config, 'getConfig').callsFake((key) => {
              var config = {};
              return config[key];
            });

            let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
            let data = parseQuery(request.data);

            let undefinedKeys = ['dt.id', 'dt.keyv'];

            // Test that none of the DigiTrust keys are part of the query
            undefinedKeys.forEach(key => {
              expect(typeof data[key]).to.equal('undefined');
            });

            // should have called DigiTrust.getUser() once
            expect(window.DigiTrust.getUser.calledOnce).to.equal(true);
          });
        });

        describe('singleRequest config', () => {
          it('should group all bid requests with the same site id', () => {
            sandbox.stub(config, 'getConfig').callsFake((key) => {
              const config = {
                'rubicon.singleRequest': true
              };
              return config[key];
            });

            const bidCopy = clone(bidderRequest.bids[0]);
            bidderRequest.bids.push(bidCopy);

            const bidCopy2 = clone(bidderRequest.bids[0]);
            bidCopy2.params.siteId = '32001';
            bidderRequest.bids.push(bidCopy2);

            const bidCopy3 = clone(bidderRequest.bids[0]);
            bidCopy3.params.siteId = '32001';
            bidderRequest.bids.push(bidCopy3);

            let serverRequests = spec.buildRequests(bidderRequest.bids, bidderRequest);
            expect(serverRequests).that.is.an('array').of.length(2);
          });

          it('should not group bid requests if singleRequest does not equal true', () => {
            sandbox.stub(config, 'getConfig').callsFake((key) => {
              const config = {
                'rubicon.singleRequest': false
              };
              return config[key];
            });

            const bidCopy = clone(bidderRequest.bids[0]);
            bidderRequest.bids.push(bidCopy);

            const bidCopy2 = clone(bidderRequest.bids[0]);
            bidCopy2.params.siteId = '32001';
            bidderRequest.bids.push(bidCopy2);

            const bidCopy3 = clone(bidderRequest.bids[0]);
            bidCopy3.params.siteId = '32001';
            bidderRequest.bids.push(bidCopy3);

            let serverRequests = spec.buildRequests(bidderRequest.bids, bidderRequest);
            expect(serverRequests).that.is.an('array').of.length(4);
          });

          it('should not group video bid requests', () => {
            sandbox.stub(config, 'getConfig').callsFake((key) => {
              const config = {
                'rubicon.singleRequest': true
              };
              return config[key];
            });

            const bidCopy = clone(bidderRequest.bids[0]);
            bidderRequest.bids.push(bidCopy);

            const bidCopy2 = clone(bidderRequest.bids[0]);
            bidCopy2.params.siteId = '32001';
            bidderRequest.bids.push(bidCopy2);

            const bidCopy3 = clone(bidderRequest.bids[0]);
            bidCopy3.params.siteId = '32001';
            bidderRequest.bids.push(bidCopy3);

            const bidCopy4 = clone(bidderRequest.bids[0]);
            bidCopy4.mediaType = 'video';
            bidCopy4.params.video = {
              'language': 'en',
              'p_aso.video.ext.skip': true,
              'p_aso.video.ext.skipdelay': 15,
              'playerHeight': 320,
              'playerWidth': 640,
              'size_id': 201,
              'aeParams': {
                'p_aso.video.ext.skip': '1',
                'p_aso.video.ext.skipdelay': '15'
              }
            };
            bidderRequest.bids.push(bidCopy4);

            let serverRequests = spec.buildRequests(bidderRequest.bids, bidderRequest);
            expect(serverRequests).that.is.an('array').of.length(3);
          });

          it('should not send more than 10 slots', () => {
            sandbox.stub(config, 'getConfig').callsFake((key) => {
              const config = {
                'rubicon.singleRequest': true
              };
              return config[key];
            });

            const bidCopy = clone(bidderRequest.bids[0]);
            bidderRequest.bids.push(bidCopy);

            for (let i = 0; i < 15; i++) {
              const bidCopy = clone(bidderRequest.bids[0]);
              bidCopy.params.siteId = '70608';
              bidderRequest.bids.push(bidCopy);
            }

            let serverRequests = spec.buildRequests(bidderRequest.bids, bidderRequest);
            const foundSlotsCount = serverRequests[0].data.indexOf('&slots=10&');
            expect(foundSlotsCount !== -1).to.equal(true);
          });
        });
      });

      describe('for video requests', () => {
        it('should make a well-formed video request', () => {
          createVideoBidderRequest();

          sandbox.stub(Date, 'now').callsFake(() =>
            bidderRequest.auctionStart + 100
          );

          let [request] = spec.buildRequests(bidderRequest.bids, bidderRequest);
          let post = request.data;

          let url = request.url;

          expect(url).to.equal('//fastlane-adv.rubiconproject.com/v1/auction/video');

          expect(post).to.have.property('page_url').that.is.a('string');
          expect(post.resolution).to.match(/\d+x\d+/);
          expect(post.account_id).to.equal('14062');
          expect(post.integration).to.equal(INTEGRATION);
          expect(post['x_source.tid']).to.equal('d45dd707-a418-42ec-b8a7-b70a6c6fab0b');
          expect(post).to.have.property('timeout').that.is.a('number');
          expect(post.timeout < 5000).to.equal(true);
          expect(post.stash_creatives).to.equal(true);

          expect(post).to.have.property('ae_pass_through_parameters');
          expect(post.ae_pass_through_parameters)
            .to.have.property('p_aso.video.ext.skip')
            .that.equals('1');
          expect(post.ae_pass_through_parameters)
            .to.have.property('p_aso.video.ext.skipdelay')
            .that.equals('15');

          expect(post).to.have.property('slots')
            .with.length.of(1);

          let slot = post.slots[0];

          expect(slot.site_id).to.equal('70608');
          expect(slot.zone_id).to.equal('335918');
          expect(slot.position).to.equal('atf');
          expect(slot.floor).to.equal(0.01);
          expect(slot.element_id).to.equal(bidderRequest.bids[0].adUnitCode);
          expect(slot.name).to.equal(bidderRequest.bids[0].adUnitCode);
          expect(slot.language).to.equal('en');
          expect(slot.width).to.equal(640);
          expect(slot.height).to.equal(320);
          expect(slot.size_id).to.equal(201);

          expect(slot).to.have.property('inventory').that.is.an('object');
          expect(slot.inventory).to.have.property('rating').that.equals('5-star');
          expect(slot.inventory).to.have.property('prodtype').that.equals('tech');

          expect(slot).to.have.property('keywords')
            .that.is.an('array')
            .of.length(3)
            .that.deep.equals(['a', 'b', 'c']);

          expect(slot).to.have.property('visitor').that.is.an('object');
          expect(slot.visitor).to.have.property('ucat').that.equals('new');
          expect(slot.visitor).to.have.property('lastsearch').that.equals('iphone');
        });

        it('should allow a floor price override', () => {
          createVideoBidderRequest();

          sandbox.stub(Date, 'now').callsFake(() =>
            bidderRequest.auctionStart + 100
          );

          var floorBidderRequest = clone(bidderRequest);

          // enter an explicit floor price //
          floorBidderRequest.bids[0].params.floor = 3.25;

          let [request] = spec.buildRequests(floorBidderRequest.bids, floorBidderRequest);
          let post = request.data;

          let floor = post.slots[0].floor;

          expect(floor).to.equal(3.25);
        });

        it('should not validate bid request when no video object is passed in', () => {
          createVideoBidderRequestNoVideo();
          sandbox.stub(Date, 'now').callsFake(() =>
            bidderRequest.auctionStart + 100
          );

          var floorBidderRequest = clone(bidderRequest);

          let result = spec.isBidRequestValid(floorBidderRequest.bids[0]);

          expect(result).to.equal(false);
        });

        it('should get size from bid.sizes too', () => {
          createVideoBidderRequestNoPlayer();
          sandbox.stub(Date, 'now').callsFake(() =>
            bidderRequest.auctionStart + 100
          );

          var floorBidderRequest = clone(bidderRequest);

          let [request] = spec.buildRequests(floorBidderRequest.bids, floorBidderRequest);
          let post = request.data;

          expect(post.slots[0].width).to.equal(300);
          expect(post.slots[0].height).to.equal(250);
        });
      });

      describe('combineSlotUrlParams', () => {
        it('should combine an array of slot url params', () => {
          expect(spec.combineSlotUrlParams([])).to.deep.equal({});

          expect(spec.combineSlotUrlParams([{p1: 'foo', p2: 'test', p3: ''}])).to.deep.equal({p1: 'foo', p2: 'test', p3: ''});

          expect(spec.combineSlotUrlParams([{}, {p1: 'foo', p2: 'test'}])).to.deep.equal({p1: ';foo', p2: ';test'});

          expect(spec.combineSlotUrlParams([{}, {}, {p1: 'foo', p2: ''}, {}])).to.deep.equal({p1: ';;foo;', p2: ''});

          expect(spec.combineSlotUrlParams([{}, {p1: 'foo'}, {p1: ''}])).to.deep.equal({p1: ';foo;'});

          expect(spec.combineSlotUrlParams([
            {p1: 'foo', p2: 'test'},
            {p2: 'test', p3: 'bar'},
            {p1: 'bar', p2: 'test', p4: 'bar'}
          ])).to.deep.equal({p1: 'foo;;bar', p2: 'test', p3: ';bar;', p4: ';;bar'});

          expect(spec.combineSlotUrlParams([
            {p1: 'foo', p2: 'test', p3: 'baz'},
            {p1: 'foo', p2: 'bar'},
            {p2: 'test'}
          ])).to.deep.equal({p1: 'foo;foo;', p2: 'test;bar;test', p3: 'baz;;'});
        });
      });

      describe('createSlotParams', () => {
        it('should return a valid slot params object', () => {
          let expectedQuery = {
            'account_id': '14062',
            'site_id': '70608',
            'zone_id': '335918',
            'size_id': 15,
            'alt_size_ids': '43',
            'p_pos': 'atf',
            'rp_floor': 0.01,
            'rp_secure': /[01]/,
            'tk_flint': INTEGRATION,
            'x_source.tid': 'd45dd707-a418-42ec-b8a7-b70a6c6fab0b',
            'p_screen_res': /\d+x\d+/,
            'tk_user_key': '12346',
            'kw': 'a,b,c',
            'tg_v.ucat': 'new',
            'tg_v.lastsearch': 'iphone',
            'tg_i.rating': '5-star',
            'tg_i.prodtype': 'tech',
            'tg_fl.eid': 'div-1',
            'rf': 'localhost'
          };

          const slotParams = spec.createSlotParams(bidderRequest.bids[0]);

          // test that all values above are both present and correct
          Object.keys(expectedQuery).forEach(key => {
            const value = expectedQuery[key];
            if (value instanceof RegExp) {
              expect(slotParams[key]).to.match(value);
            } else {
              expect(slotParams[key]).to.equal(value);
            }
          });
        });
      });

      describe('hasVideoMediaType', () => {
        it('should return true if mediaType is true', () => {
          createVideoBidderRequest();
          const legacyVideoTypeBidRequest = spec.hasVideoMediaType(bidderRequest.bids[0]);
          expect(legacyVideoTypeBidRequest).is.equal(true);
        });

        it('should return false if bidRequest.mediaType is not equal to video', () => {
          expect(spec.hasVideoMediaType({
            mediaType: 'banner'
          })).is.equal(false);
        });

        it('should return false if bidRequest.mediaType is not defined', () => {
          expect(spec.hasVideoMediaType({})).is.equal(false);
        });

        it('should return true if bidRequest.mediaTypes.video object exists', () => {
          expect(spec.hasVideoMediaType({
            mediaTypes: {
              video: {
                context: 'outstream',
                playerSize: [300, 250]
              }
            }
          })).is.equal(true);
        });
      });
    });

    describe('interpretResponse', () => {
      describe('for fastlane', () => {
        it('should handle a success response and sort by cpm', () => {
          let response = {
            'status': 'ok',
            'account_id': 14062,
            'site_id': 70608,
            'zone_id': 530022,
            'size_id': 15,
            'alt_size_ids': [
              43
            ],
            'tracking': '',
            'inventory': {},
            'ads': [
              {
                'status': 'ok',
                'impression_id': '153dc240-8229-4604-b8f5-256933b9374c',
                'size_id': '15',
                'ad_id': '6',
                'advertiser': 7,
                'network': 8,
                'creative_id': 'crid-9',
                'type': 'script',
                'script': 'alert(\'foo\')',
                'campaign_id': 10,
                'cpm': 0.811,
                'targeting': [
                  {
                    'key': 'rpfl_14062',
                    'values': [
                      '15_tier_all_test'
                    ]
                  }
                ]
              },
              {
                'status': 'ok',
                'impression_id': '153dc240-8229-4604-b8f5-256933b9374d',
                'size_id': '43',
                'ad_id': '7',
                'advertiser': 7,
                'network': 8,
                'creative_id': 'crid-9',
                'type': 'script',
                'script': 'alert(\'foo\')',
                'campaign_id': 10,
                'cpm': 0.911,
                'targeting': [
                  {
                    'key': 'rpfl_14062',
                    'values': [
                      '43_tier_all_test'
                    ]
                  }
                ]
              }
            ]
          };

          let bids = spec.interpretResponse({ body: response }, {
            bidRequest: bidderRequest.bids[0]
          });

          expect(bids).to.be.lengthOf(2);

          expect(bids[0].width).to.equal(320);
          expect(bids[0].height).to.equal(50);
          expect(bids[0].cpm).to.equal(0.911);
          expect(bids[0].ttl).to.equal(300);
          expect(bids[0].netRevenue).to.equal(false);
          expect(bids[0].rubicon.advertiserId).to.equal(7);
          expect(bids[0].rubicon.networkId).to.equal(8);
          expect(bids[0].creativeId).to.equal('crid-9');
          expect(bids[0].currency).to.equal('USD');
          expect(bids[0].ad).to.contain(`alert('foo')`)
            .and.to.contain(`<html>`)
            .and.to.contain(`<div data-rp-impression-id='153dc240-8229-4604-b8f5-256933b9374d'>`);
          expect(bids[0].rubiconTargeting.rpfl_elemid).to.equal('/19968336/header-bid-tag-0');
          expect(bids[0].rubiconTargeting.rpfl_14062).to.equal('43_tier_all_test');

          expect(bids[1].width).to.equal(300);
          expect(bids[1].height).to.equal(250);
          expect(bids[1].cpm).to.equal(0.811);
          expect(bids[1].ttl).to.equal(300);
          expect(bids[1].netRevenue).to.equal(false);
          expect(bids[1].rubicon.advertiserId).to.equal(7);
          expect(bids[1].rubicon.networkId).to.equal(8);
          expect(bids[1].creativeId).to.equal('crid-9');
          expect(bids[1].currency).to.equal('USD');
          expect(bids[1].ad).to.contain(`alert('foo')`)
            .and.to.contain(`<html>`)
            .and.to.contain(`<div data-rp-impression-id='153dc240-8229-4604-b8f5-256933b9374c'>`);
          expect(bids[1].rubiconTargeting.rpfl_elemid).to.equal('/19968336/header-bid-tag-0');
          expect(bids[1].rubiconTargeting.rpfl_14062).to.equal('15_tier_all_test');
        });

        it('should be fine with a CPM of 0', () => {
          let response = {
            'status': 'ok',
            'account_id': 14062,
            'site_id': 70608,
            'zone_id': 530022,
            'size_id': 15,
            'alt_size_ids': [
              43
            ],
            'tracking': '',
            'inventory': {},
            'ads': [{
              'status': 'ok',
              'cpm': 0,
              'size_id': 15
            }]
          };

          let bids = spec.interpretResponse({ body: response }, {
            bidRequest: bidderRequest.bids[0]
          });

          expect(bids).to.be.lengthOf(1);
          expect(bids[0].cpm).to.be.equal(0);
        });

        it('should handle an error with no ads returned', () => {
          let response = {
            'status': 'ok',
            'account_id': 14062,
            'site_id': 70608,
            'zone_id': 530022,
            'size_id': 15,
            'alt_size_ids': [
              43
            ],
            'tracking': '',
            'inventory': {},
            'ads': []
          };

          let bids = spec.interpretResponse({ body: response }, {
            bidRequest: bidderRequest.bids[0]
          });

          expect(bids).to.be.lengthOf(0);
        });

        it('should handle an error', () => {
          let response = {
            'status': 'ok',
            'account_id': 14062,
            'site_id': 70608,
            'zone_id': 530022,
            'size_id': 15,
            'alt_size_ids': [
              43
            ],
            'tracking': '',
            'inventory': {},
            'ads': [{
              'status': 'not_ok',
            }]
          };

          let bids = spec.interpretResponse({ body: response }, {
            bidRequest: bidderRequest.bids[0]
          });

          expect(bids).to.be.lengthOf(0);
        });

        it('should handle an error because of malformed json response', () => {
          let response = '{test{';

          let bids = spec.interpretResponse({ body: response }, {
            bidRequest: bidderRequest.bids[0]
          });

          expect(bids).to.be.lengthOf(0);
        });

        it('should handle a bidRequest argument of type Array', () => {
          let response = {
            'status': 'ok',
            'account_id': 14062,
            'site_id': 70608,
            'zone_id': 530022,
            'size_id': 15,
            'alt_size_ids': [
              43
            ],
            'tracking': '',
            'inventory': {},
            'ads': [{
              'status': 'ok',
              'cpm': 0,
              'size_id': 15
            }]
          };

          let bids = spec.interpretResponse({ body: response }, {
            bidRequest: [bidderRequest.bids[0]]
          });

          expect(bids).to.be.lengthOf(1);
          expect(bids[0].cpm).to.be.equal(0);
        });

        it('should handle a matching/combining adUnits with an Array of bidRequests (when singleRequest=true)', () => {
          let response = {
            'status': 'ok',
            'account_id': 14062,
            'site_id': 70608,
            'zone_id': 530022,
            'tracking': '',
            'inventory': {},
            'ads': [{
              'status': 'ok',
              'cpm': 0,
              'zone_id': 25000,
              'size_id': 15
            },
            {
              'status': 'ok',
              'cpm': 0.51,
              'zone_id': 50000,
              'size_id': 13,
            }]
          };

          const bid2 = clone(bidderRequest.bids[0]);
          bid2.sizes = [[200, 200]];
          bidderRequest.bids.push(bid2);

          let bids = spec.interpretResponse({ body: response }, {
            bidRequest: bidderRequest.bids
          });

          expect(bids).to.be.lengthOf(2);
          expect(bids[0].width).to.be.equal(200);
          expect(bids[1].width).to.be.equal(300);
        });
      });

      describe('for video', () => {
        beforeEach(() => {
          createVideoBidderRequest();
        });

        it('should register a successful bid', () => {
          let response = {
            'status': 'ok',
            'ads': {
              '/19968336/header-bid-tag-0': [
                {
                  'status': 'ok',
                  'cpm': 1,
                  'tier': 'tier0200',
                  'targeting': {
                    'rpfl_8000': '201_tier0200',
                    'rpfl_elemid': '/19968336/header-bid-tag-0'
                  },
                  'impression_id': 'a40fe16e-d08d-46a9-869d-2e1573599e0c',
                  'site_id': 88888,
                  'zone_id': 54321,
                  'creative_type': 'video',
                  'creative_depot_url': 'https://fastlane-adv.rubiconproject.com/v1/creative/a40fe16e-d08d-46a9-869d-2e1573599e0c.xml',
                  'ad_id': 999999,
                  'creative_id': 'crid-999999',
                  'size_id': 201,
                  'advertiser': 12345
                }
              ]
            },
            'account_id': 7780
          };

          let bids = spec.interpretResponse({ body: response }, {
            bidRequest: bidderRequest.bids[0]
          });

          expect(bids).to.be.lengthOf(1);

          expect(bids[0].creativeId).to.equal('crid-999999');
          expect(bids[0].cpm).to.equal(1);
          expect(bids[0].ttl).to.equal(300);
          expect(bids[0].netRevenue).to.equal(false);
          expect(bids[0].vastUrl).to.equal(
            'https://fastlane-adv.rubiconproject.com/v1/creative/a40fe16e-d08d-46a9-869d-2e1573599e0c.xml'
          );
          expect(bids[0].impression_id).to.equal('a40fe16e-d08d-46a9-869d-2e1573599e0c');
          expect(bids[0].mediaType).to.equal('video');
          expect(bids[0].videoCacheKey).to.equal('a40fe16e-d08d-46a9-869d-2e1573599e0c');
        });
      });
    });
  });

  describe('user sync', () => {
    const emilyUrl = 'https://tap-secure.rubiconproject.com/partner/scripts/rubicon/emily.html?rtb_ext=1';

    beforeEach(() => {
      resetUserSync();
    });

    it('should register the Emily iframe', () => {
      let syncs = spec.getUserSyncs({
        iframeEnabled: true
      });

      expect(syncs).to.deep.equal({type: 'iframe', url: emilyUrl});
    });

    it('should not register the Emily iframe more than once', () => {
      let syncs = spec.getUserSyncs({
        iframeEnabled: true
      });
      expect(syncs).to.deep.equal({type: 'iframe', url: emilyUrl});

      // when called again, should still have only been called once
      syncs = spec.getUserSyncs();
      expect(syncs).to.equal(undefined);
    });
  });
});

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
