var mqtt    = require('mqtt'),
    Promise = require('es6-promise').Promise,
    url     = require('url');

var ui = require('./ui');

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
      var ui = params[0],
          client = params[1];
      subscribeMessagesToUi(ui, client);
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
        protocol: 'wss',
        hostname: config.broker.hostname,
        port: config.broker.wsPort
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
    .then(function (ui) {
      window.ui = ui;
      return ui;
    });
}

function fetchTemplate() {
  return fetch('ui.tmpl')
    .then(function (res) {
      return res.text();
    });
}

function initUiWithTemplate(template) {
  return ui.create(template);
}

function subscribeMessagesToUi(ui, client) {
  var lightLevelTopic = 'ciot/lightmeter/value';
  client.subscribe(lightLevelTopic);
  client.on('message', function (topic, msg) {
    if (lightLevelTopic === topic) {
      ui.animate('lightLevelRaw', msg.toString());
    }
  });
}
