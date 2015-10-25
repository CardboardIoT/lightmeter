var mqtt    = require('mqtt');

var config = require('../../config/default.json'),
    LightMeterWidget = require('./widget');

init();

function init() {
  var id = process.env.ID;
  var lightTopic = 'ciot/pinhole/' + (id ? id + '/' : '') + 'light/value';

  var lightMeter = new LightMeterWidget();
  lightMeter.addLightingCondition(LightMeterWidget.defaults);

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
