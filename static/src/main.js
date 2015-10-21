var Ractive = require('ractive'),
    mqtt    = require('mqtt'),
    Promise = require('es6-promise').Promise,
    url     = require('url');

var time = require('./time');

// WHAT-WG Fetch API polyfill
require('whatwg-fetch');

var conditions = require('./conditions');

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
  return new Ractive({
    el: '#container',
    template: template,
    data: {
      iso: 400,
      lightLevelRaw: 0
    },
    computed: {
      timeSecs: function () {
        var c = this.get('conditions'),
            iso = this.get('iso');
        if (c && c.exposure[iso]) {
          return c.exposure[iso];
        } else {
          return null;
        }
      },
      exposure: function () {
        var timeSecs = this.get('timeSecs');
        return time.splitIntoParts(timeSecs);
      },
      lightLevel: function () {
        return 1024 - this.get('lightLevelRaw');
      },
      lightLevelPercent: function () {
        return Math.floor(
          (this.get('lightLevel') / 1024) * 100
        );
      },
      conditions: function () {
        return conditions.info(this.get('lightLevel'));
      }
    }
  });
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
