var mqtt = require('mqtt'),
    fs = require('fs'),
    url = require('url'),
    config = require('config');

module.exports.connect = function () {
  var caCert,
      mqttBroker = url.format( config.get('brokerNode') ),
      instance;

  if (config.get('brokerNode.caFile')) {
    caCert = fs.readFileSync('./certs/' + config.get('brokerNode.caFile'));
  }

  console.log('Connecting to: ', mqttBroker);

  instance = mqtt.connect(mqttBroker, { ca: caCert });

  return instance;
}

/*
  ciot/kit0/<device>/<action>/<type>
*/
module.exports.topicForParams = function topic(p) {
  return [ 'ciot/kit0', p.device, p.action, p.type ].join('/')
}
