var mqtt = require('./lib/mqtt');

connectMqtt();

function connectMqtt() {
  var client = mqtt.connect();

  client.on('connect', function () {
    console.log('Connected');
    var topic = 'ciot/lightmeter/value';
    client.subscribe(topic);
  });

  client.on('message', function (topic, msg) {
    console.log(msg.toString());
  });

  return client;
}
