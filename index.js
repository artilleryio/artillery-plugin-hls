'use strict';

const debug = require('debug')('plugin:hls');
const A = require('async');
const request = require('requestretry');
const ratelimit = require('ratelimit');
const walkManifest = require('./walk-manifest');

module.exports = {
  Plugin: HlsPlugin
};

const METRICS = {
  SEGMENT_STARTED: 'HLS: segment download started',
  SEGMENT_COMPLETED: 'HLS: segment download completed'
};

function download(concurrency, resources, throttle, events, callback) {
  A.eachLimit(
    resources.filter(r => !r.content && r.uri),
    concurrency,
    function(item, done) {
      var options = {
        uri: item.uri,
        timeout: 60 * 1000, // 60 seconds timeout
        encoding: null, // treat all responses as a buffer
        retryDelay: 1000 // retry 1s after on failure
      };
      events.emit('counter', METRICS.SEGMENT_STARTED, 1);
      const startedAt = Date.now();
      request(options, (err) => {
        events.emit('counter', METRICS.SEGMENT_COMPLETED, 1);
        const delta = Date.now() - startedAt;
        events.emit('customStat', {
          stat: 'HLS: segment download time',
          value: delta
        });
        return done(err);
      })
        .on('request', (req) => {
        })
        .on('error', (err) => {
        })
        .on('response', function(res) {
          if (throttle != Infinity) {
            ratelimit(res, throttle * 1000);
            let dataLength = 0;
            let startTime;
            res.on('data', function(data) {
              let now = Date.now();
              if (!startTime) startTime = now;
              dataLength += data.length;
              let bytesPerSec = Math.ceil(dataLength / (now - startTime) * 1000);

              if (now - startTime > 5000) {
                startTime = now;
                dataLength = 0;
                debug(
                  'avg bandwidth seconds: %s/sec',
                  bytesPerSec
                );
                // TODO: Output this as a custom metric
              }
            });
          }
        });
    },
    callback);
}

function HlsPlugin(script, event, opts) {
  const renderVariables = opts.util ? opts.util.renderVariables : x => x;

  if (!script.config.processor) {
    script.config.processor = {};
  }

  function randomStreamSelector(variantStreams) {
    const index = Math.floor(Math.random() * variantStreams.length);
    debug('random index', index);
    debug(variantStreams[index]);
    return [].concat(variantStreams[index] || []);
  }

  function createStreamSelector(requestParams) {
    let streamSelector;

    // Stream variant object:
    // { attributes:
    //   { NAME: '720',
    //     RESOLUTION: { width: 1280, height: 720 },
    //     CODECS: 'mp4a.40.2,avc1.64001f',
    //     BANDWIDTH: 2149280,
    //     'PROGRAM-ID': 1 },
    //   uri: 'url_0/193039199_mp4_h264_aac_hd_7.m3u8',
    //   timeline: 0 }

    // TODO: Add validation for streamSelector attribute
    // TODO: Add templating for stream selector options
    if (requestParams.hls.streamSelector) {
      const selectorParams = requestParams.hls.streamSelector;

      //
      // Resolution selector
      //
      // TODO: max/min selectors
      if (selectorParams.resolution) {
        streamSelector = function(variantStreams) {
          const matchingStreams = variantStreams.filter(s => {
            // TODO: Handle the case when no matching resolution is found
            return (
              s.attributes.RESOLUTION.width ===
                selectorParams.resolution.width &&
              s.attributes.RESOLUTION.height ===
                selectorParams.resolution.height
            );
          });
          return [].concat(matchingStreams[0] || []);
        };
      }

      if (selectorParams.name) {
        streamSelector = function(variantStreams) {
          return variantStreams.filter(s => {
            return (
              (s.attributes.NAME || '').toLowerCase() ===
              selectorParams.name.toLowerCase()
            );
          });
        };
      }

      if (selectorParams.bandwidth) {
        if (selectorParams.bandwidth === 'max') {
          let streamWithMax = { attributes: { BANDWIDTH: -1 } };
          variantStreams.forEach(s => {
            if (s.attributes.BANDWIDTH > streamWithMax.attributes.BANDWIDTH) {
              streamWithMax = s;
            }
          });
          return [].concat(streamWithMax);
        } else if (selectorParams.bandwidth === 'min') {
          let streamWithMin = { attributes: { BANDWIDTH: Infinity } };
          variantStreams.forEach(s => {
            if (s.attributes.BANDWIDTH < streamWithMin.attributes.BANDWIDTH) {
              streamWithMin = s;
            }
          });
          return [].concat(streamWithMin);
        } else if (typeof selectorParams.bandwidth === 'number') {
          return variantStreams.filter(s => {
            return s.attributes.BANDWIDTH === selectorParams.bandwidth;
          });
        } else {
          return [];
        }
      }

      if (selectorParams.index) {
        if (typeof selectorParams.index === 'number') {
          // Returns the last element if the index is out of bounds
          streamSelector = function(variantStreams) {
            return variantStreams.slice(
              Math.min(selectorParams.index, variantStreams.length),
              selectorParams.index + 1
            );
          };
        } else if (selectorParams.index === 'random') {
          streamSelector = randomStreamSelector;
        }
      }
    } else {
      // no streamSelector attribute - treat the same as random
      streamSelector = randomStreamSelector;
    }

    return streamSelector;
  }

  function stream(requestParams, ctx, events, callback) {
    requestParams.url = renderVariables(requestParams.url, context);

    let concurrency = 4;
    let streamSelector = createStreamSelector(requestParams);
    let throttle;

    if (requestParams.hls.concurrency) {
      concurrency = renderVariables(requestParams.hls.concurrency, context);
    }
    if (typeof requestParams.hls.throttle === 'number') {
      throttle = renderVariables(requestParams.hls.throttle, context);
    } else {
      throttle = Infinity;
    }

    const resources = walkManifest(
      false,
      '/dev/null',
      requestParams.url,
      false,
      0,
      function(variantStreams) {
        const results = streamSelector(variantStreams);
        debug('Streams selected:');
        debug(results);
        return results;
      }
    );
    const startedAt = Date.now();
    download(concurrency, resources, throttle, events, function(err) {
      if (err) {
        debug(err);
        events.emit('error', err);
        return callback(err);
      }
      const delta = Date.now() - startedAt;
      events.emit('counter', METRICS.SEGMENT_COMPLETED, 1);
      events.emit('customStat', {
        stat: 'HLS: stream download time',
        value: delta
      });
      return callback();
    });
  }

  script.config.processor.hlsPluginStream = function(
    requestParams,
    res,
    userContext,
    events,
    done
  ) {
    // TODO: We already have the master playlist here in res.body() but for
    // now the WalkManifest implementation will re-request it again.

    // NOTE: hls property must be set. Can be an object or boolean value of true.
    if (typeof requestParams.hls === 'boolean' && requestParams.hls) {
      requestParams.hls = {};
    }
    if (typeof requestParams.hls === 'object') {
      stream(requestParams, userContext, events, err => {
        done(err);
      });
    } else {
      process.nextTick(done);
    }
  };

  script.scenarios.forEach(scenario => {
    if (!scenario.afterResponse) {
      scenario.afterResponse = [];
    }
    scenario.afterResponse.push('hlsPluginStream');
  });

  debug('Plugin initialized');
}
