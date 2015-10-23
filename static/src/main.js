var mqtt    = require('mqtt');

var config = require('../../config/default.json'),
    LightMeterWidget = require('./widget');

init();

function init() {
  console.log('init', config);

  var lightTopic = 'ciot/pinhole/light/value';

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
