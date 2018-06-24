# artillery-plugin-hls - load test HLS streaming with Artillery

## Description

This plugin adds HTTP Live Streaming (HLS) support to Artillery to make it possible to load test HLS streaming servers. With the plugin enabled, when a request to an M3U8 playlist is made, Artillery will parse the playlist, pick one of the alternative streams, and download its segments (`.ts` files).

### HTTP Live Streaming (HLS)

> HTTP Live Streaming (also known as HLS) is an HTTP-based media streaming communications protocol implemented by Apple Inc. as part of its QuickTime, Safari, OS X, and iOS software. Client implementations are also available in Microsoft Edge, Firefox and some versions of Google Chrome. Support is widespread in streaming media servers.

Source: [HTTP Live Streaming] on Wikipedia

Additional reading:
- [HTTP Live Streaming] - official Apple documentation

## Usage

### Install the plugin

```
npm install -g artillery-plugin-hls
```

### Load the plugin in your test configuration

```yaml
config:
  target: "https://video.example.com"
  plugins:
    hls: {}
```

### Make a request to an M3U8 playlist

To stream an HLS-encoded video, make a request to an `m3u8` playlist, and set the `hls` attribute to `{}` to use the default options, or customize streaming options:

```yaml
scenarios:
  - name: "Stream an HLS video"
    flow:
      - get:
          url: "/streams/xyz0123/xyz0123.m3u8"
          hls:
            concurrency: 2
            streamSelector:
              resolution:
                width: 320
                height: 184
            throttle: 100
```

## HLS Configuration

The following options are supported on the `hls` attribute:

- `concurrency` - the number of segments to download concurrently; defaults to 4
- `throttle` - set to a number (in kb/sec) to throttle bandwidth available to download that stream
- `streamSelector` - specify how an alternative stream should be selected; defaults to a random stream.

### streamSelector options

- `resolution` - set `width` and `height` to pick the stream that matches
- `name` - set to match on the `NAME` attribute of a stream
- `bandwidth` - set to a number to select a specific bandwidth; or to `"min"`/`"max"` to select the lowest/highest bandwidth
- `index` - set to a number to select the alternative stream at that index in the playlist or to `"random"` to select a stream at random

## Reported Metrics

The plugin adds a number of custom metrics to Artillery reports:

- **HLS: segment download started** - the number of individual segments (`.ts` files) requested from the server
- **HLS: segment download completed** - the number of segments downloaded
- **HLS: segment download time** - the amount of time it's taken to download a segment
- **HLS: stream download time** - the amount of time it's taken to download an entire stream

## Load Testing HLS at Scale

Streaming video with a large number of virtual users can quickly exhaust all available bandwidth on a single machine. Therefore bandwidth utilization should be monitored closely while tests run to scale out the number of nodes on which Artillery runs as needed.

[Artillery Pro](https://artillery.io/pro) provides a solution for running tests from a cluster of nodes easily as well as a number of other team and enterprise-oriented features, and deep AWS integration.

## License

Some of the code in this project has been adopted from [hls-fetcher](https://github.com/videojs/hls-fetcher/), licensed under MIT:

- [walk-manifest.js](./walk-manifest.js)
- [utils.js](./utils.js)

The rest of the code is licensed under MPL-2.0.
