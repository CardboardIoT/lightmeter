var first = require('lodash').first,
    throttle = require('lodash').throttle;

var Espruino = require('./lib/espruino'),
    Receiver = require('./lib/receiver'),
    mqtt = require('./lib/mqtt');

var log = console.log.bind(console);

findAvailableEspruino()
  .then(connectReceiverAndMqtt)
  .catch(errorAndExit);

function findAvailableEspruino() {
  return Espruino
    .findEspruinos()
    .then(first)
    .then(function (serialPort) {
      if (!serialPort) {
        throw new Error('No serial port found');
      } else {
        return serialPort;
      }
    })
    .catch(errorAndExit);
}

function connectReceiverAndMqtt(serialPort) {
  var receiver = new Receiver(serialPort),
      client = mqtt.connect();

  process
    .on('SIGINT', createGracefulExit(receiver))
    .on('SIGTERM', createGracefulExit(receiver));

  client.on('connect', function () {
    console.log('Connected');
    receiver.on(
      'data',
      createPublisher(receiver, client)
      // throttle(createPublisher(receiver, client), 1000)
    );
  });

  client.on('error', function (err) {
    console.error(err);
  });

  return receiver;
}

function createPublisher(receiver, client) {
  return function (data) {
    var topic = 'ciot/lightmeter/value',
        value = data.value.toString();
    console.log('Publishing', topic, value);
    client.publish(topic, value);
  }
}

function createGracefulExit(receiver) {
  return function () {
    receiver.close();
    process.exit();
  }
}


function errorAndExit(err) {
  console.error(err);
  process.exit(1);
}
