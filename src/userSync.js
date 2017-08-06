import * as utils from 'src/utils';

export function newUserSync() {
  // Set user sync config default values which can be overridden by the publisher
  const userSyncDefaultConfig = {
    syncEnabled: true,
    pixelEnabled: true,
    syncsPerBidder: 5
  }

  let publicApi = {};
  // A queue of user syncs for each adapter
  // Let getDefaultQueue() set the defaults
  let queue = getDefaultQueue();

  // Since user syncs require cookie access we want to prevent sending syncs if cookies are not supported
  let cookiesAreSupported = !utils.isSafariBrowser() && utils.cookiesAreEnabled();
  // Whether or not user syncs have been trigger on this page load
  let hasFired = false;
  // How many bids for each adapter
  let numAdapterBids = {};

  // Merge the defaults with the user-defined config
  let userSyncConfig = Object.assign($$PREBID_GLOBAL$$.userSync || {},
    userSyncDefaultConfig);

  /**
   * @function getDefaultQueue
   * @summary Returns the default empty queue
   * @private
   * @return {object} A queue with no syncs
   */
  function getDefaultQueue() {
    return {
      image: [],
      iframe: []
    }
  }

  /**
   * @function fireSyncs
   * @summary Trigger all user syncs in the queue
   * @private
   */
  function fireSyncs() {
    if (!userSyncConfig.syncEnabled || !cookiesAreSupported || hasFired) {
      return;
    }

    try {
      // Image pixels
      fireImagePixels();
      // Iframe syncs
      loadIframes();
    }
    catch (e) {
      return utils.logError('Error firing user syncs', e);
    }
    // Reset the user sync queue
    queue = getDefaultQueue();
    hasFired = true;
  }

  /**
   * @function fireImagePixels
   * @summary Loops through user sync pixels and fires each one
   * @private
   */
  function fireImagePixels() {
    if (!userSyncConfig.pixelEnabled) {
      return;
    }
    // Randomize the order of the pixels before firing
    // This is to avoid giving any bidder who has registered multiple syncs
    // any preferential treatment and balancing them out
    utils.shuffle(queue.image).forEach((sync) => {
      let [bidderName, trackingPixelUrl] = sync;
      utils.logMessage(`Invoking image pixel user sync for bidder: ${bidderName}`);
      // Create image object and add the src url
      utils.triggerPixel(trackingPixelUrl);
    });
  }

  /**
   * @function loadIframes
   * @summary Loops through iframe syncs and loads an iframe element into the page
   * @private
   */
  function loadIframes() {
    if (!userSyncConfig.iframeEnabled) {
      return;
    }
    // Randomize the order of these syncs just like the pixels above
    utils.shuffle(queue.iframe).forEach((sync) => {
      let [bidderName, iframeUrl] = sync;
      utils.logMessage(`Invoking iframe user sync for bidder: ${bidderName}`);
      // Create image object and add the src url
      utils.insertUserSyncIframe(iframeUrl);
    });
  }

  /**
   * @function incrementAdapterBids
   * @summary Increment the count of user syncs queue for the adapter
   * @private
   * @params {object} numAdapterBids The object contain counts for all adapters
   * @params {string} bidder The name of the bidder adding a sync
   * @returns {object} The updated version of numAdapterBids
   */
  function incrementAdapterBids(numAdapterBids, bidder) {
    if (!numAdapterBids[bidder]) {
      numAdapterBids[bidder] = 1;
    } else {
      numAdapterBids[bidder] += 1;
    }
    return numAdapterBids;
  }

  /**
   * @function registerSync
   * @summary Add sync for this bidder to a queue to be fired later
   * @public
   * @params {string} type The type of the sync including image, iframe, and ajax
   * @params {string} bidder The name of the adapter. e.g. "rubicon"
   * @params {string|object} data A series of arguments

   * @example <caption>Using Image Sync</caption>
   * // registerSync(type, adapter, pixelUrl)
   * userSync.registerSync('image', 'rubicon', 'http://example.com/pixel')
   */
  publicApi.registerSync = (type, bidder, ...data) => {
    if (!userSyncConfig.syncEnabled || !utils.isArray(queue[type])) {
      return utils.logWarn(`User sync type "{$type}" not supported`);
    }
    if (Number(numAdapterBids[bidder]) >= userSyncConfig.syncsPerBidder) {
      return utils.logWarn(`Number of user syncs exceeded for "{$bidder}"`);
    }
    // All bidders are enabled by default. If specified only register for enabled bidders.
    let hasEnabledBidders = userSyncConfig.enabledBidders && userSyncConfig.enabledBidders.length;
    if (hasEnabledBidders && userSyncConfig.enabledBidders.indexOf(bidder) < 0) {
      return utils.logWarn(`Bidder "{$bidder}" not supported`);
    }
    queue[type].push([bidder, ...data]);
    numAdapterBids = incrementAdapterBids(numAdapterBids, bidder);
  };

  /**
   * @function syncUsers
   * @summary Trigger all the user syncs based on publisher-defined timeout
   * @public
   * @params {int} timeout The delay in ms before syncing data - default 0
   */
  publicApi.syncUsers = (timeout = 0) => {
    if (timeout) {
      return window.setTimeout(fireSyncs, Number(timeout));
    }
    fireSyncs();
  };

  /**
   * @function overrideSync
   * @summary Expose syncUsers method to the publisher for manual syncing when enabled
   * @param {boolean} enableOverride Tells this module to expose the syncAll method to the public
   * @public
   */
  publicApi.overrideSync = (enableOverride) => {
    if (enableOverride) {
      $$PREBID_GLOBAL$$.userSync.syncAll = userSync.syncUsers;
    }
  };

  return publicApi;
}

export const userSync = newUserSync();
