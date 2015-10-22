var five = require("johnny-five");

var mqtt = require('./lib/mqtt');

var client,
    board,
    photoresistor;

client = mqtt.connect();
board = new five.Board({ repl: false });

board.on('ready', function() {

  // Create a new `photoresistor` hardware instance.
  photoresistor = new five.Sensor({
    pin: 'A2',
    freq: 250
  });

  // "data" get the current reading from the photoresistor
  photoresistor.on('data', function() {
    var topic = 'ciot/lightmeter/value',
        value = this.value.toString();
    client.publish(topic, value, { retain: true });
    console.log('Published:', topic, value);
  });
});

// References
//
// http://nakkaya.com/2009/10/29/connecting-a-photoresistor-to-an-arduino/
