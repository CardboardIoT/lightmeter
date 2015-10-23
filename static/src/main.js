var mqtt    = require('mqtt');

var LightMeterWidget = require('./widget');

// WHAT-WG Fetch API polyfill
require('whatwg-fetch');

fetchConfig()
  .then(init)
  .catch(console.error.bind(console));

function init(config) {
  console.log('init', config);

  var lightTopic = 'ciot/lightmeter/value';

  var lightMeter = new LightMeterWidget(null, true /* use default conditions */);

  var client  = mqtt.connect({
    hostname: config.brokerUi.hostname,
    protocol: config.brokerUi.protocol,
    port: config.brokerUi.port
  });

  client.on('connect', function () {
    client.subscribe(lightTopic);
  });

  client.on('message', function (topic, payload) {
    var message = payload.toString();
    if (topic === lightTopic) {
      lightMeter.setLightLevel(message);
    }
  });

}

function fetchConfig() {
  return fetch('config.json')
    .then(function (res) {
      return res.json();
    });
}
