var mqtt    = require('mqtt'),
    Promise = require('es6-promise').Promise,
    url     = require('url');

var Widget = require('./widget');

// WHAT-WG Fetch API polyfill
require('whatwg-fetch');

// Start
init();

function init() {
  Promise.all([
    fetchTemplateAndInitUi(),
    fetchConfigAndCreateClient()
  ])
    .then(function (params) {
      var widget = params[0],
          client = params[1];
      subscribeMessagesToUi(widget, client);
    })
    .catch(function (err) {
      console.error(err);
    });
}

function fetchConfigAndCreateClient() {
  return fetchConfig()
    .then(createClientAndSubscribe);
}

function fetchConfig() {
  return fetch('config.json')
    .then(function (res) {
      return res.json();
    });
}

function createClientAndSubscribe(config) {
  var topic = '#',
      brokerUrl = url.format({
        protocol: config.brokerUi.protocol,
        hostname: config.brokerUi.hostname,
        port: config.brokerUi.port
      });
  console.log('brokerUrl', brokerUrl);
  return new Promise(function(resolve, reject) {
    var client = mqtt.connect(brokerUrl);
    client.on('connect', function () {
      resolve(client);
    });
  });
}

function fetchTemplateAndInitUi() {
  return fetchTemplate()
    .then(initUiWithTemplate)
    .then(function (widget) {
      window.widget = widget;
      return widget;
    });
}

function fetchTemplate() {
  return fetch('ui.tmpl')
    .then(function (res) {
      return res.text();
    });
}

function initUiWithTemplate(template) {
  return new Widget(template);
}

function subscribeMessagesToUi(widget, client) {
  var lightLevelTopic = 'ciot/lightmeter/value';
  client.subscribe(lightLevelTopic);
  client.on('message', function (topic, msg) {
    if (lightLevelTopic === topic) {
      widget.setLightLevel(msg.toString());
    }
  });
}
