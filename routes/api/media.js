require('dotenv').config();
var async = require('async');
var keystone = require('keystone');

// http
var http = require('http');

// fs
var fs = require('fs');
var path = require('path');

var Media = keystone.list('Media');
var MediaChannel = keystone.list('MediaChannel');

// ipfs connection
var ipfsAPI = require('ipfs-api');
var ipfs = ipfsAPI('localhost', '5001', {
	protocol: 'http'
});
const channelMsg = (msg) => {
	console.log('Channel msg received...');
	console.log(msg);
	data = msg.data.toString('utf8');
	console.log("Received data: '" + data + "'");
	// get api route
	var addPath = '/api/' + data + '/add';
	// call add api
	http.get({
		host: 'localhost',
		path: addPath
	}, function (response) {
		// Continuously update stream with data
		var body = '';
		response.on('data', function (d) {
			body += d;
		});
		response.on('end', function () {
			// Data reception is done, do whatever with it!
			var parsed = JSON.parse(body);
			console.log('added');
			console.log(parsed);
		});
	});
};
var ipfsInitAttempts = 0;
var ipfsInit = () => {
	ipfs.id(function (err, identity) {
		if (err) {
			console.log('ipfs init error');
			ipfsInitAttempts += 1;
			if (ipfsInitAttempts < 3) {
				setTimeout(function () {
					ipfsInit();
				}, 15000);
			}
		} else {
			keystone.list('MediaChannel').model.find().sort('name').exec(function (err, channels) {
				if (err || !channels.length) {
					console.log('error: no channels');
				}
				channels.forEach((channel) => {
					var topic = channel.name;
					ipfs.pubsub.subscribe(topic, channelMsg, (suberr) => {
						if (suberr) {
							console.log('Could not subscribe..');
							console.log(suberr);
							throw suberr;
						}
					});
				});
			});
			ipfs.pubsub.ls((err, topics) => {
				if (err) {
					console.log('ipfs pubsub ls err');
					throw err;
				}
			});
		}
	});
};
ipfsInit();

// Periodically show peers
setInterval(function () {
	// share media on ipfs
	ipfs.id(function (err, identity) {
		if (err) {
			if (ipfsInitAttempts < 3) {
				console.log('connection error trying to sync with ipfs');
			}
		} else {
			// find channels
			keystone.list('MediaChannel').model.find().sort('name').exec(function (err, channels) {
				if (err || !channels.length) {
					console.log('error finding media categories to sync with ipfs');
				}
				// loop through channels
				channels.forEach((channel) => {
					console.log('adding channel:');
					var ipfsTopic = channel.name;
					console.log(ipfsTopic);
					// loop through media
					keystone.list('Media').model.find().where('channels').in([channel.id]).exec(function (err, sketchesToShare) {
						if (err) console.log(err);
						sketchesToShare.forEach((sketchToShare) => {
							if (sketchToShare.ipfsHash) {
								console.log('trying to share');
								console.log(sketchToShare.ipfsHash);
								console.log('in topic');
								console.log(channel.name);
								ipfs.pubsub.publish(channel.name, new Buffer(sketchToShare.ipfsHash), (err) => {
									if (err) {
										console.log('error trying to publish media');
										console.log(err);
										throw err;
									}
								});
							}
						});
					});
				});
			});
		}
	});
	// // periodically show peers
	// ipfs.pubsub.ls((err, topics) => {
	// 	if (err) {
	// 		console.log('ipfs pubsub ls err:');
	// 		console.log(err);
	// 		throw err;
	// 	}
	// 	console.log("Subscribed topics:");
	// 	console.log(topics);
	// 	topics.forEach((topic) => {
	// 		ipfs.pubsub.peers(topic, (err, peerIds) => {
	// 			if (err) {
	// 				throw err;
	// 			}
	// 			console.log("Peers:");
	// 			console.log(peerIds);
	// 		});
	// 	})
	// });
}, 900000); // 15 min timer

// ipc connection
const ipc = require('node-ipc');
var isDplayerConnected = false;
ipc.config.id = 'dremoteipc';
ipc.config.retry = 5000;
ipc.config.maxRetries = 3;
ipc.config.silent = true;
var screenshotID = null;
ipc.connectTo(
	'dplayeripc',
	function () {
		ipc.of.dplayeripc.on(
			'connect',
			function () {
				isDplayerConnected = true;
			}
		);
		// screenshot sketch
		ipc.of.dplayeripc.on(
			'message',
			function (data, socket) {
				if(screenshotID != null){
					var apiAddress = 'http://0.0.0.0:'+parseInt(process.env.PORT || 80, 10)+'/api/media/'+screenshotID+'/screenshot';
					http.get(apiAddress);
					screenshotID = null;
				}
			}
		);
	});

/**
 * Get Media by ID
 */
exports.get = function (req, res) {
	Media.model.findById(req.params.id).exec(function (err, item) {
		if (err) return res.apiError('database error', err);
		if (!item) return res.apiError('not found');
		res.apiResponse({
			sketch: item
		});
	});
};

/**
 * List Media
 */
exports.list = function (req, res) {
	Media.model.find(function (err, mediaList) {
		if (err) {
			return res.apiError({
				success: false,
				note: 'could not get media from database'
			});
		}
		// list channels
		MediaChannel.model.find(function (err, channelList) {
			if (err) {
				return res.apiError({
					success: false,
					note: 'could not get channels from database'
				});
			}
			res.apiResponse({
				success: true,
				note: 'retrieved media list from database',
				media: mediaList,
				channels: channelList,
			});
		});
	});
};


/**
 * Play Media by ID
 */
exports.play = function (req, res) {
	// stop autoplay
	if(autoplay){
		clearInterval(autoplay);
	}
	
	if (!isDplayerConnected) {
		console.log('play error: player not connected');
		return res.apiError({
			success: false,
			note: 'renderer not active'
		});
	}
	Media.model.findById(req.params.id).exec(function (err, item) {
		if (err) {
			return res.apiError({
				success: false,
				note: 'could not find media in database'
			});
		}
		if (!item) {
			return res.apiError({
				success: false,
				note: 'could not get media from database'
			});
		}
		if (ipc.of.dplayeripc) {
			var sketchPath = 'file:///' + res.locals.staticPath + item.localDir + '/index.html';
			ipc.of.dplayeripc.emit('message', sketchPath);
			console.log(JSON.stringify(item));
			// check if sketch has thumbnail
			if(item.prefThumb) {
				screenshotID = null; // dont save thumbnail
			}else{
				screenshotID = req.params.id; // save media ID to take thumbnail
			}
			res.apiResponse({
				success: true,
				note: 'queued media to display'
			});
		} else {
			res.apiError({
				success: false,
				note: 'failed to queue media to display'
			});
		}
	});
};

/**
 * Create new Sketch
 */
exports.create = function (req, res) {
	var newModel = new Media.model();
	var updater = newModel.getUpdateHandler(req);
	// make folder
	var saveDir = newModel.id;
	var uploadPath = res.locals.viewStaticPath + saveDir;
	try {
		fs.mkdirSync(uploadPath);
	} catch (err) {
		if (fserr.code !== 'EEXIST') {
			return res.apiError({
				success: false,
				note: 'could not create new directory for media'
			});
		}
	}
	// save file
	var uploadName = uploadPath + '/index.html';
	fs.writeFile(uploadName, req.body.sketch, 'utf8', (err) => {
		if (err) {
			return res.apiError({
				success: false,
				note: 'could not save HTML to storage'
			});
		}
	});
	// update database
	var data = {
		title: saveDir,
		localDir: saveDir
	};
	updater.process(data, {
		flashErrors: true
	}, function (err) {
		if (err) {
			return res.apiError({
				success: false,
				note: 'could not save to database'
			});
		} else {
			// format media metadata
			var diskJSON = {
				"disk": {
					"title":saveDir,
					"state":"published"
				}
			};
			// save metadata with media
			fs.writeFile(uploadPath + '/disk.json', JSON.stringify(diskJSON, null, 4), 'utf8', function (err) {
				if (err) {
					console.log('error saving setup json' + err);
					return res.apiError({
						success: false,
						note: 'could not save media metadata'
					});
				}
				// play new sketch
				var playURL = 'http://0.0.0.0:'+parseInt(process.env.PORT || 80, 10)+'/api/media/'+newModel.id+'/play';
				http.get(playURL);
				// finished
				return res.apiResponse({
					success: true,
					note: 'uploaded new media'
				});
			});
		}
	});
};

/**
 * Update Sketch by ID
 */
exports.update = function (req, res) {
	Media.model.findById(req.params.id).exec(function (err, item) {
		if (err) {
			return res.apiError({
				success: false,
				note: 'database error' + err
			});
		}
		if (!item) {
			return res.apiError({
				success: false,
				note: 'sketch ID not found'
			});
		}
		// get absolute file name
		var saveName = res.locals.staticPath + item.localDir + '/index.html';
		// get code from HTTP body
		var code = req.body.code;
		// save sketch
		fs.writeFile(saveName, code, 'utf8', function (err) {
			if (err) {
				// error saving
				return res.apiError({
					success: false,
					note: 'error saving sketch file'
				});
			} else {
				// save title
				item.title = req.body.title;
				item.save(function (err) {
					if (err) {
						return res.apiError({
							success: false,
							note: 'could not update database ' + err
						});
					} else {
						// update metadata file
						var diskJSONpath = res.locals.staticPath + item.localDir + '/disk.json';
						var diskJSONexists = fs.existsSync(diskJSONpath);
						if(diskJSONexists){
							// read json with metadata
							var rawDiskJSON = fs.readFileSync(diskJSONpath);
							if(!rawDiskJSON) {
								console.log('could not read updated media metadata');
								return res.apiError({
									success: false,
									note: 'updated media but failed to find metadata file'
								});
							} else {
								// add new metadata to loaded object
								var obj = JSON.parse(rawDiskJSON);
								obj.disk.title = req.body.title;
								// save new metadata
								fs.writeFile(diskJSONpath, JSON.stringify(obj, null, 4), 'utf8', function (err) {
									if(err){
										console.log('error saving setup json' + err);
										return res.apiError({
											success: false,
											note: 'updated but failed to save metadata file'
										});					
									}else{
										// play new sketch
										var playURL = 'http://0.0.0.0:'+parseInt(process.env.PORT || 80, 10)+'/api/media/'+req.params.id+'/play';
										http.get(playURL);
										// finished
										return res.apiResponse({
											success: true,
											note: 'updated media'
										});
									}
								})
							}
						}
					}
				});
			}
		});
	});
};

/**
 * Channel add/remove sketch by ID
 */
exports.channel = function (req, res) {
	// find sketch
	Media.model.findById(req.params.id).exec(function (err, item) {
		if (err) return res.apiError('database error', err);
		if (!item) return res.apiError('not found');
		var sketchChannels = [];
		var alreadyInChannel = false;
		// add existing channels to array
		for (var i = 0; i < item.channels.length; i++) {
			// check if channel is already added
			if (item.channels[i] == req.query._id) {
				alreadyInChannel = true; // skip adding
			} else {
				// keep current channel if not the same channel in request
				sketchChannels.push(item.channels[i]);
			}
		}
		// add new channel if it wasnt already added
		if (alreadyInChannel == false) {
			sketchChannels.push(req.query._id);
		}
		var data = {
			channels: sketchChannels
		};
		// run the database update
		item.getUpdateHandler(req).process(data, function (err) {
			if (err) {
				return res.apiError('error updating media channel', err);
			} else {
				// update metadata file
				var diskJSONpath = res.locals.staticPath + item.localDir + '/disk.json';
				var diskJSONexists = fs.existsSync(diskJSONpath);
				if(diskJSONexists){
					// read json with metadata
					var rawDiskJSON = fs.readFileSync(diskJSONpath);
					if(!rawDiskJSON) {
						console.log('could not read updated media metadata');
						return res.apiError({
							success: false,
							note: 'updated media but failed to find metadata file'
						});
					} else {
						// get channel key (name as string) from id
						MediaChannel.model.findById(req.query._id).exec(function(err, updatedChannel){
							if (err) return res.apiError('database error', err);
							if (!updatedChannel) return res.apiError('not found');
							// add new metadata to loaded object
							var obj = JSON.parse(rawDiskJSON);
							if(alreadyInChannel == false){
								if(obj.disk.channels){
									obj.disk.channels.push(updatedChannel.key);
								}else{
									obj.disk.channels = [updatedChannel.key];
								}
							}else{
								var channelIdx = obj.disk.channels.indexOf(updatedChannel.key);
								if(channelIdx > -1){
									obj.disk.channels.splice(channelIdx, 1);
								}
							}
							// save new metadata
							fs.writeFile(diskJSONpath, JSON.stringify(obj, null, 4), 'utf8', function (err) {
								if(err){
									console.log('error saving setup json' + err);
									return res.apiError({
										success: false,
										note: 'updated but failed to save metadata file'
									});					
								}else{
									// finished
									return res.apiResponse({
										success: true,
										note: 'added media to channel'
									});
								}
							});
						});
					}
				}else{
					// disk.json doesnt exist
				}
			}
		});
	});
};

/**
 * Subscribe to channel
 */
exports.subscribe = function (req, res) {
	//
	var newChannel = new MediaChannel.model();
	var newUpdater = newChannel.getUpdateHandler(req);
	var data = {
		name: req.query.name
	};
	newUpdater.process(data, {
		flashErrors: true
	}, function (err) {
		if (err) {
			return res.apiError({
				success: false,
				note: 'could not subscribe to channel'
			});
		} else {
			return res.apiResponse({
				success: true,
				note: 'subscribed to channel'
			});
		}
	});
};

/**
 * Unsubscribe to channel
 */

exports.unsubscribe = function (req, res) {
	// TODO: find and remove sketches in channel before deleting channel
	// remove channel from database
	MediaChannel.model.findById(req.query.id).exec(function (err, item) {
		if (err) {
			return apiError({
				success: false,
				note: 'could not find channel in database'
			});
		}
		if (!item) {
			return res.apiError({
				success: false,
				note: 'could not get channel from database'
			});
		}
		item.remove(function (err) {
			if (err) {
				return res.apiError({
					success: false,
					note: 'could not remove channel from database'
				});
			}
			return res.apiResponse({
				success: true,
				note: 'deleted channel'
			});
		});
	});
};

/**
 * Delete/unpublish Sketch by ID
 */
exports.remove = function (req, res) {
	// find sketch
	Media.model.findById(req.params.id).exec(function (err, item) {
		if (err) return res.apiError('database error', err);
		if (!item) return res.apiError('not found');
		item.state = 'archived';
		item.save(function (err) {
			if (err) {
				return res.err(err);
			} else {
				res.apiResponse({
					success: true
				});
			}
		});
	});
};

/**
 * Screenshot sketch by ID
 */
exports.screenshot = function (req, res) {
	// no player
	if (!isDplayerConnected) {
		console.log('play error: player not connected');
		return res.apiError({
			success: false
		});
	}
	// find sketch
	Media.model.findById(req.params.id).exec(function (err, item) {
		if (err) return res.apiError('database error', err);
		if (!item) return res.apiError('not found');
		// prep to save screenshot
		var sys = require('sys');
		var exec = require('child_process').exec;
		var uploadName = 'screenshot_' + (Math.random().toString(36).substr(2, 6)) + '.png';
		var uploadPath = res.locals.staticPath + item.localDir + '/' + uploadName;
		var execCommand = 'import -window root -display :0.0 ' + uploadPath;
		console.log('saving screenshot to: ' + uploadPath);
		// save screenshot
		exec(execCommand, function (err, stdout, stderr) {
			console.log(stdout);
			if (err) {
				console.log('screenshot error: ');
				return res.apiError({
					success: false,
					note: 'could not take screenshot'
				});
			};
			// add thumbnail to database
			var thumbEntry = {
				prefThumb: uploadName
			}; 
			Media.updateItem(item, thumbEntry, {
				fields: ["prefThumb"]
			}, function (dberror) {
				if (dberror) {
					console.log('db error: ' + dberror);
					return res.apiError({
						success: false
					});
				} else {
					// save prefthumb to metadata file
						// update metadata file
						var diskJSONpath = res.locals.staticPath + item.localDir + '/disk.json';
						var diskJSONexists = fs.existsSync(diskJSONpath);
						if(diskJSONexists){
							// read json with metadata
							var rawDiskJSON = fs.readFileSync(diskJSONpath);
							if(!rawDiskJSON) {
								console.log('could not read updated media metadata');
								return res.apiError({
									success: false,
									note: 'could not read media metadata file'
								});
							} else {
								// add new metadata to loaded object
								var obj = JSON.parse(rawDiskJSON);
								obj.disk.prefThumb = uploadName;
								// save new metadata
								fs.writeFile(diskJSONpath, JSON.stringify(obj, null, 4), 'utf8', function (err) {
									if(err){
										console.log('error saving setup json' + err);
										return res.apiError({
											success: false,
											note: 'could not save screenshot to metadata file'
										});					
									}else{
										// finished
										return res.apiResponse({
											success: true,
											note: 'screenshot saved to db'
										});
									}
								})
							}
						}
				}
			});
		});
	});
};

/**
 * Screenshot renderer
 */
exports.savescreen = function (req, res) {
	// no player
	if (!isDplayerConnected) {
		console.log('play error: player not connected');
		return res.apiError({
			success: false,
			note: 'renderer not active'
		});
	}
	// prep to save screenshot
	var sys = require('sys');
	var exec = require('child_process').exec;
	var uploadName = 'screenshot.png';
	var uploadPath = path.join(__dirname, './../../public') + '/' + uploadName;
	var execCommand = 'import -window root -display :0.0 ' + uploadPath;
	console.log('saving screenshot to: ' + uploadPath);
	// save screenshot
	exec(execCommand, function (err, stdout, stderr) {
		console.log(stdout);
		if (err) {
			console.log('screenshot error: ');
			return res.apiError({
				success: false,
				note: 'could not save screenshot'
			});
		} else {
			return res.apiResponse({
				success: true,
				note: 'saved screenshot'
			});
		}
	});
};

/**
 * Sync Sketch to IPFS
 */
exports.share = function (req, res) {
	Media.model.findById(req.params.id).exec(function (err, item) {
		if (err) return res.apiError('database error', err);
		if (!item) return res.apiError('not found');
		var sketchPath = [];
		sketchPath.push(path.join(res.locals.staticPath, item.localDir));
		ipfs.files.add(sketchPath, {
			recursive: true
		}, function (ipfserr, files) {
			if (ipfserr) {
				console.log('ipfs file add error');
				return res.apiError('ipfs error', ipfserr);
			} else {
				console.log("Added:");
				files.forEach((file) => {
					console.log(file.path);
					console.log(file.hash);
					console.log(file.size);
				});
				var data = {
					ipfsHash: files[files.length - 1].hash
				};
				Media.updateItem(item, data, {
					fields: ["ipfsHash"]
				}, function (dberror) {
					if (dberror) {
						console.log(dberror);
					}else{
						// update metadata file
						var diskJSONpath = res.locals.staticPath + item.localDir + '/disk.json';
						var diskJSONexists = fs.existsSync(diskJSONpath);
						if(diskJSONexists){
							// read json with metadata
							var rawDiskJSON = fs.readFileSync(diskJSONpath);
							if(!rawDiskJSON) {
								console.log('could not read updated media metadata');
								return res.apiError({
									success: false,
									note: 'could not read media metadata file'
								});
							} else {
								// add new metadata to loaded object
								var obj = JSON.parse(rawDiskJSON);
								obj.disk.ipfsHash = files[files.length - 1].hash;
								// save new metadata
								fs.writeFile(diskJSONpath, JSON.stringify(obj, null, 4), 'utf8', function (err) {
									if(err){
										console.log('error saving setup json' + err);
										return res.apiError({
											success: false,
											note: 'could not update media with shared hash'
										});					
									}else{
										// finished
										return res.apiResponse({
											success: true,
											note: 'shared media'
										});
									}
								})
							}
						}

					}
				});
			}
		});
	});
};

/**
 * Play Sketch by URL
 */
exports.queue = function (req, res) {
	// stop autoplay
	if(autoplay){
		clearInterval(autoplay);
	}
	if (!isDplayerConnected) {
		console.log('play error: player not connected');
		return res.apiError({
			success: false,
			note: 'renderer not connected'
		});
	}
	if (ipc.of.dplayeripc) {
		var sketchPath = req.body.address;
		ipc.of.dplayeripc.emit('message', sketchPath);
		return res.apiResponse({
			success: true,
			note: 'queued sketch URL'
		});
	} else {
		return res.apiError({
			success: false,
			note: 'could not queue sketch URL'
		});
	}
};

/**
 * Drop database and rebuild after scanning directories
 */
exports.initialise = function (req, res) {
	// check data paths exist
	var dataPath = (process.env.D1_DATA_PATH ? process.env.D1_DATA_PATH : '/data/content/');
	var dataPathExists = fs.existsSync(dataPath);
	if(!dataPathExists){
		if(process.env.D1_DATA_PATH){
			return res.apiError({
				success: false,
				note: 'data path does not exist'
			});	
		}else{
			// create data directories
			try{
			fs.mkdirSync('/data/content');
			fs.mkdirSync('/data/content/view-static');
			fs.mkdirSync('/data/content/config-static');
			} catch (err) {
				if(err.code !== 'EEXIST') {
					return res.apiError({
						success: false,
						note: 'could not create content directories while initialising'
					});			
				}
			}
		}
	}

	// load Profile (colour calibration/hyperion config)
	var hyperionConfigPath = path.join(res.locals.configStaticPath, '/hyperion.config.json');
	var hyperionConfExists = fs.existsSync(hyperionConfigPath);
	if (hyperionConfExists) {
		var hyperionConfig = fs.readFileSync(hyperionConfigPath);
		if (!hyperionConfig) {
			//
			console.log('could not find hyperion config file in media init');
		} else {
			var hyperionConfigJSON = JSON.parse(hyperionConfig);
			keystone.list('Profile').model.find().exec(function (err, results) {
				if (err || !results.length) {
					console.log('could not get Profile from database');
				}
				// shorthand
				var profile = results[0];
				var hyperionChannels = hyperionConfigJSON.color.channelAdjustment[0];
				// set profile from JSON
				profile.colOrder = hyperionConfigJSON.device.colorOrder;
				profile.redR = hyperionChannels.pureRed.redChannel;
				profile.redG = hyperionChannels.pureRed.greenChannel;
				profile.redB = hyperionChannels.pureRed.blueChannel;
				profile.greenR = hyperionChannels.pureGreen.redChannel;
				profile.greenG = hyperionChannels.pureGreen.greenChannel;
				profile.greenB = hyperionChannels.pureGreen.blueChannel;
				profile.blueR = hyperionChannels.pureBlue.redChannel;
				profile.blueG = hyperionChannels.pureBlue.greenChannel;
				profile.blueb = hyperionChannels.pureBlue.blueChannel;
				// save profile
				profile.save(function (err) {
					if (err) {
						return res.apiError({
							success: false,
							note: 'could not initialise profile'
						});
					} else {
						console.log('initialised profile from saved config');
					}
				});
			});
		}
	}
	// drop sketches in database
	Media.model.find(function (err, items) {
		if (err) {
			return res.apiError({
				success: false,
				note: 'could not get media from database: ' + err
			});
		}
		// console.log(items.length);
		for (var i = 0; i < items.length; i++) {
			items[i].remove(function (err) {
				if (err) {
					return res.apiError({
						success: false,
						note: 'could not drop media from database'
					});
				}
			});
		}
	});
	// drop channels in database
	MediaChannel.model.find(function (err, items) {
		if (err) {
			return res.apiError({
				success: false,
				note: 'could not get channels from database: ' + err
			});
		}
		for (var i = 0; i < items.length; i++) {
			items[i].remove(function (err) {
				if (err) {
					return res.apiError({
						success: false,
						note: 'could not drop channel from database'
					});
				}
			});
		}
	});
	// scan sketch directory
	var newItems = {
		MediaChannel: [],
		Media: []
	};
	// scan sketch directory
	fs.readdir(res.locals.viewStaticPath, function (err, files) {
		if (err) {
			return res.apiError({
				success: false,
				note: 'could not read media folder'
			});
		}
		// iterate through each sketch directory
		for (var i = 0; i <= files.length; i++) {
			// store sketch db info
			if (i < files.length) {
				// check for disk.json
				var diskJSONpath = path.join(res.locals.viewStaticPath + files[i] + '/disk.json');
				var exists = fs.existsSync(diskJSONpath);
				if (exists) {
					// read json
					var rawDiskJSON = fs.readFileSync(diskJSONpath);
					if (!rawDiskJSON) {
						console.log('could not read media details');
						return res.apiError({
							success: false,
							note: 'could not read media details'
						});
					} else {
						// add sketch to database
						var obj = JSON.parse(rawDiskJSON);
						if(obj.disk.channels){
							for(var k=0; k<obj.disk.channels.length; k++){
								newItems.MediaChannel.push({
									"name": obj.disk.channels[k],
									"__ref": obj.disk.channels[k]
								});
							}
						}
						newItems.Media.push({
							"title": obj.disk.title ? obj.disk.title : files[i],
							"modifiedDate": obj.disk.modifiedDate ? obj.disk.modifiedDate : "2018-1-1",
							"prefThumb": obj.disk.prefThumb ? obj.disk.prefThumb : null,
							"state": obj.disk.state ? obj.disk.state : "published",
							"ipfsHash": obj.disk.ipfsHash ? obj.disk.ipfsHash : null,
							"localDir": files[i],
							"channels": obj.disk.channels ? obj.disk.channels : null,
						});
					}
				} else {
					// TODO make disk.json
					// add sketch to db
					newItems.Media.push({
						"title": files[i],
						"state": "published",
						"localDir": files[i],
					});
				}
			} else {
				// add to database when all sketches are added
				keystone.createItems(newItems, function (err, stats) {
					if (err) {
						return res.apiError({
							success: false,
							note: 'could not update database ' + err
						});
					} else {
						res.apiResponse({
							success: true,
							note: 'added sketches to database',
							list: newItems,
						});
					}
				});
			}
		}
	});
};

/**
 * Get IPFS identity
 */
exports.identity = function (req, res) {
	ipfs.id(function (err, identity) {
		if (err) {
			return res.apiError({
				success: false,
				note: 'ipfs error'
			});
		} else {
			return res.apiResponse({
				success: true,
				note: 'ID: ' + identity.id,
			});
		}
	});
};

/**
 * Download Media from IPFS
 */
exports.download = function (req, res) {
	if (req.params.ipfs) {
		// // check if hash is already in database
		// Sketch.model.findOne({
		// 	ipfsHash: req.params.ipfs
		// }).exec(function (err, result) {
		// 	// IPFS hash is already in database
		// 	if (result) {
		// 		res.apiResponse({
		// 			success: false
		// 		});
		// 	}
		// });
		// try add IPFS hash
		var ipfsURI = '/ipfs/' + req.params.ipfs;
		ipfs.files.get(ipfsURI, function (err, files) {
			if (err) {
				console.log(err);
				res.apiResponse({
					success: false,
					error: err
				});
			} else {
				// check existing database
				Media.model.findOne({
					ipfsHash: req.params.ipfs
				}).exec(function (dberr, result) {
					if (result) {
						res.apiResponse({
							success: false,
							duplicates: result
						});
					} else {
						// save each file
						var saveDir = req.params.ipfs;
						var sketchPath = res.locals.staticPath + saveDir;
						files.forEach((file) => {
							if (file.content) {
								var fileName = file.path.slice(46); // trim ipfs hash
								var fileDir = path.dirname(fileName);
								fileDir
									.split(path.sep)
									.reduce((currentPath, folder) => {
										currentPath += folder + path.sep;
										if (!fs.existsSync(path.join(sketchPath, currentPath))) {
											try {
												fs.mkdirSync(path.join(sketchPath, currentPath));
											} catch (fserr) {
												if (fserr.code !== 'EEXIST') {
													throw fserr;
												}
											}
										}
										return currentPath;
									}, '');
								var fileURI = sketchPath + fileName;
								fs.writeFile(fileURI, file.content, 'binary', (fserr) => {
									if (fserr) {
										console.log(fserr);
										res.apiResponse({
											success: false,
											note: 'Error saving file...',
											error: fserr
										});
									}
								});
							}
						});
						// add to database
						var application = new Media.model();
						var updater = application.getUpdateHandler(req);
						var data = {
							title: saveDir,
							ipfsHash: req.params.ipfs,
							localDir: saveDir
						};
						updater.process(data, {
							flashErrors: true
						}, function (upderr) {
							if (upderr) {
								res.apiResponse({
									success: false,
									note: 'Error adding new media to database...',
									error: upderr
								});
							} else {
								res.apiResponse({
									success: true,
									sketch: files
								});
							}
						});
					}
				});
			}
		});
	} else {
		// no IPFS key added
		res.apiResponse({
			success: false,
			error: "no ipfs key aded"
		});
	}
};

/**
 * Play collection of media cyclically
 */
var autoplay;
var autoplayCount = 0;
exports.autoplay = function (req, res) {
	if(!req.query.secs){
			return res.apiError({
				success: false,
				note: 'no interval set'
			});
	}else{
		// get interval in ms
		var interval = req.query.secs * 1000;
		// get media array
		if(!req.query.channel){
			return res.apiError({
				success: false,
				note: 'no channel set'
			});
		}else{
			// query database
			Media.model.find().where('state','published').sort('-publishedDate').populate('channels').where('channels').in([req.query.channel]).exec(function(err, results) {
				if(err) {
					//
				}else{
					var mediaArray = [];
					for(var i=0; i<results.length; i++){
						mediaArray.push(results[i].localDir);
					}
					autoplayMedia = mediaArray;
					console.log(mediaArray);
					autoplay = setInterval(function(media) {
						// media to play
						var currentMedia = media[autoplayCount%media.length];
						var mediaPath = 'file:///' + res.locals.staticPath + currentMedia + '/index.html';
						console.log(mediaPath);
						if (isDplayerConnected) {
							ipc.of.dplayeripc.emit('message', mediaPath);
						}
						autoplayCount++;
					}, interval, mediaArray);
					return res.apiResponse({
						success: true,
						note: 'werarfe'
					});
				}
			});
		}
	}
};

