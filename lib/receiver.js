var debug = require('debug')('sensors:receiver'),
    Promise = require('es6-promise').Promise,
    serialport = require('serialport'),
    EventEmitter = require('events').EventEmitter,
    inherits = require('util').inherits,
    _ = require('lodash');

var Receiver = function (serialPort) {
  var self = this;
  this.serial = null;
  this.lastRfid = null;
  this.connected = connect(serialPort);

  this.connected
    .then(function (serial) {
      debug('Receiver connected');
      self.serial = serial;

      // Force load command (fix for Pi)
      serial.write('load();\n');

      serial.on('data', function (data) {
        debug('data', data);
        try {
          self.handleMessage( JSON.parse(data) );
        } catch (e) {
          // do nothing
        }
      });
      serial.on('disconnect', function () {
        self.emit('disconnect');
      });
    });
};

inherits(Receiver, EventEmitter);

Receiver.prototype.close = function () {
  if (this.serial) { this.serial.close(); }
};

Receiver.prototype.send = function (msg) {
  var data = 'incoming(' + JSON.stringify(msg) + ')\n';
  if (this.serial) {
    this.serial.write( data );
  }
};

function hexify(acc, curr) {
  return acc + curr.toString(16);
}

Receiver.prototype.handleMessage = function (msg) {
  debug('handle message');
  this.emit('data', msg);
}

module.exports = Receiver;

function connect(serialPort) {
  debug('connect', serialPort);
  return new Promise(function (resolve, reject) {
    var conn = new serialport.SerialPort(serialPort, {
                  baudrate: 9600,
                  parser: serialport.parsers.readline('\n')
                }, false);
    conn.open(function (err) {
      debug('opened: ', serialPort, err);
      if (err) {
        conn.close();
        reject(err);
      } else {
        resolve(conn);
      }
    });
  });
}

function error() {
  console.error(err.stack);
}
