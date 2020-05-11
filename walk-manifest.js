var m3u8 = require('m3u8-parser');
var syncRequest = require('sync-request');
var url = require('url');
var path = require('path');
var fs = require('fs');
var debug = require('debug')('hls');

var joinURI = function(absolute, relative) {
	var parse = url.parse(absolute);
	parse.pathname = path.join(parse.pathname, relative);
	return url.format(parse);
};


var isAbsolute = function(uri) {
	var parsed = url.parse(uri);
	if (parsed.protocol) {
		return true;
	}
	return false;
};

var mediaGroupPlaylists = function(mediaGroups) {
  var playlists = [];
  ['AUDIO', 'VIDEO', 'CLOSED-CAPTIONS', 'SUBTITLES'].forEach(function(type) {
    var mediaGroupType = mediaGroups[type];
    if (mediaGroupType && !Object.keys(mediaGroupType).length) {
      return;
    }

    for (var group in mediaGroupType) {
      for (var item in mediaGroupType[group]) {
        var props = mediaGroupType[group][item];
        playlists.push(props);
      }
    }
  });
  debug('mediaGroupPlaylists:');
  debug(playlists);
  return playlists;
};

var parseManifest = function(content) {
  var parser = new m3u8.Parser();
  parser.push(content);
  parser.end();
  debug('parsed manifest:');
  debug(parser.manifest);
  return parser.manifest;
};

var parseKey = function(basedir, decrypt, resources, manifest, parent, urlVariables) {
	if (!manifest.parsed.segments[0] || !manifest.parsed.segments[0].key) {
		return {};
	}
	var key = manifest.parsed.segments[0].key;

	var keyUri = key.uri;
	if (!isAbsolute(keyUri)) {
		keyUri = joinURI(path.dirname(manifest.uri), path.basename(keyUri));
	}

	// if we are not decrypting then we just download the key
	if (!decrypt) {
		// put keys in parent-dir/key-name.key
		key.file = basedir;
		if (parent) {
			key.file = path.dirname(parent.file);
		}
		key.file = path.join(key.file, path.basename(key.uri));

		manifest.content = new Buffer(manifest.content.toString().replace(
			key.uri,
			path.relative(path.dirname(manifest.file), key.file)
		));
		key.uri = keyUri;
		if (urlVariables) {
			key.uri+=urlVariables;
		}
		resources.push(key);
		return key;
	}

	// get the aes key
	var keyContent = syncRequest('GET', keyUri).getBody();
	key.bytes = new Uint32Array([
		keyContent.readUInt32BE(0),
		keyContent.readUInt32BE(4),
		keyContent.readUInt32BE(8),
		keyContent.readUInt32BE(12)
	]);

	// remove the key from the manifest
	manifest.content = new Buffer(manifest.content.toString().replace(
		new RegExp('.*' + key.uri + '.*'),
		''
	));


	return key;
};

var walkPlaylist = function(decrypt, basedir, uri, parent, manifestIndex, playlistFilter) {

	var resources = [];
	var manifest  = {};
	manifest.uri  = uri;
	manifest.file = path.join(basedir, path.basename(uri));

	let parsedUrl = new URL(manifest.uri);
	let urlVariables = parsedUrl.search;
	resources.push(manifest);

	// if we are not the master playlist
	if (parent) {
		manifest.file = path.join(
			path.dirname(parent.file),
			'manifest' + manifestIndex,
			path.basename(manifest.file)
		);
		// get the real uri of this playlist
		if (!isAbsolute(manifest.uri)) {
			manifest.uri = joinURI(path.dirname(parent.uri), manifest.uri);
		}
		// replace original uri in file with new file path
		parent.content = new Buffer(parent.content.toString().replace(uri, path.relative(path.dirname(parent.file), manifest.file)));
	}

  manifest.content = syncRequest('GET', manifest.uri).getBody();
  debug('manifest.content');
  debug(manifest.content);
  manifest.parsed  = parseManifest(manifest.content);
	manifest.parsed.segments = manifest.parsed.segments   || [];
	manifest.parsed.playlists = manifest.parsed.playlists || [];
	manifest.parsed.mediaGroups = manifest.parsed.mediaGroups || {};

  var playlists = manifest.parsed.playlists.concat(mediaGroupPlaylists(manifest.parsed.mediaGroups));
	var key = parseKey(basedir, decrypt, resources, manifest, parent,urlVariables);

	// SEGMENTS
	manifest.parsed.segments.forEach(function(s, i) {
		if (!s.uri) {
			return;
		}
		// put segments in manifest-name/segment-name.ts
		s.file = path.join(path.dirname(manifest.file), path.basename(s.uri));
		if (!isAbsolute(s.uri)) {
			s.uri = joinURI(path.dirname(manifest.uri), s.uri);
		}
		if (key) {
			s.key = key;
			s.key.iv = s.key.iv || new Uint32Array([0, 0, 0, manifest.parsed.mediaSequence, i]);
		}
		manifest.content = new Buffer(manifest.content.toString().replace(s.uri, path.basename(s.uri)));

		if (urlVariables) {
			s.uri+=urlVariables;
		}
		resources.push(s);
	});

  // Pick a SUB playlist:
  playlists = playlists.filter(p => p.uri);
  var filterFunc = playlistFilter || (function(allPlaylists) {
    return [].concat(allPlaylists[0] || []);
  });
  playlists = filterFunc(playlists);

  // if (process.env.PLAYLIST_NAME) {
  //   // Presuming the playlist with this name exists
  //   playlists = playlists.filter((p) => {
  //     return p.attributes.NAME === process.env.PLAYLIST_NAME;
  //   });
  // } else {
  //   playlists = [].concat(playlists[0] || []);
  // }

  debug('playlists:');
  debug(playlists);

	// SUB Playlists
	playlists.forEach(function(p, z) {
		if (!p.uri) {
			return;
		}
		resources = resources.concat(walkPlaylist(decrypt, basedir, p.uri, manifest, z, playlistFilter));
	});

	return resources;
};

module.exports = walkPlaylist;
