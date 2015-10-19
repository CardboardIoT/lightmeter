/*
  Find by serial number process inspired by
  https://github.com/mudcube/node-espruino
*/
var debug = require('debug')('sensors:espruino'),
    Promise = require('es6-promise').Promise,
    serialport = require('serialport'),
    spawn = require('child_process').spawn,
    _ = require('lodash');

module.exports = {
  findEspruinos: findEspruinos,
  findBySerialNumber: findBySerialNumber,
  upload: upload,
  save: save
};

function connectAndExecuteCommand(command, filterRegexp, port) {
  return new Promise(function (resolve, reject) {
    debug('port', port.comName);

    var query = new serialport.SerialPort(port.comName, {
                  baudrate: 9600,
                  parser: serialport.parsers.readline('\n')
                }, false),
        timeoutId;

    query.open(function (err) {
      debug('open', port.comName);

      if (err) {
        debug('error', port.comName, err.stack);
        resolve();
      } else {
        //were only going to wait 500 msec for this to finish
        timeoutId = setTimeout(function() {
          debug('timeout', port.comName);
          query.close();
          resolve();
        }, 500);

        query.on('data', function (data) {
          var str = data.toString(),
              matches = filterRegexp.exec(str);

          if (matches && matches.length > 0) {
            debug('found', port.comName);
            clearTimeout(timeoutId);
            query.close();

            resolve({
              port: port.comName,
              value: matches[1]
            });
          }
        });

        query.write(command + '\n');
      }
    });
  });
}

function getSerialFromPort (port) {
  return connectAndExecuteCommand(
    'getSerial()',
    /\"([0-9a-f-]+)\"/,
    port
  );
};

function isEspruinoFromPort (port) {
  return connectAndExecuteCommand(
    'process.version',
    /\"([0-9a-z.-]+)\"/,
    port
  );
};

function findBySerialNumber(serialNum) {
  return new Promise(function (resolve, reject) {
    serialport.list(function (err, ports) {
      if (ports.length === 0) {
        resolve();
      }

      Promise
        .all( ports.map(getSerialFromPort) )
        .then(function (serials) {
          // debug('serials', serials);
          var matching = _.chain(serials)
            .compact()
            .find(function(serial) { return serial.value === serialNum; })
            .value();

          return matching;
        })
        .then(function (matching) {
          resolve( matching );
        });
    });
  });
}

function findEspruinos() {
  return new Promise(function (resolve, reject) {
    serialport.list(function (err, ports) {
      if (ports.length === 0) {
        resolve();
      }

      Promise
        .all( ports.map(isEspruinoFromPort) )
        .then(function (espruinos) {
          var matching = _.chain(espruinos)
            .map(getSerialPortValue)
            .compact()
            .value();

          return matching;
        })
        .then(function (matching) {
          debug('Found espruino on ports: ', matching);
          resolve( matching );
        });
    });
  });
}

function getSerialPortValue(info) {
  var port = info ? info.port : null;
  return port;
}

function upload(serialPort, filePath) {
  var process;
  debug('upload', serialPort, filePath);
  return new Promise(function (resolve, reject) {
    var cmd = 'espruinotool',
        args = ['--verbose' , '--port', serialPort, filePath]

    debug(cmd, args);

    process = spawn(cmd,  args);
    process.on('error', reject);
    process.on('close', resolve);
  });
}

function save(port) {
  debug('save', port);
  return connectAndExecuteCommand(
    'save()',
    /.*/,
    { comName: port }
  );
}
